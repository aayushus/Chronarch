import hashlib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.enums import ActorType
from chronarch_core.models.mcp_credential import MCPCredential
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext


class InvalidCredential(Exception):
    pass


def hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


async def resolve_auth_context(session: AsyncSession, raw_api_key: str) -> AuthContext:
    """Scoped-credential auth for external MCP clients (BRD §19). Provider
    OAuth tokens are never reachable through this path — only the
    credential's declared scopes gate what the caller can do, enforced by
    the same permission engine every other client goes through."""
    key_hash = hash_key(raw_api_key)
    cred = (
        await session.execute(
            select(MCPCredential).where(MCPCredential.key_hash == key_hash, MCPCredential.revoked.is_(False))
        )
    ).scalar_one_or_none()
    if cred is None:
        raise InvalidCredential("Invalid or revoked MCP API key")

    user = await session.get(User, cred.user_id)
    if user is None or not user.is_active:
        raise InvalidCredential("Credential owner is inactive")

    return AuthContext(
        user_id=user.id,
        role=user.role,
        actor_type=ActorType.MCP,
        is_admin=user.is_admin,
        scopes=frozenset(cred.scopes),
    )
