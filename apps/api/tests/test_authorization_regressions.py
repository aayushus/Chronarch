from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import get_current_user
from app.oauth_state import sign_oauth_state
from app.routers import admin_caldav_router as caldav_router
from app.routers import admin_delegations_router as delegations_router
from app.routers import admin_users_router as users_router
from app.routers import calendars_router
from app.routers import events_router
from chronarch_core.connectors.caldav import CalDAVConnector
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.delegation import Delegation, DelegationCalendarGrant
from chronarch_core.models.enums import ProviderType, UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.rbac import Role
from chronarch_core.models.user import User


async def _admin(session, user_id: str, email: str) -> User:
    user = User(
        id=user_id,
        email=email,
        display_name=user_id,
        password_hash="x",
        role=UserRole.ADMIN,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


async def _account_calendar(session, owner: User, suffix: str) -> Calendar:
    account = Account(
        owner_user_id=owner.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=owner.email,
        provider_account_id=f"provider-{suffix}",
    )
    session.add(account)
    await session.flush()
    calendar = Calendar(
        account_id=account.id,
        provider_calendar_id=f"provider-calendar-{suffix}",
        name=f"Calendar {suffix}",
        provider_writable=True,
        blocks_availability=True,
        ea_can_view=True,
    )
    session.add(calendar)
    await session.flush()
    return calendar


@pytest.mark.xfail(
    strict=True,
    reason="users.manage currently permits creation of an ADMIN user",
)
async def test_non_admin_user_manager_cannot_create_admin(session):
    manager = User(
        id="manager-1",
        email="manager@example.com",
        display_name="Manager",
        password_hash="x",
        role=UserRole.DELEGATE,
        is_active=True,
    )
    admin_role = Role(name="admin", description="Administrator", is_system=True)
    session.add_all([manager, admin_role])
    await session.flush()

    with pytest.raises(HTTPException) as raised:
        await users_router.create_user(
            users_router.AdminUserCreate(
                email="new-admin@example.com",
                display_name="New Admin",
                password="temporary-password",
                role=UserRole.ADMIN,
                roles=["admin"],
            ),
            _user=manager,
            session=session,
        )

    assert raised.value.status_code in {400, 403, 422}


@pytest.mark.xfail(
    strict=True,
    reason="delegation grants are not bound to the delegation owner's calendars",
)
async def test_delegation_cannot_grant_another_owners_calendar(session):
    owner = await _admin(session, "owner-1", "owner@example.com")
    other_owner = await _admin(session, "owner-2", "other-owner@example.com")
    delegate = User(
        id="delegate-1",
        email="delegate@example.com",
        display_name="Delegate",
        password_hash="x",
        role=UserRole.DELEGATE,
        is_active=True,
    )
    foreign_calendar = await _account_calendar(session, other_owner, "foreign")
    delegation = Delegation(
        owner_user_id=owner.id,
        delegate_user_id=delegate.id,
        active=True,
    )
    session.add_all([delegate, delegation])
    await session.flush()

    with pytest.raises(HTTPException) as raised:
        await delegations_router.upsert_grant(
            delegation.id,
            foreign_calendar.id,
            delegations_router.GrantUpdate(can_view_titles=True),
            _admin=owner,
            session=session,
        )

    assert raised.value.status_code in {403, 404}


@pytest.mark.xfail(
    strict=True,
    reason="calendar PATCH route references an unimported Calendar model",
)
async def test_calendar_patch_handles_valid_owner_request(session):
    owner = await _admin(session, "owner-1", "owner@example.com")
    calendar = await _account_calendar(session, owner, "owned")

    result = await calendars_router.update_calendar(
        calendar.id,
        calendars_router.CalendarUpdate(name="Renamed"),
        user=owner,
        session=session,
    )

    assert result.name == "Renamed"


@pytest.mark.xfail(
    strict=True,
    reason="calendar settings mutation has no ownership or manage-permission check",
)
async def test_calendar_patch_rejects_non_owner(session):
    owner = await _admin(session, "owner-1", "owner@example.com")
    attacker = await _admin(session, "owner-2", "attacker@example.com")
    calendar = await _account_calendar(session, owner, "owned")

    with pytest.raises(HTTPException) as raised:
        await calendars_router.update_calendar(
            calendar.id,
            calendars_router.CalendarUpdate(visible=False, blocks_availability=False),
            user=attacker,
            session=session,
        )

    assert raised.value.status_code in {403, 404}


@pytest.mark.xfail(
    strict=True,
    reason="OAuth state JWTs are currently accepted as session bearer tokens",
)
async def test_oauth_state_cannot_authenticate_an_api_request(session):
    user = await _admin(session, "admin-1", "admin@example.com")
    state = await sign_oauth_state(user.id)

    with pytest.raises(HTTPException) as raised:
        await get_current_user(
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=state),
            session=session,
        )

    assert raised.value.status_code == 401


@pytest.mark.xfail(
    strict=True,
    reason="title-only delegation grants currently return full event details",
)
async def test_title_only_delegate_receives_redacted_event_details(session):
    owner = await _admin(session, "owner-1", "owner@example.com")
    delegate = User(
        id="delegate-1",
        email="delegate@example.com",
        display_name="Delegate",
        password_hash="x",
        role=UserRole.DELEGATE,
        is_active=True,
    )
    calendar = await _account_calendar(session, owner, "private")
    delegation = Delegation(
        owner_user_id=owner.id,
        delegate_user_id=delegate.id,
        active=True,
    )
    session.add_all([delegate, delegation])
    await session.flush()
    session.add(
        DelegationCalendarGrant(
            delegation_id=delegation.id,
            calendar_id=calendar.id,
            can_view_availability=True,
            can_view_titles=True,
            can_view_full_details=False,
        )
    )
    start = datetime(2026, 9, 23, 14, 0, tzinfo=timezone.utc)
    session.add(
        UnifiedEvent(
            provider_account_id=calendar.account_id,
            calendar_id=calendar.id,
            provider_event_id="event-1",
            title="Board preparation",
            description="Confidential strategy",
            location="Executive floor",
            organizer={"email": "owner@example.com", "name": "Owner"},
            attendees=[{"email": "guest@example.com", "name": "Guest"}],
            start=start,
            end=start.replace(hour=15),
        )
    )
    await session.flush()

    events = await events_router.list_events(
        window_start=start,
        window_end=start.replace(hour=16),
        user=delegate,
        session=session,
    )

    assert len(events) == 1
    serialized = events_router.EventOut.model_validate(events[0])
    assert serialized.title == "Board preparation"
    assert serialized.description is None
    assert serialized.location is None
    assert serialized.organizer is None
    assert serialized.attendees == []


@pytest.mark.xfail(
    strict=True,
    reason="CalDAV connection testing permits arbitrary cleartext HTTP targets",
)
async def test_caldav_probe_rejects_private_http_without_network(monkeypatch):
    called = False

    async def fake_list_calendars(self):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(CalDAVConnector, "list_calendars", fake_list_calendars)

    with pytest.raises(HTTPException) as raised:
        await caldav_router.test_connection(
            caldav_router.CaldavTest(
                server_url="http://169.254.169.254",
                username="user",
                password="password",
            ),
            _user=None,
        )

    assert raised.value.status_code == 422
    assert called is False
