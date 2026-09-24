"""Host-side wall-display management (kiosk pairings).

Every endpoint requires kiosk.manage/kiosk.view; displays are always owned
by the caller (no cross-host access — lookups scope by owner_user_id).
The display itself authenticates with its unguessable token on the public
surface (`public_kiosk_router`) — never with a login.
"""

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.kiosk import KioskDisplay, new_kiosk_token
from chronarch_core.models.user import User

from ..admin_guard import require_permission
from ..deps import get_db_session
from ..rate_limiter import RateLimiter
from ..auth import get_redis_client

router = APIRouter(prefix="/api/v1/kiosk", tags=["kiosk"])

# 6-digit codes are guessable by design: tight per-IP budget on top of
# single-use + 10-minute expiry.
pair_limiter = RateLimiter(requests=10, window_seconds=300, key_prefix="kiosk-pair", by_ip=True)


def _pairs():
    from chronarch_core.kiosk_pairing import PairingStore

    try:
        redis = get_redis_client()
    except Exception:
        redis = None
    if redis is None and __import__("os").environ.get("ENVIRONMENT", "development").lower() in {"prod", "production"}:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Pairing service is temporarily unavailable.")
    return PairingStore(redis)

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _check_sleep(value: str, label: str) -> str:
    cleaned = (value or "").strip()
    if not _HHMM.match(cleaned):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"'{label}' must be HH:MM (24-hour).")
    return cleaned


def _out(display: KioskDisplay) -> dict:
    return {
        "id": display.id, "name": display.name,
        "location_label": display.location_label,
        "sleep_start": display.sleep_start, "sleep_end": display.sleep_end,
        "screensaver_timeout_seconds": display.screensaver_timeout_seconds,
        "active": display.active,
        "url_path": f"/kiosk/{display.token}",
        "last_seen_at": display.last_seen_at,
        "created_at": display.created_at,
    }


def _out_with_token(display: KioskDisplay) -> dict:
    out = _out(display)
    out["token"] = display.token
    return out


async def _owned_display(session: AsyncSession, user: User, display_id: str) -> KioskDisplay:
    display = await session.get(KioskDisplay, display_id)
    if display is None or display.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Wall display not found.")
    return display


class KioskCreate(BaseModel):
    name: str = "Wall display"
    location_label: str = ""
    sleep_start: str = "22:00"
    sleep_end: str = "07:00"
    screensaver_timeout_seconds: int = 30


class KioskUpdate(BaseModel):
    name: str | None = None
    location_label: str | None = None
    sleep_start: str | None = None
    sleep_end: str | None = None
    screensaver_timeout_seconds: int | None = None
    active: bool | None = None


@router.get("")
async def list_displays(
    user: User = Depends(require_permission("kiosk.view")),
    session: AsyncSession = Depends(get_db_session),
):
    rows = list((await session.execute(
        select(KioskDisplay).where(KioskDisplay.owner_user_id == user.id)
        .order_by(KioskDisplay.created_at))).scalars())
    return [_out(d) for d in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_display(
    body: KioskCreate,
    user: User = Depends(require_permission("kiosk.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    display = KioskDisplay(
        owner_user_id=user.id,
        name=body.name.strip() or "Wall display",
        location_label=(body.location_label or "").strip(),
        sleep_start=_check_sleep(body.sleep_start, "sleep_start"),
        sleep_end=_check_sleep(body.sleep_end, "sleep_end"),
        screensaver_timeout_seconds=max(10, min(body.screensaver_timeout_seconds, 3600)),
    )
    session.add(display)
    await session.flush()
    return _out_with_token(display)


@router.patch("/{display_id}")
async def update_display(
    display_id: str,
    body: KioskUpdate,
    user: User = Depends(require_permission("kiosk.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    display = await _owned_display(session, user, display_id)
    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and patch["name"] is not None:
        display.name = patch["name"].strip() or "Wall display"
    if "location_label" in patch and patch["location_label"] is not None:
        display.location_label = patch["location_label"].strip()
    if "sleep_start" in patch and patch["sleep_start"] is not None:
        display.sleep_start = _check_sleep(patch["sleep_start"], "sleep_start")
    if "sleep_end" in patch and patch["sleep_end"] is not None:
        display.sleep_end = _check_sleep(patch["sleep_end"], "sleep_end")
    if "screensaver_timeout_seconds" in patch and patch["screensaver_timeout_seconds"] is not None:
        display.screensaver_timeout_seconds = max(10, min(int(patch["screensaver_timeout_seconds"]), 3600))
    if "active" in patch and patch["active"] is not None:
        display.active = bool(patch["active"])
    await session.flush()
    return _out(display)


@router.post("/{display_id}/rotate")
async def rotate_token(
    display_id: str,
    user: User = Depends(require_permission("kiosk.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    """Issue a fresh token; the old wall URL stops working immediately."""
    display = await _owned_display(session, user, display_id)
    display.token = new_kiosk_token()
    await session.flush()
    return _out_with_token(display)


@router.delete("/{display_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_display(
    display_id: str,
    user: User = Depends(require_permission("kiosk.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    display = await _owned_display(session, user, display_id)
    await session.delete(display)
    await session.flush()
    return None


class PairApprove(BaseModel):
    code: str


@router.post("/pair", status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(pair_limiter)])
async def pair_with_code(
    body: PairApprove,
    user: User = Depends(require_permission("kiosk.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    """Approve the code shown on an unpaired wall display: creates the
    owned display row and binds its token to the pending pairing. The
    display picks the token up on its next poll."""
    pending = await _pairs().peek(body.code)
    if pending is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "That code is unknown or expired — check the display.")
    display = KioskDisplay(
        owner_user_id=user.id,
        name=(pending["name"] or "").strip() or "Wall display",
        location_label=(pending["location_label"] or "").strip(),
    )
    session.add(display)
    await session.flush()
    if await _pairs().approve(body.code, display.token) is None:
        # Lost a race with another admin: roll back the orphan row.
        await session.delete(display)
        await session.flush()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "That code was just used — request a fresh one.")
    return _out_with_token(display)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
