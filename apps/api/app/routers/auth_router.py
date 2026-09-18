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
    remember_me: bool = True


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
    return LoginResponse(access_token=create_access_token(user.id, remember_me=body.remember_me))


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: User = Depends(get_current_user),
):
    """Revoke current JWT access token so it cannot be used again."""
    if credentials:
        await revoke_token(credentials.credentials)
    return LogoutResponse(status="ok")


class SignupRequest(BaseModel):
    email: EmailStr
    display_name: str
    password: str


@router.get("/signup-status")
async def signup_status():
    """Whether public registration is enabled (drives the login page —
    no secrets, safe to expose)."""
    from .. import config as _config

    return {"allowed": _config.ALLOW_SIGNUPS}


@router.post("/signup", response_model=LoginResponse, dependencies=[Depends(login_rate_limiter)])
async def signup(body: SignupRequest, session: AsyncSession = Depends(get_db_session)):
    """Public self-signup, gated by ALLOW_SIGNUPS (default off).

    Every signup is a workspace admin — access control lives entirely in
    the gate (turn it off and nobody new gets in). Returns a session token
    directly so signup flows straight into onboarding.
    """
    from .. import config as _config
    from chronarch_core import rbac as _rbac
    from chronarch_core.models.enums import UserRole
    from chronarch_core.models.rbac import Role, RoleAssignment

    if not _config.ALLOW_SIGNUPS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Public signup is disabled on this server")
    name = (body.display_name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Display name cannot be blank")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    email = str(body.email).strip().lower()
    if (await session.execute(select(User).where(User.email == email))).scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")

    user = User(email=email, display_name=name, password_hash=hash_password(body.password),
                role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    # Mirror the admin-create path: admin role membership, not just the enum.
    role_id = (await session.execute(select(Role.id).where(Role.name == _rbac.ADMIN_ROLE_NAME))).scalar_one_or_none()
    if role_id is not None:
        session.add(RoleAssignment(user_id=user.id, role_id=role_id))
        await session.flush()
    return LoginResponse(access_token=create_access_token(user.id))



class MeResponse(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    permissions: list[str] = []
    roles: list[str] = []
    working_hours_start: str = "09:00"
    working_hours_end: str = "17:00"
    home_timezone: str = "UTC"
    secondary_timezone: str | None = None
    working_days: str = "1,2,3,4,5"
    min_meeting_notice_minutes: int = 0
    meeting_buffer_minutes: int = 0


def _me_response(user: User, *, permissions=None, roles=None) -> MeResponse:
    return MeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role.value,
        permissions=list(permissions or []),
        roles=list(roles or []),
        working_hours_start=user.working_hours_start or "09:00",
        working_hours_end=user.working_hours_end or "17:00",
        home_timezone=user.home_timezone or "UTC",
        secondary_timezone=user.secondary_timezone,
        working_days=user.working_days or "1,2,3,4,5",
        min_meeting_notice_minutes=user.min_meeting_notice_minutes or 0,
        meeting_buffer_minutes=user.meeting_buffer_minutes or 0,
    )


@router.get("/me", response_model=MeResponse)
async def me(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core import rbac as _rbac

    return _me_response(
        user,
        permissions=sorted(await _rbac.get_user_permissions(session, user)),
        roles=sorted(await _rbac.get_user_role_names(session, user.id)),
    )


class MeUpdate(BaseModel):
    display_name: str | None = None
    email: EmailStr | None = None
    home_timezone: str | None = None
    secondary_timezone: str | None = None
    working_days: str | None = None
    working_hours_start: str | None = None
    working_hours_end: str | None = None
    min_meeting_notice_minutes: int | None = None
    meeting_buffer_minutes: int | None = None


def _parse_hhmm(value: str, field: str) -> str:
    import re

    m = re.fullmatch(r"(\d{1,2}):(\d{2})", value.strip())
    if not m or not (0 <= int(m.group(1)) <= 23 and 0 <= int(m.group(2)) <= 59):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} must be HH:MM (00:00–23:59)")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: MeUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Self-service profile edit — any logged-in user (executive, assistant,
    admin) can update their own display name and email. Role/admin changes
    stay admin-only via /api/v1/admin/users."""
    from chronarch_core.timezones import validate_timezone

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
    if body.home_timezone is not None:
        try:
            user.home_timezone = validate_timezone(body.home_timezone)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if body.secondary_timezone is not None:
        if not body.secondary_timezone.strip():
            user.secondary_timezone = None
        else:
            try:
                user.secondary_timezone = validate_timezone(body.secondary_timezone)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if body.working_days is not None:
        import re as _re_days

        parts = [p.strip() for p in body.working_days.split(",") if p.strip()]
        if not parts or any(not _re_days.fullmatch(r"[1-7]", p) for p in parts):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "working_days must be comma-separated ISO weekday numbers (1=Mon … 7=Sun)",
            )
        user.working_days = ",".join(sorted(set(parts), key=int))
    if body.working_hours_start is not None:
        user.working_hours_start = _parse_hhmm(body.working_hours_start, "working_hours_start")
    if body.working_hours_end is not None:
        user.working_hours_end = _parse_hhmm(body.working_hours_end, "working_hours_end")
    if body.min_meeting_notice_minutes is not None:
        if body.min_meeting_notice_minutes < 0 or body.min_meeting_notice_minutes > 10080:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "min_meeting_notice_minutes must be 0–10080")
        user.min_meeting_notice_minutes = body.min_meeting_notice_minutes
    if body.meeting_buffer_minutes is not None:
        if body.meeting_buffer_minutes < 0 or body.meeting_buffer_minutes > 480:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "meeting_buffer_minutes must be 0–480")
        user.meeting_buffer_minutes = body.meeting_buffer_minutes
    await session.flush()
    from chronarch_core import rbac as _rbac_me

    return _me_response(
        user,
        permissions=sorted(await _rbac_me.get_user_permissions(session, user)),
        roles=sorted(await _rbac_me.get_user_role_names(session, user.id)),
    )


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
    return _me_response(user)
