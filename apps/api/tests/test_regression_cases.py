from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.main import app
from app.routers import booking_links_router
from app.routers import contacts_router
from chronarch_core import ai_tools
from chronarch_core.models import Base
from chronarch_core.models.account import Account
from chronarch_core.models.audit import AuditEntry
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ActorType, AuditAction, CalendarKind, ProviderType, UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext
from chronarch_core.models.booking import normalize_slug


def _route_paths(routes):
    paths = set()
    for route in routes:
        path = getattr(route, "path", None)
        if isinstance(path, str):
            paths.add(path)
        nested = getattr(route, "routes", None)
        if nested is None:
            original_router = getattr(route, "original_router", None)
            nested = getattr(original_router, "routes", None)
        if nested:
            paths.update(_route_paths(nested))
    return paths


def test_core_api_routes_are_registered():
    paths = _route_paths(app.routes)
    required = {
        "/healthz",
        "/readyz",
        "/api/v1/auth/login",
        "/api/v1/auth/me",
        "/api/v1/calendars",
        "/api/v1/events",
        "/api/v1/admin/users",
        "/api/v1/booking-links",
        "/api/v1/book/{slug}",
    }

    assert required <= paths


def test_openapi_contract_includes_critical_schemas():
    schema = app.openapi()
    paths = schema["paths"]

    assert "/api/v1/events" in paths
    assert "/api/v1/booking-links" in paths
    assert "EventOut" in schema["components"]["schemas"]
    assert "BookingLinkCreate" in schema["components"]["schemas"]


def test_metadata_contains_critical_persistence_tables():
    required = {
        "users",
        "accounts",
        "calendars",
        "events",
        "delegations",
        "booking_links",
        "bookings",
        "audit_log",
    }

    assert required <= set(Base.metadata.tables)


async def test_local_event_creation_writes_audit_entry(session):
    user = User(
        id="regression-owner",
        email="regression-owner@example.com",
        display_name="Owner",
        password_hash="x",
        role=UserRole.ADMIN,
    )
    account = Account(
        id="regression-account",
        owner_user_id=user.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=user.email,
        provider_account_id="regression-provider",
    )
    calendar = Calendar(
        id="regression-calendar",
        account_id=account.id,
        provider_calendar_id="regression-calendar-provider",
        kind=CalendarKind.PRIMARY,
        name="Work",
        provider_writable=True,
        blocks_availability=True,
    )
    session.add_all([user, account, calendar])
    await session.flush()
    start = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)
    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)

    event = await ai_tools.create_event(
        session,
        ctx,
        calendar_id=calendar.id,
        title="Regression Event",
        start=start,
        end=start.replace(hour=16),
        is_owner=True,
    )
    audit = (await session.execute(
        select(AuditEntry).where(AuditEntry.event_id == event.id)
    )).scalar_one()

    assert audit.action == AuditAction.CREATE_EVENT
    assert audit.detail["title"] == "Regression Event"


async def test_contact_crud_search_delete_and_restore(session):
    user = User(
        id="regression-contact-user",
        email="regression-contact@example.com",
        display_name="User",
        password_hash="x",
        role=UserRole.ADMIN,
    )
    session.add(user)
    await session.flush()
    created = await contacts_router.create_contact(
        contacts_router.ContactCreate(
            email="contact@example.com",
            display_name="Contact",
            company="Acme",
        ),
        _user=user,
        session=session,
    )
    fetched = await contacts_router.get_contact(created["id"], _user=user, session=session)
    updated = await contacts_router.update_contact(
        created["id"],
        contacts_router.ContactUpdate(company="Acme International"),
        _user=user,
        session=session,
    )
    searched = await contacts_router.search_contacts(
        q="contact",
        limit=10,
        _user=user,
        session=session,
    )
    deleted = await contacts_router.delete_contact(
        created["id"],
        _user=user,
        session=session,
    )
    with pytest.raises(HTTPException) as missing:
        await contacts_router.get_contact(created["id"], _user=user, session=session)
    restored = await contacts_router.restore_contact(
        created["id"],
        _user=user,
        session=session,
    )

    assert fetched["email"] == "contact@example.com"
    assert updated["company"] == "Acme International"
    assert [item["id"] for item in searched["contacts"]] == [created["id"]]
    assert deleted is None
    assert missing.value.status_code == 404
    assert restored["email"] == "contact@example.com"


def test_booking_duration_boundaries():
    valid_min = booking_links_router.BookingLinkCreate(
        title="Five minutes",
        calendar_id="calendar-id",
        duration_minutes=5,
    )
    valid_max = booking_links_router.BookingLinkCreate(
        title="Eight hours",
        calendar_id="calendar-id",
        duration_minutes=480,
    )
    with pytest.raises(HTTPException) as below:
        booking_links_router._check_windows(
            booking_links_router.BookingLinkCreate(
                title="Too short",
                calendar_id="calendar-id",
                duration_minutes=4,
            )
        )
    with pytest.raises(HTTPException) as above:
        booking_links_router._check_windows(
            booking_links_router.BookingLinkCreate(
                title="Too long",
                calendar_id="calendar-id",
                duration_minutes=481,
            )
        )

    assert below.value.status_code == 422
    assert above.value.status_code == 422
    assert valid_min.duration_minutes == 5
    assert valid_max.duration_minutes == 480


def test_booking_slug_length_boundaries():
    assert normalize_slug("abc") == "abc"
    assert normalize_slug("a" * 60) == "a" * 60
    for value in ("ab", "a" * 61):
        with pytest.raises(ValueError):
            normalize_slug(value)


def test_list_query_params_are_not_inferred_as_request_bodies():
    """A `list[str] | None` route parameter must be a query param, not a body.

    FastAPI treats a non-scalar annotation as an embedded request body. Left
    unannotated, `GET /api/v1/events` grows a `requestBody` and the
    `?calendar_ids=` filter is silently ignored (or rejected) — a filter that
    looks like it works but does not. `Query(None)` pins it to the query string.
    """
    schema = app.openapi()
    for path in ("/api/v1/events", "/api/v1/events/conflicts"):
        operation = schema["paths"][path]["get"]
        assert "requestBody" not in operation, f"{path} must not require a body"
        query_names = {p["name"] for p in operation.get("parameters", [])}
        assert {"window_start", "window_end", "calendar_ids"} <= query_names, (
            f"{path} query parameters: {sorted(query_names)}"
        )
