"""Host-side booking link management (Cal.com-style links).

Every endpoint requires booking.manage; links are always owned by the
caller (no cross-host access — lookups scope by owner_user_id).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.booking import Booking, BookingLink, normalize_slug, random_slug
from chronarch_core.models.enums import BookingStatus
from chronarch_core.models.user import User

from ..admin_guard import require_permission
from ..deps import get_db_session
from ..permission_helpers import is_calendar_owner

router = APIRouter(prefix="/api/v1/booking-links", tags=["booking"])


def _out(link: BookingLink, counts: dict | None = None) -> dict:
    return {
        "id": link.id, "slug": link.slug, "title": link.title,
        "description": link.description, "duration_minutes": link.duration_minutes,
        "calendar_id": link.calendar_id,
        "buffer_before_minutes": link.buffer_before_minutes,
        "buffer_after_minutes": link.buffer_after_minutes,
        "min_notice_minutes": link.min_notice_minutes,
        "max_days_ahead": link.max_days_ahead,
        "approval_required": link.approval_required, "active": link.active,
        "url_path": f"/book/{link.slug}",
        "booking_counts": counts or {},
    }


async def _counts(session: AsyncSession, link_id: str) -> dict:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    rows = list((await session.execute(
        select(Booking).where(Booking.link_id == link_id))).scalars())
    return {
        "pending": sum(1 for b in rows if b.status == BookingStatus.PENDING),
        "upcoming": sum(1 for b in rows
                        if b.status == BookingStatus.CONFIRMED and b.end > now),
    }


async def _owned_link(session: AsyncSession, user: User, link_id: str) -> BookingLink:
    link = await session.get(BookingLink, link_id)
    if link is None or link.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking link not found.")
    return link


class BookingLinkCreate(BaseModel):
    title: str
    description: str | None = None
    slug: str | None = None
    duration_minutes: int = 30
    calendar_id: str
    buffer_before_minutes: int = 0
    buffer_after_minutes: int = 0
    min_notice_minutes: int = 1440
    max_days_ahead: int = 30
    approval_required: bool = False


class BookingLinkUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    slug: str | None = None
    duration_minutes: int | None = None
    calendar_id: str | None = None
    buffer_before_minutes: int | None = None
    buffer_after_minutes: int | None = None
    min_notice_minutes: int | None = None
    max_days_ahead: int | None = None
    approval_required: bool | None = None
    active: bool | None = None


def _check_windows(body) -> None:
    duration = body.duration_minutes if isinstance(body, BookingLinkCreate) else None
    if duration is not None and not 5 <= duration <= 480:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Duration must be between 5 and 480 minutes.")


async def _unique_slug(session: AsyncSession, slug: str, exclude_id: str | None = None) -> str:
    stmt = select(BookingLink).where(BookingLink.slug == slug)
    if exclude_id:
        stmt = stmt.where(BookingLink.id != exclude_id)
    if (await session.execute(stmt)).scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"'{slug}' is taken — try another link address.")
    return slug


@router.get("")
async def list_links(
    user: User = Depends(require_permission("booking.view")),
    session: AsyncSession = Depends(get_db_session),
):
    links = list((await session.execute(
        select(BookingLink).where(BookingLink.owner_user_id == user.id)
        .order_by(BookingLink.created_at))).scalars())
    return [_out(link, await _counts(session, link.id)) for link in links]


@router.get("/slug-available")
async def slug_available(
    slug: str,
    _user: User = Depends(require_permission("booking.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    try:
        clean = normalize_slug(slug)
    except ValueError as exc:
        return {"available": False, "reason": str(exc)}
    taken = (await session.execute(
        select(BookingLink).where(BookingLink.slug == clean))).scalar_one_or_none()
    if taken is not None:
        return {"available": False, "reason": f"'{clean}' is taken — try another link address."}
    return {"available": True, "slug": clean}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_link(
    body: BookingLinkCreate,
    user: User = Depends(require_permission("booking.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core.models.calendar import Calendar

    _check_windows(body)
    calendar = await session.get(Calendar, body.calendar_id)
    if calendar is None or not await is_calendar_owner(session, user, calendar) or not calendar.provider_writable:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Pick one of your own calendars as the destination.")
    try:
        slug = normalize_slug(body.slug) if body.slug else random_slug()
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await _unique_slug(session, slug)
    link = BookingLink(
        owner_user_id=user.id, slug=slug, title=body.title.strip() or "Untitled link",
        description=(body.description or "").strip() or None,
        duration_minutes=body.duration_minutes, calendar_id=body.calendar_id,
        buffer_before_minutes=max(0, body.buffer_before_minutes),
        buffer_after_minutes=max(0, body.buffer_after_minutes),
        min_notice_minutes=max(0, body.min_notice_minutes),
        max_days_ahead=max(1, min(body.max_days_ahead, 90)),
        approval_required=body.approval_required,
    )
    session.add(link)
    await session.flush()
    return _out(link, await _counts(session, link.id))


@router.patch("/{link_id}")
async def update_link(
    link_id: str,
    body: BookingLinkUpdate,
    user: User = Depends(require_permission("booking.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core.models.calendar import Calendar

    link = await _owned_link(session, user, link_id)
    patch = body.model_dump(exclude_unset=True)
    if "calendar_id" in patch:
        calendar = await session.get(Calendar, patch["calendar_id"])
        if calendar is None or not await is_calendar_owner(session, user, calendar) or not calendar.provider_writable:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Pick one of your own calendars as the destination.")
    if "slug" in patch and patch["slug"] is not None:
        try:
            patch["slug"] = normalize_slug(patch["slug"])
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        await _unique_slug(session, patch["slug"], exclude_id=link.id)
    if patch.get("duration_minutes") is not None and not 5 <= patch["duration_minutes"] <= 480:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Duration must be between 5 and 480 minutes.")
    for key in ("buffer_before_minutes", "buffer_after_minutes", "min_notice_minutes"):
        if patch.get(key) is not None and patch[key] < 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"{key} cannot be negative.")
    if patch.get("max_days_ahead") is not None and not 1 <= patch["max_days_ahead"] <= 90:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "max_days_ahead must be between 1 and 90 days.")
    for key, value in patch.items():
        if value is not None and hasattr(link, key):
            setattr(link, key, value)
    if isinstance(link.title, str):
        link.title = link.title.strip() or "Untitled link"
    await session.flush()
    return _out(link, await _counts(session, link.id))


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(
    link_id: str,
    user: User = Depends(require_permission("booking.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    """Delete a link: future bookings are cancelled (events deleted),
    past ones stay as history."""
    from datetime import datetime, timezone

    from chronarch_core import booking as _booking

    link = await _owned_link(session, user, link_id)
    now = datetime.now(timezone.utc)
    bookings = list((await session.execute(select(Booking).where(Booking.link_id == link.id))).scalars())
    for booking in bookings:
        if booking.status in (BookingStatus.PENDING, BookingStatus.CONFIRMED) and booking.start > now:
            await _booking.cancel_booking(session, booking)
    # Retain booking history. Deactivation preserves the link/bookings FK and
    # removes the public capability without destroying audit/history records.
    link.active = False
    await session.flush()
    return None


@router.get("/{link_id}/bookings")
async def list_bookings(
    link_id: str,
    user: User = Depends(require_permission("booking.view")),
    session: AsyncSession = Depends(get_db_session),
):
    link = await _owned_link(session, user, link_id)
    rows = list((await session.execute(
        select(Booking).where(Booking.link_id == link.id)
        .order_by(Booking.start))).scalars())
    return {"link": _out(link), "bookings": [_booking_out(b) for b in rows]}


def _booking_out(b: Booking) -> dict:
    return {
        "id": b.id, "booker_name": b.booker_name, "booker_email": b.booker_email,
        "note": b.note, "start": b.start, "end": b.end,
        "booked_timezone": b.booked_timezone, "status": b.status.value,
        "event_id": b.event_id, "created_at": b.created_at,
    }


@router.post("/bookings/{booking_id}/approve")
async def approve_booking(
    booking_id: str,
    user: User = Depends(require_permission("booking.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core import booking as _booking

    booking = await _host_booking(session, user, booking_id)
    try:
        await _booking.approve_booking(session, booking)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return _booking_out(booking)


@router.post("/bookings/{booking_id}/decline")
async def decline_booking(
    booking_id: str,
    user: User = Depends(require_permission("booking.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core import booking as _booking

    booking = await _host_booking(session, user, booking_id)
    try:
        await _booking.decline_booking(session, booking)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return _booking_out(booking)


@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(
    booking_id: str,
    user: User = Depends(require_permission("booking.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core import booking as _booking

    booking = await _host_booking(session, user, booking_id)
    await _booking.cancel_booking(session, booking)
    await session.commit()
    return _booking_out(booking)


async def _host_booking(session: AsyncSession, user: User, booking_id: str) -> Booking:
    booking = await session.get(Booking, booking_id)
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found.")
    link = await session.get(BookingLink, booking.link_id)
    if link is None or link.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found.")
    return booking
