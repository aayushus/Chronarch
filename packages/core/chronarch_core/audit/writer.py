from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit import AuditEntry
from ..models.enums import ActorType, AuditAction
from ..permissions.context import AuthContext

_SECRET_KEYS = {"token", "access_token", "refresh_token", "api_key", "secret", "password"}


def _scrub(detail: dict) -> dict:
    """Defense in depth: strip anything that looks like a secret before it
    ever reaches the audit log, even if a caller forgets to (BRD §29)."""
    return {k: v for k, v in detail.items() if k.lower() not in _SECRET_KEYS}


async def write_audit_entry(
    session: AsyncSession,
    *,
    ctx: AuthContext,
    action: AuditAction,
    calendar_id: str | None = None,
    event_id: str | None = None,
    detail: dict | None = None,
) -> AuditEntry:
    entry = AuditEntry(
        actor_type=ctx.actor_type,
        actor_user_id=ctx.user_id,
        action=action,
        calendar_id=calendar_id,
        event_id=event_id,
        detail=_scrub(detail or {}),
    )
    session.add(entry)
    await session.flush()
    return entry
