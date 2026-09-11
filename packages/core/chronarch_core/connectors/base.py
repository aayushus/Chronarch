"""BaseConnector: the interface every provider connector implements.

Designed against Google/Microsoft/CalDAV/ICS semantics together (not just
Google/Graph) so Phase 2's CalDAV connector is additive, not a retrofit —
CalDAV lacks a rich native permission model, so `list_calendars` returning a
plain `writable: bool` (rather than a provider-specific ACL type) is what
keeps this interface generic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional


@dataclass(frozen=True)
class RemoteCalendar:
    provider_calendar_id: str
    name: str
    kind: str  # CalendarKind value
    writable: bool
    color: Optional[str] = None


@dataclass(frozen=True)
class RemoteEvent:
    provider_event_id: str
    title: str
    description: Optional[str]
    start: datetime
    end: datetime
    timezone: str
    all_day: bool
    organizer: Optional[dict]
    attendees: list[dict]
    location: Optional[str]
    conference: Optional[dict]
    recurrence: Optional[dict]
    visibility: str
    busy_status: str
    writable: bool
    provider_updated_at: Optional[datetime]


class BaseConnector(ABC):
    """One instance per connected Account. Implementations: GoogleConnector,
    MicrosoftConnector, CalDAVConnector (Phase 2), ICSConnector.
    """

    @abstractmethod
    async def list_calendars(self) -> list[RemoteCalendar]:
        ...

    @abstractmethod
    async def list_events(
        self,
        calendar_id: str,
        *,
        window_start: datetime,
        window_end: datetime,
        sync_token: Optional[str] = None,
    ) -> tuple[list[RemoteEvent], Optional[str]]:
        """Returns (events, next_sync_token). Implementations should use
        provider incremental-sync tokens when `sync_token` is provided."""
        ...

    @abstractmethod
    async def create_event(self, calendar_id: str, event: RemoteEvent) -> RemoteEvent:
        ...

    @abstractmethod
    async def update_event(self, calendar_id: str, provider_event_id: str, patch: dict[str, Any]) -> RemoteEvent:
        ...

    @abstractmethod
    async def delete_event(self, calendar_id: str, provider_event_id: str) -> None:
        ...

    @abstractmethod
    async def register_webhook(self, calendar_id: str, callback_url: str) -> dict[str, Any]:
        """Register a push subscription. Must return enough info (e.g.
        channel id + expiration) for the scheduler to renew it before it
        expires — see infra note on webhook renewal."""
        ...
