"""CalDAV connector (BR-CAL-003).

Standard CalDAV (RFC 4791) over httpx with Basic auth — no extra
dependency beyond httpx + icalendar (both already in the stack).
Covers iCloud, Fastmail, Nextcloud, DAViCal, and other compliant servers.

Design notes:
- `provider_event_id` for CalDAV calendars is the event resource href
  (path, e.g. `/calendars/user/work/abc123.ics`), which is the only
  stable server-side identifier across servers with differing UID
  naming. Sync maps href <-> cached row; UID lives inside the ICS.
- Discovery uses PROPFIND for calendar collections; event listing uses
  REPORT calendar-query with a time-range filter, falling back to
  PROPFIND + per-resource GET when the server rejects REPORT.
- Writes use PUT (create/update) with If-None-Match / If-Match where
  supported, DELETE for removal. Attendee/RSVP edits are ICS PATCHes
  (GET, mutate VEVENT, PUT) — the CalDAV-native equivalent of the
  Google/Microsoft attendee endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

import httpx

from .base import BaseConnector, RemoteCalendar, RemoteEvent

DAV_NS = "DAV:"
CALDAV_NS = "urn:ietf:params:xml:ns:caldav"


def _dav(tag: str) -> str:
    return f"{{{DAV_NS}}}{tag}"


def _cal(tag: str) -> str:
    return f"{{{CALDAV_NS}}}{tag}"


def _join(base: str, href: str) -> str:
    """Resolve a possibly-relative href against the server base URL."""
    candidate = href if href.startswith(("http://", "https://")) else urljoin(base.rstrip("/") + "/", href.lstrip("/"))
    from urllib.parse import urlparse
    base_parts, candidate_parts = urlparse(base), urlparse(candidate)
    if (candidate_parts.scheme, candidate_parts.netloc) != (base_parts.scheme, base_parts.netloc):
        raise ValueError("CalDAV server returned a cross-origin resource URL")
    return candidate


def _href_path(url: str) -> str:
    """Stable provider_event_id: path portion of the resource URL."""
    from urllib.parse import urlparse

    return urlparse(url).path


def _parse_calendar_list(base_url: str, xml_text: str) -> list[tuple[str, str, bool]]:
    """Parse PROPFIND multistatus into (href, displayname, writable)."""
    out: list[tuple[str, str, bool]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for resp in root.findall(f"{_dav('response')}"):
        href_el = resp.find(_dav("href"))
        if href_el is None or not href_el.text:
            continue
        href = href_el.text.strip()
        propstat = resp.find(_dav("propstat"))
        if propstat is None:
            continue
        prop = propstat.find(_dav("prop"))
        if prop is None:
            continue
        resourcetype = prop.find(_dav("resourcetype"))
        is_calendar = False
        if resourcetype is not None:
            for child in resourcetype:
                if child.tag == _cal("calendar"):
                    is_calendar = True
                    break
        if not is_calendar:
            continue
        name_el = prop.find(_dav("displayname"))
        name = (name_el.text or "").strip() if name_el is not None else href.rstrip("/").split("/")[-1]
        privs = prop.find(_dav("current-user-privilege-set"))
        writable = True  # deny-by-write only when the server says read-only
        if privs is not None:
            priv_names = {p.find(_dav("privilege")) for p in privs.findall(_dav("privilege"))}
            names = set()
            for p in privs.findall(_dav("privilege")):
                for sub in p:
                    names.add(sub.tag)
            if _dav("write") not in names and _dav("write-content") not in names:
                # Some servers only advertise bind; treat absence of all
                # write-ish privs as read-only.
                writable = False
            _ = priv_names  # keep linters quiet about the unused first pass
        out.append((href, name or href, writable))
    return out


def _ics_to_remote(href_path: str, calendar_url: str, ics_text: str, writable: bool) -> RemoteEvent | None:
    """Parse a single VEVENT ICS resource into a RemoteEvent. Returns None
    for non-VEVENT content (VTODO/VJOURNAL) or unparseable bodies."""
    from ..ics import parse_ics_to_remote_events

    try:
        remotes = parse_ics_to_remote_events(ics_text)
    except Exception:
        return None
    if not remotes:
        return None
    # A resource should hold one VEVENT (recurrence instances expanded
    # upstream); take the first and re-key it by href.
    first = remotes[0]
    _ = calendar_url
    return RemoteEvent(
        provider_event_id=href_path,
        title=first.title,
        description=first.description,
        start=first.start,
        end=first.end,
        timezone=first.timezone,
        all_day=first.all_day,
        organizer=first.organizer,
        attendees=first.attendees,
        location=first.location,
        conference=None,
        recurrence=first.recurrence,
        visibility="standard",
        busy_status=first.busy_status,
        writable=writable and first.writable is not False,
        provider_updated_at=first.provider_updated_at,
    )


def _remote_to_ics(uid: str, event: RemoteEvent) -> str:
    """Serialize a RemoteEvent to a minimal VCALENDAR/VEVENT document."""
    import icalendar

    cal = icalendar.Calendar()
    cal.add("prodid", "-//Chronarch//CalDAV//EN")
    cal.add("version", "2.0")
    vevent = icalendar.Event()
    vevent.add("uid", uid)
    vevent.add("summary", event.title)
    if event.description:
        vevent.add("description", event.description)
    if event.location:
        vevent.add("location", event.location)
    if event.all_day:
        from datetime import date as _date

        vevent.add("dtstart", _date(event.start.year, event.start.month, event.start.day))
        vevent.add("dtend", _date(event.end.year, event.end.month, event.end.day))
    else:
        vevent.add("dtstart", event.start)
        vevent.add("dtend", event.end)
    for att in event.attendees or []:
        if isinstance(att, dict) and att.get("email"):
            vevent.add("attendee", f"mailto:{att['email']}")
    if isinstance(event.recurrence, dict):
        rules = event.recurrence.get("rule")
        items = rules if isinstance(rules, list) else ([rules] if rules else [])
        for rule in items:
            text = str(rule)
            if ":" in text:
                text = text.split(":", 1)[1]
            try:
                vevent.add("rrule", icalendar.vRecur.from_ical(text))
            except (ValueError, TypeError):
                continue
    cal.add_component(vevent)
    return cal.to_ical().decode("utf-8")


CALENDAR_LIST_BODY = """<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:resourcetype/>
    <D:displayname/>
    <D:current-user-privilege-set/>
  </D:prop>
</D:propfind>"""


def _calendar_query_body(window_start: datetime, window_end: datetime) -> str:
    fmt = "%Y%m%dT%H%M%SZ"
    return f"""<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="{window_start.astimezone(timezone.utc).strftime(fmt)}"
                      end="{window_end.astimezone(timezone.utc).strftime(fmt)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"""


class CalDAVConnector(BaseConnector):
    """One instance per CalDAV Account (server URL + Basic-auth credentials)."""

    def __init__(self, server_url: str, username: str, password: str):
        self.server_url = server_url.rstrip("/")
        self._auth = (username, password)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(auth=self._auth, follow_redirects=True, timeout=30.0)

    async def _propfind(self, url: str, body: str, depth: str = "1") -> httpx.Response:
        async with self._client() as client:
            resp = await client.request(
                "PROPFIND", url, content=body.encode("utf-8"),
                headers={"Depth": depth, "Content-Type": "application/xml"},
            )
            resp.raise_for_status()
            return resp

    async def list_calendars(self) -> list[RemoteCalendar]:
        resp = await self._propfind(self.server_url, CALENDAR_LIST_BODY, depth="1")
        found = _parse_calendar_list(self.server_url, resp.text)
        if not found:
            # Server URL may already point at a single calendar collection
            # (common for iCloud/Fastmail per-calendar URLs) — treat it as
            # one calendar rather than failing discovery.
            name = self.server_url.rstrip("/").split("/")[-1] or "CalDAV"
            return [RemoteCalendar(provider_calendar_id=self.server_url, name=name, kind="primary", writable=True)]
        return [
            RemoteCalendar(
                provider_calendar_id=_join(self.server_url, href),
                name=name, kind="primary", writable=writable,
            )
            for href, name, writable in found
        ]

    async def list_events(
        self,
        calendar_id: str,
        *,
        window_start: datetime,
        window_end: datetime,
        sync_token: Optional[str] = None,
        calendar_writable: bool = True,
    ) -> tuple[list[RemoteEvent], list[str], Optional[str]]:
        _ = sync_token  # CalDAV sync-collection tokens are server-specific;
        # Chronarch reconciles via windowed backfill + prune (same as ICS).
        events: list[RemoteEvent] = []
        async with self._client() as client:
            # Preferred: time-filtered REPORT.
            try:
                resp = await client.request(
                    "REPORT", calendar_id,
                    content=_calendar_query_body(window_start, window_end).encode("utf-8"),
                    headers={"Depth": "1", "Content-Type": "application/xml"},
                )
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
                hrefs: list[str] = []
                ics_by_href: dict[str, str] = {}
                for r in root.findall(f"{_dav('response')}"):
                    href_el = r.find(_dav("href"))
                    data_el = r.find(f"{_dav('propstat')}/{_dav('prop')}/{_cal('calendar-data')}")
                    if href_el is None or not href_el.text:
                        continue
                    href = href_el.text.strip()
                    if data_el is not None and data_el.text:
                        ics_by_href[href] = data_el.text
                    else:
                        hrefs.append(href)
                for href in hrefs:
                    full = _join(self.server_url, href)
                    got = await client.get(full)
                    if got.status_code == 404:
                        continue
                    got.raise_for_status()
                    ics_by_href[href] = got.text
                for href, ics_text in ics_by_href.items():
                    full = _join(self.server_url, href)
                    remote = _ics_to_remote(_href_path(full), calendar_id, ics_text, calendar_writable)
                    if remote is None:
                        continue
                    if remote.end <= window_start or remote.start >= window_end:
                        continue
                    events.append(remote)
                return events, [], None
            except httpx.HTTPStatusError:
                pass  # fall through to PROPFIND + GET enumeration

            # Fallback for servers without calendar-query support.
            prop_resp = await client.request(
                "PROPFIND", calendar_id,
                content=b"""<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/><D:resourcetype/></D:prop></D:propfind>""",
                headers={"Depth": "1", "Content-Type": "application/xml"},
            )
            prop_resp.raise_for_status()
            root = ET.fromstring(prop_resp.text)
            hrefs = [
                (r.find(_dav("href")).text or "").strip()
                for r in root.findall(f"{_dav('response')}")
                if r.find(_dav("href")) is not None and (r.find(_dav("href")).text or "").strip().endswith(".ics")
            ]
            for href in hrefs:
                full = _join(self.server_url, href)
                got = await client.get(full)
                if got.status_code == 404:
                    continue
                got.raise_for_status()
                remote = _ics_to_remote(_href_path(full), calendar_id, got.text, calendar_writable)
                if remote is None:
                    continue
                if remote.end <= window_start or remote.start >= window_end:
                    continue
                events.append(remote)
            return events, [], None

    async def create_event(self, calendar_id: str, event: RemoteEvent) -> RemoteEvent:
        uid = f"{uuid.uuid4()}@chronarch"
        ics_text = _remote_to_ics(uid, event)
        target = calendar_id.rstrip("/") + f"/{uid}.ics"
        async with self._client() as client:
            resp = await client.put(
                target, content=ics_text.encode("utf-8"),
                headers={"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"},
            )
            resp.raise_for_status()
        return RemoteEvent(
            provider_event_id=_href_path(target), title=event.title, description=event.description,
            start=event.start, end=event.end, timezone=event.timezone, all_day=event.all_day,
            organizer=event.organizer, attendees=event.attendees, location=event.location,
            conference=None, recurrence=event.recurrence, visibility="standard",
            busy_status=event.busy_status, writable=True, provider_updated_at=None,
        )

    async def update_event(self, calendar_id: str, provider_event_id: str, patch: dict[str, Any]) -> RemoteEvent:
        # provider_event_id is the href path; resolve to a full URL.
        target = _join(self.server_url, provider_event_id) if provider_event_id.startswith("/") else provider_event_id
        if "://" not in target:
            target = calendar_id.rstrip("/") + "/" + provider_event_id.lstrip("/")
        async with self._client() as client:
            got = await client.get(target)
            got.raise_for_status()
            import icalendar

            cal = icalendar.Calendar.from_ical(got.content)
            vevent = next((c for c in cal.walk() if c.name == "VEVENT"), None)
            if vevent is None:
                raise ValueError("CalDAV resource contains no VEVENT")
            start_patch = (patch.get("start") or {})
            end_patch = (patch.get("end") or {})
            if "date" in start_patch and "date" in end_patch:
                from datetime import date as _date

                vevent["dtstart"] = _date.fromisoformat(start_patch["date"])
                vevent["dtend"] = _date.fromisoformat(end_patch["date"])
            elif "dateTime" in start_patch and "dateTime" in end_patch:
                vevent["dtstart"] = datetime.fromisoformat(start_patch["dateTime"])
                vevent["dtend"] = datetime.fromisoformat(end_patch["dateTime"])
            else:
                # Generic field patch (title/description/location from
                # update_event in ai_tools) applied directly to the VEVENT.
                if patch.get("title") is not None:
                    vevent["summary"] = patch["title"]
                if patch.get("description") is not None:
                    vevent["description"] = patch["description"] or ""
                if patch.get("location") is not None:
                    vevent["location"] = patch["location"] or ""
            if isinstance(patch.get("attendees"), list):
                import icalendar as _ical

                if "attendee" in vevent:
                    del vevent["attendee"]
                for entry in patch["attendees"]:
                    if not isinstance(entry, dict) or not entry.get("email"):
                        continue
                    prop = _ical.vCalAddress(f"mailto:{entry['email']}")
                    if entry.get("name"):
                        prop.params["CN"] = entry["name"]
                    vevent.add("attendee", prop)
            if isinstance(patch.get("recurrence"), dict):
                import icalendar as _ical2

                rules = patch["recurrence"].get("rule")
                items = rules if isinstance(rules, list) else ([rules] if rules else [])
                if "rrule" in vevent:
                    del vevent["rrule"]
                for rule in items:
                    text = str(rule)
                    if ":" in text:
                        text = text.split(":", 1)[1]
                    try:
                        vevent.add("rrule", _ical2.vRecur.from_ical(text))
                    except (ValueError, TypeError):
                        continue
            put = await client.put(target, content=cal.to_ical(), headers={"Content-Type": "text/calendar; charset=utf-8"})
            put.raise_for_status()
            remote = _ics_to_remote(_href_path(target), calendar_id, cal.to_ical().decode("utf-8"), True)
            if remote is None:
                raise ValueError("Failed to re-parse updated CalDAV event")
            return remote

    async def delete_event(self, calendar_id: str, provider_event_id: str) -> None:
        _ = calendar_id
        target = _join(self.server_url, provider_event_id) if provider_event_id.startswith("/") else provider_event_id
        async with self._client() as client:
            resp = await client.delete(target)
            if resp.status_code not in (200, 202, 204, 404):
                resp.raise_for_status()

    async def _mutate_attendees(
        self, provider_event_id: str, email: str, name: Optional[str], add: bool
    ) -> list[dict]:
        target = _join(self.server_url, provider_event_id) if provider_event_id.startswith("/") else provider_event_id
        async with self._client() as client:
            got = await client.get(target)
            got.raise_for_status()
            import icalendar

            cal = icalendar.Calendar.from_ical(got.content)
            vevent = next((c for c in cal.walk() if c.name == "VEVENT"), None)
            if vevent is None:
                raise ValueError("CalDAV resource contains no VEVENT")
            existing = vevent.get("attendee")
            attendees: list[str] = []
            if existing is not None:
                items = existing if isinstance(existing, list) else [existing]
                attendees = [str(a) for a in items]
            normalized = email.lower().strip()
            if add:
                if not any(normalized in a.lower() for a in attendees):
                    prop = icalendar.vCalAddress(f"mailto:{email}")
                    if name:
                        prop.params["CN"] = name
                    vevent.add("attendee", prop)
            else:
                vevent.pop("attendee", None)
                for a in attendees:
                    if normalized not in a.lower():
                        vevent.add("attendee", a)
            put = await client.put(target, content=cal.to_ical(), headers={"Content-Type": "text/calendar; charset=utf-8"})
            put.raise_for_status()
            result: list[dict] = []
            for a in vevent.get("attendee", []) if isinstance(vevent.get("attendee"), list) else (
                [vevent.get("attendee")] if vevent.get("attendee") else []
            ):
                addr = str(a).removeprefix("mailto:").removeprefix("MAILTO:")
                result.append({"email": addr})
            return result

    async def add_attendee(self, calendar_id: str, provider_event_id: str, email: str, name: Optional[str] = None) -> list[dict]:
        _ = calendar_id
        return await self._mutate_attendees(provider_event_id, email, name, add=True)

    async def remove_attendee(self, calendar_id: str, provider_event_id: str, email: str) -> list[dict]:
        _ = calendar_id
        return await self._mutate_attendees(provider_event_id, email, None, add=False)

    async def respond_to_event(self, calendar_id: str, provider_event_id: str, response_status: str) -> None:
        _ = calendar_id
        mapping = {"accepted": "ACCEPTED", "accept": "ACCEPTED", "declined": "DECLINED",
                   "decline": "DECLINED", "tentative": "TENTATIVE"}
        partstat = mapping.get(response_status.lower(), "NEEDS-ACTION")
        target = _join(self.server_url, provider_event_id) if provider_event_id.startswith("/") else provider_event_id
        async with self._client() as client:
            got = await client.get(target)
            got.raise_for_status()
            import icalendar

            cal = icalendar.Calendar.from_ical(got.content)
            vevent = next((c for c in cal.walk() if c.name == "VEVENT"), None)
            if vevent is None:
                raise ValueError("CalDAV resource contains no VEVENT")
            vevent["partstat"] = partstat
            put = await client.put(target, content=cal.to_ical(), headers={"Content-Type": "text/calendar; charset=utf-8"})
            put.raise_for_status()

    async def register_webhook(
        self, calendar_id: str, callback_url: str, *, token: str | None = None
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "CalDAV push is server-specific (pubsub/sync-collection polling). "
            "Falling back to periodic reconciliation until a push transport is configured."
        )
