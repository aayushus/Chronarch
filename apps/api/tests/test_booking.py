"""Booking engine + endpoint tests (Cal.com-style links).

Holds run on the in-memory fallback (no Redis in tests) — the real
acquire/verify/release path, same as single-process dev. Provider writes
are local-only (tokenless accounts)."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.routers import booking_links_router as bl
from app.routers import public_booking_router as pub
from app.routers.booking_links_router import BookingLinkCreate
from app.routers.public_booking_router import ConfirmRequest, HoldRequest
from chronarch_core import booking as _booking
from chronarch_core.booking import HoldStore
from chronarch_core.models.account import Account
from chronarch_core.models.booking import Booking, BookingLink, normalize_slug
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import BookingStatus, CalendarKind, ProviderType, UserRole
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


async def _link(session, user, calendar, **overrides):
    body = BookingLinkCreate(
        title="Intro", calendar_id=calendar.id, duration_minutes=30,
        slug=overrides.pop("slug", None), **overrides)
    return await bl.create_link(body, user=user, session=session)


def test_slug_rules():
    assert normalize_slug("  Acme-Intro ") == "acme-intro"
    for bad in ("ab", "UPPER CASE", "under_score", "api", "book", "-lead", "trail-"):
        with pytest.raises(ValueError):
            normalize_slug(bad)


async def test_create_link_slug_clash_and_calendar_guard(session):
    user, calendar = await _host(session)
    first = await _link(session, user, calendar, slug="intro")
    assert first["slug"] == "intro" and first["url_path"] == "/book/intro"
    from fastapi import HTTPException

    try:
        await _link(session, user, calendar, slug="intro")
        raise AssertionError("expected 409")
    except HTTPException as exc:
        assert exc.status_code == 409
    outsider, _ = await _host(session, email="other@x.com")
    try:
        await bl.create_link(
            BookingLinkCreate(title="X", calendar_id=calendar.id), user=outsider, session=session)
        raise AssertionError("expected 422")
    except HTTPException as exc:
        assert exc.status_code == 422
    avail = await bl.slug_available("intro", _user=user, session=session)
    assert avail == {"available": False, "reason": "'intro' is taken — try another link address."}
    assert (await bl.slug_available("fresh-link", _user=user, session=session))["available"] is True


async def test_slots_skip_busy_and_past(session):
    from chronarch_core import ai_tools
    from chronarch_core.permissions import AuthContext
    from chronarch_core.models.enums import ActorType

    user, calendar = await _host(session)
    link = await _link(session, user, calendar, slug="slots")
    row = (await session.execute(
        select(BookingLink).where(BookingLink.id == link["id"])
    )).scalar_one()
    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    day = _utc(2026, 10, 5, 14, 0)
    await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title="Blocked",
        start=day, end=day + timedelta(hours=2), is_owner=True)
    slots = await _booking.open_slots(
        session, row, _utc(2026, 10, 5, 9, 0), _utc(2026, 10, 5, 18, 0))
    assert slots, "expected open slots around the block"
    for s in slots:
        assert s["end"] <= day or s["start"] >= day + timedelta(hours=2)
    # Past window clamps to nothing.
    assert await _booking.open_slots(
        session, row, _utc(2020, 1, 1), _utc(2020, 1, 2)) == []


async def test_hold_confirm_happy_path_and_double_hold_loses(session):
    user, calendar = await _host(session)
    link = await _link(session, user, calendar, slug="happy")
    row = (await session.execute(
        select(BookingLink).where(BookingLink.id == link["id"])
    )).scalar_one()
    slot = _utc(2026, 10, 6, 15, 0)

    held = await pub.hold_slot("happy", HoldRequest(slot_start=slot), session=session)
    token = held["hold_token"]
    try:
        await pub.hold_slot("happy", HoldRequest(slot_start=slot), session=session)
        raise AssertionError("expected 409")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 409

    out = await pub.confirm_slot(
        "happy", ConfirmRequest(hold_token=token, slot_start=slot,
                               name="Jane Booker", email="jane@booker.com", note="Hi"),
        session=session)
    assert out["status"] == "confirmed" and out["booker_token"]
    # Event exists with the booker invited; contact learned.
    from chronarch_core.models.contact import Contact
    from chronarch_core.models.event import UnifiedEvent

    stored_booking = (await session.execute(
        select(Booking).where(Booking.id == out["booking_id"]))).scalar_one()
    stored_event = await session.get(UnifiedEvent, stored_booking.event_id)
    assert stored_event is not None
    assert stored_event.attendees and stored_event.attendees[0]["email"] == "jane@booker.com"
    assert (await session.execute(
        select(Contact).where(Contact.email == "jane@booker.com"))).scalar_one_or_none()


async def test_confirm_bad_hold_rejected(session):
    from fastapi import HTTPException

    user, calendar = await _host(session)
    await _link(session, user, calendar, slug="holds")
    try:
        await pub.confirm_slot(
            "holds", ConfirmRequest(hold_token="bogus", slot_start=_utc(2026, 10, 6, 15, 0),
                                   name="X", email="x@x.com"), session=session)
        raise AssertionError("expected 409")
    except HTTPException as exc:
        assert exc.status_code == 409


async def test_approval_flow_pending_then_approve(session):
    user, calendar = await _host(session)
    link = await _link(session, user, calendar, slug="approval", approval_required=True)
    row = (await session.execute(
        select(BookingLink).where(BookingLink.id == link["id"]))).scalar_one()
    slot = _utc(2026, 10, 7, 15, 0)
    held = await pub.hold_slot("approval", HoldRequest(slot_start=slot), session=session)
    out = await pub.confirm_slot(
        "approval", ConfirmRequest(hold_token=held["hold_token"], slot_start=slot,
                                  name="Pat", email="pat@x.com"), session=session)
    assert out["status"] == "pending"
    booking = (await session.execute(
        select(Booking).where(Booking.id == out["booking_id"]))).scalar_one()
    assert booking.event_id is None  # nothing leaks onto the calendar

    approved = await bl.approve_booking(booking.id, user=user, session=session)
    assert approved["status"] == "confirmed" and approved["event_id"]

    # Decline path on a second request.
    held2 = await pub.hold_slot("approval", HoldRequest(slot_start=_utc(2026, 10, 8, 15, 0)),
                               session=session)
    out2 = await pub.confirm_slot(
        "approval", ConfirmRequest(hold_token=held2["hold_token"],
                                  slot_start=_utc(2026, 10, 8, 15, 0),
                                  name="Sam", email="sam@x.com"), session=session)
    declined = await bl.decline_booking(out2["booking_id"], user=user, session=session)
    assert declined["status"] == "declined"


async def test_booker_cancel_removes_event(session):
    from chronarch_core.models.event import UnifiedEvent

    user, calendar = await _host(session)
    await _link(session, user, calendar, slug="cancelme")
    slot = _utc(2026, 10, 9, 15, 0)
    held = await pub.hold_slot("cancelme", HoldRequest(slot_start=slot), session=session)
    out = await pub.confirm_slot(
        "cancelme", ConfirmRequest(hold_token=held["hold_token"], slot_start=slot,
                                  name="Kay", email="kay@x.com"), session=session)
    cancelled = await pub.cancel_reservation(out["booker_token"], session=session)
    assert cancelled == {"status": "cancelled"}
    booking = (await session.execute(
        select(Booking).where(Booking.id == out["booking_id"]))).scalar_one()
    assert booking.status == BookingStatus.CANCELLED
    assert (await session.execute(
        select(UnifiedEvent).where(UnifiedEvent.id == booking.event_id)
    )).scalar_one_or_none() is None  # event row deleted with the booking
    # Idempotent second cancel.
    assert (await pub.cancel_reservation(out["booker_token"], session=session)) == {"status": "cancelled"}


async def test_delete_link_cancels_future_keeps_past(session):
    user, calendar = await _host(session)
    link = await _link(session, user, calendar, slug="gone")
    assert (await bl.delete_link(link["id"], user=user, session=session)) is None


async def test_hold_store_memory_expiry():
    store = HoldStore(None)
    slot = _utc(2026, 10, 6, 15, 0)
    token = await store.acquire("l1", slot)
    assert token
    assert await store.acquire("l1", slot) is None
    assert await store.verify("l1", slot, token) is True
    assert await store.verify("l1", slot, "wrong") is False
    await store.release("l1", slot, token)
    assert await store.acquire("l1", slot) is not None
