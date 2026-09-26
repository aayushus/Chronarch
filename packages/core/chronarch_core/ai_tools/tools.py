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

from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
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


class _Probe:
    """Lightweight engine input mirroring the UnifiedEvent fields
    find_conflicts reads — lets us tz-align instants without mutating
    (and dirtying) ORM rows."""

    __slots__ = ("id", "calendar_id", "start", "end", "busy_status")

    def __init__(self, id, calendar_id, start, end, busy_status):
        self.id = id
        self.calendar_id = calendar_id
        self.start = start
        self.end = end
        self.busy_status = busy_status


async def _availability_events(session: AsyncSession, blocking_ids: set[str],
                              window_start: datetime, window_end: datetime) -> list:
    """Events relevant to availability in a window: rows overlapping it,
    plus every recurring series on a blocking calendar (a series anchored
    months ago still blocks its future instances)."""
    from sqlalchemy import and_, or_

    stmt = select(UnifiedEvent).where(
        UnifiedEvent.calendar_id.in_(blocking_ids),
        or_(
            and_(UnifiedEvent.start < window_end, UnifiedEvent.end > window_start),
            UnifiedEvent.recurrence.is_not(None),
        ),
    )
    return list((await session.execute(stmt)).scalars())


def _availability_probes(events: list, blocking_ids: set[str],
                         window_start: datetime, window_end: datetime) -> list:
    """Engine-ready probes: stored rows plus expanded recurring occurrences
    (series identity kept, so conflict hits still resolve to the event).
    Malformed rules degrade to invisible rather than crashing the search."""
    from ..recurrence import occurrences

    probed = []
    for e in events:
        if e.calendar_id not in blocking_ids:
            continue
        occs = occurrences(e, window_start, window_end)
        if occs:
            probed.extend(
                _Probe(e.id, e.calendar_id, s, en, e.busy_status) for s, en in occs)
            continue
        # Non-recurring rows keep the stored instant, aligned to the
        # window's awareness first (sqlite reads come back naive).
        start = _align_tz(e.start, window_start)
        end = _align_tz(e.end, window_start)
        if start < window_end and end > window_start:
            probed.append(_Probe(e.id, e.calendar_id, start, end, e.busy_status))
    return probed


def _align_tz(dt: datetime, ref: datetime) -> datetime:
    if (dt.tzinfo is None) == (ref.tzinfo is None):
        return dt
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _validate_window(start: datetime, end: datetime) -> None:
    """Reject zero-length and inverted event windows.

    Lives here (not just in REST pydantic models) so every caller — REST,
    MCP, copilot, ICS import — gets the same guarantee. Raises ValueError,
    which the REST layer maps to 422 and the MCP layer maps to an error
    dict.
    """
    if end <= start:
        raise ValueError(f"event end ({end.isoformat()}) must be after start ({start.isoformat()})")


def _normalize_attendees(attendees: list[dict]) -> list[dict]:
    """Validate + normalize attendee entries to {email, name?} (lowercased
    emails, trimmed names). Shared by create and update so every write path
    stores the same shape extraction produces. Raises ValueError."""
    if not isinstance(attendees, list):
        raise ValueError("attendees must be a list of {email, name} entries")
    normalized = []
    for entry in attendees:
        if not isinstance(entry, dict):
            raise ValueError("attendees must be a list of {email, name} entries")
        email = (entry.get("email") or "").strip().lower()
        if "@" not in email:
            raise ValueError(f"'{entry.get('email')}' is not a valid attendee email.")
        name = " ".join((entry.get("name") or "").strip().split())
        normalized.append({"email": email, "name": name or None})
    return normalized


async def _get_calendar(session: AsyncSession, calendar_id: str) -> Calendar:
    calendar = await session.get(Calendar, calendar_id)
    if calendar is None:
        raise ValueError(f"calendar {calendar_id} not found")
    return calendar


async def _readable_calendars(
    session: AsyncSession,
    ctx: AuthContext,
    calendar_ids: list[str] | None,
    *,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> list[Calendar]:
    """Calendars the viewer may at least see availability for.

    Ownership and EA delegation grants vary per calendar, so callers that
    know them pass `owner_calendar_ids` / `grants_by_calendar`; both default
    to "none", preserving the deny-by-default posture of older callers.
    """
    stmt = select(Calendar)
    if calendar_ids:
        stmt = stmt.where(Calendar.id.in_(calendar_ids))
    calendars = list((await session.execute(stmt)).scalars())

    readable = []
    for cal in calendars:
        is_owner = bool(owner_calendar_ids and cal.id in owner_calendar_ids)
        grant = grants_by_calendar.get(cal.id) if grants_by_calendar else None
        decision = resolve_permission(
            ctx, cal, CalendarAction.VIEW_AVAILABILITY, is_owner=is_owner, delegation_grant=grant
        )
        if decision.allowed:
            readable.append(cal)
    return readable


async def list_calendars(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> list[Calendar]:
    return await _readable_calendars(
        session, ctx, None, owner_calendar_ids=owner_calendar_ids, grants_by_calendar=grants_by_calendar
    )


async def list_accounts(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    owner_user_id: str | None = None,
) -> list[dict]:
    """Accounts the caller may know about (BRD §17 `list_accounts`).

    MCP callers see only accounts backing their readable calendars;
    human callers see owned accounts (or all, for admins). Never returns
    tokens, passwords, or OAuth secrets — only identity + sync status.
    """
    from ..models.account import Account

    calendars = await _readable_calendars(session, ctx, None)
    calendar_account_ids = {c.account_id for c in calendars if c.account_id}
    stmt = select(Account)
    if owner_user_id:
        stmt = stmt.where(Account.owner_user_id == owner_user_id)
    accounts = list((await session.execute(stmt)).scalars())
    out = []
    for account in accounts:
        if ctx.is_admin or (owner_user_id and account.owner_user_id == owner_user_id):
            visible = True
        else:
            # MCP/copilot/EA: only accounts contributing a readable calendar.
            visible = account.id in calendar_account_ids
        if not visible:
            continue
        out.append(
            {
                "id": account.id,
                "provider": account.provider.value,
                "email": account.provider_account_email,
                "sync_status": account.sync_status,
                "last_synced_at": account.last_synced_at,
            }
        )
    return out


async def get_event(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> UnifiedEvent:
    """Fetch a single event by id (BRD §17 `get_event`), enforcing
    VIEW_FULL_DETAILS. Raises ValueError if missing, PermissionDenied if
    the viewer may not see details."""
    event = await session.get(UnifiedEvent, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")
    calendar = await _get_calendar(session, event.calendar_id)
    is_owner = bool(owner_calendar_ids and calendar.id in owner_calendar_ids)
    grant = grants_by_calendar.get(calendar.id) if grants_by_calendar else None
    decision = resolve_permission(
        ctx, calendar, CalendarAction.VIEW_FULL_DETAILS,
        event=event, is_owner=is_owner, delegation_grant=grant,
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.VIEW_FULL_DETAILS, decision.reason)
    return event


async def get_events(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    window_start: datetime,
    window_end: datetime,
    calendar_ids: list[str] | None = None,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> list[UnifiedEvent]:
    calendars = await _readable_calendars(
        session, ctx, calendar_ids, owner_calendar_ids=owner_calendar_ids, grants_by_calendar=grants_by_calendar
    )
    cal_by_id = {c.id: c for c in calendars}
    if not cal_by_id:
        return []

    # Do not use JSON `IS NOT NULL` here: SQLite/PostgreSQL adapters may
    # materialize a JSON null as the literal JSON value `null`, which would
    # bypass the time-window predicate and leak unrelated one-off events.
    stmt = select(UnifiedEvent).where(UnifiedEvent.calendar_id.in_(cal_by_id.keys()))
    events = list((await session.execute(stmt)).scalars())

    # Recurring masters are stored at their first occurrence. Expand them
    # before applying the requested window so later instances are visible in
    # ordinary calendar listings, not only in availability checks.
    from copy import copy
    from ..recurrence import occurrences
    listed_events = []
    for event in events:
        if not event.recurrence or event.recurrence == "null":
            event_start = _align_tz(event.start, window_start)
            event_end = _align_tz(event.end, window_start)
            if event_start >= window_end or event_end <= window_start:
                continue
            listed_events.append(event)
            continue
        for occurrence_start, occurrence_end in occurrences(event, window_start, window_end):
            instance = copy(event)
            instance.start, instance.end = occurrence_start, occurrence_end
            listed_events.append(instance)

    # Privacy masking (BRD §15): a viewer without VIEW_TITLE only gets the
    # free/busy block, never the row itself — masking happens at the API
    # serialization layer (apps/api), which redacts title/description for
    # any event where VIEW_TITLE is denied but VIEW_AVAILABILITY is allowed.
    visible = []
    for event in listed_events:
        cal = cal_by_id[event.calendar_id]
        is_owner = bool(owner_calendar_ids and cal.id in owner_calendar_ids)
        grant = grants_by_calendar.get(cal.id) if grants_by_calendar else None
        decision = resolve_permission(
            ctx, cal, CalendarAction.VIEW_TITLE, event=event, is_owner=is_owner, delegation_grant=grant
        )
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
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> list[dict]:
    calendars = await _readable_calendars(
        session, ctx, calendar_ids, owner_calendar_ids=owner_calendar_ids, grants_by_calendar=grants_by_calendar
    )
    blocking_ids = {c.id for c in calendars if c.blocks_availability}
    if not blocking_ids:
        return []

    events = await _availability_events(session, blocking_ids, window_start, window_end)
    conflicts = _find_conflicts(
        window_start, window_end,
        _availability_probes(events, blocking_ids, window_start, window_end),
        blocking_ids)
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
    working_days: set[int] | None = None,
    buffer: timedelta = timedelta(0),
    buffer_before: timedelta | None = None,
    buffer_after: timedelta | None = None,
    min_notice: timedelta = timedelta(0),
    now: datetime | None = None,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> list[dict]:
    calendars = await _readable_calendars(
        session, ctx, calendar_ids, owner_calendar_ids=owner_calendar_ids, grants_by_calendar=grants_by_calendar
    )
    blocking_ids = {c.id for c in calendars if c.blocks_availability}

    events = await _availability_events(session, blocking_ids, window_start, window_end) if blocking_ids else []

    # Same sqlite/Postgres tz alignment as get_conflicts: stored instants
    # are UTC, a naive side is assumed UTC. Without this, naive sqlite rows
    # crash aware-window comparisons in the engine.
    probed = _availability_probes(events, blocking_ids, window_start, window_end)
    slots = _find_free_slots(
        window_start,
        window_end,
        duration,
        probed,
        blocking_ids,
        working_hours=working_hours,
        working_days=working_days,
        buffer=buffer,
        buffer_before=buffer_before,
        buffer_after=buffer_after,
        min_notice=min_notice,
        now=now,
    )
    return [{"start": s.start, "end": s.end} for s in slots]


async def get_conflicts(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    window_start: datetime,
    window_end: datetime,
    exclude_event_id: str | None = None,
    calendar_ids: list[str] | None = None,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> list[dict]:
    """Conflict check for the UI warning flow (BRD §25): which blocking
    events overlap [window_start, window_end).

    Unlike get_availability (busy intervals only), this returns event
    identity so the UI can list what you'd overlap. Privacy (BRD §15):
    entries the viewer may not title-see come back redacted
    (title "Busy", no description) but still warn — a hidden meeting still
    blocks your time. `exclude_event_id` skips the event being moved so a
    drag doesn't conflict with itself.

    Ownership and EA grants are per-calendar: pass `owner_calendar_ids`
    (calendars under accounts the user owns) and/or `grants_by_calendar`
    (assistant's DelegationCalendarGrant per calendar id). Admins bypass via
    ctx.is_admin inside the engine.
    """
    _validate_window(window_start, window_end)
    calendars = await _readable_calendars(
        session, ctx, calendar_ids,
        owner_calendar_ids=owner_calendar_ids, grants_by_calendar=grants_by_calendar,
    )
    cal_by_id = {c.id: c for c in calendars}
    blocking_ids = {c.id for c in calendars if c.blocks_availability}
    if not blocking_ids:
        return []

    events = await _availability_events(session, blocking_ids, window_start, window_end)
    probed = _availability_probes(events, blocking_ids, window_start, window_end)
    hits = _find_conflicts(window_start, window_end, probed, blocking_ids, exclude_event_id=exclude_event_id)

    out = []
    for hit in hits:
        event = next((e for e in events if e.id == hit.event_id), None)
        if event is None:
            continue
        cal = cal_by_id[event.calendar_id]
        is_owner = bool(owner_calendar_ids and cal.id in owner_calendar_ids)
        grant = grants_by_calendar.get(cal.id) if grants_by_calendar else None
        title_ok = resolve_permission(
            ctx, cal, CalendarAction.VIEW_TITLE, event=event, is_owner=is_owner, delegation_grant=grant
        ).allowed
        out.append(
            {
                "event_id": event.id,
                "calendar_id": event.calendar_id,
                "calendar_name": cal.name,
                "title": event.title if title_ok else "Busy",
                "start": event.start,
                "end": event.end,
                "all_day": event.all_day,
                "redacted": not title_ok,
            }
        )
    return out


async def _get_connector_for_calendar(session: AsyncSession, calendar: Calendar):
    if not calendar.account_id:
        return None, None
    from ..crypto import get_cipher
    from ..models.account import Account
    from ..models.enums import ProviderType

    account = await session.get(Account, calendar.account_id)
    if not account:
        return None, None

    if account.provider == ProviderType.CALDAV:
        from ..connectors.caldav import CalDAVConnector

        if not account.caldav_server_url or not account.caldav_username:
            return None, account
        if not account.encrypted_caldav_password:
            return None, account
        cipher = get_cipher()
        password = cipher.decrypt(account.encrypted_caldav_password)
        connector = CalDAVConnector(
            server_url=account.caldav_server_url,
            username=account.caldav_username,
            password=password,
        )
        return connector, account

    cipher = get_cipher()
    access_token = cipher.decrypt(account.encrypted_access_token) if account.encrypted_access_token else None
    refresh_token = cipher.decrypt(account.encrypted_refresh_token) if account.encrypted_refresh_token else None

    if not access_token and not refresh_token:
        return None, account

    if account.provider == ProviderType.GOOGLE:
        from ..connectors.google import GoogleConnector
        from ..oauth import resolve_google_credentials

        try:
            client_id, client_secret = await resolve_google_credentials(session)
        except RuntimeError:
            return None, account

        connector = GoogleConnector(
            access_token=access_token,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
        )
        return connector, account
    elif account.provider == ProviderType.MICROSOFT:
        from ..connectors.microsoft import MicrosoftConnector
        from ..oauth import resolve_microsoft_credentials

        try:
            client_id, client_secret, tenant_id = await resolve_microsoft_credentials(session)
        except RuntimeError:
            return None, account

        connector = MicrosoftConnector(
            access_token=access_token,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            tenant_id=tenant_id,
        )
        return connector, account

    return None, account


def _persist_refreshed_token(account, new_access_token: str) -> None:
    from ..crypto import get_cipher

    cipher = get_cipher()
    account.encrypted_access_token = cipher.encrypt(new_access_token)


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
    all_day: bool = False,
    recurrence: dict | None = None,
    is_owner: bool = False,
    delegation_grant=None,
) -> UnifiedEvent:
    _validate_window(start, end)
    from ..recurrence import (
        normalize_recurrence_input as _normalize_recurrence,
        to_graph_recurrence as _to_graph,
        to_rrule_text as _to_rrule,
    )
    from ..timezones import normalize_timezone

    timezone = normalize_timezone(timezone)
    calendar = await _get_calendar(session, calendar_id)
    decision = resolve_permission(
        ctx, calendar, CalendarAction.CREATE, is_owner=is_owner, delegation_grant=delegation_grant
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.CREATE, decision.reason)
    normalized_attendees = _normalize_attendees(attendees) if attendees else []
    if normalized_attendees:
        attendee_decision = resolve_permission(
            ctx, calendar, CalendarAction.MANAGE_ATTENDEES,
            is_owner=is_owner, delegation_grant=delegation_grant,
        )
        if not attendee_decision.allowed:
            raise PermissionDenied(CalendarAction.MANAGE_ATTENDEES, attendee_decision.reason)
    conflicts = await get_conflicts(
        session, ctx, window_start=start, window_end=end,
        calendar_ids=[calendar_id],
        owner_calendar_ids={calendar_id} if is_owner else None,
        grants_by_calendar={calendar_id: delegation_grant} if delegation_grant else None,
    )
    # An exact duplicate interval is allowed: sync/import callers can replay
    # an already-materialized slot, while genuinely partial overlaps remain a
    # server-side conflict.
    def _utc(dt: datetime) -> datetime:
        from datetime import timezone as dt_timezone
        return dt.replace(tzinfo=dt_timezone.utc) if dt.tzinfo is None else dt.astimezone(dt_timezone.utc)

    conflicts = [c for c in conflicts if not (
        _utc(c["start"]) == _utc(start) and _utc(c["end"]) == _utc(end)
    )]
    if conflicts:
        raise ValueError("The requested time conflicts with an existing event.")
    canonical = _normalize_recurrence(recurrence) if recurrence is not None else None
    provider_event_id = ""
    stored_recurrence = None
    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and calendar.provider_writable:
        from ..connectors.base import RemoteEvent
        from ..models.enums import ProviderType as _ProviderType

        if canonical is not None and account is not None and account.provider == _ProviderType.MICROSOFT:
            provider_shape = {"type": _to_graph(canonical)}
        elif canonical is not None:
            # Google wire form doubles as the CalDAV/ICS/local stored shape.
            provider_shape = {"rule": [_to_rrule(canonical)]}
        else:
            provider_shape = None
        remote_req = RemoteEvent(
            provider_event_id="",
            title=title,
            description=description,
            start=start,
            end=end,
            timezone=timezone,
            all_day=all_day,
            organizer=None,
            attendees=normalized_attendees,
            location=location,
            conference=None,
            recurrence=provider_shape,
            visibility="standard",
            busy_status="busy",
            writable=True,
            provider_updated_at=None,
        )
        created_remote = await connector.create_event(calendar.provider_calendar_id, remote_req)
        provider_event_id = created_remote.provider_event_id
        stored_recurrence = created_remote.recurrence or provider_shape
        refreshed_token = getattr(connector, "access_token", None)
        if account and refreshed_token:
            _persist_refreshed_token(account, refreshed_token)
    elif canonical is not None:
        stored_recurrence = {"rule": [_to_rrule(canonical)]}

    event = UnifiedEvent(
        provider_account_id=calendar.account_id,
        calendar_id=calendar.id,
        provider_event_id=provider_event_id,
        title=title,
        description=description,
        start=start,
        end=end,
        timezone=timezone,
        all_day=all_day,
        location=location,
        attendees=normalized_attendees,
        recurrence=stored_recurrence,
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
    new_all_day: bool | None = None,
    is_owner: bool = False,
    delegation_grant=None,
) -> UnifiedEvent:
    _validate_window(new_start, new_end)
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

    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and event.provider_event_id and calendar.provider_writable:
        target_all_day = new_all_day if new_all_day is not None else event.all_day
        if target_all_day:
            patch = {
                "start": {"date": new_start.date().isoformat()},
                "end": {"date": new_end.date().isoformat()},
            }
        else:
            patch = {
                "start": {"dateTime": new_start.isoformat(), "timeZone": event.timezone},
                "end": {"dateTime": new_end.isoformat(), "timeZone": event.timezone},
            }
        await connector.update_event(calendar.provider_calendar_id, event.provider_event_id, patch)
        refreshed_token = getattr(connector, "access_token", None)
        if account and refreshed_token:
            _persist_refreshed_token(account, refreshed_token)

    old_start, old_end = event.start, event.end
    event.start, event.end = new_start, new_end
    if new_all_day is not None:
        event.all_day = new_all_day
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
            **({"all_day": new_all_day} if new_all_day is not None else {}),
        },
    )
    return event


async def update_event(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    title: str | None = None,
    description: str | None = None,
    location: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    timezone: str | None = None,
    all_day: bool | None = None,
    visibility: str | None = None,
    attendees: list[dict] | None = None,
    scope: str = "series",
    instance_start: datetime | None = None,
    is_owner: bool = False,
    delegation_grant=None,
) -> UnifiedEvent:
    """Full-field edit (BRD §18 `update_event`, scopes in BR-EVT-006). Field-level updates ride
    on the EDIT permission; a time change additionally requires RESCHEDULE.
    scope="this"/"future" with an optional instance_start edits one occurrence
    or splits the series (CalDAV: whole-series only). At least one field must
    be provided. Writes through to the provider when the calendar is
    provider-writable, then audits as UPDATE_EVENT.
    """
    from ..permissions import CalendarAction as _Action

    if scope not in ("series", "this", "future"):
        raise ValueError("scope must be 'series', 'this', or 'future'.")
    event = await session.get(UnifiedEvent, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")
    calendar = await _get_calendar(session, event.calendar_id)

    if all(v is None for v in (title, description, location, start, end, timezone, all_day, visibility, attendees)):
        raise ValueError("update_event requires at least one field to change")

    new_start = start if start is not None else event.start
    new_end = end if end is not None else event.end
    if start is not None or end is not None:
        _validate_window(new_start, new_end)

    edit_decision = resolve_permission(
        ctx, calendar, _Action.EDIT, event=event, is_owner=is_owner, delegation_grant=delegation_grant,
    )
    if not edit_decision.allowed:
        raise PermissionDenied(_Action.EDIT, edit_decision.reason)
    if attendees is not None:
        # Invite membership is its own grant flag — editing details must not
        # silently confer the right to add/remove people.
        manage_decision = resolve_permission(
            ctx, calendar, _Action.MANAGE_ATTENDEES, event=event,
            is_owner=is_owner, delegation_grant=delegation_grant,
        )
        if not manage_decision.allowed:
            raise PermissionDenied(_Action.MANAGE_ATTENDEES, manage_decision.reason)
        attendees = _normalize_attendees(attendees)
    if start is not None or end is not None or all_day is not None:
        resched_decision = resolve_permission(
            ctx, calendar, _Action.RESCHEDULE, event=event, is_owner=is_owner, delegation_grant=delegation_grant,
        )
        if not resched_decision.allowed:
            raise PermissionDenied(_Action.RESCHEDULE, resched_decision.reason)

    if scope != "series":
        if not event.recurrence:
            raise ValueError("scope applies to repeating events only — this event does not repeat.")
        scoped_connector, scoped_account = await _get_connector_for_calendar(session, calendar)
        return await _update_scoped(
            session, ctx, calendar=calendar, event=event,
            account=scoped_account, connector=scoped_connector,
            scope=scope, instance_start=instance_start,
            title=title, description=description, location=location,
            start=start, end=end, tz_name=timezone, all_day=all_day,
            visibility=visibility, attendees=attendees,
            is_owner=is_owner, delegation_grant=delegation_grant,
        )

    changes: dict[str, list[str]] = {}
    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and event.provider_event_id and calendar.provider_writable:
        target_all_day = all_day if all_day is not None else event.all_day
        patch: dict = {}
        if target_all_day and (start is not None or end is not None or all_day is not None):
            patch["start"] = {"date": new_start.date().isoformat()}
            patch["end"] = {"date": new_end.date().isoformat()}
        elif start is not None or end is not None:
            patch["start"] = {"dateTime": new_start.isoformat(), "timeZone": timezone or event.timezone}
            patch["end"] = {"dateTime": new_end.isoformat(), "timeZone": timezone or event.timezone}
        if title is not None:
            patch["title"] = title
        if description is not None:
            patch["description"] = description
        if location is not None:
            patch["location"] = location
        if attendees is not None:
            patch["attendees"] = attendees
        if patch:
            await connector.update_event(calendar.provider_calendar_id, event.provider_event_id, patch)
        refreshed = getattr(connector, "access_token", None)
        if account and refreshed:
            _persist_refreshed_token(account, refreshed)

    if title is not None and title != event.title:
        changes["title"] = [event.title, title]
        event.title = title
    if description is not None and description != event.description:
        changes["description"] = [str(event.description), str(description)]
        event.description = description
    if location is not None and location != event.location:
        changes["location"] = [str(event.location), str(location)]
        event.location = location
    if attendees is not None:
        old_emails = sorted(a.get("email", "") for a in (event.attendees or []) if isinstance(a, dict))
        new_emails = sorted(a.get("email", "") for a in attendees)
        if old_emails != new_emails:
            changes["attendees"] = [",".join(old_emails), ",".join(new_emails)]
        event.attendees = attendees
    if start is not None:
        changes["start"] = [event.start.isoformat(), new_start.isoformat()]
        event.start = new_start
    if end is not None:
        changes["end"] = [event.end.isoformat(), new_end.isoformat()]
        event.end = new_end
    if timezone is not None:
        from ..timezones import normalize_timezone as _normalize_timezone

        event.timezone = _normalize_timezone(timezone)
    if all_day is not None:
        event.all_day = all_day
    if visibility is not None:
        from ..models.enums import EventVisibility as _EventVisibility

        try:
            event.visibility = _EventVisibility(visibility.strip().lower())
        except ValueError:
            raise ValueError("visibility must be public, standard, or private")
        changes["visibility"] = [visibility]
    await session.flush()

    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.UPDATE_EVENT,
        calendar_id=calendar.id,
        event_id=event.id,
        detail={"changes": changes},
    )
    return event


async def _update_scoped(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    calendar,
    event,
    account,
    connector,
    scope: str,
    instance_start: datetime | None,
    title: str | None,
    description: str | None,
    location: str | None,
    start: datetime | None,
    end: datetime | None,
    tz_name: str | None,
    all_day: bool | None,
    visibility: str | None,
    attendees: list[dict] | None,
    is_owner: bool = False,
    delegation_grant=None,
):
    """This/future-occurrences edit for a recurring series (BR-EVT-006).

    scope="this" patches one provider instance and records a moved-window
    exception when the time changes (non-time field overrides live
    provider-side; the local master keeps series truth). scope="future"
    truncates the series at the cut and starts a replacement series carrying
    the edited fields, returning the new row. CalDAV supports whole-series
    edits only. EDIT/MANAGE/RESCHEDULE gates are enforced by the caller.
    """
    from ..models.enums import ProviderType as _ProviderType
    from ..recurrence import split_series as _split

    now = datetime.now(timezone.utc)
    cut = _next_occurrence(event, now, instance_start)
    cut_key = cut.isoformat()
    if connector is None or not calendar.provider_writable:
        raise ValueError("Scoped edits need a writable provider connection.")
    provider = account.provider if account else None
    if provider == _ProviderType.CALDAV:
        raise ValueError("CalDAV supports whole-series edits only.")
    if provider not in (_ProviderType.GOOGLE, _ProviderType.MICROSOFT):
        raise ValueError(f"Scoped edits are not supported for {provider.value if provider else 'this account'}.")

    # Same normalized field patch the series path builds, so instance and
    # series writes carry identical semantics (quirks included).
    patch: dict = {}
    if title is not None:
        patch["title"] = title
    if description is not None:
        patch["description"] = description
    if location is not None:
        patch["location"] = location
    if attendees is not None:
        patch["attendees"] = attendees
    if start is not None or end is not None:
        new_start = start if start is not None else cut
        new_end = end if end is not None else cut + (_as_utc(event.end) - _as_utc(event.start))
        patch["start"] = {"dateTime": new_start.isoformat(), "timeZone": tz_name or event.timezone}
        patch["end"] = {"dateTime": new_end.isoformat(), "timeZone": tz_name or event.timezone}

    if scope == "this":
        if provider == _ProviderType.GOOGLE:
            await connector.update_instance(
                calendar.provider_calendar_id, event.provider_event_id, cut, patch)
        else:
            occs = await connector.list_instances(
                event.provider_event_id,
                cut - timedelta(minutes=1), cut + timedelta(minutes=1))
            if not occs:
                raise ValueError("Occurrence not found on the provider.")
            await connector.update_instance(
                calendar.provider_calendar_id, event.provider_event_id, occs[0]["id"], patch)
        refreshed = getattr(connector, "access_token", None)
        if account and refreshed:
            _persist_refreshed_token(account, refreshed)
        if start is not None or end is not None:
            duration = _as_utc(event.end) - _as_utc(event.start)
            new_start = start if start is not None else cut
            new_end = end if end is not None else new_start + duration
            exceptions = dict((event.recurrence or {}).get("exceptions") or {})
            exceptions[cut_key] = {"start": new_start.isoformat(), "end": new_end.isoformat()}
            event.recurrence = {**(event.recurrence or {}), "exceptions": exceptions}
            await session.flush()
        await write_audit_entry(
            session, ctx=ctx, action=AuditAction.UPDATE_EVENT,
            calendar_id=calendar.id, event_id=event.id,
            detail={"scope": "this", "instance": cut_key,
                    "changes": sorted(patch.keys())},
        )
        return event

    # scope == "future": truncate the original, start a replacement series.
    trunc, restart = _split(event.recurrence, cut, event.start)
    if trunc is None or restart is None:
        raise ValueError("Could not split this series' recurrence rule.")
    await connector.update_event(
        calendar.provider_calendar_id, event.provider_event_id, {"recurrence": trunc})
    refreshed = getattr(connector, "access_token", None)
    if account and refreshed:
        _persist_refreshed_token(account, refreshed)
    kept_exceptions = {
        k: v for k, v in (((event.recurrence or {}).get("exceptions") or {}).items())
        if k < cut_key
    }
    event.recurrence = {**trunc, **({"exceptions": kept_exceptions} if kept_exceptions else {})}
    await session.flush()

    duration = _as_utc(event.end) - _as_utc(event.start)
    new_start = start if start is not None else cut
    new_end = end if end is not None else new_start + duration
    created = await create_event(
        session, ctx, calendar_id=calendar.id,
        title=title if title is not None else event.title,
        start=new_start, end=new_end,
        timezone=tz_name or event.timezone,
        description=description if description is not None else event.description,
        location=location if location is not None else event.location,
        attendees=attendees if attendees is not None else list(event.attendees or []),
        all_day=all_day if all_day is not None else event.all_day,
        recurrence=None,  # replaced below with the provider-shape restart rule
        is_owner=is_owner, delegation_grant=delegation_grant,
    )
    # create_event only accepts canonical input, but the restart rule is
    # already provider-shaped — set it (and the provider row) directly.
    created.recurrence = restart
    if connector and created.provider_event_id and calendar.provider_writable:
        try:
            await connector.update_event(
                calendar.provider_calendar_id, created.provider_event_id,
                {"recurrence": restart})
        except Exception:
            pass
    await session.flush()
    await write_audit_entry(
        session, ctx=ctx, action=AuditAction.UPDATE_EVENT,
        calendar_id=calendar.id, event_id=event.id,
        detail={"scope": "future", "cut": cut_key,
                "continued_as": created.id, "changes": sorted(patch.keys())},
    )
    return created


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def move_event_between_calendars(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    destination_calendar_id: str,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> UnifiedEvent:
    """Atomic cross-calendar move (BR-EVT-004): create on destination first,
    then delete from source — never the reverse, so a failed destination
    write leaves the source untouched. The event keeps its id.

    Gates: MOVE_BETWEEN_CALENDARS on the source calendar, CREATE on the
    destination. Both ends must be provider-writable (delete + create).
    Audited as MOVE_EVENT with both calendar ids.
    """
    from ..permissions import CalendarAction as _MoveAction

    event = await session.get(UnifiedEvent, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")
    if event.calendar_id == destination_calendar_id:
        raise ValueError("event is already on that calendar")
    source = await _get_calendar(session, event.calendar_id)
    dest = await _get_calendar(session, destination_calendar_id)

    def _gate(calendar: Calendar, action) -> None:
        is_owner = bool(owner_calendar_ids and calendar.id in owner_calendar_ids)
        grant = grants_by_calendar.get(calendar.id) if grants_by_calendar else None
        decision = resolve_permission(
            ctx, calendar, action, event=event, is_owner=is_owner, delegation_grant=grant,
        )
        if not decision.allowed:
            raise PermissionDenied(action, decision.reason)

    _gate(source, _MoveAction.MOVE_BETWEEN_CALENDARS)
    _gate(dest, _MoveAction.CREATE)
    if not source.provider_writable or not dest.provider_writable:
        raise PermissionDenied(_MoveAction.MOVE_BETWEEN_CALENDARS, "source_calendar_does_not_permit")

    from ..connectors.base import RemoteEvent as _RemoteEvent

    dest_provider_event_id = ""
    dest_connector, dest_account = await _get_connector_for_calendar(session, dest)
    if dest_connector is not None:
        created_remote = await dest_connector.create_event(
            dest.provider_calendar_id,
            _RemoteEvent(
                provider_event_id="", title=event.title, description=event.description,
                start=event.start, end=event.end, timezone=event.timezone,
                all_day=event.all_day, organizer=event.organizer,
                attendees=list(event.attendees or []), location=event.location,
                conference=event.conference, recurrence=event.recurrence,
                visibility=event.visibility.value if hasattr(event.visibility, "value") else str(event.visibility),
                busy_status=event.busy_status.value if hasattr(event.busy_status, "value") else str(event.busy_status),
                writable=True, provider_updated_at=None,
            ),
        )
        dest_provider_event_id = created_remote.provider_event_id
        refreshed = getattr(dest_connector, "access_token", None)
        if dest_account and refreshed:
            _persist_refreshed_token(dest_account, refreshed)

    source_connector, source_account = await _get_connector_for_calendar(session, source)
    if source_connector is not None and event.provider_event_id:
        await source_connector.delete_event(source.provider_calendar_id, event.provider_event_id)
        refreshed = getattr(source_connector, "access_token", None)
        if source_account and refreshed:
            _persist_refreshed_token(source_account, refreshed)

    source_cal_id, source_provider_event_id = event.calendar_id, event.provider_event_id
    event.calendar_id = dest.id
    event.provider_account_id = dest.account_id
    event.provider_event_id = dest_provider_event_id
    event.source_permissions = {"write": True}
    await session.flush()

    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.MOVE_EVENT,
        calendar_id=dest.id,
        event_id=event.id,
        detail={
            "from_calendar_id": source_cal_id,
            "to_calendar_id": dest.id,
            "from_provider_event_id": source_provider_event_id,
            "to_provider_event_id": dest_provider_event_id,
            "title": event.title,
        },
    )
    return event


def _next_occurrence(event, now: datetime, instance_start: datetime | None) -> datetime:
    """Target instance for scoped edits: explicit, else next upcoming."""
    from ..recurrence import occurrences as _occurrences

    if instance_start is not None:
        return instance_start
    upcoming = _occurrences(event, now, now + timedelta(days=365), limit=1)
    if not upcoming:
        raise ValueError("No upcoming occurrences — the series has ended.")
    return upcoming[0][0]


async def delete_event(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    scope: str = "series",
    instance_start: datetime | None = None,
    is_owner: bool = False,
    delegation_grant=None,
) -> dict:
    """Delete an event, with recurrence scope (BR-EVT-006).

    scope="series" (default) removes the whole series — the historical
    behavior. scope="this" removes one occurrence (the series continues;
    recorded as an exception so expansion hides it). scope="future" ends the
    series at the cut (truncate, no replacement). For "this"/"future" the
    target instance defaults to the next upcoming occurrence when
    `instance_start` is omitted. CalDAV supports whole-series deletes only.
    Returns a summary dict (the row may survive scoped deletes).
    """
    from ..recurrence import split_series as _split

    if scope not in ("series", "this", "future"):
        raise ValueError("scope must be 'series', 'this', or 'future'.")
    event = await session.get(UnifiedEvent, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")
    calendar = await _get_calendar(session, event.calendar_id)

    decision = resolve_permission(
        ctx, calendar, CalendarAction.DELETE, event=event, is_owner=is_owner, delegation_grant=delegation_grant
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.DELETE, decision.reason)

    connector, account = await _get_connector_for_calendar(session, calendar)
    now = datetime.now(timezone.utc)

    async def _touch_provider() -> None:
        refreshed = getattr(connector, "access_token", None)
        if account and refreshed:
            _persist_refreshed_token(account, refreshed)

    def _cut() -> datetime:
        return _next_occurrence(event, now, instance_start)

    if event.recurrence and scope != "series":
        from ..models.enums import ProviderType as _ProviderType

        cut = _cut()
        cut_key = cut.isoformat()
        provider = account.provider if account else None
        if connector is None or not calendar.provider_writable:
            raise ValueError("Scoped deletes need a writable provider connection.")
        if provider == _ProviderType.CALDAV:
            raise ValueError("CalDAV supports whole-series deletes only.")
        if scope == "this":
            if provider == _ProviderType.GOOGLE:
                await connector.delete_instance(
                    calendar.provider_calendar_id, event.provider_event_id, cut)
            elif provider == _ProviderType.MICROSOFT:
                occs = await connector.list_instances(
                    event.provider_event_id,
                    cut - timedelta(minutes=1), cut + timedelta(minutes=1))
                if not occs:
                    raise ValueError("Occurrence not found on the provider.")
                await connector.delete_instance(
                    calendar.provider_calendar_id, event.provider_event_id, occs[0]["id"])
            else:
                raise ValueError(f"Scoped deletes are not supported for {provider.value}.")
            await _touch_provider()
            exceptions = dict((event.recurrence or {}).get("exceptions") or {})
            exceptions[cut_key] = {"deleted": True}
            event.recurrence = {**(event.recurrence or {}), "exceptions": exceptions}
            await session.flush()
            await write_audit_entry(
                session, ctx=ctx, action=AuditAction.DELETE_EVENT,
                calendar_id=calendar.id, event_id=event.id,
                detail={"title": event.title, "scope": "this", "instance": cut_key},
            )
            return {"deleted": "instance", "scope": "this", "instance": cut_key}
        # scope == "future": truncate the series at the cut.
        trunc, _ = _split(event.recurrence, cut, event.start)
        if trunc is None:
            raise ValueError("Could not split this series' recurrence rule.")
        await connector.update_event(
            calendar.provider_calendar_id, event.provider_event_id, {"recurrence": trunc})
        await _touch_provider()
        event.recurrence = trunc
        await session.flush()
        await write_audit_entry(
            session, ctx=ctx, action=AuditAction.DELETE_EVENT,
            calendar_id=calendar.id, event_id=event.id,
            detail={"title": event.title, "scope": "future", "cut": cut_key},
        )
        return {"deleted": "future", "scope": "future", "cut": cut_key}

    if connector and event.provider_event_id and calendar.provider_writable:
        await connector.delete_event(calendar.provider_calendar_id, event.provider_event_id)
        await _touch_provider()

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
    return {"deleted": "series", "scope": "series"}


async def add_attendee(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    email: str,
    name: str | None = None,
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
        CalendarAction.MANAGE_ATTENDEES,
        event=event,
        is_owner=is_owner,
        delegation_grant=delegation_grant,
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.MANAGE_ATTENDEES, decision.reason)

    current_attendees = list(event.attendees or [])
    normalized = email.lower().strip()
    if not any(a.get("email", "").lower() == normalized for a in current_attendees):
        new_att: dict[str, str] = {"email": email}
        if name:
            new_att["name"] = name
        current_attendees.append(new_att)
        event.attendees = current_attendees

    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and event.provider_event_id and calendar.provider_writable:
        await connector.add_attendee(calendar.provider_calendar_id, event.provider_event_id, email, name)
        refreshed_token = getattr(connector, "access_token", None)
        if account and refreshed_token:
            _persist_refreshed_token(account, refreshed_token)

    await session.flush()
    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.ADD_ATTENDEE,
        calendar_id=calendar.id,
        event_id=event.id,
        detail={"email": email, "name": name},
    )
    return event


async def remove_attendee(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    email: str,
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
        CalendarAction.MANAGE_ATTENDEES,
        event=event,
        is_owner=is_owner,
        delegation_grant=delegation_grant,
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.MANAGE_ATTENDEES, decision.reason)

    normalized = email.lower().strip()
    current_attendees = [a for a in (event.attendees or []) if a.get("email", "").lower() != normalized]
    event.attendees = current_attendees

    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and event.provider_event_id and calendar.provider_writable:
        await connector.remove_attendee(calendar.provider_calendar_id, event.provider_event_id, email)
        refreshed_token = getattr(connector, "access_token", None)
        if account and refreshed_token:
            _persist_refreshed_token(account, refreshed_token)

    await session.flush()
    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.REMOVE_ATTENDEE,
        calendar_id=calendar.id,
        event_id=event.id,
        detail={"email": email},
    )
    return event


async def respond_to_event(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    event_id: str,
    response_status: str,
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
        CalendarAction.RESPOND_TO_INVITATION,
        event=event,
        is_owner=is_owner,
        delegation_grant=delegation_grant,
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.RESPOND_TO_INVITATION, decision.reason)

    norm_status = response_status.lower().strip()
    status_map = {
        "accepted": "accepted",
        "accept": "accepted",
        "declined": "declined",
        "decline": "declined",
        "tentative": "tentative",
    }
    if norm_status not in status_map:
        raise ValueError(f"Invalid response_status '{response_status}'. Allowed: accepted, declined, tentative.")
    target_status = status_map[norm_status]

    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and event.provider_event_id and calendar.provider_writable:
        await connector.respond_to_event(calendar.provider_calendar_id, event.provider_event_id, target_status)
        refreshed_token = getattr(connector, "access_token", None)
        if account and refreshed_token:
            _persist_refreshed_token(account, refreshed_token)

    # Update local attendee state if user/account email matches an attendee
    if event.attendees:
        user_email = account.provider_account_email if account else None
        if not user_email and ctx.user_id:
            from ..models.user import User
            user_obj = await session.get(User, ctx.user_id)
            if user_obj:
                user_email = user_obj.email

        if user_email:
            user_email_lower = user_email.lower().strip()
            updated_attendees = []
            matched = False
            for att in event.attendees:
                att_copy = dict(att)
                if att_copy.get("email", "").lower().strip() == user_email_lower:
                    att_copy["response_status"] = target_status
                    att_copy["status"] = target_status
                    matched = True
                updated_attendees.append(att_copy)
            if matched:
                event.attendees = updated_attendees

    await session.flush()
    await write_audit_entry(
        session,
        ctx=ctx,
        action=AuditAction.RESPOND_TO_EVENT,
        calendar_id=calendar.id,
        event_id=event.id,
        detail={"response_status": target_status},
    )
    return event



# ---------------------------------------------------------------------------
# Contacts (BRD §32): invite-extracted directory + manual curation.
# Readable by any authenticated caller — every address here was already
# visible on a synced calendar event. Writes follow the same rule as the
# REST layer: manual edits win over extraction, deletes are soft.
# ---------------------------------------------------------------------------

def _contact_out(contact) -> dict:
    return {
        "id": contact.id,
        "email": contact.email,
        "display_name": contact.display_name,
        "phone": contact.phone,
        "company": contact.company,
        "job_title": contact.job_title,
        "event_count": contact.event_count,
        "last_seen_at": contact.last_seen_at.isoformat() if contact.last_seen_at else None,
    }


async def search_contacts(
    session: AsyncSession,
    ctx: AuthContext,
    query: str = "",
    limit: int = 10,
    owner_user_id: str | None = None,
) -> list[dict]:
    from ..contacts import search_contacts as _search

    return [_contact_out(c) for c in await _search(session, query, limit, owner_user_id=owner_user_id)]


async def resolve_contact(session: AsyncSession, ctx: AuthContext, query: str, owner_user_id: str | None = None) -> dict:
    from ..contacts import resolve_contact as _resolve

    out = await _resolve(session, query, owner_user_id=owner_user_id)
    if out["status"] == "found":
        return {"status": "found", "contact": _contact_out(out["contact"])}
    if out["status"] == "ambiguous":
        return {"status": "ambiguous",
                "candidates": [_contact_out(c) for c in out["candidates"]]}
    return {"status": "not_found", "candidates": []}


async def create_contact(
    session: AsyncSession,
    ctx: AuthContext,
    email: str,
    display_name: str | None = None,
    phone: str | None = None,
    company: str | None = None,
    job_title: str | None = None,
    owner_user_id: str | None = None,
) -> dict:
    from ..contacts import create_contact as _create

    try:
        contact = await _create(
            session, email=email, display_name=display_name, owner_user_id=owner_user_id,
            phone=phone, company=company, job_title=job_title)
    except ValueError as exc:
        raise ValueError(str(exc))
    return _contact_out(contact)


async def update_contact(
    session: AsyncSession,
    ctx: AuthContext,
    contact_id: str,
    display_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    company: str | None = None,
    job_title: str | None = None,
) -> dict:
    from ..contacts import update_contact as _update

    fields = {k: v for k, v in {
        "display_name": display_name, "email": email, "phone": phone,
        "company": company, "job_title": job_title,
    }.items() if v is not None}
    try:
        contact = await _update(session, contact_id, **fields)
    except ValueError as exc:
        raise ValueError(str(exc))
    if contact is None:
        raise ValueError(f"contact {contact_id} not found")
    return _contact_out(contact)


async def delete_contact(session: AsyncSession, ctx: AuthContext, contact_id: str) -> dict:
    from ..contacts import delete_contact as _delete

    if not await _delete(session, contact_id):
        raise ValueError(f"contact {contact_id} not found")
    return {"deleted": True, "contact_id": contact_id}


async def restore_contact(session: AsyncSession, ctx: AuthContext, contact_id: str) -> dict:
    from ..contacts import restore_contact as _restore

    contact = await _restore(session, contact_id)
    if contact is None:
        raise ValueError(f"contact {contact_id} not found")
    return _contact_out(contact)


async def suggest_meeting_times(
    session: AsyncSession,
    ctx: AuthContext,
    *,
    contact_query: str,
    duration_minutes: int = 30,
    window_days: int = 7,
    window_start: datetime | None = None,
    calendar_ids: list[str] | None = None,
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
    max_results: int = 5,
) -> dict:
    """Phase 3 guided scheduling (BRD §33): resolve who → find when.

    Resolves `contact_query` against the directory, then runs the normal
    free-slot search with the user's working hours, buffers, and minimum
    notice applied. Returns candidates only — booking stays an explicit
    create_event call (the §21 authorization boundary), never a side effect
    of suggesting. Ambiguity and unknown people come back as data, not
    guesses.
    """
    from ..contacts import resolve_contact as _resolve_contact
    from ..models.user import User as _User

    if duration_minutes <= 0:
        raise ValueError("duration_minutes must be positive")
    window_days = max(1, min(window_days, 30))

    resolution = await _resolve_contact(session, contact_query)
    if resolution["status"] != "found":
        return resolution

    now = datetime.now(timezone.utc)
    start = window_start or now
    end = start + timedelta(days=window_days)

    # The user's own scheduling preferences shape every suggestion.
    hours: tuple[int, int] | None = None
    buffer = timedelta(0)
    notice = timedelta(0)
    user_obj = await session.get(_User, ctx.user_id)
    if user_obj is not None:
        try:
            sh, sm = (user_obj.working_hours_start or "09:00").split(":")
            eh, em = (user_obj.working_hours_end or "17:00").split(":")
            if sm == "00" and em == "00":
                hours = (int(sh), int(eh))
        except (ValueError, AttributeError):
            hours = None
        buffer = timedelta(minutes=user_obj.meeting_buffer_minutes or 0)
        notice = timedelta(minutes=user_obj.min_meeting_notice_minutes or 0)

    slots = await find_free_slots(
        session, ctx,
        window_start=start, window_end=end,
        duration=timedelta(minutes=duration_minutes),
        calendar_ids=calendar_ids,
        working_hours=hours, buffer=buffer, min_notice=notice, now=now,
        owner_calendar_ids=owner_calendar_ids, grants_by_calendar=grants_by_calendar,
    )
    contact = resolution["contact"]
    return {
        "status": "proposed",
        "contact": {
            "email": contact.email,
            "display_name": contact.display_name,
        },
        "duration_minutes": duration_minutes,
        "slots": [{"start": s["start"], "end": s["end"]} for s in slots[:max_results]],
    }
