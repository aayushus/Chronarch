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
    owner_calendar_ids: set[str] | None = None,
    grants_by_calendar: dict | None = None,
) -> list[dict]:
    calendars = await _readable_calendars(
        session, ctx, calendar_ids, owner_calendar_ids=owner_calendar_ids, grants_by_calendar=grants_by_calendar
    )
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

    stmt = select(UnifiedEvent).where(
        UnifiedEvent.calendar_id.in_(blocking_ids),
        UnifiedEvent.start < window_end,
        UnifiedEvent.end > window_start,
    )
    events = list((await session.execute(stmt)).scalars())
    # SQLite drops tzinfo on read (prod Postgres timestamptz does not), so
    # align event instants to the window's awareness before comparing.
    # Stored instants are UTC; a naive side is assumed UTC.
    probed = [
        _Probe(e.id, e.calendar_id, _align_tz(e.start, window_start), _align_tz(e.end, window_start), e.busy_status)
        for e in events
    ]
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
    is_owner: bool = False,
    delegation_grant=None,
) -> UnifiedEvent:
    _validate_window(start, end)
    from ..timezones import normalize_timezone

    timezone = normalize_timezone(timezone)
    calendar = await _get_calendar(session, calendar_id)
    decision = resolve_permission(
        ctx, calendar, CalendarAction.CREATE, is_owner=is_owner, delegation_grant=delegation_grant
    )
    if not decision.allowed:
        raise PermissionDenied(CalendarAction.CREATE, decision.reason)
    provider_event_id = ""
    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and calendar.provider_writable:
        from ..connectors.base import RemoteEvent

        remote_req = RemoteEvent(
            provider_event_id="",
            title=title,
            description=description,
            start=start,
            end=end,
            timezone=timezone,
            all_day=all_day,
            organizer=None,
            attendees=attendees or [],
            location=location,
            conference=None,
            recurrence=None,
            visibility="standard",
            busy_status="busy",
            writable=True,
            provider_updated_at=None,
        )
        created_remote = await connector.create_event(calendar.provider_calendar_id, remote_req)
        provider_event_id = created_remote.provider_event_id
        refreshed_token = getattr(connector, "access_token", None)
        if account and refreshed_token:
            _persist_refreshed_token(account, refreshed_token)

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
    is_owner: bool = False,
    delegation_grant=None,
) -> UnifiedEvent:
    """Full-field edit (BRD §18 `update_event`). Field-level updates ride
    on the EDIT permission; a time change additionally requires RESCHEDULE.
    At least one field must be provided. Writes through to the provider
    when the calendar is provider-writable, then audits as UPDATE_EVENT.
    """
    from ..permissions import CalendarAction as _Action

    event = await session.get(UnifiedEvent, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")
    calendar = await _get_calendar(session, event.calendar_id)

    if all(v is None for v in (title, description, location, start, end, timezone, all_day)):
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
    if start is not None or end is not None or all_day is not None:
        resched_decision = resolve_permission(
            ctx, calendar, _Action.RESCHEDULE, event=event, is_owner=is_owner, delegation_grant=delegation_grant,
        )
        if not resched_decision.allowed:
            raise PermissionDenied(_Action.RESCHEDULE, resched_decision.reason)

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

    connector, account = await _get_connector_for_calendar(session, calendar)
    if connector and event.provider_event_id and calendar.provider_writable:
        await connector.delete_event(calendar.provider_calendar_id, event.provider_event_id)
        refreshed_token = getattr(connector, "access_token", None)
        if account and refreshed_token:
            _persist_refreshed_token(account, refreshed_token)

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

