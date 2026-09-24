"""Backfill + calendar discovery for a newly connected (or reconciling)
Google account.

Called synchronously from the OAuth callback for the initial connect, and
is what apps/worker's reconcile_account task will call for periodic
reconciliation once that's wired up (BR-CAL sync, BRD §24) — kept here in
chronarch_core so both call sites share one implementation.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors.google import GoogleConnector
from ..crypto import get_cipher
from ..models.account import Account
from ..models.calendar import Calendar
from ..models.enums import BusyStatus, CalendarKind, EventVisibility
from ..models.event import UnifiedEvent

# Matches the calendar-color palette in BRAND.md.
DEFAULT_PALETTE = [
    "#0a84ff", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158",
    "#64d2ff", "#ff453a", "#98989d", "#ffd60a", "#5e5ce6",
]

BACKFILL_PAST = timedelta(days=90)
BACKFILL_FUTURE = timedelta(days=365)


async def sync_google_account(session: AsyncSession, account: Account) -> dict:
    """Discovers calendars and backfills events for `account`. Returns a
    small stats dict. Persists any refreshed access token back onto the
    account and updates its sync_status."""
    cipher = get_cipher()
    access_token = cipher.decrypt(account.encrypted_access_token) if account.encrypted_access_token else None
    refresh_token = cipher.decrypt(account.encrypted_refresh_token) if account.encrypted_refresh_token else None
    if not access_token:
        raise ValueError("Account has no stored access token")

    # OAuth client credentials come from the admin-configured DB row first
    # (Settings > Accounts), env fallback second — so token refresh keeps
    # working for UI-configured deployments.
    from ..oauth import resolve_google_credentials

    client_id, client_secret = await resolve_google_credentials(session)
    connector = GoogleConnector(
        access_token, refresh_token, client_id=client_id, client_secret=client_secret
    )

    try:
        remote_calendars = await connector.list_calendars()

        existing_by_provider_id = {
            c.provider_calendar_id: c
            for c in (
                await session.execute(select(Calendar).where(Calendar.account_id == account.id))
            ).scalars()
        }

        calendars_synced = 0
        events_synced = 0
        events_deleted = 0
        window_start = datetime.now(timezone.utc) - BACKFILL_PAST
        window_end = datetime.now(timezone.utc) + BACKFILL_FUTURE

        import asyncio

        # 1. Provision / sync calendar database rows
        synced_calendars = []
        for i, remote_cal in enumerate(remote_calendars):
            calendar = existing_by_provider_id.get(remote_cal.provider_calendar_id)
            if calendar is None:
                calendar = Calendar(
                    account_id=account.id,
                    provider_calendar_id=remote_cal.provider_calendar_id,
                    kind=CalendarKind(remote_cal.kind),
                    name=remote_cal.name,
                    color=remote_cal.color or DEFAULT_PALETTE[i % len(DEFAULT_PALETTE)],
                    provider_writable=remote_cal.writable,
                    visible=True,
                    blocks_availability=True,
                    ea_can_view=False,
                    ea_can_edit=False,
                    ai_can_read=False,
                    ai_can_write=False,
                )
                session.add(calendar)
                await session.flush()
            else:
                calendar.name = remote_cal.name
                calendar.provider_writable = remote_cal.writable
            synced_calendars.append((calendar, remote_cal))
            calendars_synced += 1

        # 2. Fetch events in parallel across all calendars using asyncio.gather (Performance 2B)
        fetch_results = await asyncio.gather(*[
            connector.list_events(
                r_cal.provider_calendar_id,
                window_start=window_start,
                window_end=window_end,
                sync_token=(account.sync_tokens or {}).get(r_cal.provider_calendar_id) or account.sync_token,
                calendar_writable=r_cal.writable,
            )
            for _, r_cal in synced_calendars
        ], return_exceptions=True)

        partial_failure = False
        for (calendar, remote_cal), res in zip(synced_calendars, fetch_results):
            if isinstance(res, Exception):
                partial_failure = True
                continue
            remote_events, deleted_ids, next_sync_token = res
            if next_sync_token:
                tokens = dict(account.sync_tokens or {})
                tokens[remote_cal.provider_calendar_id] = next_sync_token
                account.sync_tokens = tokens

            existing_events = {
                e.provider_event_id: e
                for e in (
                    await session.execute(
                        select(UnifiedEvent).where(
                            UnifiedEvent.calendar_id == calendar.id,
                            UnifiedEvent.start < window_end,
                            UnifiedEvent.end > window_start,
                        )
                    )
                ).scalars()
            }

            for provider_event_id in deleted_ids:
                stale = existing_events.pop(provider_event_id, None)
                if stale is not None:
                    await session.delete(stale)
                    events_deleted += 1

            for remote_event in remote_events:
                event = existing_events.get(remote_event.provider_event_id)
                if event is None:
                    event = UnifiedEvent(
                        provider_account_id=account.id,
                        calendar_id=calendar.id,
                        provider_event_id=remote_event.provider_event_id,
                    )
                    session.add(event)

                event.title = remote_event.title
                event.description = remote_event.description
                event.start = remote_event.start
                event.end = remote_event.end
                event.timezone = remote_event.timezone
                event.all_day = remote_event.all_day
                event.organizer = remote_event.organizer
                event.attendees = remote_event.attendees
                event.location = remote_event.location
                event.conference = remote_event.conference
                event.recurrence = remote_event.recurrence
                event.visibility = EventVisibility(remote_event.visibility)
                event.busy_status = BusyStatus(remote_event.busy_status)
                event.source_permissions = {
                    "write": bool(remote_cal.writable and remote_event.writable)
                }
                event.provider_updated_at = remote_event.provider_updated_at
                event.last_synced_at = datetime.now(timezone.utc)
                events_synced += 1

        account.sync_status = "error" if partial_failure else "ok"
        account.last_synced_at = datetime.now(timezone.utc).isoformat()
        account.last_sync_error = "One or more calendars failed to sync" if partial_failure else None
    except Exception as exc:  # noqa: BLE001 — persist the failure for the admin UI, then re-raise
        import httpx
        is_auth_error = False
        if isinstance(exc, httpx.HTTPStatusError):
            if exc.response.status_code in (400, 401):
                is_auth_error = True
        elif "invalid_grant" in str(exc).lower() or "unauthorized" in str(exc).lower():
            is_auth_error = True

        account.sync_status = "needs_auth" if is_auth_error else "error"
        account.last_sync_error = str(exc)[:500]
        raise
    finally:
        # The connector may have refreshed the access token mid-sync (401
        # handling) — persist that even on failure so we don't refresh
        # again unnecessarily next time.
        if connector.access_token != access_token:
            account.encrypted_access_token = cipher.encrypt(connector.access_token)
        await session.flush()

    return {
        "calendars_synced": calendars_synced,
        "events_synced": events_synced,
        "events_deleted": events_deleted,
    }
