from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.crypto import hash_mcp_key
from chronarch_core.models.enums import ActorType
from chronarch_core.models.mcp_credential import MCPCredential
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext


class InvalidCredential(Exception):
    pass


async def resolve_auth_context(session: AsyncSession, raw_api_key: str) -> AuthContext:
    """Scoped-credential auth for external MCP clients (BRD §19). Provider
    OAuth tokens are never reachable through this path — only the
    credential's declared scopes gate what the caller can do, enforced by
    the same permission engine every other client goes through.

    Intentional: the returned context is NEVER owner-bypassed, even when the
    credential belongs to the calendar's owning executive. An MCP caller must
    independently satisfy the calendar's AI gates (`ai_can_read` /
    `ai_can_write` / `privacy_mask` in `_calendar_level`) plus its credential
    scopes (`calendar.read` / `calendar.write` / `calendar.delete` /
    `availability.read` in `_user_level`). This is deny-by-default on purpose:
    connecting ChatGPT/Claude must never silently expose every calendar the
    executive owns — an admin grants each calendar's AI access explicitly
    (BRD §12), and a freshly connected calendar exposes nothing to AI until
    then. Callers needing owner semantics must go through the human UI
    session path (apps/api), not MCP.
    """
    key_hash = hash_mcp_key(raw_api_key)
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
