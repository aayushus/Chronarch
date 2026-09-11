"""Tests for chronarch_core.permissions.engine against BRD worked examples.

§3: "Source permits WRITE, Executive permits EA READ ONLY -> EA = READ ONLY"
§38: read-only corporate event blocks availability but can't be moved by EA;
     writable Company#2 event can be dragged by EA.
"""

from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ActorType, UserRole
from chronarch_core.models.delegation import DelegationCalendarGrant
from chronarch_core.permissions import AuthContext, CalendarAction, resolve_permission


def _calendar(**overrides) -> Calendar:
    defaults = dict(
        id="cal-1",
        account_id="acct-1",
        provider_calendar_id="prov-1",
        name="Company #2",
        provider_writable=True,
        visible=True,
        blocks_availability=True,
        ea_can_view=True,
        ea_can_edit=True,
        ai_can_read=False,
        ai_can_write=False,
        privacy_mask=False,
    )
    defaults.update(overrides)
    return Calendar(**defaults)


def _ea_ctx() -> AuthContext:
    return AuthContext(user_id="ea-1", role=UserRole.ASSISTANT, actor_type=ActorType.EA_UI)


def _full_grant() -> DelegationCalendarGrant:
    return DelegationCalendarGrant(
        id="grant-1",
        delegation_id="del-1",
        calendar_id="cal-1",
        can_view_availability=True,
        can_view_titles=True,
        can_view_full_details=True,
        can_create=True,
        can_edit=True,
        can_reschedule=True,
        can_delete=False,
        can_manage_attendees=True,
        can_respond_to_invitations=True,
        can_import_ics=True,
        can_move_between_calendars=True,
    )


def test_brd_section3_source_write_calendar_ea_readonly_yields_readonly():
    """Source permits WRITE, calendar admin only grants EA read -> EA = READ ONLY."""
    calendar = _calendar(provider_writable=True, ea_can_view=True, ea_can_edit=False)
    ctx = _ea_ctx()
    grant = _full_grant()

    read_decision = resolve_permission(ctx, calendar, CalendarAction.VIEW_FULL_DETAILS, delegation_grant=grant)
    write_decision = resolve_permission(ctx, calendar, CalendarAction.EDIT, delegation_grant=grant)

    assert read_decision.allowed is True
    assert write_decision.allowed is False
    assert write_decision.reason == "calendar_authority_denies"


def test_brd_section38_readonly_corporate_event_blocks_availability_but_not_movable():
    """A read-only corporate meeting still blocks availability but EA can't move it."""
    corporate_calendar = _calendar(
        id="cal-corp",
        name="Corporate",
        provider_writable=False,  # source itself is read-only
        blocks_availability=True,
        ea_can_view=True,
        ea_can_edit=True,  # even if admin grants edit, source still wins
    )
    ctx = _ea_ctx()
    grant = _full_grant()

    availability_decision = resolve_permission(
        ctx, corporate_calendar, CalendarAction.VIEW_AVAILABILITY, delegation_grant=grant
    )
    reschedule_decision = resolve_permission(
        ctx, corporate_calendar, CalendarAction.RESCHEDULE, delegation_grant=grant
    )

    assert availability_decision.allowed is True
    assert reschedule_decision.allowed is False
    assert reschedule_decision.reason == "source_calendar_does_not_permit"


def test_brd_section38_writable_company2_event_can_be_dragged_by_ea():
    calendar = _calendar()  # writable, ea_can_edit True
    ctx = _ea_ctx()
    grant = _full_grant()

    decision = resolve_permission(ctx, calendar, CalendarAction.RESCHEDULE, delegation_grant=grant)

    assert decision.allowed is True


def test_ea_without_delegation_grant_is_denied():
    calendar = _calendar()
    ctx = _ea_ctx()

    decision = resolve_permission(ctx, calendar, CalendarAction.EDIT, delegation_grant=None)

    assert decision.allowed is False
    assert decision.reason == "user_authority_denies"


def test_executive_owner_has_full_access_regardless_of_ea_settings():
    calendar = _calendar(ea_can_view=False, ea_can_edit=False)
    owner_ctx = AuthContext(user_id="exec-1", role=UserRole.EXECUTIVE, actor_type=ActorType.EXECUTIVE_UI)

    decision = resolve_permission(owner_ctx, calendar, CalendarAction.DELETE, is_owner=True)

    assert decision.allowed is True


def test_mcp_client_without_write_scope_cannot_create_event():
    calendar = _calendar(ai_can_read=True, ai_can_write=True)
    ctx = AuthContext(
        user_id="exec-1",
        role=UserRole.EXECUTIVE,
        actor_type=ActorType.MCP,
        scopes=frozenset({"calendar.read", "availability.read"}),
    )

    decision = resolve_permission(ctx, calendar, CalendarAction.CREATE)

    assert decision.allowed is False
    assert decision.reason == "user_authority_denies"


def test_mcp_client_denied_when_calendar_not_ai_readable():
    calendar = _calendar(ai_can_read=False, ai_can_write=False)
    ctx = AuthContext(
        user_id="exec-1",
        role=UserRole.EXECUTIVE,
        actor_type=ActorType.MCP,
        scopes=frozenset({"calendar.read", "calendar.write", "availability.read"}),
    )

    decision = resolve_permission(ctx, calendar, CalendarAction.VIEW_FULL_DETAILS)

    assert decision.allowed is False
    assert decision.reason == "calendar_authority_denies"
