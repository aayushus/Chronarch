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
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User

from ..admin_guard import require_admin
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


@router.get("", response_model=list[AdminAccountOut])
async def list_accounts(_admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)):
    accounts = list((await session.execute(select(Account))).scalars())
    out = []
    for a in accounts:
        owner = await session.get(User, a.owner_user_id)
        count = len(
            list((await session.execute(select(Calendar.id).where(Calendar.account_id == a.id))).scalars())
        )
        out.append(
            AdminAccountOut(
                id=a.id, provider=a.provider.value, provider_account_email=a.provider_account_email,
                tenant_id=a.tenant_id, owner_user_id=a.owner_user_id,
                owner_email=owner.email if owner else "Unknown",
                sync_status=a.sync_status, last_synced_at=a.last_synced_at, calendar_count=count,
            )
        )
    return out


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_account(
    account_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    account = await session.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    calendar_ids = list(
        (await session.execute(select(Calendar.id).where(Calendar.account_id == account_id))).scalars()
    )
    if calendar_ids:
        await session.execute(delete(UnifiedEvent).where(UnifiedEvent.calendar_id.in_(calendar_ids)))
        await session.execute(delete(Calendar).where(Calendar.account_id == account_id))
    await session.delete(account)
    await session.flush()


class IcsSubscriptionCreate(BaseModel):
    name: str
    url: str
    color: str = "#30d158"


@router.post("/ics-subscription", status_code=status.HTTP_201_CREATED)
async def create_ics_subscription(
    body: IcsSubscriptionCreate,
    admin: User = Depends(require_admin),
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

