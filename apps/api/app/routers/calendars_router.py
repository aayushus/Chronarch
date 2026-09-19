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
from ..permission_helpers import (
    get_delegation_grant,
    get_delegation_grants,
    get_owned_calendar_ids,
    is_calendar_owner,
)

router = APIRouter(prefix="/api/v1/calendars", tags=["calendars"])


def actor_type_for(user: User) -> ActorType:
    return ActorType.DELEGATE_UI if user.role == UserRole.DELEGATE else ActorType.ADMIN_UI


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
    ics_sync_interval_minutes: int = 60

    model_config = {"from_attributes": True}


@router.get("", response_model=list[CalendarOut])
async def list_calendars(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    ctx = build_auth_context(user, actor_type_for(user))
    owner_ids = await get_owned_calendar_ids(session, user)
    grants = (
        await get_delegation_grants(session, user.id)
        if user.role == UserRole.DELEGATE
        else None
    )
    calendars = await ai_tools.list_calendars(
        session, ctx, owner_calendar_ids=owner_ids, grants_by_calendar=grants
    )

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
        if not is_owner and user.role == UserRole.DELEGATE:
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
                ics_sync_interval_minutes=getattr(c, "ics_sync_interval_minutes", 60),
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
        from chronarch_core.models.delegation import Delegation, DelegationCalendarGrant
        stmt = (
            select(DelegationCalendarGrant.calendar_id)
            .join(Delegation, Delegation.id == DelegationCalendarGrant.delegation_id)
            .where(
                Delegation.delegate_user_id == user.id,
                Delegation.active.is_(True),
            )
        )
        cal_ids = set((await session.execute(stmt)).scalars())
        if cal_ids:
            delegated_cals = list(
                (await session.execute(select(Calendar).where(Calendar.id.in_(cal_ids)))).scalars()
            )
            account_ids = {c.account_id for c in delegated_cals if c.account_id}
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
    from chronarch_core.sync.caldav_sync import sync_caldav_account
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
            elif account.provider == ProviderType.CALDAV:
                s = await sync_caldav_account(session, account)
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


class CalendarUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    visible: bool | None = None
    blocks_availability: bool | None = None
    ics_sync_interval_minutes: int | None = None


@router.patch("/{calendar_id}", response_model=CalendarOut)
async def update_calendar(
    calendar_id: str,
    body: CalendarUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    from fastapi import HTTPException, status

    calendar = await session.get(Calendar, calendar_id)
    if calendar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendar not found")

    if body.name is not None:
        calendar.name = body.name.strip()
    if body.color is not None:
        calendar.color = body.color.strip()
    if body.visible is not None:
        calendar.visible = body.visible
    if body.blocks_availability is not None:
        calendar.blocks_availability = body.blocks_availability
    if body.ics_sync_interval_minutes is not None:
        if body.ics_sync_interval_minutes not in (15, 30, 60, 360, 1440):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "ics_sync_interval_minutes must be 15, 30, 60, 360, or 1440")
        calendar.ics_sync_interval_minutes = body.ics_sync_interval_minutes

    await session.commit()
    await session.refresh(calendar)

    is_owner = await is_calendar_owner(session, user, calendar)
    grant = None
    if not is_owner and user.role == UserRole.DELEGATE:
        grant = await get_delegation_grant(session, user.id, calendar.id)

    ctx = build_auth_context(user, actor_type_for(user))
    can_create = resolve_permission(ctx, calendar, CalendarAction.CREATE, is_owner=is_owner, delegation_grant=grant).allowed
    can_edit = resolve_permission(ctx, calendar, CalendarAction.EDIT, is_owner=is_owner, delegation_grant=grant).allowed
    can_reschedule = resolve_permission(ctx, calendar, CalendarAction.RESCHEDULE, is_owner=is_owner, delegation_grant=grant).allowed
    can_delete = resolve_permission(ctx, calendar, CalendarAction.DELETE, is_owner=is_owner, delegation_grant=grant).allowed

    account = await session.get(Account, calendar.account_id) if calendar.account_id else None

    return CalendarOut(
        id=calendar.id, name=calendar.name, color=calendar.color, visible=calendar.visible,
        writable=can_reschedule, provider_writable=calendar.provider_writable,
        can_create=can_create, can_edit=can_edit,
        can_reschedule=can_reschedule, can_delete=can_delete,
        blocks_availability=calendar.blocks_availability,
        kind=calendar.kind.value, account_id=calendar.account_id,
        account_label=account.provider_account_email if account else "Unknown",
        ics_sync_interval_minutes=calendar.ics_sync_interval_minutes,
    )
