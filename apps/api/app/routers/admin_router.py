"""Admin-only configuration endpoints (BRD §12, §30).

Gated by `require_admin` — every route here 403s for a non-admin caller
(the EA experience must never reach this surface, per BRD §4.2/§13).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.user import User

from ..auth import get_current_user
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


class AdminCalendarOut(BaseModel):
    id: str
    name: str
    color: str
    kind: str
    account_id: str
    account_label: str
    provider: str
    writable: bool
    visible: bool
    blocks_availability: bool
    is_default: bool
    ea_can_view: bool
    ea_can_edit: bool
    ai_can_read: bool
    ai_can_write: bool
    privacy_mask: bool


class AdminCalendarUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    visible: bool | None = None
    blocks_availability: bool | None = None
    is_default: bool | None = None
    ea_can_view: bool | None = None
    ea_can_edit: bool | None = None
    ai_can_read: bool | None = None
    ai_can_write: bool | None = None
    privacy_mask: bool | None = None


@router.get("/calendars", response_model=list[AdminCalendarOut])
async def admin_list_calendars(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    calendars = list((await session.execute(select(Calendar))).scalars())
    accounts = {a.id: a for a in (await session.execute(select(Account))).scalars()}

    return [
        AdminCalendarOut(
            id=c.id, name=c.name, color=c.color, kind=c.kind.value,
            account_id=c.account_id,
            account_label=accounts[c.account_id].provider_account_email if c.account_id in accounts else "Unknown",
            provider=accounts[c.account_id].provider.value if c.account_id in accounts else "unknown",
            writable=c.provider_writable, visible=c.visible, blocks_availability=c.blocks_availability,
            is_default=c.is_default, ea_can_view=c.ea_can_view, ea_can_edit=c.ea_can_edit,
            ai_can_read=c.ai_can_read, ai_can_write=c.ai_can_write, privacy_mask=c.privacy_mask,
        )
        for c in calendars
    ]


@router.patch("/calendars/{calendar_id}", response_model=AdminCalendarOut)
async def admin_update_calendar(
    calendar_id: str,
    body: AdminCalendarUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    calendar = await session.get(Calendar, calendar_id)
    if calendar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendar not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(calendar, field, value)

    await session.flush()
    account = await session.get(Account, calendar.account_id)

    return AdminCalendarOut(
        id=calendar.id, name=calendar.name, color=calendar.color, kind=calendar.kind.value,
        account_id=calendar.account_id,
        account_label=account.provider_account_email if account else "Unknown",
        provider=account.provider.value if account else "unknown",
        writable=calendar.provider_writable, visible=calendar.visible,
        blocks_availability=calendar.blocks_availability, is_default=calendar.is_default,
        ea_can_view=calendar.ea_can_view, ea_can_edit=calendar.ea_can_edit,
        ai_can_read=calendar.ai_can_read, ai_can_write=calendar.ai_can_write,
        privacy_mask=calendar.privacy_mask,
    )
