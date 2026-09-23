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


async def test_ai_contact_wrappers_round_trip(session):
    exec_user, _cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    created = await ai_tools.create_contact(
        session, ctx, email="Ada@x.com", display_name="Ada",
        company="Acme", phone="+1", job_title="Eng")
    assert created["email"] == "ada@x.com" and created["company"] == "Acme"

    found = await ai_tools.resolve_contact(session, ctx, query="ada")
    assert found["status"] == "found" and found["contact"]["id"] == created["id"]

    searched = await ai_tools.search_contacts(session, ctx, query="acme")
    assert [c["email"] for c in searched] == ["ada@x.com"]

    updated = await ai_tools.update_contact(
        session, ctx, contact_id=created["id"], job_title="Senior Eng")
    assert updated["job_title"] == "Senior Eng"

    assert await ai_tools.delete_contact(session, ctx, contact_id=created["id"]) == {
        "deleted": True, "contact_id": created["id"]}
    assert await ai_tools.search_contacts(session, ctx, query="") == []

    restored = await ai_tools.restore_contact(session, ctx, contact_id=created["id"])
    assert restored["email"] == "ada@x.com"


async def test_ai_contact_wrappers_reject_garbage(session):
    exec_user, _cal = await _seed(session)
    ctx = _owner_ctx(exec_user)
    with pytest.raises(ValueError):
        await ai_tools.create_contact(session, ctx, email="bad")
    with pytest.raises(ValueError):
        await ai_tools.update_contact(session, ctx, contact_id="missing", phone="+1")
    with pytest.raises(ValueError):
        await ai_tools.delete_contact(session, ctx, contact_id="missing")
    missing = await ai_tools.resolve_contact(session, ctx, query="nobody here")
    assert missing["status"] == "not_found"


async def _suggest_user(session, **prefs):
    user = User(id="exec-s", email="sugg@co.com", display_name="S",
                password_hash="x", role=UserRole.ADMIN,
                working_hours_start=prefs.get("start", "09:00"),
                working_hours_end=prefs.get("end", "17:00"),
                meeting_buffer_minutes=prefs.get("buffer", 0),
                min_meeting_notice_minutes=prefs.get("notice", 0))
    account = Account(id="acct-s", owner_user_id="exec-s", provider=ProviderType.GOOGLE,
                      provider_account_email="sugg@co.com", provider_account_id="g-s")
    cal = Calendar(id="cal-s", account_id="acct-s", provider_calendar_id="p-s",
                   name="Work", provider_writable=True, blocks_availability=True)
    session.add_all([user, account, cal])
    await session.flush()
    return user, cal


async def test_suggest_proposes_around_busy(session):
    from chronarch_core import contacts as _contacts

    user, cal = await _suggest_user(session)
    ctx = _owner_ctx(user)
    await _contacts.create_contact(session, email="sarah@acme.com", display_name="Sarah")
    # Keep the fixture in the future so the suggestion tool's real-time
    # minimum-notice filtering does not turn the whole window into history.
    start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
        hour=14, minute=0, second=0, microsecond=0
    )
    await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="Blocked",
        start=start, end=start + timedelta(hours=2), is_owner=True)
    out = await ai_tools.suggest_meeting_times(
        session, ctx, contact_query="sarah", duration_minutes=30,
        window_start=start.replace(hour=9),
        owner_calendar_ids={cal.id})
    assert out["status"] == "proposed"
    assert out["contact"]["email"] == "sarah@acme.com"
    # 09:00–14:00 PT window... all slots must avoid the 14:00–16:00 block.
    assert len(out["slots"]) >= 1
    for slot in out["slots"]:
        assert slot["end"] <= start or slot["start"] >= start + timedelta(hours=2)


async def test_suggest_ambiguity_and_unknown(session):
    from chronarch_core import contacts as _contacts

    user, _cal = await _suggest_user(session)
    ctx = _owner_ctx(user)
    await _contacts.create_contact(session, email="sam-a@x.com", display_name="Sam A")
    await _contacts.create_contact(session, email="sam-b@x.com", display_name="Sam B")
    amb = await ai_tools.suggest_meeting_times(session, ctx, contact_query="sam")
    assert amb["status"] == "ambiguous" and len(amb["candidates"]) == 2
    missing = await ai_tools.suggest_meeting_times(session, ctx, contact_query="ghost")
    assert missing["status"] == "not_found"


async def test_suggest_rejects_bad_duration(session):
    user, _cal = await _suggest_user(session)
    with pytest.raises(ValueError):
        await ai_tools.suggest_meeting_times(
            session, _owner_ctx(user), contact_query="x", duration_minutes=0)
