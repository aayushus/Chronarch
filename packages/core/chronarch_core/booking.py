"""Public booking engine (Cal.com-style links).

Reads (slots) run as the host against the host's own blocking calendars —
the booker has no identity here. Writes (confirm/approve/cancel) create
real provider events with the booker as attendee, so Google/Microsoft send
their own invitation emails and no SMTP is needed.

Slot holds serialize concurrent bookers: `HoldStore` prefers Redis
(atomic SET NX) and falls back to a process-local dict when Redis is
unreachable (dev/test). The confirm step re-checks conflicts anyway, so a
hold failure degrades to last-write-wins rather than silent double-booking.
"""

from __future__ import annotations

import secrets
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models.account import Account
from .models.booking import Booking, BookingLink, new_booker_token
from .models.calendar import Calendar
from .models.enums import ActorType, BookingStatus
from .models.user import User
from .permissions import AuthContext

HOLD_TTL_SECONDS = 300
MAX_SLOT_RANGE_DAYS = 31


def _now() -> datetime:
    return datetime.now(timezone.utc)


def host_context(host: User) -> AuthContext:
    # is_admin is always False here: this context drives AI-gated calendar
    # reads/writes on public booking surfaces, and admin's is_admin bypass
    # would leak other tenants' calendars into the host's own booking data.
    return AuthContext(
        user_id=host.id, role=host.role, actor_type=ActorType.SYSTEM,
        is_admin=False,
    )


async def host_calendar_ids(session: AsyncSession, host_id: str) -> set[str]:
    accounts = list((await session.execute(
        select(Account.id).where(Account.owner_user_id == host_id))).scalars())
    if not accounts:
        return set()
    calendars = list((await session.execute(
        select(Calendar.id).where(Calendar.account_id.in_(accounts)))).scalars())
    return set(calendars)


async def get_link(session: AsyncSession, slug: str) -> BookingLink | None:
    link = (await session.execute(
        select(BookingLink).where(BookingLink.slug == slug.strip().lower())
    )).scalar_one_or_none()
    if link is None or not link.active:
        return None
    return link


class HoldStore:
    """Slot-hold serialization with Redis primary, memory fallback.

    The memory fallback is process-wide (class-level) so separate store
    instances — e.g. one per request — still serialize against each other
    where Redis is absent (dev/test, single-process deploys).
    """

    _memory: dict[str, tuple[str, float]] = {}

    def __init__(self, redis_client=None):
        self._redis = redis_client

    def _key(self, link_id: str, slot_start: datetime) -> str:
        return f"bookhold:{link_id}:{slot_start.isoformat()}"

    async def acquire(self, link_id: str, slot_start: datetime) -> str | None:
        """Take a hold on a slot. Returns the hold token, or None when held."""
        key = self._key(link_id, slot_start)
        token = secrets.token_urlsafe(16)
        if self._redis is not None:
            try:
                if await self._redis.set(key, token, nx=True, ex=HOLD_TTL_SECONDS):
                    return token
                return None
            except Exception:
                pass
        now = time.monotonic()
        held = self._memory.get(key)
        if held is not None and held[1] > now:
            return None
        self._memory[key] = (token, now + HOLD_TTL_SECONDS)
        return token

    async def verify(self, link_id: str, slot_start: datetime, token: str) -> bool:
        key = self._key(link_id, slot_start)
        if self._redis is not None:
            try:
                return await self._redis.get(key) == token
            except Exception:
                pass
        held = self._memory.get(key)
        return held is not None and held[0] == token and held[1] > time.monotonic()

    async def release(self, link_id: str, slot_start: datetime, token: str) -> None:
        if not await self.verify(link_id, slot_start, token):
            return
        key = self._key(link_id, slot_start)
        if self._redis is not None:
            try:
                await self._redis.delete(key)
            except Exception:
                pass
        self._memory.pop(key, None)


async def open_slots(
    session: AsyncSession,
    link: BookingLink,
    range_start: datetime,
    range_end: datetime,
    max_results: int = 20,
) -> list[dict]:
    """Bookable slot starts for a link in [range_start, range_end).

    Availability = host's blocking calendars (not the booker's) through the
    standard engine: working prefs, buffers, min notice, recurrence-aware.
    The range is clamped to now+notice .. now+max_days_ahead.
    """
    from . import ai_tools

    host = await session.get(User, link.owner_user_id)
    if host is None:
        return []
    now = _now()
    earliest = now + timedelta(minutes=link.min_notice_minutes)
    latest = now + timedelta(days=max(1, link.max_days_ahead))
    start = max(_as_aware(range_start), earliest)
    end = min(_as_aware(range_end), latest)
    if end <= start or (end - start).days > MAX_SLOT_RANGE_DAYS:
        return []

    buffer = timedelta(minutes=max(link.buffer_before_minutes, link.buffer_after_minutes))
    try:
        sh, sm = (host.working_hours_start or "09:00").split(":")
        eh, em = (host.working_hours_end or "17:00").split(":")
        hours = (int(sh), int(eh)) if sm == "00" and em == "00" else None
    except (ValueError, AttributeError):
        hours = None

    slots = await ai_tools.find_free_slots(
        session, host_context(host),
        window_start=start, window_end=end,
        duration=timedelta(minutes=link.duration_minutes),
        # No calendar filter: every host-owned blocking calendar must block,
        # not just the destination.
        working_hours=hours, buffer=buffer,
        min_notice=timedelta(minutes=link.min_notice_minutes), now=now,
        owner_calendar_ids=await host_calendar_ids(session, host.id),
    )
    return [{"start": s["start"], "end": s["end"]} for s in slots[:max_results]]


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def validate_booker(name: str, email: str) -> tuple[str, str]:
    clean_name = " ".join((name or "").strip().split())
    clean_email = (email or "").strip().lower()
    if not clean_name:
        raise ValueError("Your name is required to book.")
    if "@" not in clean_email or "." not in clean_email.split("@")[-1]:
        raise ValueError("A valid email is required — that's where the invite goes.")
    return clean_name, clean_email


async def _book_event(session: AsyncSession, link: BookingLink, host: User,
                      name: str, email: str, note: str | None,
                      start: datetime, end: datetime) -> object:
    """Create the real event with the booker as attendee (the provider
    sends the invitation email)."""
    from . import ai_tools
    from .contacts import create_contact
    from .models.contact import Contact

    try:
        await create_contact(session, email=email, display_name=name)
    except ValueError:
        pass  # already known — the directory keeps its row
    # Count the booking meeting like extraction counts synced invites.
    # Without this, booking-created rows sit at event_count=0 and sort last
    # in the most-met-first directory (often past the default limit).
    contact = (
        await session.execute(select(Contact).where(Contact.email == email.strip().lower()))
    ).scalar_one_or_none()
    if contact is not None and contact.deleted_at is None:
        contact.event_count = (contact.event_count or 0) + 1
        contact.last_seen_at = _now()
        if not contact.display_name and (name or "").strip() and not contact.name_locked:
            contact.display_name = " ".join(name.strip().split())
        await session.flush()
    return await ai_tools.create_event(
        session, host_context(host), calendar_id=link.calendar_id,
        title=f"{link.title} — {name}",
        start=start, end=end, timezone="UTC",
        description=(f"Booked via {link.title}\n" + (f"\n{note.strip()}" if (note or "").strip() else "")),
        attendees=[{"email": email, "name": name}],
        is_owner=True,
    )


async def confirm_booking(
    session: AsyncSession, link: BookingLink,
    start: datetime, name: str, email: str, note: str | None = None,
) -> Booking:
    """Commit a held slot. Auto-confirm mode creates the event now;
    approval mode leaves the booking pending with no event (nothing
    tentative leaks onto the calendar)."""
    from . import ai_tools

    clean_name, clean_email = validate_booker(name, email)
    host = await session.get(User, link.owner_user_id)
    if host is None:
        raise ValueError("This booking link is no longer available.")
    end = start + timedelta(minutes=link.duration_minutes)
    if start < _now() + timedelta(minutes=link.min_notice_minutes):
        raise ValueError("That slot is no longer bookable — pick another.")
    # Backstop: even with a valid hold, re-check for anything that landed
    # since (holds fail open when Redis is down).
    from . import ai_tools

    host_ctx_owner_ids: set[str] = set()
    _accounts = list((await session.execute(
        select(Account.id).where(Account.owner_user_id == host.id))).scalars())
    if _accounts:
        host_ctx_owner_ids = set((await session.execute(
            select(Calendar.id).where(Calendar.account_id.in_(_accounts)))).scalars())
    clashes = await ai_tools.get_conflicts(
        session, host_context(host), window_start=start, window_end=end,
        owner_calendar_ids=host_ctx_owner_ids)
    if clashes:
        raise ValueError("That slot was just taken — pick another.")

    booking = Booking(
        link_id=link.id, booker_name=clean_name, booker_email=clean_email,
        note=(note or "").strip() or None, start=start, end=end,
        status=(BookingStatus.PENDING if link.approval_required
                else BookingStatus.CONFIRMED),
        booker_token=new_booker_token(),
    )
    session.add(booking)
    await session.flush()

    if not link.approval_required:
        event = await _book_event(session, link, host, clean_name, clean_email, note, start, end)
        booking.event_id = event.id
        booking.status = BookingStatus.CONFIRMED
        await session.flush()
    return booking


async def approve_booking(session: AsyncSession, booking: Booking) -> Booking:
    """Host approves a pending booking: creates the event now."""
    if booking.status != BookingStatus.PENDING:
        raise ValueError("Only pending bookings can be approved.")
    link = await session.get(BookingLink, booking.link_id)
    host = await session.get(User, link.owner_user_id) if link else None
    if link is None or host is None:
        raise ValueError("This booking link is no longer available.")
    event = await _book_event(session, link, host, booking.booker_name,
                              booking.booker_email, booking.note,
                              booking.start, booking.end)
    booking.event_id = event.id
    booking.status = BookingStatus.CONFIRMED
    await session.flush()
    return booking


async def decline_booking(session: AsyncSession, booking: Booking) -> Booking:
    if booking.status != BookingStatus.PENDING:
        raise ValueError("Only pending bookings can be declined.")
    booking.status = BookingStatus.DECLINED
    await session.flush()
    return booking


async def cancel_booking(session: AsyncSession, booking: Booking) -> Booking:
    """Cancel (booker or host): deletes the event so the provider cancels
    the invite, marks the row. Idempotent."""
    from . import ai_tools

    if booking.status == BookingStatus.CANCELLED:
        return booking
    if booking.event_id:
        link = await session.get(BookingLink, booking.link_id)
        host = await session.get(User, link.owner_user_id) if link else None
        if host is not None:
            try:
                await ai_tools.delete_event(
                    session, host_context(host), event_id=booking.event_id, is_owner=True)
            except ValueError:
                pass  # event already gone — still mark cancelled
        # Preserve booking history after the provider event is removed and
        # avoid leaving a dangling FK in databases without SET NULL support.
        booking.event_id = None
    booking.status = BookingStatus.CANCELLED
    await session.flush()
    return booking
