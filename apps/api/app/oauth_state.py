"""Signed state tokens for OAuth connect flows.

Google's redirect back to our callback is a plain browser navigation — no
Authorization header, so the normal get_current_user dependency can't run
there. Instead the admin who clicked "Connect" is encoded into a short-lived
signed token passed through `state`, which also doubles as Google's
recommended CSRF protection for the flow.
"""

from datetime import datetime, timedelta, timezone
import uuid

from jose import JWTError, jwt

from .config import JWT_ALGORITHM, JWT_SECRET

STATE_EXPIRE_MINUTES = 10


async def sign_oauth_state(admin_user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=STATE_EXPIRE_MINUTES)
    jti = str(uuid.uuid4())
    state = jwt.encode({"sub": admin_user_id, "purpose": "oauth_connect", "jti": jti, "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    from .auth import get_redis_client
    await get_redis_client().setex(f"oauth_state:{jti}", STATE_EXPIRE_MINUTES * 60, admin_user_id)
    return state


async def verify_oauth_state(state: str) -> str:
    """Returns the admin user id, or raises ValueError."""
    try:
        payload = jwt.decode(state, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise ValueError("Invalid or expired OAuth state")
    if payload.get("purpose") != "oauth_connect" or not payload.get("jti"):
        raise ValueError("Invalid OAuth state")
    from .auth import get_redis_client
    consumed = await get_redis_client().getdel(f"oauth_state:{payload['jti']}")
    if consumed != payload.get("sub"):
        raise ValueError("Invalid or already used OAuth state")
    return payload["sub"]
