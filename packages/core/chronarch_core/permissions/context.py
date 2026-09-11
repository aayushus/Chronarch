from dataclasses import dataclass, field
from typing import Optional

from ..models.enums import ActorType, UserRole


@dataclass(frozen=True)
class AuthContext:
    """Who/what is attempting an action, and through which surface.

    Every mutation path (Executive UI, EA UI, ICS import, MCP, copilot) must
    build one of these and pass it into the permission engine — there is no
    other route to core.permissions or core.ai_tools that bypasses it.
    """

    user_id: str
    role: UserRole
    actor_type: ActorType
    is_admin: bool = False
    # For MCP/API callers: the scopes granted to their credential
    # (e.g. {"calendar.read", "calendar.write"}). None means "not scope-limited"
    # (human UI sessions). AI actors (MCP, COPILOT) should always set this.
    scopes: Optional[frozenset[str]] = None

    def has_scope(self, scope: str) -> bool:
        if self.scopes is None:
            return True
        return scope in self.scopes


@dataclass(frozen=True)
class PermissionDecision:
    allowed: bool
    reason: str
    source_level: int
    calendar_level: int
    user_level: int
