"""MCP request auth — re-exports the core implementation.

The logic lives in `chronarch_core.mcp_auth` so the test suite exercises
the exact function this server runs. Import here stays stable for
`app.server` (`from .auth import InvalidCredential, resolve_auth_context`).
"""

from chronarch_core.mcp_auth import InvalidCredential, resolve_auth_context

__all__ = ["InvalidCredential", "resolve_auth_context"]
