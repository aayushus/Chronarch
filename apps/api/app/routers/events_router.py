from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import ai_tools
from chronarch_core.permissions import CalendarAction, describe_denial, resolve_permission
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User

from ..auth import build_auth_context, get_current_user
from ..deps import get_client_timezone, get_db_session
from ..permission_helpers import (
    get_delegation_grant,
    get_delegation_grants,
    get_owned_calendar_ids,
    is_calendar_owner,
)
from .calendars_router import actor_type_for

router = APIRouter(prefix="/api/v1/events", tags=["events"])


class EventOut(BaseModel):
    id: str
    calendar_id: str
    title: str
    start: datetime
    end: datetime
    all_day: bool
    location: str | None = None
    description: str | None = None
    organizer: dict | None = None
    attendees: list = []
    busy_status: str = "busy"
    timezone: str = "UTC"
    visibility: str = "standard"
    recurrence: dict | None = None
    # Next upcoming occurrence (series only) — drives the scoped-edit UI.
    next_occurrence: datetime | None = None

    model_config = {"from_attributes": True}


def _with_next_occurrence(events: list) -> list:
    """Attach next_occurrence to recurring rows (best-effort, never fails
    a read — expansion of a malformed rule yields nothing)."""
    from datetime import timezone as _tz

    from chronarch_core.recurrence import occurrences as _occurrences

    now = datetime.now(_tz.utc)
    horizon = now + timedelta(days=365)
    for e in events:
        try:
            upcoming = _occurrences(e, now, horizon, limit=1) if e.recurrence else []
            e.next_occurrence = upcoming[0][0] if upcoming else None
        except Exception:
            e.next_occurrence = None
    return events


class EventCreate(BaseModel):
    calendar_id: str
    title: str
    start: datetime
    end: datetime
    # Omitted = the caller's zone (X-Timezone header), never the server zone.
    timezone: str | None = None
    description: str | None = None
    location: str | None = None
    all_day: bool = False
    attendees: list[dict] | None = None
    # Optional normalized recurrence {freq: daily|weekly|monthly|yearly,
    # interval?, count?, until?, byday?} — validated in the ai layer.
    recurrence: dict | None = None

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.end <= self.start:
            raise ValueError("event end must be after start")
        return self


class EventMove(BaseModel):
    start: datetime
    end: datetime
    # Lane conversions (timed <-> all-day) ride along with the move so a
    # drag into/out of the all-day lane is one atomic operation.
    all_day: bool | None = None

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.end <= self.start:
            raise ValueError("event end must be after start")
        return self


class ConflictOut(BaseModel):
    event_id: str
    calendar_id: str
    calendar_name: str
    title: str
    start: datetime
    end: datetime
    all_day: bool = False
    redacted: bool = False


async def _resolve_owner_and_grant(session: AsyncSession, user: User, calendar_id: str):
    from chronarch_core.models.calendar import Calendar

    calendar = await session.get(Calendar, calendar_id)
    if calendar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendar not found")
    is_owner = await is_calendar_owner(session, user, calendar)
    grant = None
    if not is_owner and user.role == UserRole.DELEGATE:
        grant = await get_delegation_grant(session, user.id, calendar_id)
    return is_owner, grant


@router.get("", response_model=list[EventOut])
async def list_events(
    window_start: datetime,
    window_end: datetime,
    calendar_ids: list[str] | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    ctx = build_auth_context(user, actor_type_for(user))
    owner_ids = await get_owned_calendar_ids(session, user)
    grants = (
        await get_delegation_grants(session, user.id)
        if user.role == UserRole.DELEGATE
        else None
    )
    events = await ai_tools.get_events(
        session,
        ctx,
        window_start=window_start,
        window_end=window_end,
        calendar_ids=calendar_ids,
        owner_calendar_ids=owner_ids,
        grants_by_calendar=grants,
    )
    events = _with_next_occurrence(events)
    calendar_ids_for_events = {event.calendar_id for event in events}
    calendars_by_id = {
        calendar.id: calendar
        for calendar in (await session.execute(select(Calendar).where(Calendar.id.in_(calendar_ids_for_events)))).scalars()
    }
    out = []
    for event in events:
        calendar = calendars_by_id[event.calendar_id]
        is_owner = bool(owner_ids and calendar.id in owner_ids)
        grant = grants.get(calendar.id) if grants else None
        serialized = EventOut.model_validate(event).model_dump()
        full_details = resolve_permission(
            ctx, calendar, CalendarAction.VIEW_FULL_DETAILS,
            event=event, is_owner=is_owner, delegation_grant=grant,
        ).allowed
        if not full_details:
            serialized.update({"description": None, "location": None, "organizer": None, "attendees": [], "conference": None})
        out.append(serialized)
    return out


@router.get("/conflicts", response_model=list[ConflictOut])
async def check_conflicts(
    window_start: datetime,
    window_end: datetime,
    exclude_event_id: str | None = None,
    calendar_ids: list[str] | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Pre-commit conflict check for the UI warning flow (BRD §25): which
    blocking events overlap the proposed window. Entries the viewer may not
    title-see come back redacted (title "Busy") but still warn. Pass the
    moved event's id as exclude_event_id so a drag doesn't conflict with
    itself."""
    ctx = build_auth_context(user, actor_type_for(user))
    owner_ids = await get_owned_calendar_ids(session, user)
    grants = (
        await get_delegation_grants(session, user.id)
        if user.role == UserRole.DELEGATE
        else None
    )
    try:
        return await ai_tools.get_conflicts(
            session, ctx,
            window_start=window_start, window_end=window_end,
            exclude_event_id=exclude_event_id, calendar_ids=calendar_ids,
            owner_calendar_ids=owner_ids, grants_by_calendar=grants,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def create_event(
    body: EventCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    client_timezone: str = Depends(get_client_timezone),
):
    is_owner, grant = await _resolve_owner_and_grant(session, user, body.calendar_id)
    ctx = build_auth_context(user, actor_type_for(user))
    try:
        event = await ai_tools.create_event(
            session, ctx, calendar_id=body.calendar_id, title=body.title, start=body.start, end=body.end,
            timezone=body.timezone or client_timezone, description=body.description, location=body.location,
            all_day=body.all_day, attendees=body.attendees, recurrence=body.recurrence,
            is_owner=is_owner, delegation_grant=grant,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return event


@router.patch("/{event_id}/move", response_model=EventOut)
async def move_event(
    event_id: str,
    body: EventMove,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    from chronarch_core.models.event import UnifiedEvent

    existing = await session.get(UnifiedEvent, event_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    is_owner, grant = await _resolve_owner_and_grant(session, user, existing.calendar_id)
    ctx = build_auth_context(user, actor_type_for(user))
    try:
        event = await ai_tools.move_event(
            session, ctx, event_id=event_id, new_start=body.start, new_end=body.end,
            new_all_day=body.all_day,
            is_owner=is_owner, delegation_grant=grant,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return event


class EventMoveCalendar(BaseModel):
    calendar_id: str


@router.post("/{event_id}/move-to-calendar", response_model=EventOut)
async def move_event_to_calendar(
    event_id: str,
    body: EventMoveCalendar,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Atomic cross-calendar move (BR-EVT-004): create on the destination
    first, then delete from the source. The event keeps its id."""
    from chronarch_core.models.event import UnifiedEvent

    existing = await session.get(UnifiedEvent, event_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    ctx = build_auth_context(user, actor_type_for(user))
    owner_ids = await get_owned_calendar_ids(session, user)
    grants = (
        await get_delegation_grants(session, user.id)
        if user.role == UserRole.DELEGATE
        else None
    )
    try:
        event = await ai_tools.move_event_between_calendars(
            session, ctx, event_id=event_id, destination_calendar_id=body.calendar_id,
            owner_calendar_ids=owner_ids, grants_by_calendar=grants,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: str,
    scope: str = "series",
    instance_start: datetime | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Delete with recurrence scope (BR-EVT-006): series (default), this
    occurrence, or this-and-future. Scoped deletes keep the series row."""
    from chronarch_core.models.event import UnifiedEvent

    existing = await session.get(UnifiedEvent, event_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    is_owner, grant = await _resolve_owner_and_grant(session, user, existing.calendar_id)
    ctx = build_auth_context(user, actor_type_for(user))
    try:
        await ai_tools.delete_event(
            session, ctx, event_id=event_id, scope=scope,
            instance_start=instance_start, is_owner=is_owner, delegation_grant=grant)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))


@router.get("/{event_id}", response_model=EventOut)
async def get_event(
    event_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Single-event fetch (BRD §17 `get_event`) with full permission gating."""
    from chronarch_core.models.event import UnifiedEvent

    existing = await session.get(UnifiedEvent, event_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    is_owner, grant = await _resolve_owner_and_grant(session, user, existing.calendar_id)
    owner_ids = {existing.calendar_id} if is_owner else set()
    grants = {existing.calendar_id: grant} if grant is not None else None
    ctx = build_auth_context(user, actor_type_for(user))
    try:
        fetched = await ai_tools.get_event(
            session, ctx, event_id=event_id,
            owner_calendar_ids=owner_ids, grants_by_calendar=grants,
        )
        return _with_next_occurrence([fetched])[0]
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    location: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    timezone: str | None = None
    all_day: bool | None = None
    visibility: str | None = None
    attendees: list[dict] | None = None
    # Recurrence scope (BR-EVT-006): series (default), this occurrence, or
    # this-and-future. Scoped edits target instance_start, defaulting to the
    # next upcoming occurrence.
    scope: str = "series"
    instance_start: datetime | None = None


@router.patch("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: str,
    body: EventUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Full-field edit (BRD §18 `update_event`)."""
    from chronarch_core.models.event import UnifiedEvent

    existing = await session.get(UnifiedEvent, event_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    if all(v is None for v in (body.title, body.description, body.location, body.start, body.end, body.timezone, body.all_day, body.visibility, body.attendees)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No fields to update")
    if (body.start is None) != (body.end is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "start and end must be provided together")
    is_owner, grant = await _resolve_owner_and_grant(session, user, existing.calendar_id)
    ctx = build_auth_context(user, actor_type_for(user))
    try:
        return await ai_tools.update_event(
            session, ctx, event_id=event_id, title=body.title, description=body.description,
            location=body.location, start=body.start, end=body.end,
            timezone=body.timezone, all_day=body.all_day, visibility=body.visibility,
            attendees=body.attendees, scope=body.scope, instance_start=body.instance_start,
            is_owner=is_owner, delegation_grant=grant,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


class IcsPreviewRequest(BaseModel):
    content: str


class IcsImportRequest(BaseModel):
    calendar_id: str
    title: str
    start: datetime
    end: datetime
    timezone: str | None = None
    description: str | None = None
    location: str | None = None
    all_day: bool = False


@router.post("/ics/preview")
async def preview_ics(
    body: IcsPreviewRequest,
    _user: User = Depends(get_current_user),
):
    from chronarch_core.ics import parse_ics_events

    try:
        events = parse_ics_events(body.content)
        return {"events": events, "count": len(events)}
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Failed to parse .ics content: {exc}")


@router.post("/ics/import", response_model=EventOut)
async def import_ics_event(
    body: IcsImportRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    client_timezone: str = Depends(get_client_timezone),
):
    """Import a single event from an .ics preview into the designated writable calendar (BR-ICS-003)."""
    is_owner, grant = await _resolve_owner_and_grant(session, user, body.calendar_id)
    # ActorType is ICS_IMPORT (BRD §22 audit requirement)
    from chronarch_core.models.enums import ActorType

    # File imports are calendar mutations, not administrative operations.
    # Do not let an admin session bypass the owner/delegation check here.
    from chronarch_core.permissions import AuthContext
    ctx = AuthContext(user_id=user.id, role=user.role, actor_type=ActorType.ICS_IMPORT, is_admin=False)
    try:
        event = await ai_tools.create_event(
            session,
            ctx,
            calendar_id=body.calendar_id,
            title=body.title,
            start=body.start,
            end=body.end,
            timezone=body.timezone or client_timezone,
            description=body.description,
            location=body.location,
            all_day=body.all_day,
            is_owner=is_owner,
            delegation_grant=grant,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return event
