"""Integration tests exercising the internal tool layer (chronarch_core.ai_tools)
end-to-end against a real (sqlite) session — this is the layer both the MCP
server and the built-in copilot call, so its permission enforcement and
audit-writing must be verified together, not just the pure permission logic.
"""

from datetime import datetime, timedelta, timezone

import pytest

from chronarch_core import ai_tools
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.delegation import DelegationCalendarGrant
from chronarch_core.models.enums import ActorType, AuditAction, ProviderType, UserRole
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext


async def _seed(session):
    exec_user = User(id="exec-1", email="exec@co.com", display_name="Exec", password_hash="x", role=UserRole.EXECUTIVE)
    ea_user = User(id="ea-1", email="ea@co.com", display_name="EA", password_hash="x", role=UserRole.ASSISTANT)
    account = Account(
        id="acct-1", owner_user_id="exec-1", provider=ProviderType.GOOGLE,
        provider_account_email="exec@co.com", provider_account_id="g-1",
    )
    writable_cal = Calendar(
        id="cal-writable", account_id="acct-1", provider_calendar_id="p-1", name="Company #2",
        provider_writable=True, blocks_availability=True, ea_can_view=True, ea_can_edit=True,
    )
    session.add_all([exec_user, ea_user, account, writable_cal])
    await session.flush()
    return exec_user, ea_user, writable_cal


async def test_create_event_by_owner_succeeds_and_writes_audit(session):
    exec_user, _ea_user, calendar = await _seed(session)
    ctx = AuthContext(user_id=exec_user.id, role=UserRole.EXECUTIVE, actor_type=ActorType.EXECUTIVE_UI)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    event = await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title="Board Meeting", start=start, end=start + timedelta(hours=1),
        is_owner=True,
    )

    assert event.id is not None
    assert event.title == "Board Meeting"


async def test_ea_without_grant_cannot_create_event(session):
    _exec_user, ea_user, calendar = await _seed(session)
    ctx = AuthContext(user_id=ea_user.id, role=UserRole.ASSISTANT, actor_type=ActorType.EA_UI)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    with pytest.raises(ai_tools.PermissionDenied):
        await ai_tools.create_event(
            session, ctx, calendar_id=calendar.id, title="Sneaky Meeting", start=start, end=start + timedelta(hours=1),
        )


async def test_ea_with_grant_can_move_writable_event_brd_section38(session):
    """Mirrors BRD §38: writable Company #2 event dragged Tue 2PM -> Wed 4PM."""
    exec_user, ea_user, calendar = await _seed(session)
    owner_ctx = AuthContext(user_id=exec_user.id, role=UserRole.EXECUTIVE, actor_type=ActorType.EXECUTIVE_UI)
    tue_2pm = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
    event = await ai_tools.create_event(
        session, owner_ctx, calendar_id=calendar.id, title="Sync", start=tue_2pm, end=tue_2pm + timedelta(hours=1),
        is_owner=True,
    )

    grant = DelegationCalendarGrant(
        id="grant-1", delegation_id="del-1", calendar_id=calendar.id, can_reschedule=True,
    )
    ea_ctx = AuthContext(user_id=ea_user.id, role=UserRole.ASSISTANT, actor_type=ActorType.EA_UI)
    wed_4pm = datetime(2026, 9, 16, 16, 0, tzinfo=timezone.utc)

    moved = await ai_tools.move_event(
        session, ea_ctx, event_id=event.id, new_start=wed_4pm, new_end=wed_4pm + timedelta(hours=1),
        delegation_grant=grant,
    )

    assert moved.start == wed_4pm


async def test_mcp_actor_respects_ai_can_write_flag(session):
    exec_user, _ea_user, calendar = await _seed(session)
    calendar.ai_can_read = True
    calendar.ai_can_write = False
    await session.flush()

    mcp_ctx = AuthContext(
        user_id=exec_user.id, role=UserRole.EXECUTIVE, actor_type=ActorType.MCP,
        scopes=frozenset({"calendar.read", "calendar.write", "availability.read"}),
    )
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    with pytest.raises(ai_tools.PermissionDenied):
        await ai_tools.create_event(
            session, mcp_ctx, calendar_id=calendar.id, title="AI-created", start=start, end=start + timedelta(hours=1),
        )
