"""Tests for browser/client timezone handling (BRD §27).

The server never interprets naive datetimes in its own zone: explicit zones
win, then the caller's home zone, then UTC.
"""

from datetime import datetime, timedelta, timezone

from chronarch_core.timezones import ensure_aware, normalize_timezone, validate_timezone

import pytest


def test_normalize_canonicalizes_and_falls_back():
    assert normalize_timezone("America/Los_Angeles") == "America/Los_Angeles"
    assert normalize_timezone(None) == "UTC"
    assert normalize_timezone("") == "UTC"
    assert normalize_timezone("Not/AZone") == "UTC"


def test_validate_accepts_and_rejects():
    assert validate_timezone("Asia/Kathmandu") == "Asia/Kathmandu"
    with pytest.raises(ValueError):
        validate_timezone("Mars/Olympus")
    with pytest.raises(ValueError):
        validate_timezone("  ")


def test_ensure_aware_attaches_caller_zone():
    naive = datetime(2026, 9, 13, 9, 0)
    aware = ensure_aware(naive, "America/Los_Angeles")
    assert aware.utcoffset() == timedelta(hours=-7)
    assert aware.replace(tzinfo=None) == naive


def test_ensure_aware_passes_through_aware():
    aware = datetime(2026, 9, 13, 9, 0, tzinfo=timezone.utc)
    assert ensure_aware(aware, "America/Los_Angeles") == aware


async def test_create_event_normalizes_timezone_label(session):
    from chronarch_core import ai_tools
    from chronarch_core.models.calendar import Calendar
    from chronarch_core.models.account import Account
    from chronarch_core.models.enums import ActorType, ProviderType, UserRole
    from chronarch_core.models.user import User
    from chronarch_core.permissions import AuthContext

    user = User(id="u-1", email="u@x.com", display_name="U", password_hash="x", role=UserRole.ADMIN)
    account = Account(id="a-1", owner_user_id="u-1", provider=ProviderType.GOOGLE,
                      provider_account_email="u@x.com", provider_account_id="g-1")
    cal = Calendar(id="c-1", account_id="a-1", provider_calendar_id="p-1", name="Work",
                   provider_writable=True, blocks_availability=True)
    session.add_all([user, account, cal])
    await session.flush()

    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    start = datetime(2026, 9, 13, 9, 0, tzinfo=timezone.utc)
    event = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="T", start=start, end=start + timedelta(hours=1),
        timezone="America/Los_Angeles", is_owner=True,
    )
    assert event.timezone == "America/Los_Angeles"

    # Garbage zones normalize to UTC rather than persisting junk.
    event2 = await ai_tools.create_event(
        session, ctx, calendar_id=cal.id, title="T2", start=start, end=start + timedelta(hours=1),
        timezone="Mars/Olympus", is_owner=True,
    )
    assert event2.timezone == "UTC"
