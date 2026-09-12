"""Microsoft 365 & Outlook calendar connector (BR-CAL-002).

Talks to Microsoft Graph API v1.0 directly over httpx.
Supports multi-tenant / personal Microsoft accounts via configurable `tenant_id`
(defaults to "common").
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote, urlencode
import zoneinfo

import httpx

from .base import BaseConnector, RemoteCalendar, RemoteEvent

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
DEFAULT_TENANT = "common"
SCOPES = [
    "Calendars.ReadWrite",
    "User.Read",
    "offline_access",
]


def _auth_url(tenant_id: Optional[str] = None) -> str:
    tenant = tenant_id or DEFAULT_TENANT
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"


def _token_url(tenant_id: Optional[str] = None) -> str:
    tenant = tenant_id or DEFAULT_TENANT
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def get_client_id() -> str:
    client_id = os.environ.get("MICROSOFT_OAUTH_CLIENT_ID")
    if not client_id:
        raise RuntimeError("MICROSOFT_OAUTH_CLIENT_ID is not set")
    return client_id


def get_client_secret() -> str:
    client_secret = os.environ.get("MICROSOFT_OAUTH_CLIENT_SECRET")
    if not client_secret:
        raise RuntimeError("MICROSOFT_OAUTH_CLIENT_SECRET is not set")
    return client_secret


def get_tenant_id() -> str:
    return os.environ.get("MICROSOFT_TENANT_ID", DEFAULT_TENANT)


def build_consent_url(
    redirect_uri: str,
    state: str,
    *,
    client_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> str:
    params = {
        "client_id": client_id or get_client_id(),
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": " ".join(SCOPES),
        "state": state,
    }
    return f"{_auth_url(tenant_id)}?{urlencode(params)}"


async def exchange_code(
    code: str,
    redirect_uri: str,
    *,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _token_url(tenant_id),
            data={
                "client_id": client_id or get_client_id(),
                "client_secret": client_secret or get_client_secret(),
                "code": code,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": " ".join(SCOPES),
            },
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(
    refresh_token: str,
    *,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _token_url(tenant_id),
            data={
                "client_id": client_id or get_client_id(),
                "client_secret": client_secret or get_client_secret(),
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "scope": " ".join(SCOPES),
            },
        )
        resp.raise_for_status()
        return resp.json()


async def fetch_userinfo(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GRAPH_BASE}/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()


# Common Microsoft Graph Windows timezone names mapped to IANA identifiers
WINDOWS_TO_IANA_TIMEZONES: dict[str, str] = {
    "Dateline Standard Time": "Etc/GMT+12",
    "UTC-11": "Etc/GMT+11",
    "Hawaiian Standard Time": "Pacific/Honolulu",
    "Alaskan Standard Time": "America/Anchorage",
    "Pacific Standard Time": "America/Los_Angeles",
    "Pacific Standard Time (Mexico)": "America/Tijuana",
    "US Mountain Standard Time": "America/Phoenix",
    "Mountain Standard Time": "America/Denver",
    "Mountain Standard Time (Mexico)": "America/Chihuahua",
    "Central Standard Time": "America/Chicago",
    "Central Standard Time (Mexico)": "America/Mexico_City",
    "Canada Central Standard Time": "America/Regina",
    "SA Pacific Standard Time": "America/Bogota",
    "Eastern Standard Time": "America/New_York",
    "US Eastern Standard Time": "America/Indianapolis",
    "Venezuela Standard Time": "America/Caracas",
    "Paraguay Standard Time": "America/Asuncion",
    "Atlantic Standard Time": "America/Halifax",
    "Central Brazilian Standard Time": "America/Cuiaba",
    "SA Western Standard Time": "America/La_Paz",
    "Pacific SA Standard Time": "America/Santiago",
    "Newfoundland Standard Time": "America/St_Johns",
    "E. South America Standard Time": "America/Sao_Paulo",
    "Argentina Standard Time": "America/Buenos_Aires",
    "SA Eastern Standard Time": "America/Cayenne",
    "Greenland Standard Time": "America/Godthab",
    "Montevideo Standard Time": "America/Montevideo",
    "UTC-02": "Etc/GMT+2",
    "Mid-Atlantic Standard Time": "Etc/GMT+2",
    "Azores Standard Time": "Atlantic/Azores",
    "Cape Verde Standard Time": "Atlantic/Cape_Verde",
    "UTC": "UTC",
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "W. Europe Standard Time": "Europe/Berlin",
    "Central Europe Standard Time": "Europe/Budapest",
    "Romance Standard Time": "Europe/Paris",
    "Central European Standard Time": "Europe/Warsaw",
    "W. Central Africa Standard Time": "Africa/Lagos",
    "Jordan Standard Time": "Asia/Amman",
    "GTB Standard Time": "Europe/Bucharest",
    "Middle East Standard Time": "Asia/Beirut",
    "Egypt Standard Time": "Africa/Cairo",
    "South Africa Standard Time": "Africa/Johannesburg",
    "FLE Standard Time": "Europe/Kiev",
    "Israel Standard Time": "Asia/Jerusalem",
    "E. Europe Standard Time": "Europe/Chisinau",
    "Arabic Standard Time": "Asia/Baghdad",
    "Arab Standard Time": "Asia/Riyadh",
    "Russian Standard Time": "Europe/Moscow",
    "East Africa Standard Time": "Africa/Nairobi",
    "Iran Standard Time": "Asia/Tehran",
    "Arabian Standard Time": "Asia/Dubai",
    "Azerbaijan Standard Time": "Asia/Baku",
    "Mauritius Standard Time": "Indian/Mauritius",
    "Georgian Standard Time": "Asia/Tbilisi",
    "Caucasus Standard Time": "Asia/Yerevan",
    "Afghanistan Standard Time": "Asia/Kabul",
    "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
    "Pakistan Standard Time": "Asia/Karachi",
    "West Asia Standard Time": "Asia/Tashkent",
    "India Standard Time": "Asia/Kolkata",
    "Sri Lanka Standard Time": "Asia/Colombo",
    "Nepal Standard Time": "Asia/Kathmandu",
    "Central Asia Standard Time": "Asia/Almaty",
    "Bangladesh Standard Time": "Asia/Dhaka",
    "N. Central Asia Standard Time": "Asia/Novosibirsk",
    "Myanmar Standard Time": "Asia/Rangoon",
    "SE Asia Standard Time": "Asia/Bangkok",
    "North Asia Standard Time": "Asia/Krasnoyarsk",
    "China Standard Time": "Asia/Shanghai",
    "North Asia East Standard Time": "Asia/Irkutsk",
    "Singapore Standard Time": "Asia/Singapore",
    "W. Australia Standard Time": "Australia/Perth",
    "Taipei Standard Time": "Asia/Taipei",
    "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
    "Tokyo Standard Time": "Asia/Tokyo",
    "Korea Standard Time": "Asia/Seoul",
    "Yakutsk Standard Time": "Asia/Yakutsk",
    "Cen. Australia Standard Time": "Australia/Adelaide",
    "AUS Central Standard Time": "Australia/Darwin",
    "E. Australia Standard Time": "Australia/Brisbane",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "West Pacific Standard Time": "Pacific/Port_Moresby",
    "Tasmania Standard Time": "Australia/Hobart",
    "Vladivostok Standard Time": "Asia/Vladivostok",
    "Lord Howe Standard Time": "Australia/Lord_Howe",
    "New Zealand Standard Time": "Pacific/Auckland",
    "Fiji Standard Time": "Pacific/Fiji",
}


def _resolve_zoneinfo(tz_name: str | None) -> zoneinfo.ZoneInfo:
    """Resolve a timezone identifier (IANA or Windows) to a ZoneInfo instance."""
    if not tz_name or tz_name.upper() == "UTC":
        return zoneinfo.ZoneInfo("UTC")
    mapped = WINDOWS_TO_IANA_TIMEZONES.get(tz_name, tz_name)
    try:
        return zoneinfo.ZoneInfo(mapped)
    except Exception:
        return zoneinfo.ZoneInfo("UTC")


def _parse_graph_time(node: dict, is_all_day: bool) -> datetime:
    raw = node.get("dateTime", "")
    if is_all_day:
        # All-day dates come like "2026-09-15T00:00:00.0000000"
        return datetime.fromisoformat(raw[:10]).replace(tzinfo=timezone.utc)

    # Strip subsecond precision past 6 digits if present, or Z suffix
    cleaned = raw.rstrip("Z")
    if "." in cleaned:
        base, frac = cleaned.split(".", 1)
        cleaned = f"{base}.{frac[:6]}"

    dt = datetime.fromisoformat(cleaned)
    tz_str = node.get("timeZone")
    if dt.tzinfo is None:
        tz = _resolve_zoneinfo(tz_str)
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(timezone.utc)


def _to_remote_event(item: dict, writable: bool) -> RemoteEvent:
    all_day = bool(item.get("isAllDay"))
    start = _parse_graph_time(item["start"], all_day)
    end = _parse_graph_time(item["end"], all_day)
    organizer = item.get("organizer", {}).get("emailAddress")

    raw_response_map = {
        "none": "needs_action",
        "organizer": "accepted",
        "accepted": "accepted",
        "tentativelyaccepted": "tentative",
        "tentative": "tentative",
        "declined": "declined",
        "notresponded": "needs_action",
    }

    attendees = [
        {
            "email": a.get("emailAddress", {}).get("address"),
            "name": a.get("emailAddress", {}).get("name"),
            "response_status": raw_response_map.get(
                str(a.get("status", {}).get("response", "none")).lower(),
                "needs_action",
            ),
        }
        for a in item.get("attendees", [])
        if a.get("emailAddress", {}).get("address")
    ]

    show_as = item.get("showAs", "busy").lower()
    busy_status_map = {
        "free": "free",
        "tentative": "tentative",
        "busy": "busy",
        "oof": "out_of_office",
        "workingelsewhere": "busy",
    }
    busy_status = busy_status_map.get(show_as, "busy")

    return RemoteEvent(
        provider_event_id=item["id"],
        title=item.get("subject") or "(no title)",
        description=item.get("bodyPreview") or item.get("body", {}).get("content"),
        start=start,
        end=end,
        timezone=item.get("start", {}).get("timeZone", "UTC"),
        all_day=all_day,
        organizer={"email": organizer.get("address"), "name": organizer.get("name")} if organizer else None,
        attendees=attendees,
        location=item.get("location", {}).get("displayName"),
        conference={"url": item["onlineMeetingUrl"]} if item.get("onlineMeetingUrl") else None,
        recurrence={"type": item.get("recurrence")} if item.get("recurrence") else None,
        visibility="private" if item.get("sensitivity") == "private" else "standard",
        busy_status=busy_status,
        writable=writable and not item.get("isCancelled"),
        provider_updated_at=datetime.fromisoformat(item["lastModifiedDateTime"][:19]).replace(tzinfo=timezone.utc)
        if item.get("lastModifiedDateTime")
        else None,
    )


def _from_remote_event(event: RemoteEvent) -> dict[str, Any]:
    tz = event.timezone or "UTC"
    if event.all_day:
        start = {"dateTime": f"{event.start.date().isoformat()}T00:00:00", "timeZone": "UTC"}
        end = {"dateTime": f"{event.end.date().isoformat()}T00:00:00", "timeZone": "UTC"}
    else:
        start = {"dateTime": event.start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": tz}
        end = {"dateTime": event.end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": tz}

    body: dict[str, Any] = {
        "subject": event.title,
        "body": {"contentType": "text", "content": event.description or ""},
        "start": start,
        "end": end,
        "isAllDay": event.all_day,
    }
    if event.location:
        body["location"] = {"displayName": event.location}
    if event.attendees:
        body["attendees"] = [
            {"emailAddress": {"address": a["email"], "name": a.get("name")}, "type": "required"}
            for a in event.attendees
            if a.get("email")
        ]
    return body


class MicrosoftConnector(BaseConnector):
    def __init__(
        self,
        access_token: str,
        refresh_token: Optional[str] = None,
        *,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        tenant_id: Optional[str] = None,
    ):
        self._access_token = access_token
        self._refresh_token = refresh_token
        self._client_id = client_id
        self._client_secret = client_secret
        self._tenant_id = tenant_id or DEFAULT_TENANT

    @property
    def access_token(self) -> str:
        return self._access_token

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        url = path if path.startswith("http") else f"{GRAPH_BASE}{path}"
        async with httpx.AsyncClient() as client:
            resp = await client.request(
                method, url, headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs
            )
            if resp.status_code == 401 and self._refresh_token:
                tokens = await refresh_access_token(
                    self._refresh_token,
                    client_id=self._client_id,
                    client_secret=self._client_secret,
                    tenant_id=self._tenant_id,
                )
                self._access_token = tokens["access_token"]
                resp = await client.request(
                    method, url, headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs
                )
            resp.raise_for_status()
            return resp

    async def list_calendars(self) -> list[RemoteCalendar]:
        resp = await self._request("GET", "/me/calendars?$top=100")
        items = resp.json().get("value", [])
        result = []
        for item in items:
            is_default = bool(item.get("isDefaultCalendar"))
            can_edit = bool(item.get("canEdit", True))
            result.append(
                RemoteCalendar(
                    provider_calendar_id=item["id"],
                    name=item.get("name", "Calendar"),
                    kind="primary" if is_default else "shared",
                    writable=can_edit,
                    color=item.get("hexColor"),
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
        params = {
            "startDateTime": window_start.isoformat(),
            "endDateTime": window_end.isoformat(),
            "$top": "250",
        }
        path = f"/me/calendars/{quote(calendar_id, safe='')}/calendarView"
        events: list[RemoteEvent] = []
        deleted_ids: list[str] = []
        next_link: Optional[str] = None

        url = path
        while True:
            resp = await self._request("GET", url, params=params if url == path else None)
            data = resp.json()
            for item in data.get("value", []):
                if item.get("isCancelled"):
                    if item.get("id"):
                        deleted_ids.append(item["id"])
                    continue
                events.append(_to_remote_event(item, writable=calendar_writable))
            next_link = data.get("@odata.nextLink")
            if not next_link:
                break
            url = next_link

        delta_token = data.get("@odata.deltaLink")
        return events, deleted_ids, delta_token

    async def create_event(self, calendar_id: str, event: RemoteEvent) -> RemoteEvent:
        resp = await self._request(
            "POST",
            f"/me/calendars/{quote(calendar_id, safe='')}/events",
            json=_from_remote_event(event),
        )
        return _to_remote_event(resp.json(), writable=True)

    async def update_event(self, calendar_id: str, provider_event_id: str, patch: dict[str, Any]) -> RemoteEvent:
        # Convert incoming patch (e.g. start/end) to Graph format if needed
        graph_patch: dict[str, Any] = {}
        if "start" in patch and isinstance(patch["start"], dict):
            graph_patch["start"] = {
                "dateTime": patch["start"].get("dateTime", patch["start"].get("date")),
                "timeZone": patch["start"].get("timeZone", "UTC"),
            }
        if "end" in patch and isinstance(patch["end"], dict):
            graph_patch["end"] = {
                "dateTime": patch["end"].get("dateTime", patch["end"].get("date")),
                "timeZone": patch["end"].get("timeZone", "UTC"),
            }
        for k in ("subject", "body", "location", "isAllDay"):
            if k in patch:
                graph_patch[k] = patch[k]
        if not graph_patch:
            graph_patch = patch

        resp = await self._request(
            "PATCH",
            f"/me/events/{quote(provider_event_id, safe='')}",
            json=graph_patch,
        )
        return _to_remote_event(resp.json(), writable=True)

    async def delete_event(self, calendar_id: str, provider_event_id: str) -> None:
        await self._request(
            "DELETE",
            f"/me/events/{quote(provider_event_id, safe='')}",
        )

    async def get_raw_event(self, calendar_id: str, provider_event_id: str) -> dict[str, Any]:
        resp = await self._request(
            "GET",
            f"/me/events/{quote(provider_event_id, safe='')}",
        )
        return resp.json()

    async def add_attendee(
        self, calendar_id: str, provider_event_id: str, email: str, name: Optional[str] = None
    ) -> list[dict]:
        event = await self.get_raw_event(calendar_id, provider_event_id)
        attendees = list(event.get("attendees", []))
        normalized = email.lower().strip()
        for a in attendees:
            if a.get("emailAddress", {}).get("address", "").lower() == normalized:
                return attendees
        attendees.append(
            {"emailAddress": {"address": email, "name": name or email}, "type": "required"}
        )
        resp = await self._request(
            "PATCH",
            f"/me/events/{quote(provider_event_id, safe='')}",
            json={"attendees": attendees},
        )
        return resp.json().get("attendees", [])

    async def remove_attendee(self, calendar_id: str, provider_event_id: str, email: str) -> list[dict]:
        event = await self.get_raw_event(calendar_id, provider_event_id)
        attendees = event.get("attendees", [])
        normalized = email.lower().strip()
        updated = [a for a in attendees if a.get("emailAddress", {}).get("address", "").lower() != normalized]
        resp = await self._request(
            "PATCH",
            f"/me/events/{quote(provider_event_id, safe='')}",
            json={"attendees": updated},
        )
        return resp.json().get("attendees", [])

    async def respond_to_event(self, calendar_id: str, provider_event_id: str, response_status: str) -> None:
        """Microsoft Graph uses dedicated RSVP actions: /accept, /decline, /tentativelyAccept."""
        action_map = {
            "accepted": "accept",
            "accept": "accept",
            "declined": "decline",
            "decline": "decline",
            "tentative": "tentativelyAccept",
            "tentativelyaccept": "tentativelyAccept",
        }
        action = action_map.get(response_status.lower(), "accept")
        await self._request(
            "POST",
            f"/me/events/{quote(provider_event_id, safe='')}/{action}",
            json={"sendUpdate": True},
        )

    async def register_webhook(self, calendar_id: str, callback_url: str) -> dict[str, Any]:
        raise NotImplementedError(
            "Webhook registration requires a public HTTPS callback URL. "
            "Falling back to periodic reconciliation until this deployment has one."
        )
