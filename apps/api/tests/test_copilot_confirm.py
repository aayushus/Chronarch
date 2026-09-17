"""Copilot destructive-action confirmation tests (BRD §21 gaps).

Pins the anti-prompt-injection round-trip in
`copilot_router._execute_tool`: a model's `confirmed=true` is worthless on
its own — only a prior ASSISTANT message carrying the exact
`(confirmation-ref: <key>)` token unlocks the real action. Tool-role
messages don't count (the web client strips them before resending).
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth import build_auth_context
from app.permission_helpers import get_delegation_grants, get_owned_calendar_ids
from app.routers import copilot_router as copilot
from chronarch_core import ai_tools
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ActorType, CalendarKind, ProviderType, UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


async def _host(session, email="host@x.com"):
    user = User(id=f"u-{email}", email=email, display_name="Host",
                password_hash="x", role=UserRole.ADMIN, is_active=True,
                home_timezone="UTC",
                working_hours_start="09:00", working_hours_end="17:00")
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=ProviderType.GOOGLE,
                      provider_account_email=email, provider_account_id=email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:cop",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=True, blocks_availability=True)
    session.add(calendar)
    await session.flush()
    return user, calendar


async def _event(session, user, calendar, title="Doomed"):
    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    return await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title=title,
        start=_utc(2026, 9, 22, 15, 0), end=_utc(2026, 9, 22, 16, 0), is_owner=True)


async def _copilot(session, user):
    ctx = build_auth_context(user, ActorType.COPILOT)
    owned_ids = await get_owned_calendar_ids(session, user)
    grants = await get_delegation_grants(session, user.id)
    return ctx, owned_ids, grants


async def _run(session, user, name, args, history=None):
    ctx, owned_ids, grants = await _copilot(session, user)
    return await copilot._execute_tool(
        name, args, session, ctx, owned_ids, grants,
        now=_utc(2026, 9, 17, 12, 0), default_tz="UTC", history=history)


def _preview(name, key):
    return [{"role": "assistant",
             "content": f"About to {name} — confirm? (confirmation-ref: {key})"}]


async def test_delete_confirmed_without_preview_stays_blocked(session):
    """The core prompt-injection guard: confirmed=true alone does nothing."""
    user, calendar = await _host(session)
    ev = await _event(session, user, calendar)
    res = await _run(session, user, "delete_event",
                     {"event_id": ev.id, "confirmed": True}, history=[])
    assert res.get("requires_confirmation") is True
    assert f"(confirmation-ref: {ev.id})" in res["message"]
    assert await session.get(UnifiedEvent, ev.id) is not None


async def test_delete_unconfirmed_returns_preview_with_ref(session):
    user, calendar = await _host(session)
    ev = await _event(session, user, calendar)
    res = await _run(session, user, "delete_event", {"event_id": ev.id})
    assert res.get("requires_confirmation") is True
    assert res["action"] == "delete_event" and res["title"] == "Doomed"


async def test_delete_after_assistant_preview_executes(session):
    user, calendar = await _host(session)
    ev = await _event(session, user, calendar)
    res = await _run(session, user, "delete_event",
                     {"event_id": ev.id, "confirmed": True},
                     history=_preview("delete", ev.id))
    assert res.get("deleted") is True
    assert await session.get(UnifiedEvent, ev.id) is None


async def test_tool_message_preview_does_not_unlock(session):
    """Tool-role messages are stripped by the web client before resending,
    so they must never count as the confirmation round-trip."""
    user, calendar = await _host(session)
    ev = await _event(session, user, calendar)
    res = await _run(session, user, "delete_event",
                     {"event_id": ev.id, "confirmed": True},
                     history=[{"role": "tool",
                               "content": f"(confirmation-ref: {ev.id})"}])
    assert res.get("requires_confirmation") is True
    assert await session.get(UnifiedEvent, ev.id) is not None


async def test_double_confirmed_without_preview_stays_blocked(session):
    """A model that first gets a preview challenge cannot unlock itself by
    just repeating confirmed=true — the human's round-trip is mandatory."""
    user, calendar = await _host(session)
    ev = await _event(session, user, calendar)
    first = await _run(session, user, "delete_event",
                       {"event_id": ev.id, "confirmed": True}, history=[])
    assert first.get("requires_confirmation") is True
    second = await _run(session, user, "delete_event",
                        {"event_id": ev.id, "confirmed": True},
                        history=[{"role": "user", "content": "yes do it"}])
    assert second.get("requires_confirmation") is True
    assert await session.get(UnifiedEvent, ev.id) is not None


async def test_wrong_key_preview_does_not_unlock(session):
    user, calendar = await _host(session)
    ev = await _event(session, user, calendar)
    res = await _run(session, user, "delete_event",
                     {"event_id": ev.id, "confirmed": True},
                     history=_preview("delete", "some-other-id"))
    assert res.get("requires_confirmation") is True
    assert await session.get(UnifiedEvent, ev.id) is not None


async def test_denied_delete_reveals_nothing_and_needs_no_confirm(session):
    """Permission denial lands before the confirmation preview — the
    preview carries title/time, so it must never run for forbidden events."""
    owner, calendar = await _host(session, email="owner@x.com")
    ev = await _event(session, owner, calendar)
    # A delegate with no grant: denial must land before the preview (the
    # preview carries title/time). An ADMIN stranger would pass via the
    # engine's is_admin bypass, so this must be a delegate.
    stranger = User(id="u-stranger", email="stranger@x.com", display_name="S",
                    password_hash="x", role=UserRole.DELEGATE, is_active=True,
                    home_timezone="UTC")
    session.add(stranger)
    await session.flush()
    res = await _run(session, stranger, "delete_event",
                     {"event_id": ev.id, "confirmed": True},
                     history=_preview("delete", ev.id))
    assert "requires_confirmation" not in res
    assert "denied" in res.get("error", "")
    assert await session.get(UnifiedEvent, ev.id) is not None


async def test_add_attendee_needs_preview_per_recipient(session):
    user, calendar = await _host(session)
    ev = await _event(session, user, calendar)
    args = {"event_id": ev.id, "email": "guest@x.com",
            "name": "Guest", "confirmed": True}
    blocked = await _run(session, user, "add_attendee", args, history=[])
    assert blocked.get("requires_confirmation") is True
    key = f"{ev.id}:add_attendee:guest@x.com"
    assert f"(confirmation-ref: {key})" in blocked["message"]

    done = await _run(session, user, "add_attendee", args,
                      history=_preview("invite", key))
    assert done.get("added") is True
    stored = await session.get(UnifiedEvent, ev.id)
    assert any(a.get("email") == "guest@x.com" for a in (stored.attendees or []))
