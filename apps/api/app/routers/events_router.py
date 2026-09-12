from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import ai_tools
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User

from ..auth import build_auth_context, get_current_user
from ..deps import get_db_session
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

    model_config = {"from_attributes": True}


class EventCreate(BaseModel):
    calendar_id: str
    title: str
    start: datetime
    end: datetime
    timezone: str = "UTC"
    description: str | None = None
    location: str | None = None
    all_day: bool = False

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
    if not is_owner and user.role == UserRole.ASSISTANT:
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
        if user.role == UserRole.ASSISTANT
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
    return events


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
        if user.role == UserRole.ASSISTANT
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
):
    is_owner, grant = await _resolve_owner_and_grant(session, user, body.calendar_id)
    ctx = build_auth_context(user, actor_type_for(user))
    try:
        event = await ai_tools.create_event(
            session, ctx, calendar_id=body.calendar_id, title=body.title, start=body.start, end=body.end,
            timezone=body.timezone, description=body.description, location=body.location,
            all_day=body.all_day,
            is_owner=is_owner, delegation_grant=grant,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
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
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: str,
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
        await ai_tools.delete_event(session, ctx, event_id=event_id, is_owner=is_owner, delegation_grant=grant)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))


class IcsPreviewRequest(BaseModel):
    content: str


class IcsImportRequest(BaseModel):
    calendar_id: str
    title: str
    start: datetime
    end: datetime
    timezone: str = "UTC"
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
):
    """Import a single event from an .ics preview into the designated writable calendar (BR-ICS-003)."""
    is_owner, grant = await _resolve_owner_and_grant(session, user, body.calendar_id)
    # ActorType is ICS_IMPORT (BRD §22 audit requirement)
    from chronarch_core.models.enums import ActorType

    ctx = build_auth_context(user, ActorType.ICS_IMPORT)
    try:
        event = await ai_tools.create_event(
            session,
            ctx,
            calendar_id=body.calendar_id,
            title=body.title,
            start=body.start,
            end=body.end,
            timezone=body.timezone,
            description=body.description,
            location=body.location,
            all_day=body.all_day,
            is_owner=is_owner,
            delegation_grant=grant,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return event

