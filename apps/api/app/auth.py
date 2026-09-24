"""Session auth for the human UI (admin/delegate). Admin/MCP-credential auth
is a separate concern (apps/mcp handles scoped API keys) — this module only
issues/verifies JWTs for logged-in browser sessions.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.enums import ActorType, UserRole
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext

from .config import JWT_ALGORITHM, JWT_EXPIRE_MINUTES, JWT_SECRET, REDIS_URL
from .deps import get_db_session

logger = logging.getLogger(__name__)

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)

_redis_client: aioredis.Redis | None = None


def get_redis_client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def create_access_token(user_id: str, remember_me: bool = False) -> str:
    """Issue a session JWT: short-lived by default, long-lived when the user
    checked "Remember me" at login. Both carry a jti so logout/revocation
    works identically through the Redis blocklist."""
    from .config import REMEMBER_ME_DAYS

    now = datetime.now(timezone.utc)
    lifetime = timedelta(days=REMEMBER_ME_DAYS) if remember_me else timedelta(minutes=JWT_EXPIRE_MINUTES)
    expire = now + lifetime
    jti = str(uuid.uuid4())
    return jwt.encode(
        {"sub": user_id, "exp": expire, "iat": now, "jti": jti, "rm": remember_me, "token_type": "session"},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


async def is_token_revoked(jti: str | None) -> bool:
    if not jti:
        return False
    try:
        r = get_redis_client()
        return bool(await r.exists(f"revoked_token:{jti}"))
    except Exception as exc:
        logger.error("Failed closed while checking token revocation: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Session validation is temporarily unavailable") from exc


async def revoke_all_user_sessions(user_id: str) -> None:
    """Invalidate every JWT issued before this instant."""
    try:
        # Add a small boundary so tokens issued in the same clock tick as the
        # password operation are invalidated as well.
        await get_redis_client().set(f"revoked_user_before:{user_id}", str(datetime.now(timezone.utc).timestamp() + 1))
    except Exception as exc:
        logger.error("Failed closed while recording session invalidation: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Session invalidation is temporarily unavailable") from exc


async def revoke_token(token: str) -> None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        jti = payload.get("jti")
        exp = payload.get("exp")
        if not jti or not exp:
            return
        now_ts = datetime.now(timezone.utc).timestamp()
        ttl = int(exp - now_ts)
        if ttl > 0:
            r = get_redis_client()
            await r.setex(f"revoked_token:{jti}", ttl, "1")
    except JWTError:
        pass
    except Exception as exc:
        logger.warning("Failed to record token revocation in Redis: %s", exc)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_db_session),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        jti = payload.get("jti")
        issued_at = float(payload.get("iat", 0))
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    # OAuth `state` is a CSRF artifact, never an API session.  Check its
    # purpose before looking up the user so a leaked redirect URL cannot be
    # replayed as a bearer token.
    if payload.get("purpose") not in (None, "session") or payload.get("token_type") != "session":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if await is_token_revoked(jti):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token has been revoked")

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    try:
        revoked_before = await get_redis_client().get(f"revoked_user_before:{user.id}")
    except Exception as exc:
        logger.error("Failed closed while checking user session invalidation: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Session validation is temporarily unavailable") from exc
    if revoked_before and issued_at <= float(revoked_before):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session has been invalidated")
    if user.force_password_change:
        raise HTTPException(status.HTTP_428_PRECONDITION_REQUIRED, "Password change required")
    return user


def build_auth_context(user: User, actor_type: ActorType) -> AuthContext:
    # ADMIN user-role short-circuits to full access inside the engine;
    # delegates are gated per-calendar by their DelegationCalendarGrants.
    return AuthContext(user_id=user.id, role=user.role, actor_type=actor_type,
                       is_admin=user.role == UserRole.ADMIN)
