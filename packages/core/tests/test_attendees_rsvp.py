from datetime import datetime, timedelta, timezone
import pytest

from chronarch_core import ai_tools
from chronarch_core.models.account import Account
from chronarch_core.models.audit import AuditEntry
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.delegation import DelegationCalendarGrant
from chronarch_core.models.enums import ActorType, AuditAction, ProviderType, UserRole
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext


async def _seed_data(session):
    exec_user = User(
        id="exec-att-1",
        email="exec@co.com",
        display_name="Exec",
        password_hash="x",
        role=UserRole.ADMIN,
    )
    ea_user = User(
        id="ea-att-1",
        email="ea@co.com",
        display_name="EA",
        password_hash="x",
        role=UserRole.DELEGATE,
    )
    account = Account(
        id="acct-att-1",
        owner_user_id="exec-att-1",
        provider=ProviderType.GOOGLE,
        provider_account_email="exec@co.com",
        provider_account_id="g-att-1",
    )
    cal = Calendar(
        id="cal-att-1",
        account_id="acct-att-1",
        provider_calendar_id="p-1",
        name="Team Calendar",
        provider_writable=True,
        blocks_availability=True,
        ea_can_view=True,
        ea_can_edit=True,
    )
    session.add_all([exec_user, ea_user, account, cal])
    await session.flush()
    return exec_user, ea_user, cal


async def test_add_and_remove_attendee_lifecycle(session):
    exec_user, _ea, cal = await _seed_data(session)
    ctx = AuthContext(user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)

    start = datetime(2026, 9, 20, 10, 0, tzinfo=timezone.utc)
    event = await ai_tools.create_event(
        session,
        ctx,
        calendar_id=cal.id,
        title="Strategy Review",
        start=start,
        end=start + timedelta(hours=1),
        is_owner=True,
    )
    assert event.attendees == []

    # Add attendee
    updated = await ai_tools.add_attendee(
        session,
        ctx,
        event_id=event.id,
        email="partner@firm.com",
        name="Partner",
        is_owner=True,
    )
    assert len(updated.attendees) == 1
    assert updated.attendees[0]["email"] == "partner@firm.com"
    assert updated.attendees[0]["name"] == "Partner"

    # Remove attendee
    updated2 = await ai_tools.remove_attendee(
        session,
        ctx,
        event_id=event.id,
        email="partner@firm.com",
        is_owner=True,
    )
    assert len(updated2.attendees) == 0


async def test_respond_to_event_writes_audit(session):
    exec_user, _ea, cal = await _seed_data(session)
    ctx = AuthContext(user_id=exec_user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)

    start = datetime(2026, 9, 20, 14, 0, tzinfo=timezone.utc)
    event = await ai_tools.create_event(
        session,
        ctx,
        calendar_id=cal.id,
        title="Client Pitch",
        start=start,
        end=start + timedelta(hours=1),
        is_owner=True,
    )

    # Add attendee for the executive user
    await ai_tools.add_attendee(
        session,
        ctx,
        event_id=event.id,
        email="exec@co.com",
        name="Executive",
        is_owner=True,
    )

    ev = await ai_tools.respond_to_event(
        session,
        ctx,
        event_id=event.id,
        response_status="accepted",
        is_owner=True,
    )
    assert ev.id == event.id
    assert len(ev.attendees) == 1
    assert ev.attendees[0]["response_status"] == "accepted"
    assert ev.attendees[0]["status"] == "accepted"


async def test_ea_without_grant_denied_attendee_management(session):
    _exec_user, ea_user, cal = await _seed_data(session)
    owner_ctx = AuthContext(user_id="exec-att-1", role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    ea_ctx = AuthContext(user_id=ea_user.id, role=UserRole.DELEGATE, actor_type=ActorType.DELEGATE_UI)

    start = datetime(2026, 9, 20, 15, 0, tzinfo=timezone.utc)
    event = await ai_tools.create_event(
        session,
        owner_ctx,
        calendar_id=cal.id,
        title="Private Briefing",
        start=start,
        end=start + timedelta(hours=1),
        is_owner=True,
    )

    # EA has no grant with can_manage_attendees=True
    grant_view_only = DelegationCalendarGrant(
        id="grant-att-1",
        delegation_id="del-1",
        calendar_id=cal.id,
        can_view_full_details=True,
        can_manage_attendees=False,
    )

    with pytest.raises(ai_tools.PermissionDenied, match="manage_attendees denied"):
        await ai_tools.add_attendee(
            session,
            ea_ctx,
            event_id=event.id,
            email="guest@co.com",
            is_owner=False,
            delegation_grant=grant_view_only,
        )
