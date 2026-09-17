"""Public kiosk surface (no auth — unguessable display tokens).

Abuse containment mirrors the booking surface: fixed-window per-IP rate
limits, 128-bit+ token entropy, no enumerable IDs. The viewer is always a
non-owner: PRIVATE events render as Busy with no details, and only the
owning host's calendars are ever read.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import ai_tools
from chronarch_core import booking as _booking
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ActorType, EventVisibility
from chronarch_core.models.kiosk import KioskDisplay
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext

from ..deps import get_db_session
from ..rate_limiter import RateLimiter
from ..auth import get_redis_client

router = APIRouter(prefix="/api/v1/kiosk-display", tags=["kiosk-public"])

kiosk_limiter = RateLimiter(requests=60, window_seconds=60, key_prefix="kiosk", by_ip=True)


def _pairs() -> "PairingStore":
    from chronarch_core.kiosk_pairing import PairingStore

    try:
        return PairingStore(get_redis_client())
    except Exception:
        return PairingStore(None)


def _kiosk_context(host: User) -> AuthContext:
    """Owner-scoped read context WITHOUT the engine's admin bypass.

    `booking.host_context` sets is_admin=True, which short-circuits both
    the AI gates and the scope check — on a token-authenticated public
    surface that would leak other owners' event titles onto the wall.
    With is_admin=False the engine grants exactly the host's OWN
    calendars (via owner_calendar_ids) and denies everything else.
    """
    return AuthContext(
        user_id=host.id, role=host.role, actor_type=ActorType.SYSTEM,
        is_admin=False,
    )


async def _live_display(session: AsyncSession, token: str) -> KioskDisplay:
    display = (await session.execute(
        select(KioskDisplay).where(KioskDisplay.token == (token or "").strip())
    )).scalar_one_or_none()
    if display is None or not display.active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Display not found.")
    display.last_seen_at = datetime.now(timezone.utc)
    return display


@router.get("/{token}", dependencies=[Depends(kiosk_limiter)])
async def display_meta(token: str, session: AsyncSession = Depends(get_db_session)):
    display = await _live_display(session, token)
    host = await session.get(User, display.owner_user_id)
    return {
        "name": display.name,
        "host_name": host.display_name if host else "Host",
        "location_label": display.location_label,
        "sleep_start": display.sleep_start,
        "sleep_end": display.sleep_end,
    }


@router.get("/{token}/agenda", dependencies=[Depends(kiosk_limiter)])
async def display_agenda(
    token: str, days: int = 7, start: str | None = None,
    session: AsyncSession = Depends(get_db_session),
):
    display = await _live_display(session, token)
    host = await session.get(User, display.owner_user_id)
    if host is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Display not found.")

    window_days = max(1, min(days, 14))
    now = datetime.now(timezone.utc)
    window_start = _parse_dt(start, "start") if start else now
    end = window_start + timedelta(days=window_days)
    owner_ids = await _booking.host_calendar_ids(session, host.id)
    events = await ai_tools.get_events(
        session, _kiosk_context(host),
        window_start=window_start, window_end=end, owner_calendar_ids=owner_ids)

    calendars = {c.id: c for c in list((await session.execute(
        select(Calendar).where(Calendar.id.in_(owner_ids)))).scalars())} if owner_ids else {}

    out = []
    for e in sorted(events, key=lambda x: (x.start, x.end)):
        cal = calendars.get(e.calendar_id)
        masked = e.visibility == EventVisibility.PRIVATE
        out.append({
            "id": e.id,
            "title": "Busy" if masked else e.title,
            "masked": masked,
            "start": e.start, "end": e.end,
            "all_day": bool(e.all_day),
            "location": None if masked else e.location,
            "description": None if masked else e.description,
            "calendar_id": e.calendar_id,
            "calendar_name": cal.name if cal else "",
            "calendar_color": cal.color if cal else "#0a84ff",
        })
    return {"events": out, "server_now": now,
            "calendars": [{"id": c.id, "name": c.name, "color": c.color}
                          for c in sorted(calendars.values(), key=lambda c: c.name)]}


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


class PairCodeRequest(BaseModel):
    name: str = "Wall display"
    location_label: str = ""


@router.post("/pair-code", dependencies=[Depends(kiosk_limiter)])
async def request_pair_code(body: PairCodeRequest):
    """Unpaired wall display asks for a short code to show on screen."""
    return await _pairs().create(
        (body.name or "").strip() or "Wall display",
        (body.location_label or "").strip())


@router.get("/pair-status/{pairing_id}", dependencies=[Depends(kiosk_limiter)])
async def pair_status(pairing_id: str):
    """Wall display polls while the code is on screen. Approved delivery
    is single-shot: the token comes back once, then the pairing is gone."""
    result = await _pairs().status(pairing_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Pairing expired — request a fresh code on the display.")
    return result


async def _kiosk_host(session: AsyncSession, token: str) -> tuple[KioskDisplay, User]:
    """Token → (display, owner). The wall is trusted like the owner for
    reads AND quick-add writes — revoking the token decommissions it."""
    display = await _live_display(session, token)
    host = await session.get(User, display.owner_user_id)
    if host is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Display not found.")
    return display, host


