from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.delegation import Delegation, DelegationCalendarGrant
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User


async def is_calendar_owner(session: AsyncSession, user: User, calendar: Calendar) -> bool:
    if user.role != UserRole.EXECUTIVE and not user.is_admin:
        return False
    account = await session.get(Account, calendar.account_id)
    return account is not None and account.owner_user_id == user.id


async def get_delegation_grant(
    session: AsyncSession, assistant_user_id: str, calendar_id: str
) -> DelegationCalendarGrant | None:
    stmt = (
        select(DelegationCalendarGrant)
        .join(Delegation, Delegation.id == DelegationCalendarGrant.delegation_id)
        .where(
            Delegation.assistant_user_id == assistant_user_id,
            Delegation.active.is_(True),
            DelegationCalendarGrant.calendar_id == calendar_id,
        )
    )
    return (await session.execute(stmt)).scalar_one_or_none()
