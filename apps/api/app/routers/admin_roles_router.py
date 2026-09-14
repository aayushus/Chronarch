"""RBAC role management (custom roles + assignment).

Role administration itself is ADMIN-only (never delegable): custom roles
can never confer their way to this surface. Guards keep at least one
holder of the admin role and forbid deleting system roles.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import rbac as _rbac
from chronarch_core.models.enums import AuditAction, UserRole
from chronarch_core.models.rbac import Role, RoleAssignment, RolePermission
from chronarch_core.models.user import User

from ..admin_guard import require_admin
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/roles", tags=["admin"])


class RoleOut(BaseModel):
    id: str
    name: str
    description: str
    is_system: bool
    permissions: list[str]
    members: list[dict]


class RoleCreate(BaseModel):
    name: str
    description: str = ""
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    description: str | None = None
    permissions: list[str] | None = None


class MemberAdd(BaseModel):
    user_id: str


async def _to_out(session: AsyncSession, role: Role) -> RoleOut:
    perms = sorted(
        (
            await session.execute(
                select(RolePermission.permission).where(RolePermission.role_id == role.id)
            )
        ).scalars()
    )
    members = list(
        (
            await session.execute(
                select(User).join(RoleAssignment, RoleAssignment.user_id == User.id).where(
                    RoleAssignment.role_id == role.id
                )
            )
        ).scalars()
    )
    return RoleOut(
        id=role.id, name=role.name, description=role.description, is_system=role.is_system,
        permissions=perms,
        members=[{"id": u.id, "email": u.email} for u in members],
    )


async def _audit(session: AsyncSession, admin: User, action: AuditAction, detail: dict) -> None:
    from chronarch_core.audit import write_audit_entry
    from chronarch_core.models.enums import ActorType
    from chronarch_core.permissions import AuthContext

    await write_audit_entry(
        session,
        ctx=AuthContext(user_id=admin.id, role=admin.role, actor_type=ActorType.API, is_admin=True),
        action=action,
        detail=detail,
    )


@router.get("/catalog", response_model=dict)
async def permission_catalog(_admin: User = Depends(require_admin)):
    """The permission matrix shape for the Roles UI."""
    return {group: [{"permission": p, "description": d} for p, d in items]
            for group, items in _rbac.PERMISSION_GROUPS.items()}


@router.get("", response_model=list[RoleOut])
async def list_roles(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    roles = list((await session.execute(select(Role).order_by(Role.name))).scalars())
    return [await _to_out(session, r) for r in roles]


@router.post("", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreate,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    name = body.name.strip().lower().replace(" ", "_")
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Role name cannot be blank")
    if name in (_rbac.ADMIN_ROLE_NAME, _rbac.DELEGATE_ROLE_NAME):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That name is reserved for a system role")
    if (await session.execute(select(Role).where(Role.name == name))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "A role with that name already exists")
    unknown = set(body.permissions) - set(_rbac.ALL_PERMISSIONS)
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown permissions: {sorted(unknown)}")
    role = Role(name=name, description=body.description.strip())
    session.add(role)
    await session.flush()
    for perm in sorted(set(body.permissions)):
        session.add(RolePermission(role_id=role.id, permission=perm))
    await _audit(session, admin, AuditAction.CREATE_ROLE, {"role": name, "permissions": sorted(set(body.permissions))})
    return await _to_out(session, role)


@router.patch("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: str,
    body: RoleUpdate,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if body.description is not None:
        role.description = body.description.strip()
    if body.permissions is not None:
        unknown = set(body.permissions) - set(_rbac.ALL_PERMISSIONS)
        if unknown:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown permissions: {sorted(unknown)}")
        await session.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
        for perm in sorted(set(body.permissions)):
            session.add(RolePermission(role_id=role.id, permission=perm))
    await _audit(session, admin, AuditAction.UPDATE_ROLE, {"role": role.name})
    return await _to_out(session, role)


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: str,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if role.is_system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "System roles cannot be deleted")
    await session.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
    await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id == role.id))
    await _audit(session, admin, AuditAction.DELETE_ROLE, {"role": role.name})
    await session.delete(role)
    await session.flush()


@router.post("/{role_id}/members", response_model=RoleOut)
async def add_member(
    role_id: str,
    body: MemberAdd,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    user = await session.get(User, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    existing = (
        await session.execute(
            select(RoleAssignment).where(
                RoleAssignment.role_id == role.id, RoleAssignment.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(RoleAssignment(user_id=user.id, role_id=role.id))
        await session.flush()
    await _audit(session, admin, AuditAction.ASSIGN_ROLE, {"role": role.name, "user": user.email})
    return await _to_out(session, role)


@router.delete("/{role_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    role_id: str,
    user_id: str,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if role.name == _rbac.ADMIN_ROLE_NAME:
        members = list(
            (
                await session.execute(
                    select(RoleAssignment.user_id).where(RoleAssignment.role_id == role.id)
                )
            ).scalars()
        )
        if user_id in members and len(members) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove the last admin member")
    await session.execute(
        delete(RoleAssignment).where(
            RoleAssignment.role_id == role_id, RoleAssignment.user_id == user_id
        )
    )
    user = await session.get(User, user_id)
    await _audit(
        session, admin, AuditAction.REVOKE_ROLE,
        {"role": role.name, "user": user.email if user else user_id},
    )
    await session.flush()
