from fastapi import Depends, HTTPException, status

from chronarch_core.models.user import User

from .auth import get_current_user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
