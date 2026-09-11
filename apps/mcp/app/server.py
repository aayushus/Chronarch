"""Chronarch MCP server (BRD §16-19).

Every tool here is a thin wrapper around chronarch_core.ai_tools — the same
functions the built-in copilot's tool-calling loop calls (packages/core/
chronarch_core/ai_tools/tools.py). This file must never contain scheduling
logic of its own; it only: (1) authenticates the caller's scoped API key
into an AuthContext, (2) marshals MCP tool arguments into ai_tools calls,
(3) marshals results back to JSON-serializable dicts.
"""

from contextvars import ContextVar
from datetime import datetime, timedelta

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from chronarch_core import ai_tools
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


@mcp.tool()
async def list_calendars() -> list[dict]:
    """List calendars visible to this credential, with their permission flags."""
    ctx, session = await _authed_context()
    async with session:
        calendars = await ai_tools.list_calendars(session, ctx)
        return [
            {"id": c.id, "name": c.name, "kind": c.kind.value, "writable": c.provider_writable,
             "blocks_availability": c.blocks_availability}
            for c in calendars
        ]


@mcp.tool()
async def get_events(window_start: str, window_end: str, calendar_ids: list[str] | None = None) -> list[dict]:
    """Get events in [window_start, window_end) (ISO 8601), subject to this credential's permissions."""
    ctx, session = await _authed_context()
    async with session:
        events = await ai_tools.get_events(
            session, ctx,
            window_start=datetime.fromisoformat(window_start),
            window_end=datetime.fromisoformat(window_end),
            calendar_ids=calendar_ids,
        )
        return [
            {"id": e.id, "calendar_id": e.calendar_id, "title": e.title,
             "start": e.start.isoformat(), "end": e.end.isoformat(), "all_day": e.all_day}
            for e in events
        ]


@mcp.tool()
async def get_schedule(window_start: str, window_end: str) -> list[dict]:
    """Alias of get_events over all readable calendars — 'what's on my schedule'."""
    return await get_events(window_start, window_end, None)


@mcp.tool()
async def get_availability(window_start: str, window_end: str, calendar_ids: list[str] | None = None) -> list[dict]:
    """Return busy intervals across all availability-blocking calendars (BRD §11)."""
    ctx, session = await _authed_context()
    async with session:
        busy = await ai_tools.get_availability(
            session, ctx,
            window_start=datetime.fromisoformat(window_start),
            window_end=datetime.fromisoformat(window_end),
            calendar_ids=calendar_ids,
        )
        return [{"start": b["start"].isoformat(), "end": b["end"].isoformat()} for b in busy]


@mcp.tool()
async def find_free_slots(
    window_start: str,
    window_end: str,
    duration_minutes: int,
    calendar_ids: list[str] | None = None,
) -> list[dict]:
    """Find open slots of at least duration_minutes in [window_start, window_end)."""
    ctx, session = await _authed_context()
    async with session:
        slots = await ai_tools.find_free_slots(
            session, ctx,
            window_start=datetime.fromisoformat(window_start),
            window_end=datetime.fromisoformat(window_end),
            duration=timedelta(minutes=duration_minutes),
            calendar_ids=calendar_ids,
        )
        return [{"start": s["start"].isoformat(), "end": s["end"].isoformat()} for s in slots]


@mcp.tool()
async def find_conflicts(window_start: str, window_end: str, calendar_ids: list[str] | None = None) -> list[dict]:
    """Alias of get_availability scoped to a proposed window — used to check before creating an event."""
    return await get_availability(window_start, window_end, calendar_ids)


@mcp.tool()
async def create_event(
    calendar_id: str,
    title: str,
    start: str,
    end: str,
    description: str | None = None,
    location: str | None = None,
) -> dict:
    """Create an event. WRITE-tier: callers should preview before committing (BRD §21)."""
    ctx, session = await _authed_context()
    async with session:
        try:
            event = await ai_tools.create_event(
                session, ctx, calendar_id=calendar_id, title=title,
                start=datetime.fromisoformat(start), end=datetime.fromisoformat(end),
                description=description, location=location,
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"id": event.id, "title": event.title, "start": event.start.isoformat(), "end": event.end.isoformat()}


@mcp.tool()
async def move_event(event_id: str, start: str, end: str) -> dict:
    """Reschedule an event to a new start/end. WRITE-tier."""
    ctx, session = await _authed_context()
    async with session:
        try:
            event = await ai_tools.move_event(
                session, ctx, event_id=event_id,
                new_start=datetime.fromisoformat(start), new_end=datetime.fromisoformat(end),
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"id": event.id, "start": event.start.isoformat(), "end": event.end.isoformat()}


@mcp.tool()
async def delete_event(event_id: str) -> dict:
    """Cancel/delete an event. DESTRUCTIVE-tier: callers must confirm before invoking (BRD §21)."""
    ctx, session = await _authed_context()
    async with session:
        try:
            await ai_tools.delete_event(session, ctx, event_id=event_id)
        except ai_tools.PermissionDenied as exc:
            return {"error": str(exc)}
        await session.commit()
        return {"status": "deleted", "id": event_id}


@mcp.tool()
async def add_attendee(event_id: str, email: str) -> dict:
    """Not yet implemented — attendee management lands with BR-EVT-005."""
    return {"error": "add_attendee is not yet implemented"}


@mcp.tool()
async def remove_attendee(event_id: str, email: str) -> dict:
    """Not yet implemented — attendee management lands with BR-EVT-005."""
    return {"error": "remove_attendee is not yet implemented"}


@mcp.tool()
async def respond_to_event(event_id: str, response: str) -> dict:
    """Not yet implemented — RSVP handling lands with BR-EVT-005."""
    return {"error": "respond_to_event is not yet implemented"}


async def _healthz(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def build_app() -> Starlette:
    app = mcp.streamable_http_app()
    app.add_middleware(APIKeyMiddleware)
    app.add_route("/healthz", _healthz)
    return app


app = build_app()
