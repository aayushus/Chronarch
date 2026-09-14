from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.delegation import Delegation, DelegationCalendarGrant
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User


async def is_calendar_owner(session: AsyncSession, user: User, calendar: Calendar) -> bool:
    """True when `user` owns the account behind `calendar`.

    Ownership is per-account (Account.owner_user_id); only ADMIN-role users
    can own accounts (delegates never create accounts). A non-owner gets
    False here and the permission engine's `_user_level` explicitly denies
    them (no owner-to-owner grant table exists yet — Phase 2, BRD §32).
    Admins bypass separately via `AuthContext.is_admin` inside the engine,
    not via this helper.
    """
    if user.role != UserRole.ADMIN:
        return False
    account = await session.get(Account, calendar.account_id)
    return account is not None and account.owner_user_id == user.id


async def get_delegation_grant(
    session: AsyncSession, delegate_user_id: str, calendar_id: str
) -> DelegationCalendarGrant | None:
    stmt = (
        select(DelegationCalendarGrant)
        .join(Delegation, Delegation.id == DelegationCalendarGrant.delegation_id)
        .where(
            Delegation.delegate_user_id == delegate_user_id,
            Delegation.active.is_(True),
            DelegationCalendarGrant.calendar_id == calendar_id,
        )
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_owned_calendar_ids(session: AsyncSession, user: User) -> set[str]:
    """Ids of calendars under accounts owned by `user` — the per-calendar
    ownership set for multi-calendar checks (e.g. conflict detection)."""
    if user.role != UserRole.ADMIN:
        return set()
    stmt = (
        select(Calendar.id)
        .join(Account, Account.id == Calendar.account_id)
        .where(Account.owner_user_id == user.id)
    )
    return set((await session.execute(stmt)).scalars())


async def get_delegation_grants(
    session: AsyncSession, delegate_user_id: str
) -> dict[str, DelegationCalendarGrant]:
    """All active DelegationCalendarGrants for a delegate, keyed by
    calendar id — one query for multi-calendar checks."""
    stmt = (
        select(DelegationCalendarGrant)
        .join(Delegation, Delegation.id == DelegationCalendarGrant.delegation_id)
        .where(
            Delegation.delegate_user_id == delegate_user_id,
            Delegation.active.is_(True),
        )
    )
    grants = list((await session.execute(stmt)).scalars())
    return {g.calendar_id: g for g in grants}
