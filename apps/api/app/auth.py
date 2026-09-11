"""Session auth for the human UI (Executive/EA). Admin/MCP-credential auth
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

from chronarch_core.models.enums import ActorType
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


def create_access_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=JWT_EXPIRE_MINUTES)
    jti = str(uuid.uuid4())
    return jwt.encode(
        {"sub": user_id, "exp": expire, "iat": now, "jti": jti},
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
        logger.warning("Failed to check token revocation in Redis: %s", exc)
        return False


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
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    if await is_token_revoked(jti):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token has been revoked")

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    return user


def build_auth_context(user: User, actor_type: ActorType) -> AuthContext:
    return AuthContext(user_id=user.id, role=user.role, actor_type=actor_type, is_admin=user.is_admin)

