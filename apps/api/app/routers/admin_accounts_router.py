"""Admin account management (BRD §30 "Accounts").

Real OAuth connect flows (Google/Microsoft) aren't implemented yet — see
chronarch_core.connectors.base.BaseConnector, which the connector
implementations will fill in. This router lists/disconnects whatever
accounts exist (seeded or, later, OAuth-connected) so the admin UI has a
real surface to build against once connectors land.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User

from ..admin_guard import require_permission
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/accounts", tags=["admin"])


class AdminAccountOut(BaseModel):
    id: str
    provider: str
    provider_account_email: str
    tenant_id: str | None
    owner_user_id: str
    owner_email: str
    sync_status: str
    last_synced_at: str | None
    calendar_count: int
    push_status: str = "off"


def _push_status(webhooks: list) -> str:
    """Aggregate subscription rows: active > error > off."""
    if not webhooks:
        return "off"
    if any(w.status == "active" for w in webhooks):
        return "active"
    return "error"


@router.get("", response_model=list[AdminAccountOut])
async def list_accounts(_user: User = Depends(require_permission("accounts.view")), session: AsyncSession = Depends(get_db_session)):
    from chronarch_core.models.webhook import ProviderWebhook

    accounts = list((await session.execute(select(Account))).scalars())
    out = []
    for a in accounts:
        owner = await session.get(User, a.owner_user_id)
        count = len(
            list((await session.execute(select(Calendar.id).where(Calendar.account_id == a.id))).scalars())
        )
        webhooks = list(
            (await session.execute(select(ProviderWebhook).where(ProviderWebhook.account_id == a.id))).scalars()
        )
        out.append(
            AdminAccountOut(
                id=a.id, provider=a.provider.value, provider_account_email=a.provider_account_email,
                tenant_id=a.tenant_id, owner_user_id=a.owner_user_id,
                owner_email=owner.email if owner else "Unknown",
                sync_status=a.sync_status, last_synced_at=a.last_synced_at, calendar_count=count,
                push_status=_push_status(webhooks),
            )
        )
    return out


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_account(
    account_id: str,
    admin: User = Depends(require_permission("accounts.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core.audit import write_audit_entry
    from chronarch_core.models.delegation import DelegationCalendarGrant
    from chronarch_core.models.enums import ActorType, AuditAction
    from chronarch_core.permissions import AuthContext

    account = await session.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    calendar_ids = list(
        (await session.execute(select(Calendar.id).where(Calendar.account_id == account_id))).scalars()
    )
    if calendar_ids:
        # Grants on deleted calendars are meaningless — revoke them first
        # (their own FK would otherwise block the calendar delete). Each
        # revocation is audited so the trail shows why access disappeared.
        grants = list(
            (
                await session.execute(
                    select(DelegationCalendarGrant).where(
                        DelegationCalendarGrant.calendar_id.in_(calendar_ids)
                    )
                )
            ).scalars()
        )
        admin_ctx = AuthContext(
            user_id=admin.id, role=admin.role, actor_type=ActorType.API,
            is_admin=admin.role == UserRole.ADMIN,
        )
        for grant in grants:
            await write_audit_entry(
                session,
                ctx=admin_ctx,
                action=AuditAction.REVOKE_DELEGATION,
                calendar_id=grant.calendar_id,
                detail={"delegation_id": grant.delegation_id, "reason": "account disconnected"},
            )
            await session.delete(grant)
        await session.execute(delete(UnifiedEvent).where(UnifiedEvent.calendar_id.in_(calendar_ids)))
        # Audit entries referencing these calendars are preserved with their
        # calendar link cleared (ON DELETE SET NULL, migration 0005).
        await session.execute(delete(Calendar).where(Calendar.account_id == account_id))
    # Tear down push subscriptions first (best-effort provider stops).
    from chronarch_core.sync.webhooks import drop_account_webhooks

    await drop_account_webhooks(session, account)
    await session.delete(account)
    await session.flush()


@router.post("/{account_id}/webhooks")
async def ensure_webhooks(
    account_id: str,
    _admin: User = Depends(require_permission("accounts.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    """Arm (or renew) push subscriptions for an account now. No-op with a
    skip reason where push can't reach this deployment (polling covers it)."""
    from chronarch_core.sync.webhooks import ensure_account_webhooks

    from ..config import APP_BASE_URL

    account = await session.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    result = await ensure_account_webhooks(session, account, APP_BASE_URL)
    await session.commit()
    return {"account_id": account.id, **result}


class IcsSubscriptionCreate(BaseModel):
    name: str
    url: str
    color: str = "#30d158"


@router.post("/ics-subscription", status_code=status.HTTP_201_CREATED)
async def create_ics_subscription(
    body: IcsSubscriptionCreate,
    admin: User = Depends(require_permission("accounts.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    """Add an external ICS calendar subscription feed (BR-CAL-004)."""
    from chronarch_core.models.enums import CalendarKind, ProviderType
    from chronarch_core.sync.ics_sync import sync_ics_subscription_calendar

    # 1. Create or find an ICS account for this owner
    stmt = select(Account).where(
        Account.owner_user_id == admin.id,
        Account.provider == ProviderType.ICS,
    )
    account = (await session.execute(stmt)).scalars().first()
    if account is None:
        account = Account(
            owner_user_id=admin.id,
            provider=ProviderType.ICS,
            provider_account_email="ICS Feeds",
            provider_account_id=f"ics-{admin.id}",
            sync_status="active",
        )
        session.add(account)
        await session.flush()

    # 2. Create the subscription calendar
    calendar = Calendar(
        account_id=account.id,
        provider_calendar_id=f"sub-{body.name.lower().replace(' ', '-')}",
        kind=CalendarKind.SUBSCRIPTION,
        name=body.name,
        color=body.color,
        provider_writable=False,
        visible=True,
        blocks_availability=True,
        ics_subscription_url=body.url.strip(),
        ea_can_view=True,
        ea_can_edit=False,
        ai_can_read=True,
        ai_can_write=False,
    )
    session.add(calendar)
    await session.flush()

    # 3. Synchronously perform initial backfill sync
    stats = await sync_ics_subscription_calendar(session, calendar)

    return {
        "calendar_id": calendar.id,
        "name": calendar.name,
        "sync_stats": stats,
    }


@router.post("/{account_id}/sync")
async def sync_account(
    account_id: str,
    _user: User = Depends(require_permission("accounts.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    """Trigger an on-demand reconciliation sync for a connected provider account."""
    from datetime import datetime, timezone
    from chronarch_core.models.enums import ProviderType
    from chronarch_core.sync.google_sync import sync_google_account
    from chronarch_core.sync.microsoft_sync import sync_microsoft_account
    from chronarch_core.sync.caldav_sync import sync_caldav_account
    from chronarch_core.sync.ics_sync import sync_ics_subscription_calendar

    account = await session.get(Account, account_id)
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    stats = {}
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        if account.provider == ProviderType.GOOGLE:
            stats = await sync_google_account(session, account)
        elif account.provider == ProviderType.MICROSOFT:
            stats = await sync_microsoft_account(session, account)
        elif account.provider == ProviderType.CALDAV:
            stats = await sync_caldav_account(session, account)
        elif account.provider == ProviderType.ICS:
            # Sync all subscription calendars belonging to this ICS account
            sub_cals = list(
                (await session.execute(select(Calendar).where(Calendar.account_id == account.id))).scalars()
            )
            total_stats = {"events_synced": 0, "events_deleted": 0}
            for cal in sub_cals:
                s = await sync_ics_subscription_calendar(session, cal)
                total_stats["events_synced"] += s.get("events_synced", 0)
                total_stats["events_deleted"] += s.get("events_deleted", 0)
            stats = total_stats

        account.last_synced_at = now_iso
        account.sync_status = "active"
        account.last_sync_error = None
        # Keep the invite-extracted contact directory in step (best-effort:
        # extraction must never fail a manual sync either).
        try:
            from chronarch_core.contacts import refresh_contacts_for_account

            await refresh_contacts_for_account(session, account.id)
        except Exception:
            pass
        await session.commit()
    except Exception as e:
        account.sync_status = "error"
        account.last_sync_error = str(e)
        await session.commit()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Sync failed: {str(e)}")

    return {
        "synced": True,
        "account_id": account.id,
        "last_synced_at": now_iso,
        "stats": stats,
    }

