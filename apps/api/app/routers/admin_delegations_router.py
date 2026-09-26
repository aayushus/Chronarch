"""Admin delegation management (BRD §14, §30 "Delegates")."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.calendar import Calendar
from chronarch_core.models.account import Account
from chronarch_core.models.delegation import Delegation, DelegationCalendarGrant
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User

from ..admin_guard import require_permission
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/delegations", tags=["admin"])

GRANT_FIELDS = [
    "can_view_availability", "can_view_titles", "can_view_full_details", "can_create", "can_edit",
    "can_reschedule", "can_delete", "can_manage_attendees", "can_respond_to_invitations",
    "can_import_ics", "can_move_between_calendars",
]


class GrantOut(BaseModel):
    calendar_id: str
    calendar_name: str
    can_view_availability: bool
    can_view_titles: bool
    can_view_full_details: bool
    can_create: bool
    can_edit: bool
    can_reschedule: bool
    can_delete: bool
    can_manage_attendees: bool
    can_respond_to_invitations: bool
    can_import_ics: bool
    can_move_between_calendars: bool


class DelegationOut(BaseModel):
    id: str
    owner_user_id: str
    owner_email: str
    delegate_user_id: str
    delegate_email: str
    active: bool
    grants: list[GrantOut]


class DelegationCreate(BaseModel):
    owner_user_id: str
    delegate_user_id: str


class GrantUpdate(BaseModel):
    can_view_availability: bool = True
    can_view_titles: bool = False
    can_view_full_details: bool = False
    can_create: bool = False
    can_edit: bool = False
    can_reschedule: bool = False
    can_delete: bool = False
    can_manage_attendees: bool = False
    can_respond_to_invitations: bool = False
    can_import_ics: bool = False
    can_move_between_calendars: bool = False


async def _to_out(session: AsyncSession, deleg: Delegation) -> DelegationOut:
    owner_user = await session.get(User, deleg.owner_user_id)
    delegate = await session.get(User, deleg.delegate_user_id)
    grants = list(
        (await session.execute(
            select(DelegationCalendarGrant).where(DelegationCalendarGrant.delegation_id == deleg.id)
        )).scalars()
    )
    grant_outs = []
    for g in grants:
        cal = await session.get(Calendar, g.calendar_id)
        grant_outs.append(
            GrantOut(
                calendar_id=g.calendar_id, calendar_name=cal.name if cal else "Unknown",
                **{f: getattr(g, f) for f in GRANT_FIELDS},
            )
        )
    return DelegationOut(
        id=deleg.id, owner_user_id=deleg.owner_user_id,
        owner_email=owner_user.email if owner_user else "Unknown",
        delegate_user_id=deleg.delegate_user_id,
        delegate_email=delegate.email if delegate else "Unknown",
        active=deleg.active, grants=grant_outs,
    )


@router.get("", response_model=list[DelegationOut])
async def list_delegations(_admin: User = Depends(require_permission("delegations.view")), session: AsyncSession = Depends(get_db_session)):
    stmt = select(Delegation)
    if _admin.role != UserRole.ADMIN:
        stmt = stmt.where(Delegation.owner_user_id == _admin.id)
    delegations = list((await session.execute(stmt)).scalars())
    return [await _to_out(session, d) for d in delegations]


@router.post("", response_model=DelegationOut, status_code=status.HTTP_201_CREATED)
async def create_delegation(
    body: DelegationCreate,
    _admin: User = Depends(require_permission("delegations.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    owner = await session.get(User, body.owner_user_id)
    delegate = await session.get(User, body.delegate_user_id)
    if owner is None or delegate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Owner or delegate user not found")
    if delegate.role != UserRole.DELEGATE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Delegate user must have the delegate role")
    if _admin.role != UserRole.ADMIN and _admin.id != owner.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner or an administrator may manage this delegation")

    deleg = Delegation(owner_user_id=body.owner_user_id, delegate_user_id=body.delegate_user_id)
    session.add(deleg)
    await session.flush()
    return await _to_out(session, deleg)


@router.patch("/{delegation_id}", response_model=DelegationOut)
async def set_delegation_active(
    delegation_id: str,
    active: bool,
    _admin: User = Depends(require_permission("delegations.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    deleg = await session.get(Delegation, delegation_id)
    if deleg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Delegation not found")
    if _admin.role != UserRole.ADMIN and _admin.id != deleg.owner_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner or an administrator may manage this delegation")
    deleg.active = active
    await session.flush()
    return await _to_out(session, deleg)


@router.delete("/{delegation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_delegation(
    delegation_id: str,
    _admin: User = Depends(require_permission("delegations.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    deleg = await session.get(Delegation, delegation_id)
    if deleg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Delegation not found")
    if _admin.role != UserRole.ADMIN and _admin.id != deleg.owner_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner or an administrator may manage this delegation")
    from sqlalchemy import delete
    await session.execute(delete(DelegationCalendarGrant).where(DelegationCalendarGrant.delegation_id == delegation_id))
    await session.delete(deleg)
    await session.flush()


@router.put("/{delegation_id}/grants/{calendar_id}", response_model=DelegationOut)
async def upsert_grant(
    delegation_id: str,
    calendar_id: str,
    body: GrantUpdate,
    _admin: User = Depends(require_permission("delegations.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    deleg = await session.get(Delegation, delegation_id)
    if deleg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Delegation not found")
    if _admin.role != UserRole.ADMIN and _admin.id != deleg.owner_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner or an administrator may manage this delegation")
    calendar = await session.get(Calendar, calendar_id)
    if calendar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendar not found")
    owner_account = await session.get(Account, calendar.account_id)
    if owner_account is None or owner_account.owner_user_id != deleg.owner_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Calendar is not owned by the delegation owner")

    existing = (
        await session.execute(
            select(DelegationCalendarGrant).where(
                DelegationCalendarGrant.delegation_id == delegation_id,
                DelegationCalendarGrant.calendar_id == calendar_id,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = DelegationCalendarGrant(delegation_id=delegation_id, calendar_id=calendar_id)
        session.add(existing)

    for field in GRANT_FIELDS:
        setattr(existing, field, getattr(body, field))
    await session.flush()
    return await _to_out(session, deleg)


@router.delete("/{delegation_id}/grants/{calendar_id}", response_model=DelegationOut)
async def remove_grant(
    delegation_id: str,
    calendar_id: str,
    _admin: User = Depends(require_permission("delegations.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    deleg = await session.get(Delegation, delegation_id)
    if deleg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Delegation not found")
    if _admin.role != UserRole.ADMIN and _admin.id != deleg.owner_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner or an administrator may manage this delegation")
    existing = (
        await session.execute(
            select(DelegationCalendarGrant).where(
                DelegationCalendarGrant.delegation_id == delegation_id,
                DelegationCalendarGrant.calendar_id == calendar_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await session.delete(existing)
        await session.flush()
    return await _to_out(session, deleg)
