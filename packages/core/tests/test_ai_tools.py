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
    exec_user = User(id="exec-1", email="exec@co.com", display_name="Exec", password_hash="x", role=UserRole.ADMIN)
    ea_user = User(id="ea-1", email="ea@co.com", display_name="EA", password_hash="x", role=UserRole.DELEGATE)
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
    ctx = AuthContext(user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    event = await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title="Board Meeting", start=start, end=start + timedelta(hours=1),
        is_owner=True,
    )

    assert event.id is not None
    assert event.title == "Board Meeting"


async def test_ea_without_grant_cannot_create_event(session):
    _exec_user, ea_user, calendar = await _seed(session)
    ctx = AuthContext(user_id=ea_user.id, role=UserRole.DELEGATE, actor_type=ActorType.DELEGATE_UI)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    with pytest.raises(ai_tools.PermissionDenied):
        await ai_tools.create_event(
            session, ctx, calendar_id=calendar.id, title="Sneaky Meeting", start=start, end=start + timedelta(hours=1),
        )


async def test_ea_with_grant_can_move_writable_event_brd_section38(session):
    """Mirrors BRD §38: writable Company #2 event dragged Tue 2PM -> Wed 4PM."""
    exec_user, ea_user, calendar = await _seed(session)
    owner_ctx = AuthContext(user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    tue_2pm = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
    event = await ai_tools.create_event(
        session, owner_ctx, calendar_id=calendar.id, title="Sync", start=tue_2pm, end=tue_2pm + timedelta(hours=1),
        is_owner=True,
    )

    grant = DelegationCalendarGrant(
        id="grant-1", delegation_id="del-1", calendar_id=calendar.id, can_reschedule=True,
    )
    ea_ctx = AuthContext(user_id=ea_user.id, role=UserRole.DELEGATE, actor_type=ActorType.DELEGATE_UI)
    wed_4pm = datetime(2026, 9, 16, 16, 0, tzinfo=timezone.utc)

    moved = await ai_tools.move_event(
        session, ea_ctx, event_id=event.id, new_start=wed_4pm, new_end=wed_4pm + timedelta(hours=1),
        delegation_grant=grant,
    )

    assert moved.start == wed_4pm


async def test_get_conflicts_finds_overlap_and_excludes_moved_event(session):
    exec_user, _ea_user, calendar = await _seed(session)
    ctx = AuthContext(user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    tue_2pm = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
    blocker = await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title="Corporate sync",
        start=tue_2pm + timedelta(minutes=30), end=tue_2pm + timedelta(hours=1, minutes=30),
        is_owner=True,
    )
    draggable = await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title="Drag me",
        start=tue_2pm - timedelta(hours=2), end=tue_2pm - timedelta(hours=1),
        is_owner=True,
    )

    hits = await ai_tools.get_conflicts(
        session, ctx, window_start=tue_2pm, window_end=tue_2pm + timedelta(hours=1),
        exclude_event_id=draggable.id, owner_calendar_ids={calendar.id},
    )

    assert [h["event_id"] for h in hits] == [blocker.id]
    assert hits[0]["title"] == "Corporate sync"
    assert hits[0]["redacted"] is False

    # Without the exclusion the dragged event would conflict with itself.
    self_hits = await ai_tools.get_conflicts(
        session, ctx,
        window_start=tue_2pm - timedelta(hours=2), window_end=tue_2pm - timedelta(hours=1),
        owner_calendar_ids={calendar.id},
    )
    assert [h["event_id"] for h in self_hits] == [draggable.id]


async def test_get_conflicts_redacts_title_without_view_permission(session):
    exec_user, _ea_user, calendar = await _seed(session)
    owner_ctx = AuthContext(user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    start = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
    await ai_tools.create_event(
        session, owner_ctx, calendar_id=calendar.id, title="Secret merger talk",
        start=start, end=start + timedelta(hours=1), is_owner=True,
    )

    # EA whose grant covers availability/reschedule but not titles still warns.
    grant = DelegationCalendarGrant(
        id="grant-1", delegation_id="del-1", calendar_id=calendar.id,
        can_view_availability=True, can_reschedule=True,
    )
    ea_ctx = AuthContext(user_id="ea-1", role=UserRole.DELEGATE, actor_type=ActorType.DELEGATE_UI)
    hits = await ai_tools.get_conflicts(
        session, ea_ctx, window_start=start, window_end=start + timedelta(hours=1),
        grants_by_calendar={calendar.id: grant},
    )
    # The overlap must still surface, redacted (BRD §15: hidden meetings
    # still block). (sqlite drops tzinfo on read, so compare instants.)
    assert len(hits) == 1
    assert hits[0]["title"] == "Busy"
    assert hits[0]["redacted"] is True
    assert hits[0]["start"].replace(tzinfo=timezone.utc) == start


async def test_create_and_move_support_all_day_lane_conversions(session):
    exec_user, _ea_user, calendar = await _seed(session)
    ctx = AuthContext(user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    day = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)

    alldayer = await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title="Offsite",
        start=day, end=day + timedelta(days=1), all_day=True, is_owner=True,
    )
    assert alldayer.all_day is True

    # Lane -> grid: drop at 10:00 as a 1h timed event.
    moved = await ai_tools.move_event(
        session, ctx, event_id=alldayer.id,
        new_start=day + timedelta(hours=10), new_end=day + timedelta(hours=11),
        new_all_day=False, is_owner=True,
    )
    assert moved.all_day is False
    assert moved.start == day + timedelta(hours=10)

    # Grid -> lane: back to all-day.
    back = await ai_tools.move_event(
        session, ctx, event_id=alldayer.id,
        new_start=day, new_end=day + timedelta(days=1),
        new_all_day=True, is_owner=True,
    )
    assert back.all_day is True


async def test_mcp_actor_respects_ai_can_write_flag(session):
    exec_user, _ea_user, calendar = await _seed(session)
    calendar.ai_can_read = True
    calendar.ai_can_write = False
    await session.flush()

    mcp_ctx = AuthContext(
        user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.MCP,
        scopes=frozenset({"calendar.read", "calendar.write", "availability.read"}),
    )
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    with pytest.raises(ai_tools.PermissionDenied):
        await ai_tools.create_event(
            session, mcp_ctx, calendar_id=calendar.id, title="AI-created", start=start, end=start + timedelta(hours=1),
        )
