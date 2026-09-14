"""The permission engine (BRD §3): the single place that decides what an
actor may do with a calendar/event.

`effective_permission = min(source_authority, calendar_authority, user_authority)`

- source_authority: what the *provider* allows (Calendar.provider_writable,
  plus any per-event override in UnifiedEvent.source_permissions).
- calendar_authority: what the calendar's admin settings grant to this class
  of actor (owner / EA / AI), from Calendar.ea_can_*/ai_can_*/privacy_mask.
- user_authority: what this specific user/credential is granted — full for
  the owning executive or an admin, the assistant's DelegationCalendarGrant
  for an EA, and the credential's declared scopes for MCP/copilot callers.

Every mutating or detail-revealing code path (REST API, MCP tools, copilot
tool layer, ICS import) must call `resolve_permission` before acting and
before returning event details — never re-derive access some other way.
"""

from __future__ import annotations

from typing import Optional

from ..models.calendar import Calendar
from ..models.delegation import DelegationCalendarGrant
from ..models.enums import ActorType, PermissionLevel, UserRole, EventVisibility
from ..models.event import UnifiedEvent
from .actions import CalendarAction, ACTION_REQUIRED_LEVEL
from .context import AuthContext, PermissionDecision

# Maps a delegation grant's per-action boolean flags to CalendarAction.
_GRANT_FIELD_FOR_ACTION: dict[CalendarAction, str] = {
    CalendarAction.VIEW_AVAILABILITY: "can_view_availability",
    CalendarAction.VIEW_TITLE: "can_view_titles",
    CalendarAction.VIEW_FULL_DETAILS: "can_view_full_details",
    CalendarAction.CREATE: "can_create",
    CalendarAction.EDIT: "can_edit",
    CalendarAction.RESCHEDULE: "can_reschedule",
    CalendarAction.DELETE: "can_delete",
    CalendarAction.MANAGE_ATTENDEES: "can_manage_attendees",
    CalendarAction.RESPOND_TO_INVITATION: "can_respond_to_invitations",
    CalendarAction.IMPORT_ICS: "can_import_ics",
    CalendarAction.MOVE_BETWEEN_CALENDARS: "can_move_between_calendars",
}

# MCP/copilot scope required for actions in each rough category.
_SCOPE_FOR_ACTION: dict[CalendarAction, str] = {
    CalendarAction.VIEW_AVAILABILITY: "availability.read",
    CalendarAction.VIEW_TITLE: "calendar.read",
    CalendarAction.VIEW_FULL_DETAILS: "calendar.read",
    CalendarAction.CREATE: "calendar.write",
    CalendarAction.EDIT: "calendar.write",
    CalendarAction.RESCHEDULE: "calendar.write",
    CalendarAction.MANAGE_ATTENDEES: "calendar.write",
    CalendarAction.RESPOND_TO_INVITATION: "calendar.write",
    CalendarAction.IMPORT_ICS: "calendar.write",
    CalendarAction.MOVE_BETWEEN_CALENDARS: "calendar.write",
    CalendarAction.DELETE: "calendar.delete",
}


def _source_level(calendar: Calendar, event: Optional[UnifiedEvent]) -> PermissionLevel:
    if event is not None and event.source_permissions.get("write") is False:
        return PermissionLevel.READ_FULL
    if calendar.provider_writable:
        return PermissionLevel.DELETE
    return PermissionLevel.READ_FULL


def _calendar_level(calendar: Calendar, ctx: AuthContext, is_owner: bool) -> PermissionLevel:
    if is_owner or ctx.is_admin:
        return PermissionLevel.DELETE

    if ctx.actor_type in (ActorType.MCP, ActorType.COPILOT):
        if not calendar.ai_can_read:
            return PermissionLevel.NONE
        if calendar.privacy_mask:
            return PermissionLevel.FREE_BUSY
        return PermissionLevel.DELETE if calendar.ai_can_write else PermissionLevel.READ_FULL

    # Delegate UI / API acting as a grantee.
    if not calendar.ea_can_view:
        return PermissionLevel.NONE if not calendar.blocks_availability else PermissionLevel.FREE_BUSY
    if calendar.privacy_mask:
        return PermissionLevel.FREE_BUSY
    return PermissionLevel.DELETE if calendar.ea_can_edit else PermissionLevel.READ_FULL


def _user_level(
    ctx: AuthContext,
    action: CalendarAction,
    is_owner: bool,
    grant: Optional[DelegationCalendarGrant],
) -> PermissionLevel:
    if is_owner or ctx.is_admin:
        return PermissionLevel.DELETE

    required_scope = _SCOPE_FOR_ACTION[action]
    if not ctx.has_scope(required_scope):
        return PermissionLevel.NONE

    if ctx.actor_type in (ActorType.MCP, ActorType.COPILOT):
        # Scope check above is the user-authority gate for AI actors; a
        # matching scope grants up to the level the action requires.
        return ACTION_REQUIRED_LEVEL[action]

    if ctx.role == UserRole.DELEGATE:
        if grant is None:
            return PermissionLevel.NONE
        field = _GRANT_FIELD_FOR_ACTION[action]
        return ACTION_REQUIRED_LEVEL[action] if getattr(grant, field) else PermissionLevel.NONE

    if ctx.role == UserRole.ADMIN:
        # Non-owner, non-bypassed admin (only reachable when is_admin is
        # False, i.e. misconstructed contexts in tests). Deny-by-default:
        # Delegation rows only cover owner -> delegate, so there is no
        # grant table to consult for admin -> admin yet. Phase 2 (BRD §32:
        # multiple owners) needs a grant lookup here before denying; until
        # then this explicit deny (rather than a fall-through) keeps the
        # failure reason auditable as user_authority_denies.
        return PermissionLevel.NONE

    return PermissionLevel.NONE


def _event_privacy_cap(event: Optional[UnifiedEvent], is_owner: bool) -> PermissionLevel:
    """A Private event (BRD §15) caps non-owner visibility at free/busy."""
    if event is not None and event.visibility == EventVisibility.PRIVATE and not is_owner:
        return PermissionLevel.FREE_BUSY
    return PermissionLevel.DELETE  # no cap


_DENIAL_VERBS: dict[CalendarAction, str] = {
    CalendarAction.VIEW_AVAILABILITY: "see availability for",
    CalendarAction.VIEW_TITLE: "see event titles on",
    CalendarAction.VIEW_FULL_DETAILS: "see full details on",
    CalendarAction.CREATE: "create events on",
    CalendarAction.EDIT: "edit events on",
    CalendarAction.RESCHEDULE: "reschedule events on",
    CalendarAction.DELETE: "delete events on",
    CalendarAction.MANAGE_ATTENDEES: "manage attendees on",
    CalendarAction.RESPOND_TO_INVITATION: "respond to invitations on",
    CalendarAction.IMPORT_ICS: "import events into",
    CalendarAction.MOVE_BETWEEN_CALENDARS: "move events between calendars involving",
}


def describe_denial(action: CalendarAction, reason: str) -> str:
    """Human-readable denial for API/MCP/copilot surfaces.

    The engine's machine reasons (`user_authority_denies`, …) are for audit
    logs, not users — this renders the two cases a user can act on:
    read-only at the provider vs. not granted to them.
    """
    verb = _DENIAL_VERBS.get(action, "change events on")
    if reason == "source_calendar_does_not_permit":
        return f"This calendar is read-only at the provider, so it can't be changed here."
    return f"You don't have permission to {verb} this calendar."


def resolve_permission(
    ctx: AuthContext,
    calendar: Calendar,
    action: CalendarAction,
    *,
    event: Optional[UnifiedEvent] = None,
    is_owner: bool = False,
    delegation_grant: Optional[DelegationCalendarGrant] = None,
) -> PermissionDecision:
    source = _source_level(calendar, event)
    cal_level = min(_calendar_level(calendar, ctx, is_owner), _event_privacy_cap(event, is_owner))
    user_level = _user_level(ctx, action, is_owner, delegation_grant)

    effective = min(source, cal_level, user_level)
    required = ACTION_REQUIRED_LEVEL[action]
    allowed = effective >= required

    if allowed:
        reason = "granted"
    elif source < required:
        reason = "source_calendar_does_not_permit"
    elif cal_level < required:
        reason = "calendar_authority_denies"
    else:
        reason = "user_authority_denies"

    return PermissionDecision(
        allowed=allowed,
        reason=reason,
        source_level=int(source),
        calendar_level=int(cal_level),
        user_level=int(user_level),
    )
