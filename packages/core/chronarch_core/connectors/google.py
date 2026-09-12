"""Google Calendar connector (BR-CAL-001).

Talks to Calendar API v3 directly over httpx rather than pulling in
google-api-python-client — keeps this async-native and dependency-light,
matching the rest of the stack. OAuth token exchange/refresh lives here
too since it's Google-API-shaped, not generic; the admin OAuth router
(apps/api/app/routers/admin_google_router.py) only orchestrates: build
consent URL, exchange code, hand the resulting tokens to this connector.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote, urlencode

import httpx

from .base import BaseConnector, RemoteCalendar, RemoteEvent

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
API_BASE = "https://www.googleapis.com/calendar/v3"

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
]


def get_client_id() -> str:
    """Env-only fallback. Prefer `chronarch_core.oauth.resolve_google_credentials`,
    which checks the admin-configured DB row first — these helpers exist for
    scripts and contexts without a DB session."""
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    if not client_id:
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_ID is not set")
    return client_id


def get_client_secret() -> str:
    """Env-only fallback — see `get_client_id`."""
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_secret:
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_SECRET is not set")
    return client_secret


def build_consent_url(
    redirect_uri: str, state: str, *, client_id: Optional[str] = None
) -> str:
    params = {
        "client_id": client_id or get_client_id(),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(
    code: str,
    redirect_uri: str,
    *,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
) -> dict[str, Any]:
    """Returns {access_token, refresh_token, expires_in, ...}."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id or get_client_id(),
                "client_secret": client_secret or get_client_secret(),
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def fetch_userinfo(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(
    refresh_token: str,
    *,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": client_id or get_client_id(),
                "client_secret": client_secret or get_client_secret(),
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        return resp.json()


def _parse_event_time(node: dict) -> tuple[datetime, bool]:
    """Google represents all-day events as {"date": "YYYY-MM-DD"} and timed
    events as {"dateTime": "...", "timeZone": "..."}."""
    if "date" in node:
        return datetime.fromisoformat(node["date"]).replace(tzinfo=timezone.utc), True
    return datetime.fromisoformat(node["dateTime"]), False


def _to_remote_event(item: dict, writable: bool) -> RemoteEvent:
    start, all_day = _parse_event_time(item["start"])
    end, _ = _parse_event_time(item["end"])
    organizer = item.get("organizer")
    attendees = [
        {
            "email": a.get("email"),
            "name": a.get("displayName"),
            "response_status": a.get("responseStatus", "needs_action"),
        }
        for a in item.get("attendees", [])
    ]
    busy_status = "free" if item.get("transparency") == "transparent" else "busy"
    if item.get("status") == "tentative":
        busy_status = "tentative"

    return RemoteEvent(
        provider_event_id=item["id"],
        title=item.get("summary", "(no title)"),
        description=item.get("description"),
        start=start,
        end=end,
        timezone=item.get("start", {}).get("timeZone", "UTC"),
        all_day=all_day,
        organizer={"email": organizer.get("email"), "name": organizer.get("displayName")} if organizer else None,
        attendees=attendees,
        location=item.get("location"),
        conference={"url": item["hangoutLink"]} if item.get("hangoutLink") else None,
        recurrence={"rule": item["recurrence"]} if item.get("recurrence") else None,
        visibility={"public": "public", "private": "private"}.get(item.get("visibility", "default").lower(), "standard"),
        busy_status=busy_status,
        writable=writable and item.get("status") != "cancelled",
        provider_updated_at=datetime.fromisoformat(item["updated"]) if item.get("updated") else None,
    )


def _from_remote_event(event: RemoteEvent) -> dict[str, Any]:
    if event.all_day:
        start = {"date": event.start.date().isoformat()}
        end = {"date": event.end.date().isoformat()}
    else:
        start = {"dateTime": event.start.isoformat(), "timeZone": event.timezone}
        end = {"dateTime": event.end.isoformat(), "timeZone": event.timezone}
    body: dict[str, Any] = {
        "summary": event.title,
        "description": event.description,
        "location": event.location,
        "start": start,
        "end": end,
    }
    if event.attendees:
        body["attendees"] = [{"email": a["email"]} for a in event.attendees if a.get("email")]
    return body


class GoogleConnector(BaseConnector):
    def __init__(
        self,
        access_token: str,
        refresh_token: Optional[str] = None,
        *,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
    ):
        self._access_token = access_token
        self._refresh_token = refresh_token
        # OAuth client credentials for mid-flight token refresh. Callers with
        # a DB session should resolve these via
        # `chronarch_core.oauth.resolve_google_credentials` (DB config first,
        # env fallback) and pass them in — otherwise the env-only fallback
        # applies, which breaks refresh for UI-configured deployments.
        self._client_id = client_id
        self._client_secret = client_secret

    @property
    def access_token(self) -> str:
        """Current access token — may differ from what the connector was
        constructed with if a 401 triggered a mid-flight refresh; callers
        that persist tokens should re-read this after making requests."""
        return self._access_token

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        async with httpx.AsyncClient() as client:
            resp = await client.request(
                method, url, headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs
            )
            if resp.status_code == 401 and self._refresh_token:
                tokens = await refresh_access_token(
                    self._refresh_token,
                    client_id=self._client_id,
                    client_secret=self._client_secret,
                )
                self._access_token = tokens["access_token"]
                resp = await client.request(
                    method, url, headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs
                )
            resp.raise_for_status()
            return resp

    async def list_calendars(self) -> list[RemoteCalendar]:
        resp = await self._request("GET", f"{API_BASE}/users/me/calendarList")
        items = resp.json().get("items", [])
        result = []
        for item in items:
            access_role = item.get("accessRole", "reader")
            writable = access_role in ("owner", "writer")
            kind = "primary" if item.get("primary") else "shared"
            result.append(
                RemoteCalendar(
                    provider_calendar_id=item["id"],
                    name=item.get("summaryOverride") or item.get("summary", item["id"]),
                    kind=kind,
                    writable=writable,
                    color=item.get("backgroundColor"),
                )
            )
        return result

    async def list_events(
        self,
        calendar_id: str,
        *,
        window_start: datetime,
        window_end: datetime,
        sync_token: Optional[str] = None,
        calendar_writable: bool = True,
    ) -> tuple[list[RemoteEvent], list[str], Optional[str]]:
        params: dict[str, Any] = {
            "singleEvents": "true",
            "maxResults": 2500,
            # showDeleted surfaces cancelled instances as stub items
            # (status=cancelled, usually start/end omitted) so the sync
            # layer can delete the matching cached rows. showHidden includes
            # hidden invitations, which still block availability.
            "showDeleted": "true",
            "showHidden": "true",
        }
        if sync_token:
            params["syncToken"] = sync_token
        else:
            params["timeMin"] = window_start.isoformat()
            params["timeMax"] = window_end.isoformat()

        events: list[RemoteEvent] = []
        deleted_ids: list[str] = []
        next_sync_token: Optional[str] = None
        page_token: Optional[str] = None
        while True:
            if page_token:
                params["pageToken"] = page_token
            resp = await self._request(
                "GET", f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events", params=params
            )
            data = resp.json()
            for item in data.get("items", []):
                if item.get("status") == "cancelled":
                    # Cancelled stubs carry only the id — record the
                    # deletion and skip conversion (no start/end to parse).
                    if item.get("id"):
                        deleted_ids.append(item["id"])
                    continue
                events.append(_to_remote_event(item, writable=calendar_writable))
            next_sync_token = data.get("nextSyncToken", next_sync_token)
            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return events, deleted_ids, next_sync_token

    async def create_event(self, calendar_id: str, event: RemoteEvent) -> RemoteEvent:
        resp = await self._request(
            "POST",
            f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events",
            json=_from_remote_event(event),
        )
        return _to_remote_event(resp.json(), writable=True)

    async def update_event(self, calendar_id: str, provider_event_id: str, patch: dict[str, Any]) -> RemoteEvent:
        resp = await self._request(
            "PATCH",
            f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events/"
            f"{quote(provider_event_id, safe='')}",
            json=patch,
        )
        return _to_remote_event(resp.json(), writable=True)

    async def delete_event(self, calendar_id: str, provider_event_id: str) -> None:
        await self._request(
            "DELETE",
            f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events/"
            f"{quote(provider_event_id, safe='')}",
        )

    async def get_raw_event(self, calendar_id: str, provider_event_id: str) -> dict[str, Any]:
        resp = await self._request(
            "GET",
            f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events/{quote(provider_event_id, safe='')}",
        )
        return resp.json()

    async def add_attendee(
        self, calendar_id: str, provider_event_id: str, email: str, name: Optional[str] = None
    ) -> list[dict]:
        event = await self.get_raw_event(calendar_id, provider_event_id)
        attendees = list(event.get("attendees", []))
        normalized = email.lower().strip()
        for a in attendees:
            if a.get("email", "").lower() == normalized:
                return attendees
        new_att: dict[str, Any] = {"email": email}
        if name:
            new_att["displayName"] = name
        attendees.append(new_att)
        resp = await self._request(
            "PATCH",
            f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events/{quote(provider_event_id, safe='')}",
            json={"attendees": attendees},
        )
        return resp.json().get("attendees", [])

    async def remove_attendee(self, calendar_id: str, provider_event_id: str, email: str) -> list[dict]:
        event = await self.get_raw_event(calendar_id, provider_event_id)
        attendees = event.get("attendees", [])
        normalized = email.lower().strip()
        updated = [a for a in attendees if a.get("email", "").lower() != normalized]
        resp = await self._request(
            "PATCH",
            f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events/{quote(provider_event_id, safe='')}",
            json={"attendees": updated},
        )
        return resp.json().get("attendees", [])

    async def respond_to_event(self, calendar_id: str, provider_event_id: str, response_status: str) -> None:
        """Update RSVP status in Google Calendar. Valid values: 'accepted', 'declined', 'tentative'."""
        status_map = {
            "accepted": "accepted",
            "accept": "accepted",
            "declined": "declined",
            "decline": "declined",
            "tentative": "tentative",
        }
        target = status_map.get(response_status.lower(), response_status.lower())
        event = await self.get_raw_event(calendar_id, provider_event_id)
        attendees = list(event.get("attendees", []))
        matched = False
        for a in attendees:
            if a.get("self"):
                a["responseStatus"] = target
                matched = True
                break
        if not matched:
            raise ValueError("Cannot RSVP: calendar user is not listed as an attendee with self=True on this event.")
        await self._request(
            "PATCH",
            f"{API_BASE}/calendars/{quote(calendar_id, safe='')}/events/{quote(provider_event_id, safe='')}",
            json={"attendees": attendees} if attendees else {},
        )

    async def register_webhook(self, calendar_id: str, callback_url: str) -> dict[str, Any]:
        """Google's push channels require a publicly reachable HTTPS URL —
        not available for a local/dev deployment, so this is a no-op there.
        A production deployment behind a real domain can call this once
        that's true; the scheduler would then need to renew the channel
        before `expiration` (channels last at most ~7 days for events)."""
        raise NotImplementedError(
            "Webhook registration requires a public HTTPS callback URL. "
            "Falling back to periodic reconciliation until this deployment has one."
        )

