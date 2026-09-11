from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.user import User

from ..auth import (
    _bearer,
    build_auth_context,
    create_access_token,
    get_current_user,
    hash_password,
    revoke_token,
    verify_password,
)
from ..config import (
    LOGIN_RATE_LIMIT_REQUESTS,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    PASSWORD_RATE_LIMIT_REQUESTS,
    PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
)
from ..deps import get_db_session
from ..rate_limiter import RateLimiter

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

MIN_PASSWORD_LENGTH = 8

login_rate_limiter = RateLimiter(
    requests=LOGIN_RATE_LIMIT_REQUESTS,
    window_seconds=LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    key_prefix="login",
    by_ip=True,
)

password_rate_limiter = RateLimiter(
    requests=PASSWORD_RATE_LIMIT_REQUESTS,
    window_seconds=PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
    key_prefix="password",
    by_ip=False,
)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LogoutResponse(BaseModel):
    status: str = "ok"


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(login_rate_limiter)])
async def login(body: LoginRequest, session: AsyncSession = Depends(get_db_session)):
    user = (await session.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return LoginResponse(access_token=create_access_token(user.id))


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: User = Depends(get_current_user),
):
    """Revoke current JWT access token so it cannot be used again."""
    if credentials:
        await revoke_token(credentials.credentials)
    return LogoutResponse(status="ok")



class MeResponse(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    is_admin: bool


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)):
    return MeResponse(id=user.id, email=user.email, display_name=user.display_name, role=user.role.value, is_admin=user.is_admin)


class MeUpdate(BaseModel):
    display_name: str | None = None
    email: EmailStr | None = None


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: MeUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Self-service profile edit — any logged-in user (executive, assistant,
    admin) can update their own display name and email. Role/admin changes
    stay admin-only via /api/v1/admin/users."""
    if body.display_name is not None:
        name = body.display_name.strip()
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Display name cannot be blank")
        user.display_name = name
    if body.email is not None and body.email != user.email:
        existing = (await session.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")
        user.email = body.email
    await session.flush()
    return MeResponse(id=user.id, email=user.email, display_name=user.display_name, role=user.role.value, is_admin=user.is_admin)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/password", response_model=MeResponse, dependencies=[Depends(password_rate_limiter)])
async def change_my_password(
    body: PasswordChange,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Self-service password change. Requires the current password so a
    briefly-unattended session can't be used to lock the owner out."""
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Current password is incorrect")
    if len(body.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"New password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    user.password_hash = hash_password(body.new_password)
    await session.flush()
    return MeResponse(id=user.id, email=user.email, display_name=user.display_name, role=user.role.value, is_admin=user.is_admin)
