"""Natural-language quick-add (BRD §32).

Two-step flow per the §21 WRITE confirmation pattern: `parse` turns text
into a draft (no side effects), `create` commits the confirmed draft to a
calendar. Parsing is one deterministic LiteLLM call (temperature 0) reusing
the copilot's proxy settings; attendee names resolve against the
invite-extracted contact directory, and ambiguity is returned — never
guessed. Creation rides the same `ai_tools.create_event` permission path as
every other write, so delegation grants are enforced identically.
"""

import json
import logging
import os
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import ai_tools
from chronarch_core import contacts as _contacts
from chronarch_core.models.user import User
from chronarch_core.permissions import describe_denial

from ..auth import build_auth_context, get_current_user
from ..deps import get_client_timezone, get_db_session
from .calendars_router import actor_type_for
from .events_router import EventOut, _resolve_owner_and_grant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/quick-add", tags=["quick-add"])

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000/v1/chat/completions")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")


class QuickAddParseRequest(BaseModel):
    text: str
    # Omitted = the caller's zone (X-Timezone header), never the server zone.
    timezone: str | None = None


class QuickAddAttendee(BaseModel):
    name: str
    email: str | None = None
    ambiguous: list[dict] | None = None


class QuickAddDraft(BaseModel):
    title: str
    start: datetime
    end: datetime
    all_day: bool = False
    location: str | None = None
    description: str | None = None
    attendees: list[QuickAddAttendee] = []
    recurrence: dict | None = None


class QuickAddCreateRequest(BaseModel):
    calendar_id: str
    draft: QuickAddDraft


def _parse_json_object(text: str) -> dict | None:
    """Extract the first {...} block (models wrap JSON in fences/prose)."""
    cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def _any_provider_key(session: AsyncSession) -> bool:
    from chronarch_core.ai_config import get_settings as _get_ai_settings

    try:
        row = await _get_ai_settings(session)
    except Exception:
        return True
    return bool(
        row
        and (
            row.encrypted_openrouter_api_key
            or getattr(row, "encrypted_groq_api_key", None)
            or getattr(row, "encrypted_gemini_api_key", None)
        )
    )


async def _call_litellm(messages: list[dict]) -> str:
    """Single deterministic chat call; raises HTTPException on failure."""
    payload = {"model": "primary", "messages": messages, "temperature": 0}
    headers = {"Authorization": f"Bearer {LITELLM_MASTER_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            resp = await client.post(LITELLM_URL, json=payload, headers=headers)
    except httpx.RequestError:
        logger.exception("Quick-add: LiteLLM unreachable at %s", LITELLM_URL)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Couldn't reach the AI service. Check the proxy and try again.",
        )
    if resp.status_code != 200:
        logger.error("Quick-add: LiteLLM returned status %d", resp.status_code)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS
            if resp.status_code == 429
            else status.HTTP_502_BAD_GATEWAY,
            "The AI service is over quota — retry later."
            if resp.status_code == 429
            else "The AI service failed to parse that. Try rephrasing.",
        )
    try:
        return resp.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError, ValueError):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The AI service returned an unreadable reply. Try again."
        )


def _parse_prompt(text: str, now_iso: str, tz_name: str, people: list[dict]) -> list[dict]:
    known = "\n".join(f"- {p['name']} <{p['email']}>" for p in people) or "(none yet)"
    return [
        {"role": "system", "content": (
            "Extract a calendar event from the user's text. Respond with ONLY a JSON object, no prose. "
            f"Current time is {now_iso} in {tz_name}; interpret relative dates (today, tomorrow, Friday) "
            "against it and emit start/end as ISO datetimes WITH numeric UTC offset "
            "(e.g. 2026-09-16T14:00:00-07:00). Default duration is 30 minutes when none is given. "
            'Schema: {"title": str, "start": str, "end": str, "all_day": bool, '
            '"location": str|null, "description": str|null, "attendees": [{"name": str}], '
            '"recurrence": {"freq": "daily|weekly|monthly|yearly"}|null}. '
            'Set recurrence when the user says "every day/week/Tuesday/month" and null otherwise. '
            'Put every person mentioned with the event in attendees as {"name"} entries — '
            "do NOT guess emails. Known people (match names against these when the user says a first name):\n"
            f"{known}"
        )},
        {"role": "user", "content": text},
    ]


@router.post("/parse", response_model=QuickAddDraft)
async def quick_add_parse(
    body: QuickAddParseRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    client_timezone: str = Depends(get_client_timezone),
):
    """Parse free text into an event draft. No side effects."""
    from chronarch_core.timezones import normalize_timezone

    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nothing to parse — type an event first.")
    if not await _any_provider_key(session):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "No AI provider key is saved yet — add one under Settings > AI & Copilot, then try again.",
        )
    tz_name = normalize_timezone(body.timezone or client_timezone)
    now_iso = datetime.now().astimezone().isoformat()
    people = await _contacts.known_people_for_prompt(session)
    content = await _call_litellm(_parse_prompt(text, now_iso, tz_name, people))
    parsed = _parse_json_object(content)
    if parsed is None or not parsed.get("title") or not parsed.get("start") or not parsed.get("end"):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Couldn't understand that as an event — try something like “Lunch with John tomorrow at noon”.",
        )
    try:
        start = datetime.fromisoformat(str(parsed["start"]))
        end = datetime.fromisoformat(str(parsed["end"]))
    except ValueError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The parsed time wasn't a valid date — try rephrasing."
        )
    if end <= start:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The parsed end time is before the start — try rephrasing."
        )

    attendees: list[QuickAddAttendee] = []
    for entry in parsed.get("attendees") or []:
        name = (entry.get("name") if isinstance(entry, dict) else str(entry) or "").strip()
        if not name:
            continue
        resolution = await _contacts.resolve_contact(session, name)
        if resolution["status"] == "found":
            contact = resolution["contact"]
            attendees.append(QuickAddAttendee(
                name=contact.display_name or contact.email, email=contact.email))
        elif resolution["status"] == "ambiguous":
            attendees.append(QuickAddAttendee(
                name=name,
                ambiguous=[{"email": c.email, "display_name": c.display_name}
                           for c in resolution["candidates"][:5]]))
        else:
            attendees.append(QuickAddAttendee(name=name))

    return QuickAddDraft(
        title=str(parsed["title"]).strip(),
        start=start, end=end, all_day=bool(parsed.get("all_day", False)),
        location=parsed.get("location"), description=parsed.get("description"),
        attendees=attendees,
        recurrence=parsed.get("recurrence") if isinstance(parsed.get("recurrence"), dict) else None,
    )


@router.post("/create", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def quick_add_create(
    body: QuickAddCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    client_timezone: str = Depends(get_client_timezone),
):
    """Commit a confirmed draft. Unresolved attendees are rejected, not guessed."""
    from chronarch_core.timezones import normalize_timezone

    draft = body.draft
    if draft.end <= draft.start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Event end must be after start.")
    unresolved = [a.name for a in draft.attendees if not a.email]
    if unresolved:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"These people aren't in your contacts yet: {', '.join(unresolved)}. "
            "Pick a match or remove them before creating.",
        )
    is_owner, grant = await _resolve_owner_and_grant(session, user, body.calendar_id)
    ctx = build_auth_context(user, actor_type_for(user))
    conflicts = await ai_tools.get_conflicts(
        session, ctx,
        window_start=draft.start, window_end=draft.end,
        calendar_ids=[body.calendar_id],
        owner_calendar_ids={body.calendar_id} if is_owner else None,
        grants_by_calendar={body.calendar_id: grant} if grant else None,
    )
    if conflicts:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This overlaps {conflicts[0]['title']!r} on this calendar. Adjust the time and try again.",
        )
    try:
        event = await ai_tools.create_event(
            session, ctx, calendar_id=body.calendar_id, title=draft.title,
            start=draft.start, end=draft.end,
            timezone=normalize_timezone(client_timezone),
            description=draft.description, location=draft.location,
            attendees=[{"email": a.email, "name": a.name} for a in draft.attendees if a.email],
            all_day=draft.all_day, recurrence=draft.recurrence,
            is_owner=is_owner, delegation_grant=grant,
        )
    except ai_tools.PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, describe_denial(exc.action, exc.reason))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return event
