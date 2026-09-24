import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from cryptography.fernet import Fernet
import pytest
from sqlalchemy import event, text

from chronarch_core import booking as booking_module
from chronarch_core import contacts
from chronarch_core import recurrence
from chronarch_core.availability import find_free_slots
from chronarch_core.booking import HoldStore
from chronarch_core.crypto import TokenCipher, rotate_all_encrypted_data
from chronarch_core.models.account import Account
from chronarch_core.models.booking import Booking, BookingLink
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.contact import Contact
from chronarch_core.models.enums import BookingStatus, CalendarKind, ProviderType, UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User


async def test_hold_store_concurrent_acquire_has_one_winner():
    HoldStore._memory.clear()
    store = HoldStore(None)
    start = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)

    results = await asyncio.gather(
        *(store.acquire("link-1", start) for _ in range(32))
    )
    winners = [token for token in results if token is not None]

    assert len(winners) == 1
    assert await store.verify("link-1", start, winners[0]) is True
    HoldStore._memory.clear()


async def test_hold_store_ttl_uses_a_controlled_clock(monkeypatch):
    HoldStore._memory.clear()
    now = [0.0]
    monkeypatch.setattr(booking_module.time, "monotonic", lambda: now[0])
    store = HoldStore(None)
    start = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)

    token = await store.acquire("link-ttl", start)
    now[0] = booking_module.HOLD_TTL_SECONDS - 1
    assert await store.verify("link-ttl", start, token) is True
    assert await store.acquire("link-ttl", start) is None

    now[0] = booking_module.HOLD_TTL_SECONDS + 1
    replacement = await store.acquire("link-ttl", start)
    assert replacement != token
    assert await store.verify("link-ttl", start, token) is False
    HoldStore._memory.clear()


@pytest.mark.xfail(
    strict=True,
    reason="expired memory holds are not proactively pruned",
)
async def test_expired_memory_holds_are_bounded(monkeypatch):
    HoldStore._memory.clear()
    now = [0.0]
    monkeypatch.setattr(booking_module.time, "monotonic", lambda: now[0])
    store = HoldStore(None)
    start = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)

    for index in range(100):
        await store.acquire(f"link-{index}", start + timedelta(minutes=index))
    now[0] = booking_module.HOLD_TTL_SECONDS + 1
    await store.acquire("new-link", start)

    assert len(HoldStore._memory) <= 10
    HoldStore._memory.clear()


def test_availability_result_limit_caps_large_gap_sets():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = [
        SimpleNamespace(
            id=f"event-{index}",
            calendar_id="cal-1",
            start=start + timedelta(hours=index * 2),
            end=start + timedelta(hours=index * 2, minutes=30),
            busy_status="busy",
        )
        for index in range(100)
    ]

    slots = find_free_slots(
        start,
        start + timedelta(hours=250),
        timedelta(minutes=30),
        events,
        {"cal-1"},
        max_results=7,
    )

    assert len(slots) == 7


@pytest.mark.xfail(
    strict=True,
    reason="availability accepts non-positive durations",
)
def test_availability_rejects_non_positive_duration():
    start = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        find_free_slots(
            start,
            start + timedelta(hours=1),
            timedelta(0),
            [],
            {"cal-1"},
        )


def test_recurrence_output_is_capped_for_unbounded_series():
    start = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    event = SimpleNamespace(
        start=start,
        end=start + timedelta(hours=1),
        recurrence={"rule": ["RRULE:FREQ=DAILY;COUNT=5000"]},
    )

    occurrences = recurrence.occurrences(
        event,
        start,
        start + timedelta(days=365 * 20),
    )

    assert len(occurrences) == recurrence.MAX_OCCURRENCES


@pytest.mark.xfail(
    strict=True,
    reason="recurrence limit is applied after materializing the full rule",
)
def test_recurrence_limit_one_does_not_expand_the_entire_window(monkeypatch):
    import dateutil.rrule

    start = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    inspected = [0]

    class CountingRule:
        def between(self, window_start, window_end, inc=True):
            for index in range(100):
                inspected[0] += 1
                if inspected[0] > 2:
                    raise AssertionError("recurrence expansion was not lazy")
                yield start + timedelta(days=index)

    monkeypatch.setattr(
        dateutil.rrule,
        "rrulestr",
        lambda *args, **kwargs: CountingRule(),
    )
    event = SimpleNamespace(
        start=start,
        end=start + timedelta(hours=1),
        recurrence={"rule": ["RRULE:FREQ=DAILY"]},
    )

    result = recurrence.occurrences(
        event,
        start,
        start + timedelta(days=365),
        limit=1,
    )

    assert len(result) == 1
    assert inspected[0] <= 2


async def test_contact_search_limit_is_bounded(session):
    session.add_all(
        [
            Contact(email=f"person-{index}@example.com", display_name=f"Person {index}")
            for index in range(100)
        ]
    )
    await session.flush()

    results = await contacts.search_contacts(session, "", limit=5000)

    assert len(results) == 50


@pytest.mark.xfail(
    strict=True,
    reason="ambiguous contact resolution returns an unbounded candidate list",
)
async def test_ambiguous_contact_results_are_capped(session):
    session.add_all(
        [
            Contact(email=f"sam-{index}@example.com", display_name=f"Sam {index}")
            for index in range(20)
        ]
    )
    await session.flush()

    result = await contacts.resolve_contact(session, "sam")

    assert result["status"] == "ambiguous"
    assert len(result["candidates"]) <= 10


@pytest.mark.xfail(
    strict=True,
    reason="contact refresh performs one contact query per sighting",
)
async def test_contact_refresh_uses_a_bounded_query_count(session):
    user = User(
        id="perf-owner",
        email="perf-owner@example.com",
        display_name="Owner",
        password_hash="x",
        role=UserRole.ADMIN,
    )
    account = Account(
        id="perf-account",
        owner_user_id=user.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=user.email,
        provider_account_id="perf-provider",
    )
    calendar = Calendar(
        id="perf-calendar",
        account_id=account.id,
        provider_calendar_id="perf-provider-calendar",
        kind=CalendarKind.PRIMARY,
        name="Work",
        provider_writable=True,
        blocks_availability=True,
    )
    event = UnifiedEvent(
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="perf-event",
        title="Meeting",
        start=datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 24, 16, 0, tzinfo=timezone.utc),
        attendees=[
            {"email": f"person-{index}@example.com", "name": f"Person {index}"}
            for index in range(5)
        ],
    )
    session.add_all([user, account, calendar, event])
    await session.flush()
    statements = []

    def count_selects(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = session.sync_session._engine
    event.listen(engine, "before_cursor_execute", count_selects)
    try:
        await contacts.refresh_contacts_for_account(session, account.id)
    finally:
        event.remove(engine, "before_cursor_execute", count_selects)

    assert len(statements) <= 3


@pytest.mark.xfail(
    strict=True,
    reason="CalDAV password ciphertext is omitted from encryption-key rotation",
)
async def test_encryption_rotation_includes_caldav_password(session):
    old_key = Fernet.generate_key().decode()
    new_key = Fernet.generate_key().decode()
    old_cipher = TokenCipher(old_key.encode())
    new_cipher = TokenCipher(new_key.encode())
    account = Account(
        id="rotation-caldav",
        owner_user_id="rotation-user",
        provider=ProviderType.CALDAV,
        provider_account_email="rotation@example.com",
        provider_account_id="caldav:rotation",
        encrypted_caldav_password=old_cipher.encrypt("caldav-secret"),
    )
    session.add(account)
    await session.flush()

    await rotate_all_encrypted_data(session, old_key, new_key)

    assert new_cipher.decrypt(account.encrypted_caldav_password) == "caldav-secret"


@pytest.mark.xfail(
    strict=True,
    reason="booking cancellation can violate the event foreign key",
)
async def test_booking_cancellation_preserves_database_integrity(session):
    await session.rollback()
    await session.execute(text("PRAGMA foreign_keys=ON"))
    user = User(
        id="fk-owner",
        email="fk-owner@example.com",
        display_name="Owner",
        password_hash="x",
        role=UserRole.ADMIN,
    )
    account = Account(
        id="fk-account",
        owner_user_id=user.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=user.email,
        provider_account_id="fk-provider",
    )
    calendar = Calendar(
        id="fk-calendar",
        account_id=account.id,
        provider_calendar_id="fk-provider-calendar",
        kind=CalendarKind.PRIMARY,
        name="Work",
        provider_writable=True,
        blocks_availability=True,
    )
    link = BookingLink(
        owner_user_id=user.id,
        slug="fk-booking",
        title="Intro",
        calendar_id=calendar.id,
    )
    start = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)
    event = UnifiedEvent(
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="fk-event",
        title="Intro",
        start=start,
        end=start + timedelta(hours=1),
    )
    booking = Booking(
        link_id=link.id,
        booker_name="Booker",
        booker_email="booker@example.com",
        start=start,
        end=start + timedelta(hours=1),
        status=BookingStatus.CONFIRMED,
        event_id=event.id,
    )
    session.add_all([user, account, calendar, link, event, booking])
    await session.flush()

    await booking_module.cancel_booking(session, booking)

    assert booking.status == BookingStatus.CANCELLED
