"""Chronarch MCP server (BRD §16-19).

Every tool here is a thin wrapper around chronarch_core.ai_tools — the same
functions the built-in copilot's tool-calling loop calls (packages/core/
chronarch_core/ai_tools/tools.py). This file must never contain scheduling
logic of its own; it only: (1) authenticates the caller's scoped API key
into an AuthContext, (2) marshals MCP tool arguments into ai_tools calls,
(3) marshals results back to JSON-serializable dicts.

Auth semantics (see apps/mcp/app/auth.py): MCP callers are never
owner-bypassed — even the calendar owner's own credential must pass the
calendar's AI gates plus credential scopes. Deny-by-default is intentional.
"""

from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
import os

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from chronarch_core import ai_tools
from chronarch_core.permissions import describe_denial
from chronarch_core.prompts import tool_description
from chronarch_core.db import SessionLocal

from .auth import InvalidCredential, resolve_auth_context

_current_api_key: ContextVar[str | None] = ContextVar("_current_api_key", default=None)

mcp = FastMCP("chronarch")


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Extracts the caller's scoped API key (BRD §19) from the Authorization
    header into a contextvar tools read from — MCP tool functions have no
    direct access to the inbound HTTP request."""

    async def dispatch(self, request: Request, call_next):
        auth_header = request.headers.get("authorization", "")
        api_key = auth_header.removeprefix("Bearer ").strip() if auth_header else None
        token = _current_api_key.set(api_key)
        try:
            return await call_next(request)
        finally:
            _current_api_key.reset(token)


async def _authed_context():
    api_key = _current_api_key.get()
    if not api_key:
        raise InvalidCredential("Missing Authorization: Bearer <api-key> header")
    async with SessionLocal() as session:
        ctx = await resolve_auth_context(session, api_key)
        return ctx, session


async def _caller_timezone(session, ctx, explicit: str | None) -> str:
    """Timezone for interpreting naive datetimes from this caller: explicit
    per-call zone first, then the credential owner's stored home zone
    (kept fresh by their browser), else UTC. Never the server zone."""
    from chronarch_core.timezones import normalize_timezone
    from chronarch_core.models.user import User

    if explicit and explicit.strip():
        return normalize_timezone(explicit)
    if ctx.user_id:
        user = await session.get(User, ctx.user_id)
        if user is not None and user.home_timezone:
            return normalize_timezone(user.home_timezone)
    return "UTC"


def _as_aware(value: str, tz_name: str) -> datetime:
    from chronarch_core.timezones import ensure_aware

    return ensure_aware(datetime.fromisoformat(value), tz_name)


@mcp.tool(description=tool_description("mcp", "list_accounts"))
async def list_accounts() -> list[dict]:
    """Prompt: prompts/mcp/tools/list_accounts.md."""
    ctx, session = await _authed_context()
    async with session:
        return await ai_tools.list_accounts(session, ctx)


@mcp.tool(description=tool_description("mcp", "list_calendars"))
async def list_calendars() -> list[dict]:
    """Prompt: prompts/mcp/tools/list_calendars.md."""
    from chronarch_core.permissions import CalendarAction, resolve_permission

    ctx, session = await _authed_context()
    async with session:
        calendars = await ai_tools.list_calendars(session, ctx)
        out = []
        for c in calendars:
            # MCP callers are never owners — gate on scopes + ai_can_* flags.
            can_create = resolve_permission(ctx, c, CalendarAction.CREATE).allowed
            can_delete = resolve_permission(ctx, c, CalendarAction.DELETE).allowed
            out.append(
                {"id": c.id, "name": c.name, "kind": c.kind.value,
                 "writable": can_create,
                 "provider_writable": c.provider_writable,
                 "can_create": can_create, "can_delete": can_delete,
                 "blocks_availability": c.blocks_availability}
            )
        return out


@mcp.tool(description=tool_description("mcp", "get_event"))
async def get_event(event_id: str) -> dict:
    """Prompt: prompts/mcp/tools/get_event.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            e = await ai_tools.get_event(session, ctx, event_id=event_id)
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": str(exc)}
        return {
            "id": e.id, "calendar_id": e.calendar_id, "title": e.title,
            "description": e.description, "start": e.start.isoformat(), "end": e.end.isoformat(),
            "timezone": e.timezone, "all_day": e.all_day, "location": e.location, "attendees": e.attendees,
            "busy_status": e.busy_status.value if hasattr(e.busy_status, "value") else str(e.busy_status),
        }


@mcp.tool(description=tool_description("mcp", "get_events"))
async def get_events(window_start: str, window_end: str, calendar_ids: list[str] | None = None) -> list[dict]:
    """Prompt: prompts/mcp/tools/get_events.md."""
    ctx, session = await _authed_context()
    async with session:
        tz_name = await _caller_timezone(session, ctx, None)
        events = await ai_tools.get_events(
            session, ctx,
            window_start=_as_aware(window_start, tz_name),
            window_end=_as_aware(window_end, tz_name),
            calendar_ids=calendar_ids,
        )
        return [
            {"id": e.id, "calendar_id": e.calendar_id, "title": e.title,
             "start": e.start.isoformat(), "end": e.end.isoformat(),
             "timezone": e.timezone, "all_day": e.all_day}
            for e in events
        ]


@mcp.tool(description=tool_description("mcp", "get_schedule"))
async def get_schedule(window_start: str, window_end: str) -> list[dict]:
    """Prompt: prompts/mcp/tools/get_schedule.md."""
    return await get_events(window_start, window_end, None)


@mcp.tool(description=tool_description("mcp", "get_availability"))
async def get_availability(window_start: str, window_end: str, calendar_ids: list[str] | None = None) -> list[dict]:
    """Prompt: prompts/mcp/tools/get_availability.md."""
    ctx, session = await _authed_context()
    async with session:
        tz_name = await _caller_timezone(session, ctx, None)
        busy = await ai_tools.get_availability(
            session, ctx,
            window_start=_as_aware(window_start, tz_name),
            window_end=_as_aware(window_end, tz_name),
            calendar_ids=calendar_ids,
        )
        return [{"start": b["start"].isoformat(), "end": b["end"].isoformat()} for b in busy]


@mcp.tool(description=tool_description("mcp", "find_free_slots"))
async def find_free_slots(
    window_start: str,
    window_end: str,
    duration_minutes: int,
    calendar_ids: list[str] | None = None,
    working_hours_start: int | None = None,
    working_hours_end: int | None = None,
    buffer_minutes: int = 0,
    min_notice_minutes: int = 0,
) -> list[dict]:
    """Prompt: prompts/mcp/tools/find_free_slots.md."""
    ctx, session = await _authed_context()
    async with session:
        if (working_hours_start is None) != (working_hours_end is None):
            return [{"error": "working_hours_start and working_hours_end must be provided together"}]
        working_hours = None
        if working_hours_start is not None and working_hours_end is not None:
            if not (0 <= working_hours_start < working_hours_end <= 24):
                return [{"error": "working hours must satisfy 0 <= start < end <= 24"}]
            working_hours = (working_hours_start, working_hours_end)
        if buffer_minutes < 0 or min_notice_minutes < 0:
            return [{"error": "buffer_minutes and min_notice_minutes must be >= 0"}]
        tz_name = await _caller_timezone(session, ctx, None)
        slots = await ai_tools.find_free_slots(
            session, ctx,
            window_start=_as_aware(window_start, tz_name),
            window_end=_as_aware(window_end, tz_name),
            duration=timedelta(minutes=duration_minutes),
            calendar_ids=calendar_ids,
            working_hours=working_hours,
            buffer=timedelta(minutes=buffer_minutes),
            min_notice=timedelta(minutes=min_notice_minutes),
            now=datetime.now(timezone.utc),
        )
        return [{"start": s["start"].isoformat(), "end": s["end"].isoformat()} for s in slots]


@mcp.tool(description=tool_description("mcp", "find_conflicts"))
async def find_conflicts(
    window_start: str,
    window_end: str,
    calendar_ids: list[str] | None = None,
    exclude_event_id: str | None = None,
) -> list[dict]:
    """Prompt: prompts/mcp/tools/find_conflicts.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            tz_name = await _caller_timezone(session, ctx, None)
            hits = await ai_tools.get_conflicts(
                session, ctx,
                window_start=_as_aware(window_start, tz_name),
                window_end=_as_aware(window_end, tz_name),
                exclude_event_id=exclude_event_id,
                calendar_ids=calendar_ids,
            )
        except ValueError as exc:
            return [{"error": f"invalid window: {exc}"}]
        return [
            {
                "event_id": h["event_id"], "calendar_id": h["calendar_id"],
                "calendar_name": h["calendar_name"], "title": h["title"],
                "start": h["start"].isoformat(), "end": h["end"].isoformat(),
                "all_day": h["all_day"], "redacted": h["redacted"],
            }
            for h in hits
        ]


@mcp.tool(description=tool_description("mcp", "create_event"))
async def create_event(
    calendar_id: str,
    title: str,
    start: str,
    end: str,
    description: str | None = None,
    location: str | None = None,
    timezone: str | None = None,
    all_day: bool = False,
) -> dict:
    """Prompt: prompts/mcp/tools/create_event.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            tz_name = await _caller_timezone(session, ctx, timezone)
            event = await ai_tools.create_event(
                session, ctx, calendar_id=calendar_id, title=title,
                start=_as_aware(start, tz_name), end=_as_aware(end, tz_name),
                timezone=tz_name, description=description, location=location,
                all_day=all_day,
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": f"invalid window: {exc}"}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"id": event.id, "title": event.title, "start": event.start.isoformat(), "end": event.end.isoformat(),
                "timezone": event.timezone}


@mcp.tool(description=tool_description("mcp", "move_event"))
async def move_event(event_id: str, start: str, end: str, timezone: str | None = None) -> dict:
    """Prompt: prompts/mcp/tools/move_event.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            tz_name = await _caller_timezone(session, ctx, timezone)
            event = await ai_tools.move_event(
                session, ctx, event_id=event_id,
                new_start=_as_aware(start, tz_name), new_end=_as_aware(end, tz_name),
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": f"invalid window: {exc}"}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"id": event.id, "start": event.start.isoformat(), "end": event.end.isoformat()}


@mcp.tool(description=tool_description("mcp", "move_event_between_calendars"))
async def move_event_between_calendars(event_id: str, destination_calendar_id: str) -> dict:
    """Prompt: prompts/mcp/tools/move_event_between_calendars.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            event = await ai_tools.move_event_between_calendars(
                session, ctx, event_id=event_id,
                destination_calendar_id=destination_calendar_id,
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"id": event.id, "calendar_id": event.calendar_id,
                "start": event.start.isoformat(), "end": event.end.isoformat()}


@mcp.tool(description=tool_description("mcp", "update_event"))
async def update_event(
    event_id: str,
    title: str | None = None,
    description: str | None = None,
    location: str | None = None,
    start: str | None = None,
    end: str | None = None,
    timezone: str | None = None,
    all_day: bool | None = None,
) -> dict:
    """Prompt: prompts/mcp/tools/update_event.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            tz_name = await _caller_timezone(session, ctx, timezone)
            event = await ai_tools.update_event(
                session, ctx, event_id=event_id, title=title, description=description,
                location=location,
                start=_as_aware(start, tz_name) if start else None,
                end=_as_aware(end, tz_name) if end else None,
                timezone=tz_name if timezone else None,
                all_day=all_day,
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {
            "id": event.id, "title": event.title,
            "start": event.start.isoformat(), "end": event.end.isoformat(),
            "timezone": event.timezone,
            "location": event.location, "description": event.description,
            "all_day": event.all_day,
        }


@mcp.tool(description=tool_description("mcp", "delete_event"))
async def delete_event(event_id: str) -> dict:
    """Prompt: prompts/mcp/tools/delete_event.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            await ai_tools.delete_event(session, ctx, event_id=event_id)
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"status": "deleted", "id": event_id}


@mcp.tool(description=tool_description("mcp", "add_attendee"))
async def add_attendee(event_id: str, email: str, name: str | None = None) -> dict:
    """Prompt: prompts/mcp/tools/add_attendee.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            event = await ai_tools.add_attendee(session, ctx, event_id=event_id, email=email, name=name)
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"status": "ok", "id": event_id, "attendees": event.attendees}


@mcp.tool(description=tool_description("mcp", "remove_attendee"))
async def remove_attendee(event_id: str, email: str) -> dict:
    """Prompt: prompts/mcp/tools/remove_attendee.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            event = await ai_tools.remove_attendee(session, ctx, event_id=event_id, email=email)
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"status": "ok", "id": event_id, "attendees": event.attendees}


@mcp.tool(description=tool_description("mcp", "respond_to_event"))
async def respond_to_event(event_id: str, response: str) -> dict:
    """Prompt: prompts/mcp/tools/respond_to_event.md."""
    ctx, session = await _authed_context()
    async with session:
        try:
            await ai_tools.respond_to_event(session, ctx, event_id=event_id, response_status=response)
        except ai_tools.PermissionDenied as exc:
            return {"error": describe_denial(exc.action, exc.reason)}
        except ValueError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"status": "ok", "id": event_id}



async def _healthz(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def _get_cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        if raw.strip() == "*":
            return ["*"]
        return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    return [os.environ.get("APP_BASE_URL", "http://localhost:3000").rstrip("/")]


def build_app() -> Starlette:
    app = mcp.streamable_http_app()
    app.add_middleware(APIKeyMiddleware)
    # Browser-based MCP clients (e.g. the admin Settings > System page)
    # need cross-origin access. Default is same-origin-only via APP_BASE_URL;
    # set CORS_ORIGINS explicitly in production. Wildcard never sends
    # credentials — browsers reject `*` with Allow-Credentials.
    cors_origins = _get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=cors_origins != ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_route("/healthz", _healthz)
    return app


app = build_app()
