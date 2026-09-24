from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.auth as auth_module
import app.deps as deps_module
import app.rate_limiter as rate_limiter_module
from app.auth import hash_password
from app.oauth_state import sign_oauth_state
from app.routers import (
    admin_delegations_router,
    admin_roles_router,
    admin_users_router,
    auth_router,
    booking_links_router,
    calendars_router,
    events_router,
    health,
    public_booking_router,
)
from chronarch_core.booking import HoldStore
from chronarch_core.models import Base
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import CalendarKind, ProviderType, UserRole
from chronarch_core.models.rbac import Role, RoleAssignment, RolePermission
from chronarch_core.models.user import User


PASSWORD = "ChronarchPass123!"
OWNER_EMAIL = "owner@example.com"
OTHER_OWNER_EMAIL = "other-owner@example.com"
DELEGATE_EMAIL = "delegate@example.com"
MANAGER_EMAIL = "manager@example.com"
WORK_CALENDAR_ID = "calendar-owner-work"
PERSONAL_CALENDAR_ID = "calendar-owner-personal"
READONLY_CALENDAR_ID = "calendar-owner-readonly"
OTHER_CALENDAR_ID = "calendar-other-owner"


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.counts = {}

    async def incr(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, seconds):
        return True

    async def ttl(self, key):
        return 60

    async def exists(self, key):
        return int(key in self.values)

    async def setex(self, key, seconds, value):
        self.values[key] = value
        return True

    async def set(self, key, value):
        self.values[key] = value
        return True

    async def get(self, key):
        return self.values.get(key)

    async def getdel(self, key):
        return self.values.pop(key, None)


@pytest_asyncio.fixture
async def api(monkeypatch):
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    password_hash = hash_password(PASSWORD)
    async with session_factory() as seed_session:
        admin_role = Role(
            id="role-admin",
            name="admin",
            description="Administrator",
            is_system=True,
        )
        delegate_role = Role(
            id="role-delegate",
            name="delegate",
            description="Delegate",
            is_system=True,
        )
        manager_role = Role(
            id="role-user-manager",
            name="user_manager",
            description="User manager",
            is_system=False,
        )
        owner = User(
            id="user-owner",
            email=OWNER_EMAIL,
            display_name="Calendar Owner",
            password_hash=password_hash,
            role=UserRole.ADMIN,
            is_active=True,
            home_timezone="UTC",
            working_days="1,2,3,4,5",
            working_hours_start="09:00",
            working_hours_end="17:00",
        )
        other_owner = User(
            id="user-other-owner",
            email=OTHER_OWNER_EMAIL,
            display_name="Other Owner",
            password_hash=password_hash,
            role=UserRole.ADMIN,
            is_active=True,
        )
        delegate = User(
            id="user-delegate",
            email=DELEGATE_EMAIL,
            display_name="Calendar Delegate",
            password_hash=password_hash,
            role=UserRole.DELEGATE,
            is_active=True,
        )
        manager = User(
            id="user-manager",
            email=MANAGER_EMAIL,
            display_name="User Manager",
            password_hash=password_hash,
            role=UserRole.DELEGATE,
            is_active=True,
        )
        seed_session.add_all(
            [admin_role, delegate_role, manager_role, owner, other_owner, delegate, manager]
        )
        await seed_session.flush()
        seed_session.add_all(
            [
                RolePermission(role_id=delegate_role.id, permission="copilot.use"),
                RolePermission(
                    role_id=delegate_role.id,
                    permission="mcp_keys.create_self",
                ),
                RolePermission(
                    role_id=manager_role.id,
                    permission="users.manage",
                ),
                RoleAssignment(user_id=owner.id, role_id=admin_role.id),
                RoleAssignment(user_id=other_owner.id, role_id=admin_role.id),
                RoleAssignment(user_id=delegate.id, role_id=delegate_role.id),
                RoleAssignment(user_id=manager.id, role_id=delegate_role.id),
                RoleAssignment(user_id=manager.id, role_id=manager_role.id),
            ]
        )
        owner_account = Account(
            id="account-owner",
            owner_user_id=owner.id,
            provider=ProviderType.GOOGLE,
            provider_account_email=OWNER_EMAIL,
            provider_account_id="provider-owner",
        )
        other_account = Account(
            id="account-other",
            owner_user_id=other_owner.id,
            provider=ProviderType.GOOGLE,
            provider_account_email=OTHER_OWNER_EMAIL,
            provider_account_id="provider-other",
        )
        seed_session.add_all([owner_account, other_account])
        await seed_session.flush()
        seed_session.add_all(
            [
                Calendar(
                    id=WORK_CALENDAR_ID,
                    account_id=owner_account.id,
                    provider_calendar_id="owner-work",
                    kind=CalendarKind.PRIMARY,
                    name="Owner Work",
                    provider_writable=True,
                    blocks_availability=True,
                    ea_can_view=True,
                    ea_can_edit=True,
                ),
                Calendar(
                    id=PERSONAL_CALENDAR_ID,
                    account_id=owner_account.id,
                    provider_calendar_id="owner-personal",
                    kind=CalendarKind.SHARED,
                    name="Owner Personal",
                    provider_writable=True,
                    blocks_availability=True,
                    ea_can_view=True,
                    ea_can_edit=True,
                ),
                Calendar(
                    id=READONLY_CALENDAR_ID,
                    account_id=owner_account.id,
                    provider_calendar_id="owner-readonly",
                    kind=CalendarKind.SHARED,
                    name="Owner Read Only",
                    provider_writable=False,
                    blocks_availability=True,
                    ea_can_view=True,
                ),
                Calendar(
                    id=OTHER_CALENDAR_ID,
                    account_id=other_account.id,
                    provider_calendar_id="other-work",
                    kind=CalendarKind.PRIMARY,
                    name="Other Owner Work",
                    provider_writable=True,
                    blocks_availability=True,
                    ea_can_view=True,
                    ea_can_edit=True,
                ),
            ]
        )
        await seed_session.commit()

    original_session_local = deps_module.SessionLocal
    deps_module.SessionLocal = session_factory

    api_app = FastAPI(title="Chronarch API Functional Test")
    for router in (
        health.router,
        auth_router.router,
        admin_users_router.router,
        admin_roles_router.router,
        admin_delegations_router.router,
        booking_links_router.router,
        public_booking_router.router,
        calendars_router.router,
    ):
        api_app.include_router(router)

    event_app = FastAPI(title="Chronarch Events Functional Test")
    event_app.include_router(events_router.router)

    fake_redis = FakeRedis()
    monkeypatch.setattr(auth_module, "get_redis_client", lambda: fake_redis)
    monkeypatch.setattr(rate_limiter_module, "get_redis_client", lambda: fake_redis)
    monkeypatch.setattr(public_booking_router, "get_redis_client", lambda: None)
    HoldStore._memory.clear()
    api_transport = httpx.ASGITransport(
        app=api_app,
        raise_app_exceptions=True,
    )
    event_transport = httpx.ASGITransport(
        app=event_app,
        raise_app_exceptions=True,
    )
    try:
        async with httpx.AsyncClient(
            transport=api_transport,
            base_url="http://testserver",
        ) as client, httpx.AsyncClient(
            transport=event_transport,
            base_url="http://testserver",
        ) as event_client:
            yield SimpleNamespace(
                client=client,
                event_client=event_client,
                session_factory=session_factory,
                password=PASSWORD,
            )
    finally:
        deps_module.SessionLocal = original_session_local
        HoldStore._memory.clear()
        await engine.dispose()


async def login(api, email):
    response = await api.client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": api.password, "remember_me": False},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


async def create_event(api, token, calendar_id=WORK_CALENDAR_ID):
    response = await api.event_client.post(
        "/api/v1/events",
        headers={**bearer(token), "X-Timezone": "UTC"},
        json={
            "calendar_id": calendar_id,
            "title": "Board Planning",
            "start": "2026-09-23T14:00:00+00:00",
            "end": "2026-09-23T15:00:00+00:00",
            "description": "Quarterly planning",
            "location": "Board room",
            "attendees": [
                {"email": "GUEST@EXAMPLE.COM", "name": "  Guest   User "}
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def grant_body(**overrides):
    body = {
        "can_view_availability": True,
        "can_view_titles": False,
        "can_view_full_details": False,
        "can_create": False,
        "can_edit": False,
        "can_reschedule": False,
        "can_delete": False,
        "can_manage_attendees": False,
        "can_respond_to_invitations": False,
        "can_import_ics": False,
        "can_move_between_calendars": False,
    }
    body.update(overrides)
    return body


async def test_health_auth_session_and_logout_asgi(api):
    health = await api.client.get("/healthz")
    ready = await api.client.get("/readyz")
    unauthenticated = await api.client.get("/api/v1/calendars")

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}
    assert unauthenticated.status_code == 401

    token = await login(api, OWNER_EMAIL)
    me = await api.client.get("/api/v1/auth/me", headers=bearer(token))
    logout = await api.client.post("/api/v1/auth/logout", headers=bearer(token))
    revoked = await api.client.get("/api/v1/auth/me", headers=bearer(token))

    assert me.status_code == 200
    assert me.json()["email"] == OWNER_EMAIL
    assert me.json()["role"] == "admin"
    assert "booking.manage" in me.json()["permissions"]
    assert logout.status_code == 200
    assert revoked.status_code == 401
    assert revoked.json()["detail"] == "Token has been revoked"


async def test_profile_and_password_update_asgi(api):
    token = await login(api, OWNER_EMAIL)
    updated = await api.client.patch(
        "/api/v1/auth/me",
        headers=bearer(token),
        json={
            "display_name": "Updated Owner",
            "home_timezone": "America/Los_Angeles",
            "working_hours_start": "8:30",
            "working_hours_end": "16:30",
        },
    )
    wrong_password = await api.client.post(
        "/api/v1/auth/me/password",
        headers=bearer(token),
        json={
            "current_password": "incorrect-password",
            "new_password": "new-secure-password",
        },
    )
    short_password = await api.client.post(
        "/api/v1/auth/me/password",
        headers=bearer(token),
        json={"current_password": PASSWORD, "new_password": "short"},
    )
    changed = await api.client.post(
        "/api/v1/auth/me/password",
        headers=bearer(token),
        json={
            "current_password": PASSWORD,
            "new_password": "new-secure-password",
        },
    )
    old_login = await api.client.post(
        "/api/v1/auth/login",
        json={"email": OWNER_EMAIL, "password": PASSWORD},
    )
    new_login = await api.client.post(
        "/api/v1/auth/login",
        json={"email": OWNER_EMAIL, "password": "new-secure-password"},
    )

    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Updated Owner"
    assert updated.json()["home_timezone"] == "America/Los_Angeles"
    assert updated.json()["working_hours_start"] == "08:30"
    assert wrong_password.status_code == 403
    assert short_password.status_code == 422
    assert changed.status_code == 200
    assert old_login.status_code == 401
    assert new_login.status_code == 200


@pytest.mark.xfail(
    strict=True,
    reason="event route dependency analysis currently fails before the handler runs",
)
async def test_owner_event_create_list_and_update_asgi(api):
    token = await login(api, OWNER_EMAIL)
    calendars = await api.client.get("/api/v1/calendars", headers=bearer(token))
    created = await create_event(api, token)
    listed = await api.event_client.get(
        "/api/v1/events",
        headers=bearer(token),
        params={
            "window_start": "2026-09-23T13:00:00+00:00",
            "window_end": "2026-09-23T16:00:00+00:00",
        },
    )
    fetched = await api.event_client.get(
        f"/api/v1/events/{created['id']}",
        headers=bearer(token),
    )
    updated = await api.event_client.patch(
        f"/api/v1/events/{created['id']}",
        headers=bearer(token),
        json={
            "title": "Board Planning Revised",
            "description": "Updated agenda",
            "location": "Room 4",
        },
    )

    assert calendars.status_code == 200
    assert {item["id"] for item in calendars.json()} >= {
        WORK_CALENDAR_ID,
        PERSONAL_CALENDAR_ID,
    }
    assert created["title"] == "Board Planning"
    assert created["attendees"] == [
        {"email": "guest@example.com", "name": "Guest User"}
    ]
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [created["id"]]
    assert fetched.status_code == 200
    assert fetched.json()["description"] == "Quarterly planning"
    assert updated.status_code == 200
    assert updated.json()["title"] == "Board Planning Revised"
    assert updated.json()["location"] == "Room 4"


@pytest.mark.xfail(
    strict=True,
    reason="event route dependency analysis currently fails before the handler runs",
)
async def test_owner_event_move_and_delete_asgi(api):
    token = await login(api, OWNER_EMAIL)
    created = await create_event(api, token)
    moved = await api.event_client.patch(
        f"/api/v1/events/{created['id']}/move",
        headers=bearer(token),
        json={
            "start": "2026-09-23T16:00:00+00:00",
            "end": "2026-09-23T17:00:00+00:00",
            "all_day": False,
        },
    )
    moved_calendar = await api.event_client.post(
        f"/api/v1/events/{created['id']}/move-to-calendar",
        headers=bearer(token),
        json={"calendar_id": PERSONAL_CALENDAR_ID},
    )
    deleted = await api.event_client.delete(
        f"/api/v1/events/{created['id']}",
        headers=bearer(token),
    )
    missing = await api.event_client.get(
        f"/api/v1/events/{created['id']}",
        headers=bearer(token),
    )

    assert moved.status_code == 200
    assert moved.json()["start"].startswith("2026-09-23T16:00:00")
    assert moved_calendar.status_code == 200
    assert moved_calendar.json()["id"] == created["id"]
    assert moved_calendar.json()["calendar_id"] == PERSONAL_CALENDAR_ID
    assert deleted.status_code == 204
    assert missing.status_code == 404


@pytest.mark.xfail(
    strict=True,
    reason="event route dependency analysis currently fails before request validation",
)
async def test_event_validation_and_read_only_calendar_asgi(api):
    token = await login(api, OWNER_EMAIL)
    invalid_window = await api.event_client.post(
        "/api/v1/events",
        headers=bearer(token),
        json={
            "calendar_id": WORK_CALENDAR_ID,
            "title": "Invalid",
            "start": "2026-09-23T15:00:00+00:00",
            "end": "2026-09-23T14:00:00+00:00",
        },
    )
    unknown_calendar = await api.event_client.post(
        "/api/v1/events",
        headers=bearer(token),
        json={
            "calendar_id": "missing-calendar",
            "title": "Missing",
            "start": "2026-09-23T14:00:00+00:00",
            "end": "2026-09-23T15:00:00+00:00",
        },
    )
    read_only = await api.event_client.post(
        "/api/v1/events",
        headers=bearer(token),
        json={
            "calendar_id": READONLY_CALENDAR_ID,
            "title": "Read Only",
            "start": "2026-09-23T14:00:00+00:00",
            "end": "2026-09-23T15:00:00+00:00",
        },
    )
    created = await create_event(api, token)
    empty_update = await api.event_client.patch(
        f"/api/v1/events/{created['id']}",
        headers=bearer(token),
        json={},
    )
    partial_time_update = await api.event_client.patch(
        f"/api/v1/events/{created['id']}",
        headers=bearer(token),
        json={"start": "2026-09-23T18:00:00+00:00"},
    )

    assert invalid_window.status_code == 422
    assert unknown_calendar.status_code == 404
    assert read_only.status_code == 403
    assert empty_update.status_code == 422
    assert partial_time_update.status_code == 422


async def test_admin_creates_delegate_and_delegate_logs_in_asgi(api):
    admin_token = await login(api, OWNER_EMAIL)
    created = await api.client.post(
        "/api/v1/admin/users",
        headers=bearer(admin_token),
        json={
            "email": "created-delegate@example.com",
            "display_name": "Created Delegate",
            "password": PASSWORD,
        },
    )
    duplicate = await api.client.post(
        "/api/v1/admin/users",
        headers=bearer(admin_token),
        json={
            "email": "created-delegate@example.com",
            "display_name": "Created Delegate",
            "password": PASSWORD,
        },
    )
    login_response = await api.client.post(
        "/api/v1/auth/login",
        json={
            "email": "created-delegate@example.com",
            "password": PASSWORD,
            "remember_me": False,
        },
    )
    created_token = login_response.json()["access_token"]
    me = await api.client.get(
        "/api/v1/auth/me",
        headers=bearer(created_token),
    )

    assert created.status_code == 201
    assert created.json()["role"] == "delegate"
    assert created.json()["roles"] == ["delegate"]
    assert duplicate.status_code == 409
    assert login_response.status_code == 200
    assert login_response.json()["force_password_change"] is True
    assert me.status_code == 428


@pytest.mark.xfail(
    strict=True,
    reason="event route dependency analysis currently blocks the delegation journey",
)
async def test_delegation_grant_and_deactivation_asgi(api):
    owner_token = await login(api, OWNER_EMAIL)
    created = await create_event(api, owner_token)
    delegation = await api.client.post(
        "/api/v1/admin/delegations",
        headers=bearer(owner_token),
        json={
            "owner_user_id": "user-owner",
            "delegate_user_id": "user-delegate",
        },
    )
    grant = await api.client.put(
        f"/api/v1/admin/delegations/{delegation.json()['id']}/grants/{WORK_CALENDAR_ID}",
        headers=bearer(owner_token),
        json=grant_body(
            can_view_titles=True,
            can_view_full_details=True,
        ),
    )
    delegate_token = await login(api, DELEGATE_EMAIL)
    visible = await api.event_client.get(
        "/api/v1/events",
        headers=bearer(delegate_token),
        params={
            "window_start": "2026-09-23T13:00:00+00:00",
            "window_end": "2026-09-23T16:00:00+00:00",
        },
    )
    detail = await api.event_client.get(
        f"/api/v1/events/{created['id']}",
        headers=bearer(delegate_token),
    )
    deactivated = await api.client.patch(
        f"/api/v1/admin/delegations/{delegation.json()['id']}",
        headers=bearer(owner_token),
        params={"active": False},
    )
    hidden = await api.event_client.get(
        "/api/v1/events",
        headers=bearer(delegate_token),
        params={
            "window_start": "2026-09-23T13:00:00+00:00",
            "window_end": "2026-09-23T16:00:00+00:00",
        },
    )
    denied_detail = await api.event_client.get(
        f"/api/v1/events/{created['id']}",
        headers=bearer(delegate_token),
    )

    assert delegation.status_code == 201
    assert grant.status_code == 200
    assert visible.status_code == 200
    assert [item["id"] for item in visible.json()] == [created["id"]]
    assert detail.status_code == 200
    assert detail.json()["description"] == "Quarterly planning"
    assert deactivated.status_code == 200
    assert deactivated.json()["active"] is False
    assert hidden.status_code == 200
    assert hidden.json() == []
    assert denied_detail.status_code == 403


@pytest.mark.xfail(
    strict=True,
    reason="event route dependency analysis currently blocks the availability journey",
)
async def test_availability_only_delegate_gets_redacted_conflict_asgi(api):
    owner_token = await login(api, OWNER_EMAIL)
    created = await create_event(api, owner_token)
    delegation = await api.client.post(
        "/api/v1/admin/delegations",
        headers=bearer(owner_token),
        json={
            "owner_user_id": "user-owner",
            "delegate_user_id": "user-delegate",
        },
    )
    grant = await api.client.put(
        f"/api/v1/admin/delegations/{delegation.json()['id']}/grants/{WORK_CALENDAR_ID}",
        headers=bearer(owner_token),
        json=grant_body(),
    )
    delegate_token = await login(api, DELEGATE_EMAIL)
    events = await api.event_client.get(
        "/api/v1/events",
        headers=bearer(delegate_token),
        params={
            "window_start": "2026-09-23T13:00:00+00:00",
            "window_end": "2026-09-23T16:00:00+00:00",
        },
    )
    detail = await api.event_client.get(
        f"/api/v1/events/{created['id']}",
        headers=bearer(delegate_token),
    )
    conflicts = await api.event_client.get(
        "/api/v1/events/conflicts",
        headers=bearer(delegate_token),
        params={
            "window_start": "2026-09-23T13:00:00+00:00",
            "window_end": "2026-09-23T16:00:00+00:00",
        },
    )

    assert grant.status_code == 200
    assert events.status_code == 200
    assert events.json() == []
    assert detail.status_code == 403
    assert conflicts.status_code == 200
    assert conflicts.json()[0]["event_id"] == created["id"]
    assert conflicts.json()[0]["title"] == "Busy"
    assert conflicts.json()[0]["redacted"] is True


async def test_user_manager_permissions_asgi(api):
    manager_token = await login(api, MANAGER_EMAIL)
    roles = await api.client.get(
        "/api/v1/admin/roles",
        headers=bearer(manager_token),
    )
    created = await api.client.post(
        "/api/v1/admin/users",
        headers=bearer(manager_token),
        json={
            "email": "manager-created@example.com",
            "display_name": "Manager Created",
            "password": PASSWORD,
        },
    )
    role_assignment = await api.client.patch(
        f"/api/v1/admin/users/{created.json()['id']}",
        headers=bearer(manager_token),
        json={"roles": ["admin"]},
    )

    assert roles.status_code == 403
    assert created.status_code == 201
    assert role_assignment.status_code == 403
    assert role_assignment.json()["detail"] == "Only admins can assign roles"


async def create_booking_link(api, token, slug, approval_required=False):
    response = await api.client.post(
        "/api/v1/booking-links",
        headers=bearer(token),
        json={
            "title": "Intro Call",
            "description": "Thirty minutes to talk",
            "slug": slug,
            "duration_minutes": 30,
            "calendar_id": WORK_CALENDAR_ID,
            "min_notice_minutes": 0,
            "max_days_ahead": 30,
            "approval_required": approval_required,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def first_booking_slot(api, slug):
    response = await api.client.get(
        f"/api/v1/book/{slug}/slots",
        params={
            "date_from": "2026-09-24T00:00:00+00:00",
            "date_to": "2026-09-24T23:59:59+00:00",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["slots"], response.text
    return response.json()["slots"][0]


async def test_public_booking_confirm_and_cancel_asgi(api):
    host_token = await login(api, OWNER_EMAIL)
    link = await create_booking_link(api, host_token, "asgi-intro")
    metadata = await api.client.get("/api/v1/book/asgi-intro")
    slot = await first_booking_slot(api, "asgi-intro")
    hold = await api.client.post(
        "/api/v1/book/asgi-intro/hold",
        json={"slot_start": slot["start"]},
    )
    confirmed = await api.client.post(
        "/api/v1/book/asgi-intro/confirm",
        json={
            "hold_token": hold.json()["hold_token"],
            "slot_start": slot["start"],
            "name": "Jane Booker",
            "email": "jane@example.com",
            "note": "Please send the agenda",
            "booked_timezone": "America/Edmonton",
        },
    )
    bookings = await api.client.get(
        f"/api/v1/booking-links/{link['id']}/bookings",
        headers=bearer(host_token),
    )
    cancelled = await api.client.post(
        f"/api/v1/book/reservations/{confirmed.json()['booker_token']}/cancel"
    )
    cancelled_again = await api.client.post(
        f"/api/v1/book/reservations/{confirmed.json()['booker_token']}/cancel"
    )
    bookings_after_cancel = await api.client.get(
        f"/api/v1/booking-links/{link['id']}/bookings",
        headers=bearer(host_token),
    )

    assert metadata.status_code == 200
    assert metadata.json()["host_name"] == "Calendar Owner"
    assert hold.status_code == 200
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "confirmed"
    assert bookings.status_code == 200
    assert bookings.json()["bookings"][0]["event_id"]
    assert bookings.json()["bookings"][0]["booker_email"] == "jane@example.com"
    assert cancelled.status_code == 200
    assert cancelled_again.status_code == 200
    assert bookings_after_cancel.json()["bookings"][0]["status"] == "cancelled"


async def test_approval_booking_asgi(api):
    host_token = await login(api, OWNER_EMAIL)
    link = await create_booking_link(
        api,
        host_token,
        "asgi-approval",
        approval_required=True,
    )
    slot = await first_booking_slot(api, "asgi-approval")
    hold = await api.client.post(
        "/api/v1/book/asgi-approval/hold",
        json={"slot_start": slot["start"]},
    )
    confirmed = await api.client.post(
        "/api/v1/book/asgi-approval/confirm",
        json={
            "hold_token": hold.json()["hold_token"],
            "slot_start": slot["start"],
            "name": "Pat Booker",
            "email": "pat@example.com",
        },
    )
    pending = await api.client.get(
        f"/api/v1/booking-links/{link['id']}/bookings",
        headers=bearer(host_token),
    )
    approved = await api.client.post(
        f"/api/v1/booking-links/bookings/{confirmed.json()['booking_id']}/approve",
        headers=bearer(host_token),
    )
    confirmed_bookings = await api.client.get(
        f"/api/v1/booking-links/{link['id']}/bookings",
        headers=bearer(host_token),
    )

    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "pending"
    assert pending.json()["bookings"][0]["event_id"] is None
    assert approved.status_code == 200
    assert approved.json()["status"] == "confirmed"
    assert approved.json()["event_id"]
    assert confirmed_bookings.json()["bookings"][0]["status"] == "confirmed"


async def test_non_admin_manager_cannot_create_admin_asgi(api):
    manager_token = await login(api, MANAGER_EMAIL)
    response = await api.client.post(
        "/api/v1/admin/users",
        headers=bearer(manager_token),
        json={
            "email": "escalated-admin@example.com",
            "display_name": "Escalated Admin",
            "password": PASSWORD,
            "role": "admin",
            "roles": ["admin"],
        },
    )
    assert response.status_code in {400, 403, 422}


@pytest.mark.xfail(
    strict=True,
    reason="calendar settings can currently be patched across owners",
)
async def test_non_owner_cannot_patch_calendar_asgi(api):
    other_owner_token = await login(api, OTHER_OWNER_EMAIL)
    response = await api.client.patch(
        f"/api/v1/calendars/{WORK_CALENDAR_ID}",
        headers=bearer(other_owner_token),
        json={"visible": False, "blocks_availability": False},
    )
    assert response.status_code in {403, 404}


@pytest.mark.xfail(
    strict=True,
    reason="event route analysis currently blocks the request; title-only redaction is also a known gap",
)
async def test_title_only_delegate_list_is_redacted_asgi(api):
    owner_token = await login(api, OWNER_EMAIL)
    created = await create_event(api, owner_token)
    delegation = await api.client.post(
        "/api/v1/admin/delegations",
        headers=bearer(owner_token),
        json={
            "owner_user_id": "user-owner",
            "delegate_user_id": "user-delegate",
        },
    )
    grant = await api.client.put(
        f"/api/v1/admin/delegations/{delegation.json()['id']}/grants/{WORK_CALENDAR_ID}",
        headers=bearer(owner_token),
        json=grant_body(can_view_titles=True),
    )
    delegate_token = await login(api, DELEGATE_EMAIL)
    response = await api.event_client.get(
        "/api/v1/events",
        headers=bearer(delegate_token),
        params={
            "window_start": "2026-09-23T13:00:00+00:00",
            "window_end": "2026-09-23T16:00:00+00:00",
        },
    )

    assert grant.status_code == 200
    assert response.status_code == 200
    assert len(response.json()) == 1
    event = response.json()[0]
    assert event["id"] == created["id"]
    assert event["title"] == "Board Planning"
    assert event["description"] is None
    assert event["location"] is None
    assert event["organizer"] is None
    assert event["attendees"] == []


async def test_delegation_rejects_another_owners_calendar_asgi(api):
    owner_token = await login(api, OWNER_EMAIL)
    delegation = await api.client.post(
        "/api/v1/admin/delegations",
        headers=bearer(owner_token),
        json={
            "owner_user_id": "user-owner",
            "delegate_user_id": "user-delegate",
        },
    )
    response = await api.client.put(
        f"/api/v1/admin/delegations/{delegation.json()['id']}/grants/{OTHER_CALENDAR_ID}",
        headers=bearer(owner_token),
        json=grant_body(can_view_titles=True, can_view_full_details=True),
    )
    assert response.status_code in {403, 404}


async def test_oauth_state_cannot_access_authenticated_route_asgi(api):
    state = await sign_oauth_state("user-owner")
    response = await api.client.get(
        "/api/v1/auth/me",
        headers=bearer(state),
    )
    assert response.status_code == 401
