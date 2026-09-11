"""Signed state tokens for OAuth connect flows.

Google's redirect back to our callback is a plain browser navigation — no
Authorization header, so the normal get_current_user dependency can't run
there. Instead the admin who clicked "Connect" is encoded into a short-lived
signed token passed through `state`, which also doubles as Google's
recommended CSRF protection for the flow.
"""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from .config import JWT_ALGORITHM, JWT_SECRET

STATE_EXPIRE_MINUTES = 10


def sign_oauth_state(admin_user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=STATE_EXPIRE_MINUTES)
    return jwt.encode({"sub": admin_user_id, "purpose": "oauth_connect", "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_oauth_state(state: str) -> str:
    """Returns the admin user id, or raises ValueError."""
    try:
        payload = jwt.decode(state, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise ValueError("Invalid or expired OAuth state")
    if payload.get("purpose") != "oauth_connect":
        raise ValueError("Invalid OAuth state")
    return payload["sub"]
