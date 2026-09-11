"""Regression tests for the review's "smaller correctness notes".

Covers: end>start validation, DST-safe working hours, non-owner executive
deny, and MCP owner-gating — all at the core-engine level (the same layer
the REST API and MCP server both call).
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from chronarch_core import ai_tools
from chronarch_core.availability import find_free_slots
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import (
    ActorType,
    ProviderType,
    UserRole,
)
from chronarch_core.models.user import User
from chronarch_core.permissions import (
    AuthContext,
    CalendarAction,
    resolve_permission,
)


async def _seed_owner_calendar(session):
    owner = User(
        id="exec-1", email="exec@co.com", display_name="Exec",
        password_hash="x", role=UserRole.EXECUTIVE,
    )
    account = Account(
        id="acct-1", owner_user_id="exec-1", provider=ProviderType.GOOGLE,
        provider_account_email="exec@co.com", provider_account_id="g-1",
    )
    calendar = Calendar(
        id="cal-1", account_id="acct-1", provider_calendar_id="p-1",
        name="Work", provider_writable=True, blocks_availability=True,
    )
    session.add_all([owner, account, calendar])
    await session.flush()
    return owner, calendar


def _owner_ctx(user_id="exec-1"):
    return AuthContext(user_id=user_id, role=UserRole.EXECUTIVE, actor_type=ActorType.EXECUTIVE_UI)


# --- end > start validation -------------------------------------------------


async def test_create_event_rejects_end_before_start(session):
    owner, calendar = await _seed_owner_calendar(session)
    start = datetime(2026, 9, 17, 11, 0, tzinfo=timezone.utc)
    end = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    with pytest.raises(ValueError, match="must be after start"):
        await ai_tools.create_event(
            session, _owner_ctx(), calendar_id=calendar.id,
            title="Inverted", start=start, end=end, is_owner=True,
        )


async def test_create_event_rejects_zero_length(session):
    owner, calendar = await _seed_owner_calendar(session)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)

    with pytest.raises(ValueError, match="must be after start"):
        await ai_tools.create_event(
            session, _owner_ctx(), calendar_id=calendar.id,
            title="Zero", start=start, end=start, is_owner=True,
        )


async def test_move_event_rejects_inverted_window(session):
    owner, calendar = await _seed_owner_calendar(session)
    start = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    event = await ai_tools.create_event(
        session, _owner_ctx(), calendar_id=calendar.id,
        title="Ok", start=start, end=start + timedelta(hours=1), is_owner=True,
    )

    with pytest.raises(ValueError, match="must be after start"):
        await ai_tools.move_event(
            session, _owner_ctx(), event_id=event.id,
            new_start=start + timedelta(hours=2), new_end=start + timedelta(hours=1),
            is_owner=True,
        )


async def test_validation_fires_before_permission_check(session):
    """Bad windows raise ValueError even for callers who would also be
    denied — invalid input is not a permission question."""
    _owner, calendar = await _seed_owner_calendar(session)
    ea_ctx = AuthContext(user_id="ea-1", role=UserRole.ASSISTANT, actor_type=ActorType.EA_UI)
    start = datetime(2026, 9, 17, 11, 0, tzinfo=timezone.utc)

    with pytest.raises(ValueError, match="must be after start"):
        await ai_tools.create_event(
            session, ea_ctx, calendar_id=calendar.id,
            title="Bad", start=start, end=start - timedelta(hours=1),
        )


# --- working-hours validation + DST ------------------------------------------


def test_working_hours_rejects_inverted_range():
    gap_start = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
    gap_end = datetime(2026, 9, 16, 0, 0, tzinfo=timezone.utc)

    with pytest.raises(ValueError, match="working_hours"):
        find_free_slots(gap_start, gap_end, timedelta(minutes=30), [], {"c"},
                        working_hours=(17, 9))
    with pytest.raises(ValueError, match="working_hours"):
        find_free_slots(gap_start, gap_end, timedelta(minutes=30), [], {"c"},
                        working_hours=(9, 9))


def test_working_hours_spring_forward_wall_clock():
    """US DST starts 2026-03-08 02:00 -> 03:00 America/New_York (23-hour day).

    Pins the wall-clock contract: 9am on the transition day is EDT (UTC-4).
    The implementation must iterate calendar dates (DST-safe), not 24h steps
    or offset-preserving arithmetic, which drift across 23/25-hour days.
    """
    ny = ZoneInfo("America/New_York")
    gap_start = datetime(2026, 3, 8, 0, 0, tzinfo=ny)  # midnight EST
    gap_end = datetime(2026, 3, 9, 0, 0, tzinfo=ny)  # midnight EDT

    slots = find_free_slots(
        gap_start, gap_end, timedelta(minutes=60), [], {"c"},
        working_hours=(9, 17),
    )

    assert slots, "expected a 9am slot on the transition day"
    expected = datetime(2026, 3, 8, 9, 0, tzinfo=ny)
    assert expected.utcoffset() == timedelta(hours=-4)  # sanity: 9am is EDT
    assert slots[0].start == expected


def test_working_hours_full_day_end_at_24():
    """end_hour=24 means midnight; the old `.replace(hour=24)` impl crashed
    with `hour must be in 0..23`."""
    gap_start = datetime(2026, 9, 15, 9, 0, tzinfo=timezone.utc)
    gap_end = datetime(2026, 9, 15, 17, 0, tzinfo=timezone.utc)

    slots = find_free_slots(
        gap_start, gap_end, timedelta(minutes=60), [], {"c"},
        working_hours=(0, 24),
    )

    assert len(slots) == 1
    assert slots[0].start == gap_start


def test_working_hours_yields_one_slot_per_day_across_dst():
    ny = ZoneInfo("America/New_York")
    gap_start = datetime(2026, 3, 7, 0, 0, tzinfo=ny)
    gap_end = datetime(2026, 3, 10, 0, 0, tzinfo=ny)

    slots = find_free_slots(
        gap_start, gap_end, timedelta(minutes=60), [], {"c"},
        working_hours=(9, 17), max_results=10,
    )

    assert [s.start.date().isoformat() for s in slots] == ["2026-03-07", "2026-03-08", "2026-03-09"]
    assert all(s.start.hour == 9 and s.start.minute == 0 for s in slots)


# --- non-owner executive + MCP owner-gating -----------------------------------


def _calendar(**overrides):
    defaults = dict(
        id="cal-1", account_id="acct-1", provider_calendar_id="p-1", name="Work",
        provider_writable=True, blocks_availability=True,
    )
    defaults.update(overrides)
    return Calendar(**defaults)


def test_non_owner_executive_is_denied_explicitly():
    """Executive B touching executive A's calendar: deny-by-default until
    Phase 2 adds executive-to-executive grants (BRD §32).

    ea_can_* are set permissive so the denial lands in user_authority (the
    explicit EXECUTIVE branch), isolating it from calendar_authority.
    """
    calendar = _calendar(ea_can_view=True, ea_can_edit=True)
    ctx = AuthContext(user_id="exec-b", role=UserRole.EXECUTIVE, actor_type=ActorType.EXECUTIVE_UI)

    decision = resolve_permission(ctx, calendar, CalendarAction.CREATE, is_owner=False)

    assert decision.allowed is False
    assert decision.reason == "user_authority_denies"


def test_mcp_owner_credential_still_gated_by_ai_flags():
    """Even the calendar owner's own MCP credential gets no owner bypass:
    ai_can_read=False denies with calendar_authority_denies despite full
    scopes. Deny-by-default is intentional (see apps/mcp/app/auth.py)."""
    calendar = _calendar(ai_can_read=False, ai_can_write=False)
    ctx = AuthContext(
        user_id="exec-1", role=UserRole.EXECUTIVE, actor_type=ActorType.MCP,
        scopes=frozenset({"calendar.read", "calendar.write", "calendar.delete", "availability.read"}),
    )

    decision = resolve_permission(ctx, calendar, CalendarAction.VIEW_FULL_DETAILS, is_owner=False)

    assert decision.allowed is False
    assert decision.reason == "calendar_authority_denies"


def test_mcp_write_scope_without_ai_write_flag_is_denied():
    calendar = _calendar(ai_can_read=True, ai_can_write=False)
    ctx = AuthContext(
        user_id="exec-1", role=UserRole.EXECUTIVE, actor_type=ActorType.MCP,
        scopes=frozenset({"calendar.read", "calendar.write", "availability.read"}),
    )

    decision = resolve_permission(ctx, calendar, CalendarAction.CREATE, is_owner=False)

    assert decision.allowed is False
    assert decision.reason == "calendar_authority_denies"
