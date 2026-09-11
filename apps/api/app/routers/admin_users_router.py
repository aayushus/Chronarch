"""Admin user management (BRD §30 "Users")."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User

from ..admin_guard import require_admin
from ..auth import hash_password
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin"])


class AdminUserOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    is_admin: bool
    is_active: bool

    model_config = {"from_attributes": True}


class AdminUserCreate(BaseModel):
    email: EmailStr
    display_name: str
    password: str
    role: UserRole = UserRole.ASSISTANT
    is_admin: bool = False


class AdminUserUpdate(BaseModel):
    display_name: str | None = None
    role: UserRole | None = None
    is_admin: bool | None = None
    is_active: bool | None = None


@router.get("", response_model=list[AdminUserOut])
async def list_users(_admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)):
    users = list((await session.execute(select(User))).scalars())
    return [_to_out(u) for u in users]


@router.post("", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: AdminUserCreate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    existing = (await session.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")

    user = User(
        email=body.email, display_name=body.display_name,
        password_hash=hash_password(body.password), role=body.role, is_admin=body.is_admin,
    )
    session.add(user)
    await session.flush()
    return _to_out(user)


@router.patch("/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: str,
    body: AdminUserUpdate,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id and body.is_admin is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin access")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await session.flush()
    return _to_out(user)


def _to_out(user: User) -> AdminUserOut:
    return AdminUserOut(
        id=user.id, email=user.email, display_name=user.display_name,
        role=user.role.value, is_admin=user.is_admin, is_active=user.is_active,
    )
