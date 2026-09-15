"""Quick-add endpoint tests (BRD §32).

The LLM call is stubbed at `_call_litellm` — these tests cover prompt
handling, draft validation, contact resolution, and the permission-checked
create path. No network, no broker.
"""

from datetime import datetime, timezone

from app.routers import quick_add_router as qa
from app.routers.quick_add_router import QuickAddCreateRequest, QuickAddDraft, QuickAddParseRequest
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.contact import Contact
from chronarch_core.models.enums import CalendarKind, ProviderType, UserRole
from chronarch_core.models.user import User


async def _user(session, role=UserRole.ADMIN, email="qa@x.com"):
    user = User(id=f"u-{email}", email=email, display_name="Q",
                password_hash="x", role=role, home_timezone="America/New_York")
    session.add(user)
    await session.flush()
    return user


async def _writable_calendar(session, user, writable=True):
    account = Account(owner_user_id=user.id, provider=ProviderType.GOOGLE,
                      provider_account_email=user.email, provider_account_id=user.email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:qa",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=writable)
    session.add(calendar)
    await session.flush()
    return calendar


async def _deny(session):
    return False


def _no_keys(monkeypatch):
    async def _ok(session):
        return True

    monkeypatch.setattr(qa, "_any_provider_key", _ok)


def _llm_says(payload: str):
    async def _call(messages):
        return payload

    return _call


async def _contact(session, email="john@x.com", name="John Appleseed"):
    session.add(Contact(email=email, display_name=name, event_count=5))
    await session.flush()


_LLM_JSON = (
    '```json\n{"title": "Lunch", "start": "2026-09-16T12:00:00-04:00", '
    '"end": "2026-09-16T12:30:00-04:00", "all_day": false, '
    '"location": "Cafe", "description": null, "attendees": [{"name": "John"}]}\n```'
)


async def test_parse_resolves_known_attendee(session, monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setattr(qa, "_call_litellm", _llm_says(_LLM_JSON))
    user = await _user(session)
    await _contact(session)

    draft = await qa.quick_add_parse(
        QuickAddParseRequest(text="Lunch with John tomorrow at noon"),
        user=user, session=session, client_timezone="America/New_York")

    assert draft.title == "Lunch"
    assert draft.start == datetime.fromisoformat("2026-09-16T12:00:00-04:00")
    assert draft.location == "Cafe"
    assert len(draft.attendees) == 1
    assert draft.attendees[0].email == "john@x.com"


async def test_parse_unknown_attendee_kept_unresolved(session, monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setattr(qa, "_call_litellm", _llm_says(_LLM_JSON))
    user = await _user(session)

    draft = await qa.quick_add_parse(
        QuickAddParseRequest(text="Lunch with John tomorrow"), user=user,
        session=session, client_timezone="America/New_York")
    assert draft.attendees[0].name == "John"
    assert draft.attendees[0].email is None


async def test_parse_rejects_empty_and_garbage(session, monkeypatch):
    from fastapi import HTTPException

    _no_keys(monkeypatch)
    user = await _user(session)
    try:
        await qa.quick_add_parse(QuickAddParseRequest(text="  "), user=user,
                                 session=session, client_timezone="UTC")
        raise AssertionError("expected 422")
    except HTTPException as exc:
        assert exc.status_code == 422

    monkeypatch.setattr(qa, "_call_litellm", _llm_says("sorry, no idea"))
    try:
        await qa.quick_add_parse(QuickAddParseRequest(text="blah"), user=user,
                                 session=session, client_timezone="UTC")
        raise AssertionError("expected 502")
    except HTTPException as exc:
        assert exc.status_code == 502


async def test_parse_needs_ai_key(session, monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setattr(qa, "_any_provider_key", _deny)
    user = await _user(session)
    try:
        await qa.quick_add_parse(QuickAddParseRequest(text="Lunch tomorrow"), user=user,
                                 session=session, client_timezone="UTC")
        raise AssertionError("expected 502")
    except HTTPException as exc:
        assert exc.status_code == 502


async def test_create_commits_with_attendees(session):
    from chronarch_core.models.event import UnifiedEvent
    from sqlalchemy import select

    user = await _user(session)
    calendar = await _writable_calendar(session, user)
    await _contact(session)

    event = await qa.quick_add_create(
        QuickAddCreateRequest(calendar_id=calendar.id, draft=QuickAddDraft(
            title="Lunch", start=datetime(2026, 9, 16, 16, 0, tzinfo=timezone.utc),
            end=datetime(2026, 9, 16, 16, 30, tzinfo=timezone.utc),
            attendees=[{"name": "John Appleseed", "email": "john@x.com"}])),
        user=user, session=session, client_timezone="America/New_York")

    stored = (await session.execute(
        select(UnifiedEvent).where(UnifiedEvent.id == event.id))).scalar_one()
    assert stored.title == "Lunch"
    assert stored.attendees == [{"email": "john@x.com", "name": "John Appleseed"}]


async def test_create_rejects_unresolved_and_forbidden(session):
    from fastapi import HTTPException

    user = await _user(session)
    calendar = await _writable_calendar(session, user)

    try:
        await qa.quick_add_create(
            QuickAddCreateRequest(calendar_id=calendar.id, draft=QuickAddDraft(
                title="Lunch", start=datetime(2026, 9, 16, 16, 0, tzinfo=timezone.utc),
                end=datetime(2026, 9, 16, 16, 30, tzinfo=timezone.utc),
                attendees=[{"name": "Stranger"}])),
            user=user, session=session, client_timezone="UTC")
        raise AssertionError("expected 422")
    except HTTPException as exc:
        assert exc.status_code == 422 and "Stranger" in str(exc.detail)

    outsider = await _user(session, role=UserRole.DELEGATE, email="outsider@x.com")
    try:
        await qa.quick_add_create(
            QuickAddCreateRequest(calendar_id=calendar.id, draft=QuickAddDraft(
                title="Sneaky", start=datetime(2026, 9, 16, 16, 0, tzinfo=timezone.utc),
                end=datetime(2026, 9, 16, 16, 30, tzinfo=timezone.utc))),
            user=outsider, session=session, client_timezone="UTC")
        raise AssertionError("expected 403")
    except HTTPException as exc:
        assert exc.status_code == 403


async def test_extract_json_object():
    assert qa._parse_json_object('{"a": 1}') == {"a": 1}
    assert qa._parse_json_object('Here you go:\n```json\n{"a": 1}\n```') == {"a": 1}
    assert qa._parse_json_object("no json here") is None
    assert qa._parse_json_object("[1, 2]") is None
