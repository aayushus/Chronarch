"""RBAC enforcement for admin-surface endpoints.

`require_admin` is kept as the ADMIN-role short-circuit (used for role
management itself, which must stay admin-only). Everything else uses
`require_permission("<group>.<level>")`: ADMIN holders pass automatically,
other users need the permission via an assigned role.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import rbac
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User

from .auth import get_current_user
from .deps import get_db_session


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


def require_permission(permission: str):
    """Dependency factory: 403 unless the caller holds `permission`."""

    async def _guard(
        user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_db_session),
    ) -> User:
        if not await rbac.has_permission(session, user, permission):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires the '{permission}' permission",
            )
        return user

    return _guard


async def current_permissions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> frozenset[str]:
    """Effective permission set for the caller (for /auth/me and UI gating)."""
    return await rbac.get_user_permissions(session, user)
