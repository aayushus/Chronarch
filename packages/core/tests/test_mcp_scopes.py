"""MCP scope + credential-auth tests (BRD §19 gaps).

Two layers:

1. Engine level — credential scopes are the user-authority gate for MCP
   callers (`_user_level`), ANDed with the calendar's AI gates. MCP contexts
   are never owners (`server.py` never passes `is_owner=True`).
2. `chronarch_core.mcp_auth::resolve_auth_context` — key-hash lookup,
   revocation, and owner-activity checks. (The implementation lives in core
   precisely so this suite covers the exact function the MCP server runs;
   `apps/mcp/app/auth.py` is a re-export shim.)
"""

import pytest
from sqlalchemy import select

from chronarch_core.crypto import hash_mcp_key
from chronarch_core.mcp_auth import InvalidCredential, resolve_auth_context
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import (
    ActorType, CalendarKind, EventVisibility, ProviderType, UserRole,
)
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.mcp_credential import MCPCredential
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext, resolve_permission
from chronarch_core.permissions.actions import CalendarAction


async def _seed(session, *, ai_open=True):
    """Owner admin + account + one calendar; returns (owner, calendar)."""
    owner = User(id="exec-1", email="exec@co.com", display_name="Exec",
                 password_hash="x", role=UserRole.ADMIN, is_active=True)
    account = Account(id="acct-1", owner_user_id="exec-1", provider=ProviderType.GOOGLE,
                      provider_account_email="exec@co.com", provider_account_id="g-1")
    calendar = Calendar(
        id="cal-1", account_id="acct-1", provider_calendar_id="p-1", name="Work",
        kind=CalendarKind.PRIMARY, provider_writable=True, blocks_availability=True,
        ai_can_read=ai_open, ai_can_write=ai_open,
    )
    session.add_all([owner, account, calendar])
    await session.flush()
    return owner, calendar


def _mcp_ctx(user_id, scopes, *, role=UserRole.DELEGATE, is_admin=False):
    # MCP callers are never owners: is_owner=False at every call site.
    return AuthContext(user_id=user_id, role=role, actor_type=ActorType.MCP,
                       is_admin=is_admin, scopes=frozenset(scopes))


async def test_read_key_can_read_but_not_write(session):
    _, calendar = await _seed(session)
    ctx = _mcp_ctx("ea-1", {"calendar.read", "availability.read"})
    assert resolve_permission(
        ctx, calendar, CalendarAction.VIEW_TITLE, is_owner=False).allowed
    assert resolve_permission(
        ctx, calendar, CalendarAction.VIEW_AVAILABILITY, is_owner=False).allowed
    denied = resolve_permission(ctx, calendar, CalendarAction.CREATE, is_owner=False)
    assert not denied.allowed and denied.reason == "user_authority_denies"


async def test_write_key_still_cannot_delete(session):
    _, calendar = await _seed(session)
    ctx = _mcp_ctx("ea-1", {"calendar.read", "calendar.write", "availability.read"})
    assert resolve_permission(
        ctx, calendar, CalendarAction.CREATE, is_owner=False).allowed
    denied = resolve_permission(ctx, calendar, CalendarAction.DELETE, is_owner=False)
    assert not denied.allowed and denied.reason == "user_authority_denies"


async def test_scopeless_key_denied_everything(session):
    _, calendar = await _seed(session)
    ctx = _mcp_ctx("ea-1", set())
    for action in (CalendarAction.VIEW_AVAILABILITY, CalendarAction.VIEW_TITLE,
                   CalendarAction.CREATE, CalendarAction.DELETE):
        assert not resolve_permission(ctx, calendar, action, is_owner=False).allowed


async def test_ai_closed_calendar_denies_even_full_scopes(session):
    _, calendar = await _seed(session, ai_open=False)
    ctx = _mcp_ctx("ea-1", {"calendar.read", "calendar.write",
                            "calendar.delete", "availability.read"})
    denied = resolve_permission(ctx, calendar, CalendarAction.VIEW_TITLE, is_owner=False)
    assert not denied.allowed and denied.reason == "calendar_authority_denies"


async def test_private_event_caps_mcp_at_free_busy(session):
    from datetime import datetime, timezone

    _, calendar = await _seed(session)
    event = UnifiedEvent(
        provider_account_id="acct-1", calendar_id=calendar.id,
        provider_event_id="ev-priv", title="Secret",
        start=datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 17, 11, 0, tzinfo=timezone.utc),
        visibility=EventVisibility.PRIVATE)
    session.add(event)
    await session.flush()
    ctx = _mcp_ctx("ea-1", {"calendar.read", "availability.read"})
    assert resolve_permission(
        ctx, calendar, CalendarAction.VIEW_AVAILABILITY,
        event=event, is_owner=False).allowed
    assert not resolve_permission(
        ctx, calendar, CalendarAction.VIEW_TITLE,
        event=event, is_owner=False).allowed


async def test_admin_mcp_key_bypasses_ai_gates_via_is_admin(session):
    """Tripwire: `resolve_auth_context` sets `is_admin=True` for admin
    owners, and the engine short-circuits `is_admin` past both the AI
    gates and the scope check. That contradicts the "never
    owner-bypassed" docstring on the function itself — if the bypass
    is ever removed, this test must fail loudly so the change is
    deliberate, not silent."""
    _, calendar = await _seed(session, ai_open=False)
    ctx = _mcp_ctx("exec-1", set(), role=UserRole.ADMIN, is_admin=True)
    assert resolve_permission(
        ctx, calendar, CalendarAction.VIEW_TITLE, is_owner=False).allowed


async def _credential(session, user_id, raw_key, scopes, *, revoked=False):
    cred = MCPCredential(user_id=user_id, name="claude", key_hash=hash_mcp_key(raw_key),
                         scopes=list(scopes), revoked=revoked)
    session.add(cred)
    await session.flush()
    return cred


@pytest.mark.xfail(
    strict=True,
    reason="admin-owned MCP credentials currently inherit the human admin bypass",
)
async def test_admin_mcp_credential_does_not_bypass_scopes_or_ai_gates(session):
    _, calendar = await _seed(session, ai_open=False)
    await _credential(session, "exec-1", "scopeless-admin-key", set())

    ctx = await resolve_auth_context(session, "scopeless-admin-key")
    read_decision = resolve_permission(
        ctx, calendar, CalendarAction.VIEW_TITLE, is_owner=False
    )
    write_decision = resolve_permission(
        ctx, calendar, CalendarAction.CREATE, is_owner=False
    )

    assert not read_decision.allowed
    assert not write_decision.allowed


async def test_resolve_auth_context_happy_path(session):
    owner = User(id="exec-1", email="exec@co.com", display_name="Exec",
                 password_hash="x", role=UserRole.ADMIN, is_active=True)
    session.add(owner)
    await session.flush()
    await _credential(session, owner.id, "secret-key", ["calendar.read", "availability.read"])

    ctx = await resolve_auth_context(session, "secret-key")
    assert ctx.user_id == owner.id
    assert ctx.actor_type == ActorType.MCP
    assert ctx.has_scope("calendar.read")
    assert not ctx.has_scope("calendar.delete")


async def test_resolve_auth_context_rejects_unknown_revoked_inactive(session):
    owner = User(id="exec-1", email="exec@co.com", display_name="Exec",
                 password_hash="x", role=UserRole.ADMIN, is_active=True)
    session.add(owner)
    await session.flush()
    await _credential(session, owner.id, "revoked-key", ["calendar.read"], revoked=True)

    with pytest.raises(InvalidCredential):
        await resolve_auth_context(session, "nope-wrong-key")
    with pytest.raises(InvalidCredential):
        await resolve_auth_context(session, "revoked-key")

    owner.is_active = False
    await session.flush()
    await _credential(session, owner.id, "live-key", ["calendar.read"])
    with pytest.raises(InvalidCredential):
        await resolve_auth_context(session, "live-key")
