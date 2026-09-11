from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import ai_tools
from chronarch_core.models.account import Account
from chronarch_core.models.enums import ActorType, UserRole
from chronarch_core.models.user import User
from chronarch_core.permissions import CalendarAction, resolve_permission

from ..auth import build_auth_context, get_current_user
from ..deps import get_db_session
from ..permission_helpers import get_delegation_grant, is_calendar_owner

router = APIRouter(prefix="/api/v1/calendars", tags=["calendars"])


def actor_type_for(user: User) -> ActorType:
    return ActorType.EA_UI if user.role == UserRole.ASSISTANT else ActorType.EXECUTIVE_UI


class CalendarOut(BaseModel):
    id: str
    name: str
    color: str
    visible: bool
    writable: bool
    provider_writable: bool
    can_create: bool
    can_edit: bool
    can_reschedule: bool
    can_delete: bool
    blocks_availability: bool
    kind: str
    account_id: str
    account_label: str

    model_config = {"from_attributes": True}


@router.get("", response_model=list[CalendarOut])
async def list_calendars(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    ctx = build_auth_context(user, actor_type_for(user))
    calendars = await ai_tools.list_calendars(session, ctx)

    account_ids = {c.account_id for c in calendars}
    accounts = {}
    for account_id in account_ids:
        account = await session.get(Account, account_id)
        if account is not None:
            accounts[account_id] = account

    out: list[CalendarOut] = []
    for c in calendars:
        is_owner = await is_calendar_owner(session, user, c)
        grant = None
        if not is_owner and user.role == UserRole.ASSISTANT:
            grant = await get_delegation_grant(session, user.id, c.id)

        def _allowed(action: CalendarAction) -> bool:
            return resolve_permission(
                ctx, c, action, is_owner=is_owner, delegation_grant=grant
            ).allowed

        can_create = _allowed(CalendarAction.CREATE)
        can_edit = _allowed(CalendarAction.EDIT)
        can_reschedule = _allowed(CalendarAction.RESCHEDULE)
        can_delete = _allowed(CalendarAction.DELETE)
        # `writable` is the legacy single flag the web UI gates drag/drop on.
        # It must reflect the viewer's *effective* reschedule permission —
        # never the raw provider flag — so an EA without a grant sees a
        # read-only calendar even when the provider itself is writable.
        writable = can_reschedule

        out.append(
            CalendarOut(
                id=c.id, name=c.name, color=c.color, visible=c.visible,
                writable=writable, provider_writable=c.provider_writable,
                can_create=can_create, can_edit=can_edit,
                can_reschedule=can_reschedule, can_delete=can_delete,
                blocks_availability=c.blocks_availability,
                kind=c.kind.value, account_id=c.account_id,
                account_label=accounts[c.account_id].provider_account_email if c.account_id in accounts else "Unknown",
            )
        )
    return out
