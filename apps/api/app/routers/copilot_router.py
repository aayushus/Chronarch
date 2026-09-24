"""Built-In AI Copilot Router (BRD §4.4, §20, §31).

Provides `POST /api/v1/copilot/chat`:
- Proxies conversational scheduling requests to the LiteLLM container.
- Defines OpenAI-standard function-calling schemas for internal `ai_tools`
  (`list_calendars`, `get_event`, `get_events`, `get_availability`,
  `find_free_slots`, `get_conflicts`, `create_event`, `update_event`,
  `move_event`, `delete_event`, `add_attendee`, `remove_attendee`,
  `respond_to_event`, `list_accounts`), plus a deterministic
  `resolve_date_range` helper (no `ai_tools` call — pure date math) so the
  model resolves "today"/"this week"/etc. without doing that arithmetic
  itself.
- Executes function calls in an iterative loop against `ai_tools`, passing
  results back to the model until a conversational response or action confirmation
  is produced.
- Enforces strict user authentication, permissions, and audit logging with
  `ActorType.COPILOT`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
import httpx
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import ai_tools
from chronarch_core.prompts import render_system_prompt, tool_description
from chronarch_core.models.enums import ActorType
from chronarch_core.permissions import CalendarAction, resolve_permission
from chronarch_core.models.user import User

from ..auth import build_auth_context, get_current_user
from ..deps import get_db_session
from ..permission_helpers import get_delegation_grants, get_owned_calendar_ids

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/copilot", tags=["copilot"])


def _friendly_litellm_error(status_code: int, *, key_configured: bool = True) -> str:
    """User-facing summary for a LiteLLM failure (BRD §20.4: surface, don't
    dump). Each message names the fix; provider internals stay in logs."""
    if status_code == 401:
        if not key_configured:
            return (
                "No AI provider key is saved yet. "
                "Add one under Settings → AI & Copilot and try again."
            )
        return (
            "The AI provider rejected the saved API key. "
            "Re-check the keys under Settings → AI & Copilot and save again."
        )
    if status_code == 429:
        return "The AI service is rate-limiting us. Wait a minute and try again."
    if status_code == 400:
        return "The AI request was rejected — the conversation may be too long. Start a new chat and try a shorter request."
    if status_code == 404:
        return (
            "The configured AI model is no longer available on OpenRouter "
            "(free-tier models rotate without notice). "
            "Pick a current free model under Settings → AI & Copilot and try again."
        )
    if status_code in (502, 503, 504):
        return "The AI service is having trouble right now. Try again in a bit."
    return "The AI service returned an unexpected error. Try again in a bit."

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000/v1/chat/completions")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "sk-litellm-dev")

COPILOT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_calendars",
            "description": tool_description("copilot", "list_calendars"),
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_date_range",
            "description": tool_description("copilot", "resolve_date_range"),
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["today", "tomorrow", "yesterday", "this_week", "next_week", "last_week", "this_month", "next_month"],
                        "description": "The relative period to resolve into exact boundaries.",
                    },
                    "anchor_date": {
                        "type": "string",
                        "description": "Optional YYYY-MM-DD to resolve the period relative to, instead of today.",
                    },
                },
                "required": ["period"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_events",
            "description": tool_description("copilot", "get_events"),
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["today", "tomorrow", "yesterday", "this_week", "next_week", "last_week", "this_month", "next_month"],
                        "description": "Preferred over window_start/window_end for a relative range — resolved server-side, so it can't be miscalculated. Use this whenever the request is phrased relatively.",
                    },
                    "window_start": {"type": "string", "description": "Start timestamp (ISO 8601 with offset, e.g. 2026-09-11T09:00:00-07:00). Omit if period is given."},
                    "window_end": {"type": "string", "description": "End timestamp (ISO 8601 with offset, e.g. 2026-09-11T18:00:00-07:00). Omit if period is given."},
                    "calendar_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of calendar IDs to query",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_free_slots",
            "description": tool_description("copilot", "find_free_slots"),
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["today", "tomorrow", "yesterday", "this_week", "next_week", "last_week", "this_month", "next_month"],
                        "description": "Preferred over window_start/window_end for a relative range — resolved server-side, so it can't be miscalculated.",
                    },
                    "window_start": {"type": "string", "description": "Start timestamp (ISO 8601). Omit if period is given."},
                    "window_end": {"type": "string", "description": "End timestamp (ISO 8601). Omit if period is given."},
                    "duration_minutes": {"type": "integer", "description": "Desired duration in minutes (e.g. 30, 45, 60)"},
                },
                "required": ["duration_minutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": tool_description("copilot", "create_event"),
            "parameters": {
                "type": "object",
                "properties": {
                    "calendar_id": {"type": "string", "description": "Target calendar ID"},
                    "title": {"type": "string", "description": "Event title"},
                    "start": {"type": "string", "description": "Start timestamp (ISO 8601, with offset, e.g. 2026-09-14T09:00:00-07:00)"},
                    "end": {"type": "string", "description": "End timestamp (ISO 8601, with offset)"},
                    "description": {"type": "string", "description": "Event description"},
                    "location": {"type": "string", "description": "Event location"},
                    "timezone": {"type": "string", "description": "IANA zone for naive times, e.g. America/Los_Angeles"},
                    "all_day": {"type": "boolean", "description": "Whether event is all-day"},
                    "attendees": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": 'Attendees as [{"email": "...", "name": "..."}]',
                    },
                },
                "required": ["calendar_id", "title", "start", "end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_event",
            "description": tool_description("copilot", "get_event"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID"},
                },
                "required": ["event_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_conflicts",
            "description": tool_description("copilot", "get_conflicts"),
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["today", "tomorrow", "yesterday", "this_week", "next_week", "last_week", "this_month", "next_month"],
                        "description": "Preferred over window_start/window_end for a relative range — resolved server-side, so it can't be miscalculated.",
                    },
                    "window_start": {"type": "string", "description": "Start timestamp (ISO 8601). Omit if period is given."},
                    "window_end": {"type": "string", "description": "End timestamp (ISO 8601). Omit if period is given."},
                    "exclude_event_id": {"type": "string", "description": "Skip this event (the one being moved)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_event",
            "description": tool_description("copilot", "update_event"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID to edit"},
                    "title": {"type": "string", "description": "New title"},
                    "description": {"type": "string", "description": "New description"},
                    "location": {"type": "string", "description": "New location"},
                    "all_day": {"type": "boolean", "description": "Toggle all-day flag in place (times unchanged)"},
                    "scope": {"type": "string", "enum": ["series", "this", "future"], "description": "Repeating events only: whole series (default), one occurrence, or this-and-future."},
                    "instance_time": {"type": "string", "description": "Which occurrence for scoped edits (ISO 8601 with offset). Omit for the next upcoming one."},
                },
                "required": ["event_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_event",
            "description": tool_description("copilot", "move_event"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID to move"},
                    "new_start": {"type": "string", "description": "New start timestamp (ISO 8601 with offset)"},
                    "new_end": {"type": "string", "description": "New end timestamp (ISO 8601 with offset)"},
                    "new_all_day": {"type": "boolean", "description": "Whether event is all-day"},
                },
                "required": ["event_id", "new_start", "new_end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_attendee",
            "description": tool_description("copilot", "add_attendee"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID"},
                    "email": {"type": "string", "description": "Attendee email address"},
                    "name": {"type": "string", "description": "Attendee display name (optional)"},
                    "confirmed": {
                        "type": "boolean",
                        "description": "Must be true only if the user has explicitly confirmed inviting this exact person.",
                    },
                },
                "required": ["event_id", "email"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_attendee",
            "description": tool_description("copilot", "remove_attendee"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID"},
                    "email": {"type": "string", "description": "Attendee email address to remove"},
                },
                "required": ["event_id", "email"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "respond_to_event",
            "description": tool_description("copilot", "respond_to_event"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID"},
                    "response": {"type": "string", "description": "One of: accepted, declined, tentative"},
                    "confirmed": {
                        "type": "boolean",
                        "description": "Must be true only if the user has explicitly confirmed this exact RSVP.",
                    },
                },
                "required": ["event_id", "response"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_availability",
            "description": tool_description("copilot", "get_availability"),
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["today", "tomorrow", "yesterday", "this_week", "next_week", "last_week", "this_month", "next_month"],
                        "description": "Preferred over window_start/window_end for a relative range — resolved server-side, so it can't be miscalculated.",
                    },
                    "window_start": {"type": "string", "description": "Start timestamp (ISO 8601 with offset). Omit if period is given."},
                    "window_end": {"type": "string", "description": "End timestamp (ISO 8601 with offset). Omit if period is given."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_accounts",
            "description": tool_description("copilot", "list_accounts"),
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_event_between_calendars",
            "description": tool_description("copilot", "move_event_between_calendars"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID to move"},
                    "destination_calendar_id": {"type": "string", "description": "Target calendar ID"},
                },
                "required": ["event_id", "destination_calendar_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_event",
            "description": tool_description("copilot", "delete_event"),
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID to delete"},
                    "confirmed": {
                        "type": "boolean",
                        "description": "Must be true only if the user has explicitly confirmed deleting this specific event.",
                    },
                    "scope": {"type": "string", "enum": ["series", "this", "future"], "description": "Repeating events only: whole series (default), one occurrence, or this-and-future."},
                    "instance_time": {"type": "string", "description": "Which occurrence for scoped deletes (ISO 8601 with offset). Omit for the next upcoming one."},
                },
                "required": ["event_id"],
            },
        },
    },
        {
            "type": "function",
            "function": {
                "name": "search_contacts",
                "description": tool_description("copilot", "search_contacts"),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Name, email, or company substring. Empty lists everyone, most-met first."},
                        "limit": {"type": "integer", "description": "Max results (default 10)."},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "resolve_contact",
                "description": tool_description("copilot", "resolve_contact"),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "A name ('Sarah') or email to resolve to one contact."},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_contact",
                "description": tool_description("copilot", "create_contact"),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "email": {"type": "string", "description": "Email address (required, must be new)."},
                        "name": {"type": "string", "description": "Display name (optional)."},
                        "phone": {"type": "string", "description": "Phone (optional)."},
                        "company": {"type": "string", "description": "Company (optional)."},
                        "job_title": {"type": "string", "description": "Job title (optional)."},
                    },
                    "required": ["email"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "update_contact",
                "description": tool_description("copilot", "update_contact"),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "contact_id": {"type": "string", "description": "Contact ID from search/resolve."},
                        "name": {"type": "string", "description": "New display name (optional)."},
                        "email": {"type": "string", "description": "New email (optional, must stay unique)."},
                        "phone": {"type": "string", "description": "New phone (optional)."},
                        "company": {"type": "string", "description": "New company (optional)."},
                        "job_title": {"type": "string", "description": "New job title (optional)."},
                    },
                    "required": ["contact_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "delete_contact",
                "description": tool_description("copilot", "delete_contact"),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "contact_id": {"type": "string", "description": "Contact ID to remove."},
                        "confirmed": {
                            "type": "boolean",
                            "description": "Must be true only if the user has explicitly confirmed removing this specific contact.",
                        },
                    },
                    "required": ["contact_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "restore_contact",
                "description": tool_description("copilot", "restore_contact"),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "contact_id": {"type": "string", "description": "Contact ID to bring back."},
                    },
                    "required": ["contact_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "suggest_meeting_times",
                "description": tool_description("copilot", "suggest_meeting_times"),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "contact_query": {"type": "string", "description": "Name or email of the person to meet ('Sarah', 'sarah@acme.com')."},
                        "duration_minutes": {"type": "integer", "description": "Meeting length in minutes (default 30)."},
                        "window_days": {"type": "integer", "description": "How many days ahead to search (default 7, max 30)."},
                    },
                    "required": ["contact_query"],
                },
            },
        },
    ]


class ChatMessage(BaseModel):
    role: str
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    user_time: str | None = None  # User's current local ISO timestamp for relative date resolution
    viewed_date: str | None = None  # Active date in the user's calendar viewport
    view_mode: str | None = None  # Active view: "day" | "week" | "month" | "year"
    user_timezone: str | None = None  # Browser IANA zone, e.g. America/Los_Angeles
    include_trace: bool = False  # Echo the tool trace (for evals/debugging, not chat)


def _confirmation_ref(key: str) -> str:
    return f"(confirmation-ref: {key})"


def _already_previewed(history: list[dict[str, Any]], key: str) -> bool:
    """Whether a prior turn in *this conversation* already surfaced a
    requires_confirmation preview for this exact action (keyed by
    event_id, or event_id plus a discriminator like an attendee email).

    The model's own `confirmed` argument is never trusted on its own — a
    single unconfirmed user message ("delete my X meeting", "invite Y")
    is enough for a model to just set confirmed=true on its first
    attempt, skipping the human entirely. Only a genuine round-trip may
    unlock the real action.

    The check anchors on prior ASSISTANT content, not tool-role messages:
    the web client (apps/web/src/api/calendar.ts) strips every resent
    message down to {role, content} before the next request, so a
    tool-role message from an earlier turn never comes back — only
    assistant/user text survives the round trip. Every confirmation
    prompt therefore carries a stable ref token in its visible text so
    this check can recognize it later without needing any server-side
    session state.
    """
    marker = _confirmation_ref(key)
    for msg in history:
        if msg.get("role") == "assistant" and marker in (msg.get("content") or ""):
            return True
    return False


_PERIODS = ["today", "tomorrow", "yesterday", "this_week", "next_week", "last_week", "this_month", "next_month"]


def _period_bounds(period: str, tz_name: str, now: datetime | None, anchor_date: str | None = None) -> tuple[datetime, datetime] | None:
    """Deterministic calendar-math for relative periods — computed in
    Python, never by the model. Returns None for an unrecognized period.

    The window-leak bug (next-day events appearing under a "today" query)
    traced to the model constructing window_start/window_end by hand from
    {now}; that arithmetic was unreliable the same way UTC-to-local
    display conversion was. Giving the model a resolve_date_range tool to
    call first wasn't sufficient on its own — live testing showed it
    would call the tool, get the right boundary back, and then still not
    faithfully carry that value into the next get_events call. So `period`
    is also accepted directly by get_events/get_conflicts/find_free_slots/
    get_availability and resolved right here in the same dispatch — no
    intermediate value for the model to drop or miscopy.
    """
    from datetime import timedelta
    from zoneinfo import ZoneInfo

    zone = ZoneInfo(tz_name)
    if anchor_date:
        anchor = datetime.fromisoformat(anchor_date).replace(tzinfo=zone)
    elif now is not None:
        anchor = (now if now.tzinfo else now.replace(tzinfo=zone)).astimezone(zone)
    else:
        anchor = datetime.now(zone)
    day_start = anchor.replace(hour=0, minute=0, second=0, microsecond=0)
    monday = day_start - timedelta(days=day_start.weekday())
    month_start = day_start.replace(day=1)
    next_month_start = (month_start + timedelta(days=32)).replace(day=1)

    ranges = {
        "today": (day_start, day_start + timedelta(days=1)),
        "tomorrow": (day_start + timedelta(days=1), day_start + timedelta(days=2)),
        "yesterday": (day_start - timedelta(days=1), day_start),
        "this_week": (monday, monday + timedelta(days=7)),
        "next_week": (monday + timedelta(days=7), monday + timedelta(days=14)),
        "last_week": (monday - timedelta(days=7), monday),
        "this_month": (month_start, next_month_start),
        "next_month": (next_month_start, (next_month_start + timedelta(days=32)).replace(day=1)),
    }
    return ranges.get(period)


def _resolve_date_range(period: str, tz_name: str, now: datetime | None, anchor_date: str | None) -> dict[str, Any]:
    bounds = _period_bounds(period, tz_name, now, anchor_date)
    if bounds is None:
        return {"error": f"Unknown period '{period}'. Use one of: {', '.join(_PERIODS)}."}
    start, end = bounds
    return {
        "period": period,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "start_local": _local_time_str(start, tz_name),
        "end_local": _local_time_str(end, tz_name),
    }


def _local_time_str(dt: datetime, tz_name: str) -> str:
    """Pre-converted local-time string for the model to echo verbatim.

    The model was doing its own UTC-to-local arithmetic when rendering
    event times in prose and getting it wrong by 1-2 hours inconsistently
    (verified live against DB ground truth). Every tool result that
    carries a start/end must hand back an already-localized string in the
    acting user's own zone (never a hardcoded one — `tz_name` is always
    the caller's resolved `default_tz`) so there is no arithmetic left
    for the model to get wrong.
    """
    from datetime import timezone as _tz
    from zoneinfo import ZoneInfo

    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=_tz.utc)
    try:
        local = aware.astimezone(ZoneInfo(tz_name))
    except Exception:
        local = aware.astimezone(_tz.utc)
    return local.strftime("%Y-%m-%d %I:%M %p %Z").replace(" 0", " ", 1)


async def _execute_tool(
    name: str,
    args: dict[str, Any],
    session: AsyncSession,
    ctx: Any,
    owned_ids: set[str],
    grants: dict[str, Any],
    now: datetime | None = None,
    default_tz: str | None = None,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:

    """Dispatch copilot tool execution to internal `ai_tools`.

    `default_tz` is the caller's IANA zone (request zone, else stored home
    zone): naive datetimes from the model resolve in it — never UTC, never
    the server zone — mirroring the MCP contract.
    """
    from datetime import timedelta

    from chronarch_core.timezones import ensure_aware

    tz = default_tz or "UTC"

    def _aware(value: str) -> datetime:
        return ensure_aware(datetime.fromisoformat(value), default_tz)

    def _local(dt: datetime) -> str:
        return _local_time_str(dt, tz)

    def _window(args: dict[str, Any]) -> tuple[datetime, datetime] | dict[str, Any]:
        """window_start/window_end for a query tool — via `period` when
        given (resolved server-side, can't be miscalculated), else via the
        model's own ISO strings. Returns an error dict if neither is
        usable, so the caller can short-circuit with `return`."""
        period = args.get("period")
        if period:
            bounds = _period_bounds(period, tz, now)
            if bounds is None:
                return {"error": f"Unknown period '{period}'. Use one of: {', '.join(_PERIODS)}."}
            return bounds
        if args.get("window_start") and args.get("window_end"):
            return _aware(args["window_start"]), _aware(args["window_end"])
        return {"error": "Provide either period, or both window_start and window_end."}

    if name == "list_calendars":
        cals = await ai_tools.list_calendars(
            session, ctx, owner_calendar_ids=owned_ids, grants_by_calendar=grants
        )
        calendars_out = []
        for c in cals:
            is_owner = c.id in owned_ids
            grant = grants.get(c.id)
            writable = bool(is_owner or (grant and (grant.can_edit or grant.can_create or grant.can_reschedule)))
            calendars_out.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "writable": writable,
                    "kind": c.kind.value,
                    "color": c.color,
                }
            )
        return {"calendars": calendars_out}

    elif name == "resolve_date_range":
        return _resolve_date_range(args["period"], tz, now, args.get("anchor_date"))

    elif name == "get_events":
        window = _window(args)
        if isinstance(window, dict):
            return window
        w_start, w_end = window
        cal_ids = args.get("calendar_ids")
        events = await ai_tools.get_events(
            session,
            ctx,
            window_start=w_start,
            window_end=w_end,
            calendar_ids=cal_ids,
            owner_calendar_ids=owned_ids,
            grants_by_calendar=grants,
        )
        cals = await ai_tools.list_calendars(
            session, ctx, owner_calendar_ids=owned_ids, grants_by_calendar=grants
        )
        cal_names = {c.id: c.name for c in cals}
        cal_by_id = {c.id: c for c in cals}
        return {
            "events": [
                {
                    "id": e.id,
                    "calendar_id": e.calendar_id,
                    "calendar_name": cal_names.get(e.calendar_id, ""),
                    "title": e.title,
                    "start": e.start.isoformat(),
                    "end": e.end.isoformat(),
                    "start_local": _local(e.start),
                    "end_local": _local(e.end),
                    "all_day": e.all_day,
                    "location": e.location if resolve_permission(
                        ctx, cal_by_id[e.calendar_id], CalendarAction.VIEW_FULL_DETAILS,
                        event=e, is_owner=e.calendar_id in owned_ids,
                        delegation_grant=grants.get(e.calendar_id) if grants else None,
                    ).allowed else None,
                    "attendees": e.attendees if resolve_permission(
                        ctx, cal_by_id[e.calendar_id], CalendarAction.VIEW_FULL_DETAILS,
                        event=e, is_owner=e.calendar_id in owned_ids,
                        delegation_grant=grants.get(e.calendar_id) if grants else None,
                    ).allowed else [],
                }
                for e in events
            ]
        }

    elif name == "find_free_slots":
        window = _window(args)
        if isinstance(window, dict):
            return window
        w_start, w_end = window
        dur = timedelta(minutes=int(args.get("duration_minutes", 30)))
        # BRD §26: the user's own working hours, buffer, and "now" shape
        # free-slot search — without these the copilot would happily offer
        # 7am or already-past slots.
        working_hours: tuple[int, int] | None = None
        buffer = timedelta(0)
        min_notice = timedelta(0)
        if ctx.user_id:
            from chronarch_core.models.user import User as _CopilotUser

            _u = await session.get(_CopilotUser, ctx.user_id)

            def _hh(value: str | None, fallback: int) -> int:
                import re as _re

                m = _re.match(r"^(\d{1,2}):(\d{2})", value or "")
                return min(23, max(0, int(m.group(1)))) if m else fallback

            if _u is not None:
                start_h, end_h = _hh(_u.working_hours_start, 9), _hh(_u.working_hours_end, 17)
                if start_h < end_h:
                    working_hours = (start_h, end_h)
                buffer = timedelta(minutes=_u.meeting_buffer_minutes or 0)
                min_notice = timedelta(minutes=_u.min_meeting_notice_minutes or 0)
        slots = await ai_tools.find_free_slots(
            session,
            ctx,
            window_start=w_start,
            window_end=w_end,
            duration=dur,
            working_hours=working_hours,
            buffer=buffer,
            min_notice=min_notice,
            now=now,
            owner_calendar_ids=owned_ids,
            grants_by_calendar=grants,
        )
        return {
            "free_slots": [
                {
                    "start": s["start"].isoformat(),
                    "end": s["end"].isoformat(),
                    "start_local": _local(s["start"]),
                    "end_local": _local(s["end"]),
                }
                for s in slots
            ]
        }

    elif name == "create_event":
        cal_id = args["calendar_id"]
        is_owner = cal_id in owned_ids
        grant = grants.get(cal_id)
        start = _aware(args["start"])
        end = _aware(args["end"])
        ev = await ai_tools.create_event(
            session,
            ctx,
            calendar_id=cal_id,
            title=args["title"],
            start=start,
            end=end,
            timezone=args.get("timezone") or default_tz or "UTC",
            description=args.get("description"),
            location=args.get("location"),
            attendees=args.get("attendees"),
            all_day=bool(args.get("all_day", False)),
            is_owner=is_owner,
            delegation_grant=grant,
        )
        return {
            "created": True,
            "event": {
                "id": ev.id,
                "title": ev.title,
                "calendar_id": ev.calendar_id,
                "start": ev.start.isoformat(),
                "end": ev.end.isoformat(),
                "start_local": _local(ev.start),
                "end_local": _local(ev.end),
            },
        }

    elif name == "move_event":
        from chronarch_core.models.event import UnifiedEvent

        ev_id = args["event_id"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        is_owner = existing.calendar_id in owned_ids
        grant = grants.get(existing.calendar_id)
        n_start = _aware(args["new_start"])
        n_end = _aware(args["new_end"])
        ev = await ai_tools.move_event(
            session,
            ctx,
            event_id=ev_id,
            new_start=n_start,
            new_end=n_end,
            new_all_day=args.get("new_all_day"),
            is_owner=is_owner,
            delegation_grant=grant,
        )
        return {
            "moved": True,
            "event": {
                "id": ev.id,
                "title": ev.title,
                "start": ev.start.isoformat(),
                "end": ev.end.isoformat(),
                "start_local": _local(ev.start),
                "end_local": _local(ev.end),
            },
        }

    elif name == "move_event_between_calendars":
        from chronarch_core.models.event import UnifiedEvent

        ev_id = args["event_id"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        try:
            ev = await ai_tools.move_event_between_calendars(
                session, ctx, event_id=ev_id,
                destination_calendar_id=args["destination_calendar_id"],
                owner_calendar_ids=owned_ids, grants_by_calendar=grants,
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": f"{exc.action.value} denied: {exc.reason}"}
        except ValueError as exc:
            return {"error": str(exc)}
        return {
            "moved": True,
            "event": {
                "id": ev.id,
                "title": ev.title,
                "calendar_id": ev.calendar_id,
                "start": ev.start.isoformat(),
                "end": ev.end.isoformat(),
            },
        }

    elif name == "get_event":
        from chronarch_core.models.event import UnifiedEvent

        ev_id = args["event_id"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        is_owner = existing.calendar_id in owned_ids
        owner_arg = {existing.calendar_id} if is_owner else owned_ids
        try:
            ev = await ai_tools.get_event(
                session, ctx, event_id=ev_id,
                owner_calendar_ids=owner_arg, grants_by_calendar=grants,
            )
        except ai_tools.PermissionDenied as exc:
            return {"error": f"{exc.action.value} denied: {exc.reason}"}
        return {
            "event": {
                "id": ev.id, "calendar_id": ev.calendar_id, "title": ev.title,
                "description": ev.description, "start": ev.start.isoformat(),
                "end": ev.end.isoformat(), "start_local": _local(ev.start),
                "end_local": _local(ev.end), "all_day": ev.all_day, "location": ev.location,
                "attendees": ev.attendees,
            }
        }

    elif name == "get_conflicts":
        window = _window(args)
        if isinstance(window, dict):
            return window
        w_start, w_end = window
        hits = await ai_tools.get_conflicts(
            session, ctx, window_start=w_start, window_end=w_end,
            exclude_event_id=args.get("exclude_event_id"),
            owner_calendar_ids=owned_ids, grants_by_calendar=grants,
        )
        return {
            "conflicts": [
                {
                    "event_id": h["event_id"], "title": h["title"],
                    "start": h["start"].isoformat(), "end": h["end"].isoformat(),
                    "start_local": _local(h["start"]), "end_local": _local(h["end"]),
                    "redacted": h["redacted"],
                }
                for h in hits
            ]
        }

    elif name == "update_event":
        from chronarch_core.models.event import UnifiedEvent

        ev_id = args["event_id"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        is_owner = existing.calendar_id in owned_ids
        grant = grants.get(existing.calendar_id)
        ev = await ai_tools.update_event(
            session, ctx, event_id=ev_id, title=args.get("title"),
            description=args.get("description"), location=args.get("location"),
            all_day=args.get("all_day"), scope=args.get("scope", "series"),
            instance_start=_aware(args["instance_time"]) if args.get("instance_time") else None,
            is_owner=is_owner, delegation_grant=grant,
        )
        return {
            "updated": True,
            "event": {
                "id": ev.id, "title": ev.title,
                "start": ev.start.isoformat(), "end": ev.end.isoformat(),
            },
        }

    elif name == "add_attendee":
        from chronarch_core.models.calendar import Calendar
        from chronarch_core.models.event import UnifiedEvent
        from chronarch_core.permissions import CalendarAction, resolve_permission

        ev_id = args["event_id"]
        email = args["email"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        is_owner = existing.calendar_id in owned_ids
        grant = grants.get(existing.calendar_id)
        calendar = await session.get(Calendar, existing.calendar_id)
        if calendar is None:
            return {"error": f"Event {ev_id} not found"}
        decision = resolve_permission(
            ctx, calendar, CalendarAction.MANAGE_ATTENDEES, event=existing,
            is_owner=is_owner, delegation_grant=grant,
        )
        if not decision.allowed:
            return {"error": f"manage_attendees denied: {decision.reason}"}

        confirm_key = f"{ev_id}:add_attendee:{email.lower().strip()}"
        already_previewed = _already_previewed(history or [], confirm_key)
        if not (args.get("confirmed", False) and already_previewed):
            return {
                "requires_confirmation": True,
                "action": "add_attendee",
                "event_id": ev_id,
                "title": existing.title,
                "email": email,
                "message": (
                    f"Inviting {email} to '{existing.title}' will send them a real invite email. "
                    "Please ask the user to explicitly confirm before proceeding. "
                    f"{_confirmation_ref(confirm_key)}"
                ),
            }

        ev = await ai_tools.add_attendee(
            session, ctx, event_id=ev_id, email=email, name=args.get("name"),
            is_owner=is_owner, delegation_grant=grant,
        )
        return {
            "added": True,
            "event": {"id": ev.id, "title": ev.title, "attendees": ev.attendees},
        }

    elif name == "remove_attendee":
        from chronarch_core.models.event import UnifiedEvent

        ev_id = args["event_id"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        is_owner = existing.calendar_id in owned_ids
        grant = grants.get(existing.calendar_id)
        ev = await ai_tools.remove_attendee(
            session, ctx, event_id=ev_id, email=args["email"],
            is_owner=is_owner, delegation_grant=grant,
        )
        return {
            "removed": True,
            "event": {"id": ev.id, "title": ev.title, "attendees": ev.attendees},
        }

    elif name == "respond_to_event":
        from chronarch_core.models.calendar import Calendar
        from chronarch_core.models.event import UnifiedEvent
        from chronarch_core.permissions import CalendarAction, resolve_permission

        ev_id = args["event_id"]
        response = args["response"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        is_owner = existing.calendar_id in owned_ids
        grant = grants.get(existing.calendar_id)
        calendar = await session.get(Calendar, existing.calendar_id)
        if calendar is None:
            return {"error": f"Event {ev_id} not found"}
        decision = resolve_permission(
            ctx, calendar, CalendarAction.RESPOND_TO_INVITATION, event=existing,
            is_owner=is_owner, delegation_grant=grant,
        )
        if not decision.allowed:
            return {"error": f"respond_to_invitation denied: {decision.reason}"}

        confirm_key = f"{ev_id}:respond_to_event:{response.lower().strip()}"
        already_previewed = _already_previewed(history or [], confirm_key)
        if not (args.get("confirmed", False) and already_previewed):
            return {
                "requires_confirmation": True,
                "action": "respond_to_event",
                "event_id": ev_id,
                "title": existing.title,
                "response": response,
                "message": (
                    f"Responding '{response}' to '{existing.title}' will be visible to the organizer. "
                    "Please ask the user to explicitly confirm before proceeding. "
                    f"{_confirmation_ref(confirm_key)}"
                ),
            }

        try:
            ev = await ai_tools.respond_to_event(
                session, ctx, event_id=ev_id, response_status=response,
                is_owner=is_owner, delegation_grant=grant,
            )
        except ValueError as exc:
            return {"error": str(exc)}
        return {"responded": True, "event_id": ev.id, "title": ev.title}

    elif name == "get_availability":
        window = _window(args)
        if isinstance(window, dict):
            return window
        w_start, w_end = window
        busy = await ai_tools.get_availability(
            session, ctx, window_start=w_start, window_end=w_end,
            owner_calendar_ids=owned_ids, grants_by_calendar=grants,
        )
        return {
            "busy": [
                {
                    "start": b["start"].isoformat(),
                    "end": b["end"].isoformat(),
                    "start_local": _local(b["start"]),
                    "end_local": _local(b["end"]),
                }
                for b in busy
            ]
        }

    elif name == "list_accounts":
        accounts = await ai_tools.list_accounts(session, ctx)
        return {
            "accounts": [
                {"id": a["id"], "provider": a["provider"], "email": a["email"],
                 "sync_status": a["sync_status"]}
                for a in accounts
            ]
        }

    elif name == "delete_event":
        from chronarch_core.models.calendar import Calendar
        from chronarch_core.models.event import UnifiedEvent
        from chronarch_core.permissions import CalendarAction, resolve_permission

        ev_id = args["event_id"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}

        is_owner = existing.calendar_id in owned_ids
        grant = grants.get(existing.calendar_id)
        calendar = await session.get(Calendar, existing.calendar_id)
        if calendar is None:
            return {"error": f"Event {ev_id} not found"}
        decision = resolve_permission(
            ctx, calendar, CalendarAction.DELETE, event=existing,
            is_owner=is_owner, delegation_grant=grant,
        )
        if not decision.allowed:
            # Deny before any detail (title/time) is revealed — the preview
            # below is detail-revealing, so it must never run first.
            return {"error": f"delete denied: {decision.reason}"}

        already_previewed = _already_previewed(history or [], ev_id)
        if not (args.get("confirmed", False) and already_previewed):
            scope = args.get("scope", "series")
            scope_note = (
                " (this occurrence only)" if scope == "this"
                else " (this and all future occurrences)" if scope == "future"
                else " (the entire series)")
            return {
                "requires_confirmation": True,
                "action": "delete_event",
                "event_id": ev_id,
                "title": existing.title,
                "start": existing.start.isoformat(),
                "end": existing.end.isoformat(),
                "start_local": _local(existing.start),
                "end_local": _local(existing.end),
                "message": (
                    f"Deleting '{existing.title}'{scope_note} is a destructive action. "
                    "Please ask the user to explicitly confirm before proceeding. "
                    f"{_confirmation_ref(ev_id)}"
                ),
            }

        await ai_tools.delete_event(
            session, ctx, event_id=ev_id, scope=args.get("scope", "series"),
            instance_start=_aware(args["instance_time"]) if args.get("instance_time") else None,
            is_owner=is_owner, delegation_grant=grant
        )
        return {"deleted": True, "event_id": ev_id, "title": existing.title}

    elif name == "search_contacts":
        return {"contacts": await ai_tools.search_contacts(
            session, ctx, query=args.get("query", ""), limit=int(args.get("limit", 10) or 10))}

    elif name == "resolve_contact":
        return await ai_tools.resolve_contact(session, ctx, query=args.get("query", ""))

    elif name == "create_contact":
        try:
            contact = await ai_tools.create_contact(
                session, ctx, email=args["email"], display_name=args.get("name"),
                phone=args.get("phone"), company=args.get("company"), job_title=args.get("job_title"))
        except ValueError as exc:
            return {"error": str(exc)}
        return {"contact": contact}

    elif name == "update_contact":
        try:
            contact = await ai_tools.update_contact(
                session, ctx, contact_id=args["contact_id"], display_name=args.get("name"),
                email=args.get("email"), phone=args.get("phone"),
                company=args.get("company"), job_title=args.get("job_title"))
        except ValueError as exc:
            return {"error": str(exc)}
        return {"contact": contact}

    elif name == "delete_contact":
        from chronarch_core.models.contact import Contact as _Contact

        cid = args["contact_id"]
        existing = await session.get(_Contact, cid)
        if existing is None or existing.deleted_at is not None:
            return {"error": f"Contact {cid} not found"}
        already_previewed = _already_previewed(history or [], cid)
        if not (args.get("confirmed", False) and already_previewed):
            return {
                "requires_confirmation": True,
                "action": "delete_contact",
                "contact_id": cid,
                "title": existing.display_name or existing.email,
                "message": (
                    f"Removing '{existing.display_name or existing.email}' from contacts "
                    "is destructive. Please ask the user to explicitly confirm before "
                    f"proceeding. {_confirmation_ref(cid)}"
                ),
            }
        await ai_tools.delete_contact(session, ctx, contact_id=cid)
        return {"deleted": True, "contact_id": cid}

    elif name == "restore_contact":
        try:
            contact = await ai_tools.restore_contact(session, ctx, contact_id=args["contact_id"])
        except ValueError as exc:
            return {"error": str(exc)}
        return {"contact": contact}

    elif name == "suggest_meeting_times":
        try:
            return await ai_tools.suggest_meeting_times(
                session, ctx, contact_query=args.get("contact_query", ""),
                duration_minutes=int(args.get("duration_minutes", 30) or 30),
                window_days=int(args.get("window_days", 7) or 7),
                owner_calendar_ids=owned_ids, grants_by_calendar=grants)
        except ValueError as exc:
            return {"error": str(exc)}

    return {"error": f"Unknown tool: {name}"}


async def _friendly_error_for_status(session: AsyncSession, status_code: int) -> str:
    """401-aware friendly message shared by the chat and stream endpoints."""
    key_configured = True
    if status_code == 401:
        from chronarch_core.ai_config import get_settings as _get_ai_settings

        try:
            _row = await _get_ai_settings(session)
            key_configured = bool(
                _row
                and (
                    _row.encrypted_openrouter_api_key
                    or getattr(_row, "encrypted_groq_api_key", None)
                    or getattr(_row, "encrypted_gemini_api_key", None)
                )
            )
        except Exception:
            pass  # error-path best effort; default message is safe
    return _friendly_litellm_error(status_code, key_configured=key_configured)


def _fmt_day(value: str | None) -> str:
    """'2026-09-16T09:00:00Z' -> 'Tue, Sep 16'; garbage in, '' out."""
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value).strftime("%a, %b %d")
    except (ValueError, TypeError):
        return ""


def _describe_tool_call(name: str, args: dict[str, Any]) -> str:
    """One-line activity text for a tool invocation — the visible 'thought'."""
    if name == "list_calendars":
        return "Checking your calendars"
    if name == "resolve_date_range":
        return f"Working out {args.get('period', 'the date range')}"
    if name == "get_events":
        if args.get("period"):
            return f"Checking events for {args['period'].replace('_', ' ')}"
        day = _fmt_day(args.get("window_start"))
        end_day = _fmt_day(args.get("window_end"))
        span = f"{day} → {end_day}" if end_day and end_day != day else day
        return f"Checking events {span}".strip()
    if name == "find_free_slots":
        return f"Scanning for {args.get('duration_minutes', 30)}-min open slots"
    if name == "get_conflicts":
        return "Checking for conflicts"
    if name == "get_event":
        return "Reading event details"
    if name == "create_event":
        title = str(args.get("title", "event"))
        day = _fmt_day(args.get("start"))
        return f"Creating '{title}' {day}".strip()
    if name == "update_event":
        return "Updating event"
    if name == "move_event":
        return "Rescheduling event"
    if name == "delete_event":
        return "Deleting event"
    if name == "search_contacts":
        return f"Looking up {args.get('query') or 'contacts'}"
    if name == "resolve_contact":
        return f"Resolving {args.get('query', 'contact')}"
    if name == "create_contact":
        return f"Adding {args.get('email', 'contact')}"
    if name == "update_contact":
        return "Updating contact"
    if name == "delete_contact":
        return "Removing contact"
    if name == "restore_contact":
        return "Restoring contact"
    if name == "suggest_meeting_times":
        return f"Finding time with {args.get('contact_query', 'them')}"
    return name.replace("_", " ").capitalize()


def _summarize_tool_result(name: str, result: dict[str, Any]) -> str:
    """One-line outcome for a finished tool call (counts, never full data)."""
    if not isinstance(result, dict):
        return "Done"
    if result.get("error"):
        return str(result["error"])[:120]
    if result.get("requires_confirmation"):
        return f"Needs confirmation: {result.get('title', 'event')}"
    if name == "list_calendars":
        return f"{len(result.get('calendars', []))} calendars"
    if name == "resolve_date_range":
        return result.get("start_local", "Done")
    if name == "get_events":
        n = len(result.get("events", []))
        return f"Found {n} event{'s' if n != 1 else ''}"
    if name == "find_free_slots":
        n = len(result.get("free_slots", []))
        return f"Found {n} open slot{'s' if n != 1 else ''}" if n else "No open slots"
    if name == "get_conflicts":
        n = len(result.get("conflicts", []))
        return "No conflicts" if not n else f"{n} conflict{'s' if n != 1 else ''}"
    if name == "create_event":
        return f"Created '{result.get('event', {}).get('title', 'event')}'"
    if name in ("move_event", "update_event"):
        return "Updated"
    if name == "delete_event":
        return f"Deleted '{result.get('title', 'event')}'"
    if name == "search_contacts":
        n = len(result.get("contacts", []))
        return f"Found {n} contact{'s' if n != 1 else ''}"
    if name == "resolve_contact":
        if result.get("status") == "found":
            c = result.get("contact", {})
            return f"Resolved to {c.get('display_name') or c.get('email', '?')}"
        if result.get("status") == "ambiguous":
            return f"{len(result.get('candidates', []))} matches — ask which one"
        return "No match"
    if name in ("create_contact", "update_contact", "restore_contact"):
        c = result.get("contact", {})
        return f"Saved {c.get('display_name') or c.get('email', 'contact')}"
    if name == "delete_contact":
        return "Removed contact"
    if name == "suggest_meeting_times":
        if result.get("status") == "proposed":
            n = len(result.get("slots", []))
            return f"Proposed {n} time{'s' if n != 1 else ''}" if n else "No open times found"
        if result.get("status") == "ambiguous":
            return f"{len(result.get('candidates', []))} matches — ask which one"
        return "No match"
    if name == "get_event":
        return result.get("event", {}).get("title", "Done")
    return "Done"


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def _build_history(req: ChatRequest, user=None, tz_name: str = "UTC") -> list[dict[str, Any]]:
    """Shared prompt construction for the chat and stream endpoints.

    `tz_name` must be the same value the caller resolves as `default_tz`
    for tool dispatch — the system prompt's stated timezone and the zone
    actually used to interpret naive datetimes must never diverge, or the
    model gets told one zone while the backend silently uses another.
    Each authenticated user (executive, delegate, admin) carries their own
    `home_timezone`, so this is inherently per-acting-user, never a single
    hardcoded default — a PST admin and an Eastern delegate each get their
    own zone resolved from their own request/account, not each other's.
    """
    now_str = req.user_time or datetime.now().isoformat()
    view_ctx = ""
    if req.viewed_date:
        view_ctx = f" The user is currently viewing their calendar on {req.viewed_date} in {req.view_mode or 'day'} view."
    hours_ctx = ""
    if user is not None:
        try:
            _days = (user.working_days or "1,2,3,4,5").split(",")
            _names = {"1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu",
                      "5": "Fri", "6": "Sat", "7": "Sun"}
            _day_str = ",".join(_names.get(d.strip(), d.strip()) for d in _days)
            hours_ctx = (
                f" The user's working hours are {user.working_hours_start or '09:00'}–"
                f"{user.working_hours_end or '17:00'} {_day_str} ({tz_name}). "
                "When asked for time outside working hours, flag it and confirm "
                "before booking anything there."
            )
        except Exception:
            pass
    system_prompt = render_system_prompt(
        now=now_str, timezone=tz_name, view_ctx=view_ctx, hours_ctx=hours_ctx
    )

    history: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for m in req.messages:
        item: dict[str, Any] = {"role": m.role}
        if m.content is not None:
            item["content"] = m.content
        if m.tool_calls is not None:
            item["tool_calls"] = m.tool_calls
        if m.tool_call_id is not None:
            item["tool_call_id"] = m.tool_call_id
        if m.name is not None:
            item["name"] = m.name
        history.append(item)
    return history


async def _any_provider_key(session: AsyncSession) -> bool:
    """True when at least one provider key is stored. Lets the copilot fail
    fast with the "no key saved" message instead of burning a proxy call."""
    from chronarch_core.ai_config import get_settings as _get_ai_settings

    try:
        row = await _get_ai_settings(session)
    except Exception:
        return True  # error-path best effort; let the call through
    return bool(
        row
        and (
            row.encrypted_openrouter_api_key
            or getattr(row, "encrypted_groq_api_key", None)
            or getattr(row, "encrypted_gemini_api_key", None)
        )
    )


@router.post("/chat")
async def copilot_chat(
    req: ChatRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Conversational copilot interaction loop (non-streaming)."""
    from chronarch_core import rbac as _rbac

    if not await _rbac.has_permission(session, user, "copilot.use"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires the 'copilot.use' permission")
    if not await _any_provider_key(session):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            _friendly_litellm_error(401, key_configured=False),
        )
    ctx = build_auth_context(user, ActorType.COPILOT)
    owned_ids = await get_owned_calendar_ids(session, user)
    grants = await get_delegation_grants(session, user.id)

    from chronarch_core.timezones import normalize_timezone as _normalize_timezone

    default_tz = _normalize_timezone(req.user_timezone or user.home_timezone)
    history = _build_history(req, user, default_tz)
    try:
        now_ref = datetime.fromisoformat(req.user_time) if req.user_time else None
    except (ValueError, TypeError):
        now_ref = None

    headers = {
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
        "Content-Type": "application/json",
    }

    # Iterative tool-calling loop (up to 5 turns)
    trace: list[dict[str, Any]] = []
    for _ in range(5):
        payload = {
            "model": "primary",
            "messages": history,
            "tools": COPILOT_TOOLS,
            "tool_choice": "auto",
            # Deterministic tool-calling: an EA assistant must behave the
            # same way every time, not creatively reinterpret requests.
            "temperature": 0,
        }

        async with httpx.AsyncClient(timeout=35.0) as client:
            try:
                resp = await client.post(LITELLM_URL, json=payload, headers=headers)
                if resp.status_code != 200:
                    # Full provider body stays server-side (it can echo
                    # config); users get an actionable summary instead.
                    # Rate limits surface as 429 (not 502) so callers can
                    # distinguish "over quota, retry later" from "broken".
                    logger.error("LiteLLM returned status %d: %s", resp.status_code, resp.text)
                    raise HTTPException(
                        status.HTTP_429_TOO_MANY_REQUESTS
                        if resp.status_code == 429
                        else status.HTTP_502_BAD_GATEWAY,
                        await _friendly_error_for_status(session, resp.status_code),
                    )
                data = resp.json()
            except httpx.RequestError as exc:
                logger.exception("Failed to connect to LiteLLM at %s", LITELLM_URL)
                raise HTTPException(
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                    "Couldn't reach the AI service. Make sure it's running and try again.",
                )

        choice = data["choices"][0]
        message = choice["message"]

        tool_calls = message.get("tool_calls")
        if not tool_calls:
            # Final conversational answer reached
            out: dict[str, Any] = {
                "message": {
                    "role": "assistant",
                    "content": message.get("content", ""),
                }
            }
            if req.include_trace:
                out["trace"] = trace
            return out

        # Model requested tool executions. Rebuild the assistant message with
        # only OpenAI-standard fields: raw provider payloads often carry
        # extra keys (reasoning traces, provider_specific_fields) that the
        # *same* provider rejects when echoed back on the next turn.
        history.append({
            "role": "assistant",
            "content": message.get("content"),
            "tool_calls": [
                {
                    "id": tc.get("id"),
                    "type": "function",
                    "function": {
                        "name": (tc.get("function") or {}).get("name"),
                        "arguments": (tc.get("function") or {}).get("arguments", "{}"),
                    },
                }
                for tc in tool_calls
            ],
        })
        for tc in tool_calls:
            func = tc["function"]
            fname = func["name"]
            try:
                fargs = json.loads(func.get("arguments", "{}"))
            except Exception:
                fargs = {}

            try:
                result = await _execute_tool(fname, fargs, session, ctx, owned_ids, grants, now_ref, default_tz, history)
            except Exception as e:
                result = {"error": str(e)}

            if req.include_trace:
                trace.append({"tool": fname, "summary": _summarize_tool_result(fname, result)})

            history.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "name": fname,
                "content": json.dumps(result),
            })

            if isinstance(result, dict) and result.get("requires_confirmation"):
                # Hard stop: a destructive action needs a real round-trip
                # through the user. Prompt wording alone doesn't reliably
                # stop the model from immediately re-calling the same tool
                # with confirmed=true inside this same turn, so the loop
                # itself must end here and hand control back — confirmed
                # can only ever come from a genuinely new request.
                out = {
                    "message": {
                        "role": "assistant",
                        "content": result.get("message", "This action requires your confirmation before proceeding."),
                    }
                }
                if req.include_trace:
                    out["trace"] = trace
                return out

    # Tool-call budget exhausted without a final conversational answer.
    # history[-1] is a tool-role message at this point — its content is
    # raw JSON (event/calendar data, potentially across every calendar an
    # admin-scoped actor can see), never a message meant for the user, so
    # it must never be echoed back verbatim.
    out = {
        "message": {
            "role": "assistant",
            "content": "I wasn't able to finish that within the allotted steps. Could you narrow the request (e.g. a specific date or event) and try again?",
        }
    }
    if req.include_trace:
        out["trace"] = trace
    return out


@router.post("/chat/stream")
async def copilot_chat_stream(
    req: ChatRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Streaming copilot interaction (SSE).

    Events (all `data:` JSON):
    - `status` {text} — turn-level activity ("Thinking…")
    - `tool` {name, text} — a tool call started (the visible "thought")
    - `result` {name, summary} — a tool call finished
    - `token` {text} — answer content delta (streams the reply live)
    - `done` {content} — final full answer
    - `error` {message} — friendly failure; the stream ends here
    """
    from fastapi.responses import StreamingResponse
    from chronarch_core import rbac as _rbac_stream

    if not await _rbac_stream.has_permission(session, user, "copilot.use"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires the 'copilot.use' permission")
    if not await _any_provider_key(session):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            _friendly_litellm_error(401, key_configured=False),
        )
    ctx = build_auth_context(user, ActorType.COPILOT)
    owned_ids = await get_owned_calendar_ids(session, user)
    grants = await get_delegation_grants(session, user.id)
    from chronarch_core.timezones import normalize_timezone as _normalize_timezone

    default_tz = _normalize_timezone(req.user_timezone or user.home_timezone)
    history = _build_history(req, user, default_tz)
    try:
        now_ref = datetime.fromisoformat(req.user_time) if req.user_time else None
    except (ValueError, TypeError):
        now_ref = None

    headers = {
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
        "Content-Type": "application/json",
    }

    async def _generate():
        yield _sse("status", {"text": "Thinking…"})
        try:
            for _ in range(5):
                payload = {
                    "model": "primary",
                    "messages": history,
                    "tools": COPILOT_TOOLS,
                    "tool_choice": "auto",
                    "temperature": 0,
                    "stream": True,
                }

                try:
                    stream_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
                    async with stream_client as client:
                        async with client.stream(
                            "POST", LITELLM_URL, json=payload, headers=headers
                        ) as resp:
                            if resp.status_code != 200:
                                body = await resp.aread()
                                logger.error(
                                    "LiteLLM stream returned status %d: %s",
                                    resp.status_code, body[:2000],
                                )
                                msg = await _friendly_error_for_status(session, resp.status_code)
                                yield _sse("error", {"message": msg})
                                return

                            content_parts: list[str] = []
                            tool_accum: dict[int, dict[str, str]] = {}
                            async for line in resp.aiter_lines():
                                if not line.startswith("data:"):
                                    continue
                                data = line[5:].strip()
                                if not data or data == "[DONE]":
                                    continue
                                try:
                                    chunk = json.loads(data)
                                except json.JSONDecodeError:
                                    continue
                                choices = chunk.get("choices") or []
                                if not choices:
                                    continue
                                delta = choices[0].get("delta") or {}
                                text = delta.get("content")
                                if text:
                                    content_parts.append(text)
                                    yield _sse("token", {"text": text})
                                for tc in delta.get("tool_calls") or []:
                                    idx = tc.get("index", 0)
                                    acc = tool_accum.setdefault(
                                        idx, {"id": "", "name": "", "arguments": ""}
                                    )
                                    if tc.get("id"):
                                        acc["id"] = tc["id"]
                                    fn = tc.get("function") or {}
                                    if fn.get("name"):
                                        acc["name"] = fn["name"]
                                    if fn.get("arguments"):
                                        acc["arguments"] += fn["arguments"]
                except httpx.RequestError:
                    logger.exception("Failed to connect to LiteLLM at %s", LITELLM_URL)
                    yield _sse("error", {
                        "message": "Couldn't reach the AI service. Make sure it's running and try again.",
                    })
                    return

                if not tool_accum:
                    yield _sse("done", {"content": "".join(content_parts)})
                    return

                ordered = [tool_accum[i] for i in sorted(tool_accum)]
                message: dict[str, Any] = {
                    "role": "assistant",
                    "content": "".join(content_parts) or None,
                    "tool_calls": [
                        {
                            "id": acc["id"] or f"call_{i}",
                            "type": "function",
                            "function": {"name": acc["name"], "arguments": acc["arguments"]},
                        }
                        for i, acc in enumerate(ordered)
                    ],
                }
                history.append(message)

                for tc in message["tool_calls"]:
                    fname = tc["function"]["name"]
                    try:
                        fargs = json.loads(tc["function"].get("arguments") or "{}")
                    except (json.JSONDecodeError, TypeError):
                        fargs = {}
                    if not isinstance(fargs, dict):
                        fargs = {}

                    yield _sse("tool", {"name": fname, "text": _describe_tool_call(fname, fargs)})
                    try:
                        result = await _execute_tool(fname, fargs, session, ctx, owned_ids, grants, now_ref, default_tz, history)
                    except Exception as e:
                        result = {"error": str(e)}
                    yield _sse("result", {"name": fname, "summary": _summarize_tool_result(fname, result)})

                    history.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": fname,
                        "content": json.dumps(result),
                    })

                    if isinstance(result, dict) and result.get("requires_confirmation"):
                        # Hard stop, same as the non-streaming loop: never
                        # let the model re-call the same tool with
                        # confirmed=true inside this turn. End the stream
                        # here and wait for a genuinely new request.
                        yield _sse("done", {
                            "content": result.get("message", "This action requires your confirmation before proceeding."),
                        })
                        return

            # Same exhaustion case as the non-streaming loop: never echo a
            # trailing tool-role message's raw JSON back to the user.
            yield _sse("done", {
                "content": "I wasn't able to finish that within the allotted steps. Could you narrow the request (e.g. a specific date or event) and try again?",
            })
        except asyncio.CancelledError:
            raise

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
