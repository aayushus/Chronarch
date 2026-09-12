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


@router.get("/sync-status")
async def get_sync_status(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Returns the latest sync status across connected accounts for this user."""
    from sqlalchemy import select
    accounts = list(
        (await session.execute(select(Account).where(Account.owner_user_id == user.id))).scalars()
    )
    if not accounts:
        # Check if user has access to any calendars via delegation
        all_cals = list((await session.execute(select(Calendar))).scalars())
        account_ids = {c.account_id for c in all_cals}
        accounts = list(
            (await session.execute(select(Account).where(Account.id.in_(account_ids)))).scalars()
        ) if account_ids else []

    last_synced = None
    statuses = [a.sync_status for a in accounts]
    for a in accounts:
        if a.last_synced_at:
            if last_synced is None or a.last_synced_at > last_synced:
                last_synced = a.last_synced_at

    return {
        "account_count": len(accounts),
        "last_synced_at": last_synced,
        "is_syncing": "syncing" in statuses,
        "has_error": "error" in statuses,
    }


@router.post("/sync")
async def trigger_user_sync(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Trigger a manual reconciliation sync across accounts available to this user."""
    from datetime import datetime, timezone
    from sqlalchemy import select
    from chronarch_core.models.enums import ProviderType
    from chronarch_core.sync.google_sync import sync_google_account
    from chronarch_core.sync.microsoft_sync import sync_microsoft_account
    from chronarch_core.sync.ics_sync import sync_ics_subscription_calendar

    accounts = list(
        (await session.execute(select(Account).where(Account.owner_user_id == user.id))).scalars()
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    total_synced = 0
    errors = []

    for account in accounts:
        try:
            if account.provider == ProviderType.GOOGLE:
                s = await sync_google_account(session, account)
                total_synced += s.get("events_synced", 0)
            elif account.provider == ProviderType.MICROSOFT:
                s = await sync_microsoft_account(session, account)
                total_synced += s.get("events_synced", 0)
            elif account.provider == ProviderType.ICS:
                sub_cals = list(
                    (await session.execute(select(Calendar).where(Calendar.account_id == account.id))).scalars()
                )
                for cal in sub_cals:
                    s = await sync_ics_subscription_calendar(session, cal)
                    total_synced += s.get("events_synced", 0)

            account.last_synced_at = now_iso
            account.sync_status = "active"
            account.last_sync_error = None
        except Exception as e:
            account.sync_status = "error"
            account.last_sync_error = str(e)
            errors.append(f"{account.provider_account_email}: {str(e)}")

    await session.commit()

    return {
        "synced": True,
        "last_synced_at": now_iso,
        "events_synced": total_synced,
        "accounts_synced": len(accounts),
        "errors": errors,
    }
