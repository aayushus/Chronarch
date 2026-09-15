"""Tests for the MCP-gap tools: list_accounts, get_event, update_event."""

from datetime import datetime, timedelta, timezone

import pytest

from chronarch_core import ai_tools
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ActorType, ProviderType, UserRole
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext


async def _seed(session):
    exec_user = User(id="exec-1", email="exec@co.com", display_name="Exec", password_hash="x", role=UserRole.ADMIN)
    account = Account(
        id="acct-1", owner_user_id="exec-1", provider=ProviderType.GOOGLE,
        provider_account_email="exec@co.com", provider_account_id="g-1",
    )
    writable_cal = Calendar(
        id="cal-writable", account_id="acct-1", provider_calendar_id="p-1", name="Work",
        provider_writable=True, blocks_availability=True,
    )
    session.add_all([exec_user, account, writable_cal])
    await session.flush()
    return exec_user, writable_cal


def _owner_ctx(user):
    return AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)


async def test_list_accounts_owner_sees_own(session):
    exec_user, _cal = await _seed(session)
    accounts = await ai_tools.list_accounts(session, _owner_ctx(exec_user), owner_user_id=exec_user.id)
    assert [a["id"] for a in accounts] == ["acct-1"]
    assert accounts[0]["provider"] == "google"
    assert "sync_status" in accounts[0]
    # No secrets leak.
    assert not any("token" in k.lower() or "password" in k.lower() for a in accounts for k in a.keys())


async def test_get_event_roundtrip(session):
    exec_user, cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    created = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="Standup", start=start, end=start + timedelta(hours=1), is_owner=True,
    )
    fetched = await ai_tools.get_event(session, ctx, event_id=created.id, owner_calendar_ids={cal.id})
    assert fetched.id == created.id
    assert fetched.title == "Standup"


async def test_get_event_missing_raises(session):
    exec_user, _cal = await _seed(session)
    with pytest.raises(ValueError):
        await ai_tools.get_event(session, _owner_ctx(exec_user), event_id="nope")


async def test_update_event_edits_fields_and_audits(session):
    from sqlalchemy import select
    from chronarch_core.models.audit import AuditEntry

    exec_user, cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    created = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="Old", start=start, end=start + timedelta(hours=1), is_owner=True,
    )
    updated = await ai_tools.update_event(
        session, ctx, event_id=created.id, title="New", location="Room 2", is_owner=True,
    )
    assert updated.title == "New"
    assert updated.location == "Room 2"
    rows = list((await session.execute(select(AuditEntry).where(AuditEntry.event_id == created.id))).scalars())
    assert any(r.action.value == "update_event" for r in rows)


async def test_update_event_requires_field(session):
    exec_user, cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    created = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="T", start=start, end=start + timedelta(hours=1), is_owner=True,
    )
    with pytest.raises(ValueError):
        await ai_tools.update_event(session, ctx, event_id=created.id, is_owner=True)


async def test_update_event_denied_without_edit_grant(session):
    from chronarch_core.models.delegation import DelegationCalendarGrant
    from chronarch_core.models.enums import ActorType as AT

    exec_user, cal = await _seed(session)
    ea = User(id="ea-1", email="ea@co.com", display_name="EA", password_hash="x", role=UserRole.DELEGATE)
    session.add(ea)
    await session.flush()
    created = await ai_tools.create_event(
        session, _owner_ctx(exec_user), calendar_id=cal.id, title="T",
        start=datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 17, 11, 0, tzinfo=timezone.utc), is_owner=True,
    )
    grant = DelegationCalendarGrant(id="g-1", delegation_id="d-1", calendar_id=cal.id, can_view_availability=True)
    ea_ctx = AuthContext(user_id=ea.id, role=UserRole.DELEGATE, actor_type=AT.DELEGATE_UI)
    with pytest.raises(ai_tools.PermissionDenied):
        await ai_tools.update_event(session, ea_ctx, event_id=created.id, title="Sneaky", delegation_grant=grant)


async def test_update_event_visibility_toggle(session):
    from chronarch_core.models.enums import EventVisibility

    exec_user, cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    created = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="T", start=start, end=start + timedelta(hours=1), is_owner=True,
    )
    assert created.visibility == EventVisibility.STANDARD
    updated = await ai_tools.update_event(session, ctx, event_id=created.id, visibility="private", is_owner=True)
    assert updated.visibility == EventVisibility.PRIVATE
    back = await ai_tools.update_event(session, ctx, event_id=created.id, visibility="standard", is_owner=True)
    assert back.visibility == EventVisibility.STANDARD
    with pytest.raises(ValueError):
        await ai_tools.update_event(session, ctx, event_id=created.id, visibility="secret", is_owner=True)


async def _second_calendar(session, account_id="acct-1"):
    dest = Calendar(
        id="cal-dest", account_id=account_id, provider_calendar_id="p-2", name="Family",
        provider_writable=True, blocks_availability=True,
    )
    session.add(dest)
    await session.flush()
    return dest


async def test_move_between_calendars_atomic_owner(session):
    exec_user, cal = await _seed(session)
    dest = await _second_calendar(session)
    ctx = _owner_ctx(exec_user)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    created = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="Mover", start=start, end=start + timedelta(hours=1), is_owner=True,
    )
    moved = await ai_tools.move_event_between_calendars(
        session, ctx, event_id=created.id, destination_calendar_id=dest.id,
        owner_calendar_ids={cal.id, dest.id},
    )
    assert moved.id == created.id
    assert moved.calendar_id == dest.id


async def test_move_between_calendars_same_calendar_rejected(session):
    exec_user, cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    created = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="Mover", start=start, end=start + timedelta(hours=1), is_owner=True,
    )
    with pytest.raises(ValueError):
        await ai_tools.move_event_between_calendars(
            session, ctx, event_id=created.id, destination_calendar_id=cal.id,
            owner_calendar_ids={cal.id},
        )


async def test_move_between_calendars_ea_denied_without_grants(session):
    from chronarch_core.models.delegation import DelegationCalendarGrant
    from chronarch_core.models.enums import ActorType as AT

    exec_user, cal = await _seed(session)
    dest = await _second_calendar(session)
    ea = User(id="ea-1", email="ea@co.com", display_name="EA", password_hash="x", role=UserRole.DELEGATE)
    session.add(ea)
    await session.flush()
    created = await ai_tools.create_event(
        session, _owner_ctx(exec_user), calendar_id=cal.id, title="T",
        start=datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 17, 11, 0, tzinfo=timezone.utc), is_owner=True,
    )
    # Availability-only grant: no move rights on source, no create on dest.
    grant = DelegationCalendarGrant(id="g-1", delegation_id="d-1", calendar_id=cal.id, can_view_availability=True)
    ea_ctx = AuthContext(user_id=ea.id, role=UserRole.DELEGATE, actor_type=AT.COPILOT)
    with pytest.raises(ai_tools.PermissionDenied):
        await ai_tools.move_event_between_calendars(
            session, ea_ctx, event_id=created.id, destination_calendar_id=dest.id,
            grants_by_calendar={cal.id: grant},
        )


async def test_ea_copilot_respects_delegation_grants(session):
    """BRD §37: an assistant's copilot must not exceed its grant (the engine
    must not bypass grants for COPILOT actors the way MCP scope-gating does)."""
    from chronarch_core.models.delegation import DelegationCalendarGrant
    from chronarch_core.models.enums import ActorType as AT

    exec_user, cal = await _seed(session)
    ea = User(id="ea-2", email="ea2@co.com", display_name="EA2", password_hash="x", role=UserRole.DELEGATE)
    session.add(ea)
    await session.flush()
    created = await ai_tools.create_event(
        session, _owner_ctx(exec_user), calendar_id=cal.id, title="T",
        start=datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 17, 11, 0, tzinfo=timezone.utc), is_owner=True,
    )
    grant = DelegationCalendarGrant(id="g-2", delegation_id="d-2", calendar_id=cal.id, can_view_availability=True)
    ea_ctx = AuthContext(user_id=ea.id, role=UserRole.DELEGATE, actor_type=AT.COPILOT)
    with pytest.raises(ai_tools.PermissionDenied):
        await ai_tools.delete_event(session, ea_ctx, event_id=created.id, delegation_grant=grant)


async def test_find_free_slots_min_notice(session):
    exec_user, cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    base = datetime(2026, 9, 17, 8, 0, tzinfo=timezone.utc)
    slots = await ai_tools.find_free_slots(
        session, ctx, window_start=base, window_end=base + timedelta(hours=12),
        duration=timedelta(minutes=30), working_hours=(9, 17),
        min_notice=timedelta(hours=2), now=base, owner_calendar_ids={cal.id},
    )
    assert slots, "expected slots"
    assert all(s["start"] >= base + timedelta(hours=2) for s in slots)
