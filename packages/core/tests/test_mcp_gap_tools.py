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
