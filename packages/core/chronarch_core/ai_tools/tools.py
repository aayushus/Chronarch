"""The internal tool layer (BRD §37, §20.1): plain async functions that
implement each scheduling capability once. Both the MCP server
(apps/mcp) and the built-in copilot's tool-calling loop import and call
these directly — neither re-implements scheduling logic, and both are
subject to exactly the same `resolve_permission` checks and audit writes
as the human UI's REST endpoints.

Every function's first argument is an AuthContext built by the caller
(MCP request auth, copilot session auth, or the REST layer) — there is no
other way to reach the database from here.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import write_audit_entry
from ..availability import find_conflicts as _find_conflicts, find_free_slots as _find_free_slots
from ..models.calendar import Calendar
from ..models.enums import AuditAction
from ..models.event import UnifiedEvent
from ..permissions import AuthContext, CalendarAction, resolve_permission


class PermissionDenied(Exception):
    def __init__(self, action: CalendarAction, reason: str):
        super().__init__(f"{action.value} denied: {reason}")
        self.action = action
        self.reason = reason


async def _get_calendar(session: AsyncSession, calendar_id: str) -> Calendar:
    calendar = await session.get(Calendar, calendar_id)
    if calendar is None:
        raise ValueError(f"calendar {calendar_id} not found")
    return calendar


async def _readable_calendars(
    session: AsyncSession, ctx: AuthContext, calendar_ids: list[str] | None
) -> list[Calendar]:
    stmt = select(Calendar)
    if calendar_ids:
        stmt = stmt.where(Calendar.id.in_(calendar_ids))
    calendars = list((await session.execute(stmt)).scalars())

    readable = []
    for cal in calendars:
        decision = resolve_permission(ctx, cal, CalendarAction.VIEW_AVAILABILITY)
        if decision.allowed:
            readable.append(cal)
    return readable


async def list_calendars(session: AsyncSession, ctx: AuthContext) -> list[Calendar]:
    all_calendars = list((await session.execute(select(Calendar))).scalars())
    return [c for c in all_calendars if resolve_permission(ctx, c, CalendarAction.VIEW_AVAILABILITY).allowed]


async def get_events(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    window_start: datetime,
    window_end: datetime,
    calendar_ids: list[str] | None = None,
) -> list[UnifiedEvent]:
    calendars = await _readable_calendars(session, ctx, calendar_ids)
    cal_by_id = {c.id: c for c in calendars}
    if not cal_by_id:
        return []

    stmt = select(UnifiedEvent).where(
        UnifiedEvent.calendar_id.in_(cal_by_id.keys()),
        UnifiedEvent.start < window_end,
        UnifiedEvent.end > window_start,
    )
    events = list((await session.execute(stmt)).scalars())

    # Privacy masking (BRD §15): a viewer without VIEW_TITLE only gets the
    # free/busy block, never the row itself — masking happens at the API
    # serialization layer (apps/api), which redacts title/description for
    # any event where VIEW_TITLE is denied but VIEW_AVAILABILITY is allowed.
    visible = []
    for event in events:
        cal = cal_by_id[event.calendar_id]
        decision = resolve_permission(ctx, cal, CalendarAction.VIEW_TITLE, event=event)
        if decision.allowed:
            visible.append(event)
    return visible


async def get_availability(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    window_start: datetime,
    window_end: datetime,
    calendar_ids: list[str] | None = None,
) -> list[dict]:
    calendars = await _readable_calendars(session, ctx, calendar_ids)
    blocking_ids = {c.id for c in calendars if c.blocks_availability}
    if not blocking_ids:
        return []

    stmt = select(UnifiedEvent).where(
        UnifiedEvent.calendar_id.in_(blocking_ids),
        UnifiedEvent.start < window_end,
        UnifiedEvent.end > window_start,
    )
    events = list((await session.execute(stmt)).scalars())
    conflicts = _find_conflicts(window_start, window_end, events, blocking_ids)
    return [{"start": c.start, "end": c.end} for c in conflicts]


async def find_free_slots(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    window_start: datetime,
    window_end: datetime,
    duration: timedelta,
    calendar_ids: list[str] | None = None,
    working_hours: tuple[int, int] | None = None,
    buffer: timedelta = timedelta(0),
    now: datetime | None = None,
) -> list[dict]:
    calendars = await _readable_calendars(session, ctx, calendar_ids)
    blocking_ids = {c.id for c in calendars if c.blocks_availability}

    stmt = select(UnifiedEvent).where(
        UnifiedEvent.calendar_id.in_(blocking_ids),
        UnifiedEvent.start < window_end,
        UnifiedEvent.end > window_start,
    )
    events = list((await session.execute(stmt)).scalars()) if blocking_ids else []

    slots = _find_free_slots(
        window_start,
        window_end,
        duration,
        events,
        blocking_ids,
        working_hours=working_hours,
        buffer=buffer,
        now=now,
    )
    return [{"start": s.start, "end": s.end} for s in slots]


async def create_event(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    calendar_id: str,
    title: str,
    start: datetime,
    end: datetime,
    timezone: str = "UTC",
    description: str | None = None,
    location: str | None = None,
    attendees: list[dict] | None = None,
    is_owner: bool = False,
    delegation_grant=None,
) -> UnifiedEvent:
    calendar = await _get_calendar(session, calendar_id)
    decision = resolve_permission(
        ctx, calendar, CalendarAction.CREATE, is_owner=is_owner, delegation_grant=delegation_grant
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.CREATE, decision.reason)

    event = UnifiedEvent(
        provider_account_id=calendar.account_id,
        calendar_id=calendar.id,
        provider_event_id="",  # filled in once the connector confirms creation upstream
        title=title,
        description=description,
        start=start,
        end=end,
        timezone=timezone,
        location=location,
        attendees=attendees or [],
    )
    session.add(event)
    await session.flush()

    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.CREATE_EVENT,
        calendar_id=calendar.id,
        event_id=event.id,
        detail={"title": title, "start": start.isoformat(), "end": end.isoformat()},
    )
    return event


async def move_event(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    new_start: datetime,
    new_end: datetime,
    is_owner: bool = False,
    delegation_grant=None,
) -> UnifiedEvent:
    event = await session.get(UnifiedEvent, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")
    calendar = await _get_calendar(session, event.calendar_id)

    decision = resolve_permission(
        ctx,
        calendar,
        CalendarAction.RESCHEDULE,
        event=event,
        is_owner=is_owner,
        delegation_grant=delegation_grant,
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.RESCHEDULE, decision.reason)

    old_start, old_end = event.start, event.end
    event.start, event.end = new_start, new_end
    await session.flush()

    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.RESCHEDULE_EVENT,
        calendar_id=calendar.id,
        event_id=event.id,
        detail={
            "from_start": old_start.isoformat(),
            "from_end": old_end.isoformat(),
            "to_start": new_start.isoformat(),
            "to_end": new_end.isoformat(),
        },
    )
    return event


async def delete_event(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    is_owner: bool = False,
    delegation_grant=None,
) -> None:
    event = await session.get(UnifiedEvent, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")
    calendar = await _get_calendar(session, event.calendar_id)

    decision = resolve_permission(
        ctx, calendar, CalendarAction.DELETE, event=event, is_owner=is_owner, delegation_grant=delegation_grant
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.DELETE, decision.reason)

    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.DELETE_EVENT,
        calendar_id=calendar.id,
        event_id=event.id,
        detail={"title": event.title},
    )
    await session.delete(event)
    await session.flush()
