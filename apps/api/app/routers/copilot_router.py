"""Built-In AI Copilot Router (BRD §4.4, §20, §31).

Provides `POST /api/v1/copilot/chat`:
- Proxies conversational scheduling requests to the LiteLLM container.
- Defines OpenAI-standard function-calling schemas for internal `ai_tools`
  (`list_calendars`, `get_events`, `get_availability`, `find_free_slots`,
  `get_conflicts`, `create_event`, `move_event`, `delete_event`).
- Executes function calls in an iterative loop against `ai_tools`, passing
  results back to the model until a conversational response or action confirmation
  is produced.
- Enforces strict user authentication, permissions, and audit logging with
  `ActorType.COPILOT`.
"""

from __future__ import annotations

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
from chronarch_core.models.enums import ActorType
from chronarch_core.models.user import User

from ..auth import build_auth_context, get_current_user
from ..deps import get_db_session
from ..permission_helpers import get_delegation_grants, get_owned_calendar_ids

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/copilot", tags=["copilot"])

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000/v1/chat/completions")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "sk-master-chronarch-secret")

COPILOT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_calendars",
            "description": "List all calendars visible to the current user, along with write permissions and status.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_events",
            "description": "Get events in a time window [window_start, window_end). Times must be ISO 8601 strings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "window_start": {"type": "string", "description": "Start timestamp (ISO 8601), e.g. 2026-09-11T09:00:00Z"},
                    "window_end": {"type": "string", "description": "End timestamp (ISO 8601), e.g. 2026-09-11T18:00:00Z"},
                    "calendar_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of calendar IDs to query",
                    },
                },
                "required": ["window_start", "window_end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_free_slots",
            "description": "Find free non-conflicting time slots within a window for scheduling a meeting of given duration.",
            "parameters": {
                "type": "object",
                "properties": {
                    "window_start": {"type": "string", "description": "Start timestamp (ISO 8601)"},
                    "window_end": {"type": "string", "description": "End timestamp (ISO 8601)"},
                    "duration_minutes": {"type": "integer", "description": "Desired duration in minutes (e.g. 30, 45, 60)"},
                },
                "required": ["window_start", "window_end", "duration_minutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": "Create a new event on a calendar. Requires explicit user intent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "calendar_id": {"type": "string", "description": "Target calendar ID"},
                    "title": {"type": "string", "description": "Event title"},
                    "start": {"type": "string", "description": "Start timestamp (ISO 8601)"},
                    "end": {"type": "string", "description": "End timestamp (ISO 8601)"},
                    "description": {"type": "string", "description": "Event description"},
                    "location": {"type": "string", "description": "Event location"},
                    "all_day": {"type": "boolean", "description": "Whether event is all-day"},
                },
                "required": ["calendar_id", "title", "start", "end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_event",
            "description": "Move/reschedule an existing event to a new start and end time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID to move"},
                    "new_start": {"type": "string", "description": "New start timestamp (ISO 8601)"},
                    "new_end": {"type": "string", "description": "New end timestamp (ISO 8601)"},
                    "new_all_day": {"type": "boolean", "description": "Whether event is all-day"},
                },
                "required": ["event_id", "new_start", "new_end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_event",
            "description": "Cancel or delete an existing event.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "The event ID to delete"},
                },
                "required": ["event_id"],
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


async def _execute_tool(
    name: str,
    args: dict[str, Any],
    session: AsyncSession,
    ctx: Any,
    owned_ids: set[str],
    grants: dict[str, Any],
) -> dict[str, Any]:

    """Dispatch copilot tool execution to internal `ai_tools`."""
    from datetime import timedelta

    if name == "list_calendars":
        cals = await ai_tools.list_calendars(session, ctx)
        return {
            "calendars": [
                {
                    "id": c.id,
                    "name": c.name,
                    "writable": c.provider_writable,
                    "kind": c.kind.value,
                    "color": c.color,
                }
                for c in cals
            ]
        }

    elif name == "get_events":
        w_start = datetime.fromisoformat(args["window_start"])
        w_end = datetime.fromisoformat(args["window_end"])
        cal_ids = args.get("calendar_ids")
        events = await ai_tools.get_events(session, ctx, window_start=w_start, window_end=w_end, calendar_ids=cal_ids)
        return {
            "events": [
                {
                    "id": e.id,
                    "calendar_id": e.calendar_id,
                    "title": e.title,
                    "start": e.start.isoformat(),
                    "end": e.end.isoformat(),
                    "all_day": e.all_day,
                    "location": e.location,
                }
                for e in events
            ]
        }

    elif name == "find_free_slots":
        w_start = datetime.fromisoformat(args["window_start"])
        w_end = datetime.fromisoformat(args["window_end"])
        dur = timedelta(minutes=int(args.get("duration_minutes", 30)))
        slots = await ai_tools.find_free_slots(
            session, ctx, window_start=w_start, window_end=w_end, duration=dur
        )
        return {
            "free_slots": [
                {"start": s["start"].isoformat(), "end": s["end"].isoformat()}
                for s in slots
            ]
        }

    elif name == "create_event":
        cal_id = args["calendar_id"]
        is_owner = cal_id in owned_ids
        grant = grants.get(cal_id)
        start = datetime.fromisoformat(args["start"])
        end = datetime.fromisoformat(args["end"])
        ev = await ai_tools.create_event(
            session,
            ctx,
            calendar_id=cal_id,
            title=args["title"],
            start=start,
            end=end,
            description=args.get("description"),
            location=args.get("location"),
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
        n_start = datetime.fromisoformat(args["new_start"])
        n_end = datetime.fromisoformat(args["new_end"])
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
            },
        }

    elif name == "delete_event":
        from chronarch_core.models.event import UnifiedEvent

        ev_id = args["event_id"]
        existing = await session.get(UnifiedEvent, ev_id)
        if not existing:
            return {"error": f"Event {ev_id} not found"}
        is_owner = existing.calendar_id in owned_ids
        grant = grants.get(existing.calendar_id)
        await ai_tools.delete_event(
            session, ctx, event_id=ev_id, is_owner=is_owner, delegation_grant=grant
        )
        return {"deleted": True, "event_id": ev_id}

    return {"error": f"Unknown tool: {name}"}


@router.post("/chat")
async def copilot_chat(
    req: ChatRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Conversational copilot interaction loop."""
    ctx = build_auth_context(user, ActorType.COPILOT)
    owned_ids = await get_owned_calendar_ids(session, user.id)
    grants = await get_delegation_grants(session, user.id)

    now_str = req.user_time or datetime.now().isoformat()
    view_ctx = ""
    if req.viewed_date:
        view_ctx = f" The user is currently viewing their calendar on {req.viewed_date} in {req.view_mode or 'day'} view."

    system_prompt = (
        f"You are the Chronarch AI Calendar Copilot. Current reference time is {now_str}.{view_ctx} "
        "You help the user check their schedule, find available time slots, reschedule, and manage meetings. "
        "When summarizing an agenda or day, present meetings cleanly with time, title, and key details. "
        "Always use available tools to inspect calendars and find free slots. "
        "Before creating or modifying events, confirm with clear details (title, start, end, calendar). "
        "Be concise, polite, and helpful."
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

    headers = {
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
        "Content-Type": "application/json",
    }

    # Iterative tool-calling loop (up to 5 turns)
    for _ in range(5):
        payload = {
            "model": "primary",
            "messages": history,
            "tools": COPILOT_TOOLS,
            "tool_choice": "auto",
        }

        async with httpx.AsyncClient(timeout=35.0) as client:
            try:
                resp = await client.post(LITELLM_URL, json=payload, headers=headers)
                if resp.status_code != 200:
                    logger.error("LiteLLM returned status %d: %s", resp.status_code, resp.text)
                    raise HTTPException(
                        status.HTTP_502_BAD_GATEWAY,
                        f"AI service returned status {resp.status_code}: {resp.text}",
                    )
                data = resp.json()
            except httpx.RequestError as exc:
                logger.exception("Failed to connect to LiteLLM at %s", LITELLM_URL)
                raise HTTPException(
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                    f"Could not reach LiteLLM service at {LITELLM_URL}: {exc}",
                )

        choice = data["choices"][0]
        message = choice["message"]

        tool_calls = message.get("tool_calls")
        if not tool_calls:
            # Final conversational answer reached
            return {
                "message": {
                    "role": "assistant",
                    "content": message.get("content", ""),
                }
            }

        # Model requested tool executions
        history.append(message)
        for tc in tool_calls:
            func = tc["function"]
            fname = func["name"]
            try:
                fargs = json.loads(func.get("arguments", "{}"))
            except Exception:
                fargs = {}

            try:
                result = await _execute_tool(fname, fargs, session, ctx, owned_ids, grants)
            except Exception as e:
                result = {"error": str(e)}

            history.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "name": fname,
                "content": json.dumps(result),
            })

    # Return whatever message was generated
    return {
        "message": {
            "role": "assistant",
            "content": history[-1].get("content") or "I processed your request.",
        }
    }
