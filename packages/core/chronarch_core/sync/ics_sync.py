"""Sync engine for ICS URL Subscriptions (BR-CAL-004, BRD §7).

Fetches the remote .ics feed, parses events, and updates local UnifiedEvent
rows. ICS subscriptions are treated as read-only (`writable=False`).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ics import fetch_ics_feed, parse_ics_to_remote_events
from ..models.calendar import Calendar
from ..models.enums import BusyStatus, EventVisibility
from ..models.event import UnifiedEvent

logger = logging.getLogger(__name__)


async def sync_ics_subscription_calendar(session: AsyncSession, calendar: Calendar) -> dict:
    """Syncs a single subscription calendar from its `ics_subscription_url`."""
    if not calendar.ics_subscription_url:
        return {"calendar_id": calendar.id, "status": "no_url"}

    try:
        raw_content = await fetch_ics_feed(calendar.ics_subscription_url)
        remote_events = parse_ics_to_remote_events(raw_content)
    except Exception as exc:
        logger.exception("Failed to fetch/parse ICS feed for calendar %s", calendar.id)
        return {"calendar_id": calendar.id, "status": "error", "error": str(exc)}

    # Fetch existing cached events for this calendar
    stmt = select(UnifiedEvent).where(UnifiedEvent.calendar_id == calendar.id)
    existing_events = {e.provider_event_id: e for e in (await session.execute(stmt)).scalars()}

    seen_provider_ids = set()
    upserted_count = 0

    for rem in remote_events:
        seen_provider_ids.add(rem.provider_event_id)
        existing = existing_events.get(rem.provider_event_id)

        vis = EventVisibility.STANDARD
        busy = BusyStatus.BUSY

        if existing:
            existing.title = rem.title
            existing.description = rem.description
            existing.start = rem.start
            existing.end = rem.end
            existing.timezone = rem.timezone
            existing.all_day = rem.all_day
            existing.location = rem.location
            existing.organizer = rem.organizer
            existing.attendees = rem.attendees
            existing.recurrence = rem.recurrence
            existing.visibility = vis
            existing.busy_status = busy
            existing.source_permissions = {"write": False}
            upserted_count += 1
        else:
            new_event = UnifiedEvent(
                provider_account_id=calendar.account_id,
                calendar_id=calendar.id,
                provider_event_id=rem.provider_event_id,
                title=rem.title,
                description=rem.description,
                start=rem.start,
                end=rem.end,
                timezone=rem.timezone,
                all_day=rem.all_day,
                location=rem.location,
                organizer=rem.organizer,
                attendees=rem.attendees,
                conference=rem.conference,
                recurrence=rem.recurrence,
                visibility=vis,
                busy_status=busy,
                source_permissions={"write": False},
            )
            session.add(new_event)
            upserted_count += 1

    # Prune removed events
    to_delete = [
        eid for pid, eid in [(e.provider_event_id, e.id) for e in existing_events.values()]
        if pid not in seen_provider_ids
    ]
    if to_delete:
        await session.execute(delete(UnifiedEvent).where(UnifiedEvent.id.in_(to_delete)))

    await session.flush()
    return {
        "calendar_id": calendar.id,
        "status": "ok",
        "total_parsed": len(remote_events),
        "upserted": upserted_count,
        "pruned": len(to_delete),
        "events_synced": upserted_count,
        "events_deleted": len(to_delete),
    }
