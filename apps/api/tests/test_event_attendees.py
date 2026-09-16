"""Attendee write paths: create/update normalization, the MANAGE_ATTENDEES
gate, and per-provider write-through translation (BRD §32 contacts meet
§14 delegation). Provider HTTP is faked; the DB is real sqlite."""

from datetime import datetime, timezone

from app.routers import events_router as er
from app.routers.events_router import EventCreate, EventUpdate
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.delegation import Delegation, DelegationCalendarGrant
from chronarch_core.models.enums import CalendarKind, ProviderType, UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User


async def _owner(session, email="att-owner@x.com"):
    user = User(id=f"u-{email}", email=email, display_name="O",
                password_hash="x", role=UserRole.ADMIN, home_timezone="UTC")
    session.add(user)
    await session.flush()
    return user


async def _calendar(session, user, provider=ProviderType.GOOGLE, writable=True):
    account = Account(owner_user_id=user.id, provider=provider,
                      provider_account_email=user.email, provider_account_id=user.email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:att",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=writable,
                        ea_can_view=True, ea_can_edit=True)
    session.add(calendar)
    await session.flush()
    return calendar


def _window():
    return (datetime(2026, 9, 16, 16, 0, tzinfo=timezone.utc),
            datetime(2026, 9, 16, 16, 30, tzinfo=timezone.utc))


async def _delegate_with_grant(session, owner, calendar, **flags):
    delegate = User(id="u-delegate", email="delegate@x.com", display_name="D",
                    password_hash="x", role=UserRole.DELEGATE, home_timezone="UTC")
    session.add(delegate)
    await session.flush()
    delegation = Delegation(owner_user_id=owner.id, delegate_user_id=delegate.id, active=True)
    session.add(delegation)
    await session.flush()
    grant = DelegationCalendarGrant(
        delegation_id=delegation.id, calendar_id=calendar.id,
        can_view_availability=True, can_view_titles=True, can_view_full_details=True,
        can_edit=True, **flags)
    session.add(grant)
    await session.flush()
    return delegate


async def test_create_normalizes_attendees(session):
    from sqlalchemy import select

    user = await _owner(session)
    calendar = await _calendar(session, user)
    start, end = _window()
    event = await er.create_event(
        EventCreate(calendar_id=calendar.id, title="Sync", start=start, end=end,
                    attendees=[{"email": "  JOHN@X.com ", "name": "  John  Appleseed "},
                               {"email": "jane@x.com"}]),
        user=user, session=session, client_timezone="UTC")
    stored = (await session.execute(
        select(UnifiedEvent).where(UnifiedEvent.id == event.id))).scalar_one()
    assert stored.attendees == [
        {"email": "john@x.com", "name": "John Appleseed"},
        {"email": "jane@x.com", "name": None},
    ]


async def test_create_rejects_bad_attendee_email(session):
    from fastapi import HTTPException

    user = await _owner(session)
    calendar = await _calendar(session, user)
    start, end = _window()
    try:
        await er.create_event(
            EventCreate(calendar_id=calendar.id, title="Sync", start=start, end=end,
                        attendees=[{"email": "not-an-email"}]),
            user=user, session=session, client_timezone="UTC")
        raise AssertionError("expected 422")
    except HTTPException as exc:
        assert exc.status_code == 422


async def test_update_attendees_stores_and_audits(session):
    from sqlalchemy import select

    from chronarch_core.models.audit import AuditEntry

    user = await _owner(session)
    calendar = await _calendar(session, user)
    start, end = _window()
    created = await er.create_event(
        EventCreate(calendar_id=calendar.id, title="Sync", start=start, end=end),
        user=user, session=session, client_timezone="UTC")
    updated = await er.update_event(
        created.id, EventUpdate(attendees=[{"email": "sam@x.com", "name": "Sam"}]),
        user=user, session=session)
    assert updated.attendees == [{"email": "sam@x.com", "name": "Sam"}]
    audits = list((await session.execute(
        select(AuditEntry).where(AuditEntry.event_id == created.id))).scalars())
    assert any("attendees" in (a.detail.get("changes") or {}) for a in audits)


async def test_update_attendees_denied_without_grant_flag(session):
    from fastapi import HTTPException

    user = await _owner(session)
    calendar = await _calendar(session, user)
    start, end = _window()
    created = await er.create_event(
        EventCreate(calendar_id=calendar.id, title="Sync", start=start, end=end),
        user=user, session=session, client_timezone="UTC")
    # can_edit but not can_manage_attendees: title edits pass, people don't.
    delegate = await _delegate_with_grant(session, user, calendar)
    allowed = await er.update_event(
        created.id, EventUpdate(title="Retitled"),
        user=delegate, session=session)
    assert allowed.title == "Retitled"
    try:
        await er.update_event(
            created.id, EventUpdate(attendees=[{"email": "sam@x.com"}]),
            user=delegate, session=session)
        raise AssertionError("expected 403")
    except HTTPException as exc:
        assert exc.status_code == 403


async def test_update_attendees_allowed_with_grant_flag(session):
    user = await _owner(session)
    calendar = await _calendar(session, user)
    start, end = _window()
    created = await er.create_event(
        EventCreate(calendar_id=calendar.id, title="Sync", start=start, end=end),
        user=user, session=session, client_timezone="UTC")
    delegate = await _delegate_with_grant(session, user, calendar, can_manage_attendees=True)
    updated = await er.update_event(
        created.id, EventUpdate(attendees=[{"email": "sam@x.com"}]),
        user=delegate, session=session)
    assert updated.attendees == [{"email": "sam@x.com", "name": None}]


async def test_google_translate_attendees(monkeypatch):
    from chronarch_core.connectors.google import GoogleConnector

    seen = {}

    class _Resp:
        def json(self):
            return {"id": "e1", "summary": "T", "start": {"dateTime": "2026-09-16T16:00:00Z"},
                    "end": {"dateTime": "2026-09-16T16:30:00Z"}}

    async def _fake_request(self, method, url, json=None):
        seen["json"] = json
        return _Resp()

    monkeypatch.setattr(GoogleConnector, "_request", _fake_request)
    connector = GoogleConnector("token")
    await connector.update_event("cal", "ev", {
        "title": "T", "attendees": [{"email": "a@x.com", "name": "A"},
                                    {"email": "b@x.com", "name": None}]})
    assert seen["json"]["attendees"] == [
        {"email": "a@x.com", "displayName": "A"}, {"email": "b@x.com"}]


async def test_microsoft_translate_attendees(monkeypatch):
    from chronarch_core.connectors.microsoft import MicrosoftConnector

    seen = {}

    class _Resp:
        def json(self):
            return {"id": "e1", "subject": "T",
                    "start": {"dateTime": "2026-09-16T16:00:00", "timeZone": "UTC"},
                    "end": {"dateTime": "2026-09-16T16:30:00", "timeZone": "UTC"}}

    async def _fake_request(self, method, url, json=None):
        seen.update(method=method, json=json)
        return _Resp()

    monkeypatch.setattr(MicrosoftConnector, "_request", _fake_request)
    connector = MicrosoftConnector("token")
    await connector.update_event("cal", "ev", {
        "attendees": [{"email": "a@x.com", "name": "A"}]})
    assert seen["json"]["attendees"] == [
        {"emailAddress": {"address": "a@x.com", "name": "A"}, "type": "required"}]


async def test_caldav_rewrites_attendee_props(monkeypatch):
    import icalendar

    from chronarch_core.connectors.caldav import CalDAVConnector

    cal = icalendar.Calendar()
    cal.add("version", "2.0")
    vevent = icalendar.Event()
    vevent.add("uid", "u1")
    vevent.add("summary", "T")
    from datetime import datetime as _dt

    vevent.add("dtstart", _dt(2026, 9, 16, 16, 0))
    vevent.add("dtend", _dt(2026, 9, 16, 16, 30))
    prop = icalendar.vCalAddress("mailto:old@x.com")
    vevent.add("attendee", prop)
    cal.add_component(vevent)
    original = cal.to_ical()
    put_body = {}

    class _FakeResp:
        content = original

        def raise_for_status(self):
            pass

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url):
            return _FakeResp()

        async def put(self, url, content=None, headers=None):
            put_body["content"] = content

            class _Put:
                def raise_for_status(self):
                    pass

            return _Put()

    monkeypatch.setattr(CalDAVConnector, "_client", lambda self: _FakeClient())
    connector = CalDAVConnector(server_url="https://dav.x.com", username="u", password="p")
    await connector.update_event("https://dav.x.com/cal/", "/ev.ics", {
        "attendees": [{"email": "new@x.com", "name": "New Person"}]})
    reparsed = icalendar.Calendar.from_ical(put_body["content"])
    vevent = next(c for c in reparsed.walk() if c.name == "VEVENT")
    attendees = vevent.get("attendee")
    items = attendees if isinstance(attendees, list) else [attendees]
    assert [str(a) for a in items] == ["mailto:new@x.com"]
    assert items[0].params.get("CN") == "New Person"
