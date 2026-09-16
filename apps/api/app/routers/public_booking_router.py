"""Public booking surface (no auth — unguessable slugs + booker tokens).

Abuse containment: fixed-window per-IP rate limits on every endpoint
(fail-open when Redis is down, same as login), 128-bit+ token entropy, no
enumerable IDs anywhere. Slot double-booking is serialized by holds (Redis
SET NX, memory fallback) plus a conflict re-check at confirm time.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import booking as _booking
from chronarch_core.booking import HoldStore
from chronarch_core.models.booking import Booking
from chronarch_core.models.user import User

from ..auth import get_redis_client
from ..deps import get_db_session
from ..rate_limiter import RateLimiter

router = APIRouter(prefix="/api/v1/book", tags=["booking-public"])

meta_limiter = RateLimiter(requests=60, window_seconds=60, key_prefix="book-meta", by_ip=True)
slots_limiter = RateLimiter(requests=60, window_seconds=60, key_prefix="book-slots", by_ip=True)
hold_limiter = RateLimiter(requests=20, window_seconds=60, key_prefix="book-hold", by_ip=True)
confirm_limiter = RateLimiter(requests=10, window_seconds=300, key_prefix="book-confirm", by_ip=True)


def _holds() -> HoldStore:
    try:
        return HoldStore(get_redis_client())
    except Exception:
        return HoldStore(None)


def _parse_dt(raw: str, label: str) -> datetime:
    try:
        value = datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"'{label}' must be an ISO datetime.")
    if value.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"'{label}' must carry a UTC offset.")
    return value


@router.get("/{slug}", dependencies=[Depends(meta_limiter)])
async def link_metadata(slug: str, session: AsyncSession = Depends(get_db_session)):
    link = await _booking.get_link(session, slug)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking link not found.")
    host = await session.get(User, link.owner_user_id)
    return {
        "slug": link.slug, "title": link.title, "description": link.description,
        "duration_minutes": link.duration_minutes,
        "host_name": host.display_name if host else "Host",
        "approval_required": link.approval_required,
    }


@router.get("/{slug}/slots", dependencies=[Depends(slots_limiter)])
async def link_slots(
    slug: str, date_from: str, date_to: str,
    session: AsyncSession = Depends(get_db_session),
):
    link = await _booking.get_link(session, slug)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking link not found.")
    start = _parse_dt(date_from, "date_from")
    end = _parse_dt(date_to, "date_to")
    if end <= start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "date_to must be after date_from.")
    slots = await _booking.open_slots(session, link, start, end)
    return {"slots": [{"start": s["start"], "end": s["end"]} for s in slots]}


class HoldRequest(BaseModel):
    slot_start: datetime


@router.post("/{slug}/hold", dependencies=[Depends(hold_limiter)])
async def hold_slot(
    slug: str, body: HoldRequest,
    session: AsyncSession = Depends(get_db_session),
):
    link = await _booking.get_link(session, slug)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking link not found.")
    start = body.slot_start
    if start.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "slot_start must carry a UTC offset.")
    # Only hold genuinely open slots — never a past, taken, or out-of-window time.
    probe_end = start + timedelta(minutes=link.duration_minutes * 2)
    if not any(s["start"] == start for s in await _booking.open_slots(
            session, link, start, probe_end)):
        raise HTTPException(status.HTTP_409_CONFLICT, "That time is no longer open.")
    token = await _holds().acquire(link.id, start)
    if token is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone just took that time — pick another.")
    return {"hold_token": token, "slot_start": start, "expires_in_seconds": 300}


class ConfirmRequest(BaseModel):
    hold_token: str
    slot_start: datetime
    name: str
    email: str
    note: str | None = None
    booked_timezone: str = "UTC"


@router.post("/{slug}/confirm", dependencies=[Depends(confirm_limiter)])
async def confirm_slot(
    slug: str, body: ConfirmRequest,
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core.timezones import normalize_timezone

    link = await _booking.get_link(session, slug)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking link not found.")
    start = body.slot_start
    if start.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "slot_start must carry a UTC offset.")
    holds = _holds()
    if not await holds.verify(link.id, start, body.hold_token):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "That hold expired or was taken — pick another time.")
    try:
        booking = await _booking.confirm_booking(
            session, link, start, body.name, body.email, body.note)
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    booking.booked_timezone = normalize_timezone(body.booked_timezone or "UTC")
    await session.commit()
    await holds.release(link.id, start, body.hold_token)
    return {
        "booking_id": booking.id, "status": booking.status.value,
        "start": booking.start, "end": booking.end,
        "booker_token": booking.booker_token,
        "message": ("Request received — the host confirms shortly."
                    if link.approval_required else "Booked — the invite is on its way."),
    }


@router.post("/reservations/{booker_token}/cancel")
async def cancel_reservation(
    booker_token: str, session: AsyncSession = Depends(get_db_session),
):
    booking = (await session.execute(
        select(Booking).where(Booking.booker_token == booker_token)
    )).scalar_one_or_none()
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reservation not found.")
    await _booking.cancel_booking(session, booking)
    await session.commit()
    return {"status": "cancelled"}
