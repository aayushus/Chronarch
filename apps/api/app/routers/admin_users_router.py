"""User management (BRD §30 "Users") + role assignment.

Reads need `users.view`, writes need `users.manage`. Changing which *roles*
a user holds is additionally restricted to ADMIN-role holders (custom roles
must never become an escalation path), with a last-admin-holder guard.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import rbac as _rbac
from chronarch_core.models.enums import UserRole
from chronarch_core.models.rbac import Role, RoleAssignment
from chronarch_core.models.user import User

from ..admin_guard import require_permission
from ..auth import hash_password
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin"])


class AdminUserOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    roles: list[str] = []
    is_active: bool

    model_config = {"from_attributes": True}


class AdminUserCreate(BaseModel):
    email: EmailStr
    display_name: str
    password: str
    role: UserRole = UserRole.DELEGATE
    roles: list[str] | None = None  # role names; defaults to ["delegate"]


class AdminUserUpdate(BaseModel):
    display_name: str | None = None
    role: UserRole | None = None
    roles: list[str] | None = None
    is_active: bool | None = None


async def _to_out(session: AsyncSession, user: User) -> AdminUserOut:
    return AdminUserOut(
        id=user.id, email=user.email, display_name=user.display_name,
        role=user.role.value,
        roles=sorted(await _rbac.get_user_role_names(session, user.id)),
        is_active=user.is_active,
    )


async def _set_roles(session: AsyncSession, user: User, role_names: list[str]) -> None:
    """Replace a user's role memberships. Caller must be ADMIN (checked by
    the route): role assignment is never delegable."""
    wanted = []
    for name in dict.fromkeys(role_names):
        role = (
            await session.execute(select(Role).where(Role.name == name))
        ).scalar_one_or_none()
        if role is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown role '{name}'")
        wanted.append(role)
    if user.role == UserRole.ADMIN and not any(r.name == _rbac.ADMIN_ROLE_NAME for r in wanted):
        # The ADMIN user-role short-circuits to all permissions on its own,
        # so membership rows are informational for admins — still, keep at
        # least the admin membership for a truthful Roles tab.
        pass
    await session.execute(
        RoleAssignment.__table__.delete().where(RoleAssignment.user_id == user.id)
    )
    for role in wanted:
        session.add(RoleAssignment(user_id=user.id, role_id=role.id))
    await session.flush()


@router.get("", response_model=list[AdminUserOut])
async def list_users(
    _user: User = Depends(require_permission("users.view")),
    session: AsyncSession = Depends(get_db_session),
):
    users = list((await session.execute(select(User))).scalars())
    return [await _to_out(session, u) for u in users]


@router.post("", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: AdminUserCreate,
    _user: User = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    existing = (await session.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")

    user = User(
        email=body.email, display_name=body.display_name,
        password_hash=hash_password(body.password), role=body.role,
        force_password_change=(body.role != UserRole.ADMIN),
    )
    session.add(user)
    await session.flush()
    # New users land in the requested roles (default: delegate).
    names = body.roles if body.roles is not None else [_rbac.DELEGATE_ROLE_NAME]
    if user.role == UserRole.ADMIN and _rbac.ADMIN_ROLE_NAME not in names:
        names = [*names, _rbac.ADMIN_ROLE_NAME]
    await _set_roles(session, user, names)
    return await _to_out(session, user)


@router.patch("/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: str,
    body: AdminUserUpdate,
    admin: User = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    if body.roles is not None:
        # Role assignment is ADMIN-only, even for holders of users.manage.
        if admin.role != UserRole.ADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can assign roles")
        if user.id == admin.id and _rbac.ADMIN_ROLE_NAME not in body.roles and user.role == UserRole.ADMIN:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin role")
        await _set_roles(session, user, body.roles)

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        if admin.role != UserRole.ADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can change user roles")
        if user.id == admin.id and body.role != UserRole.ADMIN:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin access")
        if body.role != UserRole.ADMIN:
            remaining = await _rbac.admin_holder_count(session, exclude_user_id=user.id)
            if remaining == 0 and user.role == UserRole.ADMIN:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot demote the last admin")
        user.role = body.role
    if body.is_active is not None:
        if user.id == admin.id and body.is_active is False:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate yourself")
        if body.is_active is False and user.role == UserRole.ADMIN:
            remaining = await _rbac.admin_holder_count(session, exclude_user_id=user.id)
            if remaining == 0:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot deactivate the last admin")
        user.is_active = body.is_active
    await session.flush()
    return await _to_out(session, user)
