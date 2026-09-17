"""RBAC permission catalog and resolution (admin/delegate/custom roles).

`UserRole` (ADMIN/DELEGATE) is calendar identity + the admin short-circuit:
ADMIN holders are allowed everything without consulting these tables.
Everyone else's effective permissions are the union of their assigned
roles' permissions. New users get the `delegate` role by default.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models.enums import UserRole
from .models.rbac import Role, RoleAssignment, RolePermission
from .models.user import User

# group -> [(permission, description)]
PERMISSION_GROUPS: dict[str, list[tuple[str, str]]] = {
    "Calendars": [
        ("calendars.view", "See calendar settings"),
        ("calendars.manage", "Change calendar settings"),
    ],
    "Accounts": [
        ("accounts.view", "See connected accounts"),
        ("accounts.manage", "Connect, disconnect, and sync accounts"),
    ],
    "OAuth credentials": [
        ("oauth.view", "See provider credential status"),
        ("oauth.manage", "Save or clear provider secrets"),
    ],
    "Delegation": [
        ("delegations.view", "See sharing grants"),
        ("delegations.manage", "Create and revoke sharing grants"),
    ],
    "Booking": [
        ("booking.view", "See booking links and bookings"),
        ("booking.manage", "Create booking links and approve bookings"),
    ],
    "Kiosk": [
        ("kiosk.view", "See wall displays and their links"),
        ("kiosk.manage", "Pair, configure, and revoke wall displays"),
    ],
    "Users": [
        ("users.view", "See users"),
        ("users.manage", "Create, edit, and deactivate users"),
    ],
    "MCP": [
        ("mcp.view", "See MCP credentials"),
        ("mcp.manage", "Issue and revoke any MCP credential"),
        ("mcp_keys.create_self", "Create and revoke own MCP keys"),
    ],
    "AI / Copilot": [
        ("ai.view", "See model and routing settings"),
        ("ai.manage", "Change models, routing, and provider keys"),
        ("copilot.use", "Use the built-in AI copilot"),
    ],
    "Audit": [
        ("audit.view", "Inspect the audit log (read-only, always)"),
    ],
    "System": [
        ("system.view", "See sync and service status"),
    ],
}

ALL_PERMISSIONS: frozenset[str] = frozenset(
    perm for group in PERMISSION_GROUPS.values() for perm, _ in group
)

ADMIN_ROLE_NAME = "admin"
DELEGATE_ROLE_NAME = "delegate"

#: Seeded permissions for the default delegate: calendar UI (open to all
#: authenticated users by design) + copilot + own MCP keys. Nothing else.
DELEGATE_DEFAULT_PERMISSIONS: frozenset[str] = frozenset({
    "copilot.use",
    "mcp_keys.create_self",
})


async def get_user_role_names(session: AsyncSession, user_id: str) -> list[str]:
    rows = list(
        (
            await session.execute(
                select(Role.name).join(RoleAssignment, RoleAssignment.role_id == Role.id).where(
                    RoleAssignment.user_id == user_id
                )
            )
        ).scalars()
    )
    return rows


async def get_user_permissions(session: AsyncSession, user: User) -> frozenset[str]:
    """Effective permission set. ADMIN user-role short-circuits to all."""
    if user.role == UserRole.ADMIN:
        return ALL_PERMISSIONS
    rows = list(
        (
            await session.execute(
                select(RolePermission.permission)
                .join(RoleAssignment, RoleAssignment.role_id == RolePermission.role_id)
                .where(RoleAssignment.user_id == user.id)
            )
        ).scalars()
    )
    return frozenset(rows) & ALL_PERMISSIONS


async def has_permission(session: AsyncSession, user: User, permission: str) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    return permission in await get_user_permissions(session, user)


async def ensure_default_role(session: AsyncSession, user_id: str) -> None:
    """Give a user the delegate role unless they hold any role already."""
    existing = (
        await session.execute(select(RoleAssignment.id).where(RoleAssignment.user_id == user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return
    role_id = (
        await session.execute(select(Role.id).where(Role.name == DELEGATE_ROLE_NAME))
    ).scalar_one_or_none()
    if role_id is None:
        return
    session.add(RoleAssignment(user_id=user_id, role_id=role_id))
    await session.flush()


async def admin_holder_count(session: AsyncSession, exclude_user_id: str | None = None) -> int:
    """Users whose ADMIN user-role makes them full admins (optionally excluding one)."""
    from sqlalchemy import func

    stmt = select(func.count(User.id)).where(User.role == UserRole.ADMIN, User.is_active.is_(True))
    if exclude_user_id:
        stmt = stmt.where(User.id != exclude_user_id)
    return (await session.execute(stmt)).scalar_one()
