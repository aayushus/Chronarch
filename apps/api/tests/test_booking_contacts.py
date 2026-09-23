"""Booking → contacts coupling tests (gaps found 2026-09-17).

Regression context: a real booking landed on the calendar but the booker
was invisible in Settings → Contacts. The row existed with event_count=0
while the directory sorts most-met-first under a default limit=10, so it
was cut off the list. These tests pin the fixed behavior:

1. Instant-confirm bookings count the meeting (event_count >= 1).
2. Repeat bookings bump a known contact instead of duplicating it.
3. Approval-mode creates no contact at pending time, exactly one on approve.
4. The default search limit can bury low-count rows (documents why the UI
   must request the full page).
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.routers import booking_links_router as bl
from app.routers import public_booking_router as pub
from app.routers.booking_links_router import BookingLinkCreate
from app.routers.public_booking_router import ConfirmRequest, HoldRequest
from chronarch_core import booking as _booking
from chronarch_core import contacts as _contacts
from chronarch_core.models.account import Account
from chronarch_core.models.booking import Booking, BookingLink
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.contact import Contact
from chronarch_core.models.enums import CalendarKind, ProviderType, UserRole
from chronarch_core.models.user import User


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


async def _host(session, email="host@x.com"):
    user = User(id=f"u-{email}", email=email, display_name="Host",
                password_hash="x", role=UserRole.ADMIN, home_timezone="UTC",
                working_hours_start="09:00", working_hours_end="17:00")
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=ProviderType.GOOGLE,
                      provider_account_email=email, provider_account_id=email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:book",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=True, blocks_availability=True)
    session.add(calendar)
    await session.flush()
    return user, calendar


async def _link(session, user, calendar, slug, **overrides):
    body = BookingLinkCreate(
        title="Intro", calendar_id=calendar.id, duration_minutes=30,
        slug=slug, **overrides)
    return await bl.create_link(body, user=user, session=session)


async def _book(session, slug, slot, name, email):
    held = await pub.hold_slot(slug, HoldRequest(slot_start=slot), session=session)
    return await pub.confirm_slot(
        slug, ConfirmRequest(hold_token=held["hold_token"], slot_start=slot,
                             name=name, email=email), session=session)


async def _contact(session, email):
    return (await session.execute(
        select(Contact).where(Contact.email == email))).scalar_one_or_none()


async def test_instant_booking_leaves_counted_contact(session):
    user, calendar = await _host(session)
    await _link(session, user, calendar, slug="counted")
    out = await _book(session, "counted", _utc(2026, 10, 6, 15, 0),
                      "New Person", "new@person.com")
    assert out["status"] == "confirmed"

    contact = await _contact(session, "new@person.com")
    assert contact is not None, "booker must be added to contacts"
    assert contact.display_name == "New Person"
    assert (contact.event_count or 0) >= 1, \
        f"booking must count as a meeting, got event_count={contact.event_count}"
    assert contact.last_seen_at is not None


async def test_repeat_booking_bumps_instead_of_duplicating(session):
    user, calendar = await _host(session)
    await _link(session, user, calendar, slug="repeat")
    await _book(session, "repeat", _utc(2026, 10, 6, 15, 0), "Regular", "regular@x.com")
    first = await _contact(session, "regular@x.com")
    assert first is not None and first.event_count == 1

    await _book(session, "repeat", _utc(2026, 10, 7, 15, 0), "Regular", "regular@x.com")
    rows = list((await session.execute(
        select(Contact).where(Contact.email == "regular@x.com"))).scalars())
    assert len(rows) == 1, "same email must not create a second row"
    assert rows[0].event_count == 2


async def test_known_contact_keeps_name_and_gains_count(session):
    user, calendar = await _host(session)
    await _link(session, user, calendar, slug="known")
    # Manual row (name-locked, extraction-style count).
    known = await _contacts.create_contact(
        session, email="vip@x.com", display_name="VIP Person")
    known.event_count = 5
    await session.flush()

    await _book(session, "known", _utc(2026, 10, 6, 15, 0),
                "Typed Differently", "vip@x.com")
    contact = await _contact(session, "vip@x.com")
    assert contact.display_name == "VIP Person", "manual names win over booking input"
    assert contact.event_count == 6


async def test_approval_pending_creates_no_contact_until_approved(session):
    user, calendar = await _host(session)
    await _link(session, user, calendar, slug="gated", approval_required=True)

    out = await _book(session, "gated", _utc(2026, 10, 7, 15, 0),
                      "Waiter", "waiter@x.com")
    assert out["status"] == "pending"
    assert await _contact(session, "waiter@x.com") is None, \
        "pending request must not touch the directory (nothing on calendar yet)"

    booking = (await session.execute(
        select(Booking).where(Booking.id == out["booking_id"]))).scalar_one()
    approved = await bl.approve_booking(booking.id, user=user, session=session)
    assert approved["status"] == "confirmed"
    contact = await _contact(session, "waiter@x.com")
    assert contact is not None and (contact.event_count or 0) >= 1


async def test_default_search_limit_buries_newcomers(session):
    """Documents the second half of the bug: default limit=10 + most-met
    ordering hides fresh rows. The UI must request the full page."""
    for i in range(12):
        c = await _contacts.create_contact(
            session, email=f"old{i}@x.com", display_name=f"Old {i}")
        c.event_count = 12 - i  # 12 .. 1
    await session.flush()
    newcomer = await _contacts.create_contact(
        session, email="fresh@x.com", display_name="Fresh")
    newcomer.event_count = 1
    await session.flush()

    default_page = await _contacts.search_contacts(session, "")
    assert len(default_page) == 10
    assert "fresh@x.com" not in {c.email for c in default_page}, \
        "fresh row sorts past the default limit — this hid the booker"

    full_page = await _contacts.search_contacts(session, "", limit=50)
    assert "fresh@x.com" in {c.email for c in full_page}
