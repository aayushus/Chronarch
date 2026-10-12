import asyncio
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from cryptography.fernet import Fernet
import pytest
from sqlalchemy import event, select, text

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
from chronarch_core.models.enums import ActorType, BookingStatus, CalendarKind, ProviderType, UserRole
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


def test_recurrence_limit_one_does_not_expand_the_entire_window(monkeypatch):
    import dateutil.rrule

    start = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    inspected = [0]

    class CountingRule:
        """Stands in for dateutil's rrule: `xafter` streams, `between` does not.

        Real `rrule.between()` returns a fully materialized list, so a double
        that faked it as a generator would let a non-streaming implementation
        pass. Both methods are instrumented to fail past the limit.
        """

        def xafter(self, dt, count=None, inc=False):
            for index in range(100):
                inspected[0] += 1
                if inspected[0] > 2:
                    raise AssertionError("recurrence expansion was not lazy")
                yield start + timedelta(days=index)

        def between(self, window_start, window_end, inc=True):
            for index in range(100):
                inspected[0] += 1
                if inspected[0] > 2:
                    raise AssertionError("between() materializes the whole window")
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


def test_recurrence_limit_bounds_work_for_a_real_high_frequency_rule():
    """Regression guard using a genuine dateutil rule, no test double.

    `FREQ=SECONDLY` over a year is ~31.5M occurrences. Expanding it even once
    takes seconds and hundreds of MB; returning the 5 requested must not.
    """
    start = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    event = SimpleNamespace(
        start=start,
        end=start + timedelta(hours=1),
        recurrence={"rule": ["RRULE:FREQ=SECONDLY"]},
    )

    began = time.perf_counter()
    result = recurrence.occurrences(
        event,
        start,
        start + timedelta(days=365),
        limit=5,
    )
    elapsed = time.perf_counter() - began

    assert len(result) == 5
    # Generous ceiling: the materializing version needs >5s and ~1GB here.
    assert elapsed < 1.0, f"expansion took {elapsed:.2f}s — window was materialized"


def test_recurrence_expansion_does_not_leak_occurrences_past_the_window():
    """A series starting after the window must yield nothing, and must stay bounded."""
    start = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    series_start = start + timedelta(days=365)  # series begins after the window closes
    event = SimpleNamespace(
        start=series_start,
        end=series_start + timedelta(hours=1),
        recurrence={"rule": ["RRULE:FREQ=SECONDLY"]},
    )

    result = recurrence.occurrences(
        event,
        start,
        start + timedelta(days=30),
        limit=5,
    )

    assert result == []


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
    ev = UnifiedEvent(
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="perf-event",
        title="Meeting",
        start=datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 24, 16, 0, tzinfo=timezone.utc),
        attendees=[
            {"email": f"person-{index}@example.com", "name": f"Person {index}"}
            for index in range(25)
        ],
    )
    session.add_all([user, account, calendar, ev])
    await session.flush()
    statements = []

    def count_selects(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = session.sync_session.bind
    event.listen(engine, "before_cursor_execute", count_selects)
    try:
        await contacts.refresh_contacts_for_account(session, account.id)
    finally:
        event.remove(engine, "before_cursor_execute", count_selects)

    # 25 attendees. An un-batched (one query per sighting) implementation
    # issues 26+ SELECTs here; the batched one issues 2 (events, then contacts).
    assert len(statements) <= 3, f"{len(statements)} SELECTs:\n" + "\n".join(statements)


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
        id="fk-link",
        owner_user_id=user.id,
        slug="fk-booking",
        title="Intro",
        calendar_id=calendar.id,
    )
    start = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)
    event = UnifiedEvent(
        id="fk-event",
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="fk-event",
        title="Intro",
        start=start,
        end=start + timedelta(hours=1),
    )
    booking = Booking(
        id="fk-booking",
        link_id=link.id,
        booker_name="Booker",
        booker_email="booker@example.com",
        start=start,
        end=start + timedelta(hours=1),
        status=BookingStatus.CONFIRMED,
        event_id=event.id,
    )
    session.add(user)
    await session.flush()
    session.add(account)
    await session.flush()
    session.add(calendar)
    await session.flush()
    session.add(link)
    session.add(event)
    await session.flush()
    session.add(booking)
    await session.flush()

    await booking_module.cancel_booking(session, booking)

    assert booking.status == BookingStatus.CANCELLED
    # `cancel_booking` must clear event_id *before* the event row is deleted.
    # Nulling it afterwards leaves `booking` pointing at a deleted row, and the
    # flush below raises IntegrityError under the PRAGMA enabled at the top.
    assert booking.event_id is None
    await session.flush()
    remaining = await session.execute(
        select(UnifiedEvent.id).where(UnifiedEvent.id == event.id)
    )
    assert remaining.scalar_one_or_none() is None, "provider event row should be gone"


async def test_get_events_sql_window_pruning(session):
    # COV-004: Ensure get_events pushes start < window_end and end > window_start
    # down to SQL for non-recurring events so out-of-window rows are pruned before Python.
    from chronarch_core.ai_tools.tools import get_events
    from chronarch_core.permissions import AuthContext

    user = User(
        id="cov4-user",
        email="cov4@example.com",
        display_name="COV4 User",
        password_hash="x",
        role=UserRole.ADMIN,
    )
    account = Account(
        id="cov4-acc",
        owner_user_id=user.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=user.email,
        provider_account_id="cov4-prov",
    )
    calendar = Calendar(
        id="cov4-cal",
        account_id=account.id,
        provider_calendar_id="cov4-cal-p",
        kind=CalendarKind.PRIMARY,
        name="Work",
        provider_writable=True,
        blocks_availability=True,
    )
    # Event 1: in window
    in_win = UnifiedEvent(
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="e-in",
        title="In Window",
        start=datetime(2026, 9, 24, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 24, 11, 0, tzinfo=timezone.utc),
    )
    # Event 2: completely in the past
    past = UnifiedEvent(
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="e-past",
        title="Past Event",
        start=datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 1, 11, 0, tzinfo=timezone.utc),
    )
    # Event 3: completely in the future
    future = UnifiedEvent(
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="e-future",
        title="Future Event",
        start=datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc),
    )
    # Event 4: recurring event (master in past, but recurring so must be fetched and expanded)
    rec = UnifiedEvent(
        provider_account_id=account.id,
        calendar_id=calendar.id,
        provider_event_id="e-rec",
        title="Daily Standup",
        start=datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 1, 9, 30, tzinfo=timezone.utc),
        recurrence={"rule": "RRULE:FREQ=DAILY"},
    )
    session.add_all([user, account, calendar, in_win, past, future, rec])
    await session.flush()

    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI, is_admin=True)
    results = await get_events(
        session,
        ctx,
        window_start=datetime(2026, 9, 24, 0, 0, tzinfo=timezone.utc),
        window_end=datetime(2026, 9, 25, 0, 0, tzinfo=timezone.utc),
        calendar_ids=[calendar.id],
    )
    titles = [e.title for e in results]
    assert "In Window" in titles
    assert "Daily Standup" in titles
    assert "Past Event" not in titles
    assert "Future Event" not in titles

