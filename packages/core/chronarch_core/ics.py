"""ICS (iCalendar) parser and feed utilities (BRD §8, BR-ICS-001..005, BR-CAL-004).

Provides:
1. `parse_ics_events`: Extracts event dictionaries from raw .ics bytes/strings
   for UI preview (BR-ICS-002) and import (BR-ICS-003).
2. `parse_ics_to_remote_events`: Converts .ics content to `RemoteEvent` dataclasses
   for connector and subscription sync.
3. `fetch_ics_feed`: HTTP fetch helper for ICS subscriptions.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urljoin
import zoneinfo

import icalendar
import httpx

from .connectors.base import RemoteEvent


def _to_datetime(dt_or_date: Any, default_tz: str = "UTC") -> tuple[datetime, bool]:
    """Normalize icalendar dt (date or datetime) to timezone-aware datetime and all_day flag."""
    if isinstance(dt_or_date, datetime):
        if dt_or_date.tzinfo is None:
            try:
                tz = zoneinfo.ZoneInfo(default_tz)
                return dt_or_date.replace(tzinfo=tz).astimezone(timezone.utc), False
            except Exception:
                return dt_or_date.replace(tzinfo=timezone.utc), False
        return dt_or_date.astimezone(timezone.utc), False
    elif isinstance(dt_or_date, date):
        dt = datetime(dt_or_date.year, dt_or_date.month, dt_or_date.day, 0, 0, 0, tzinfo=timezone.utc)
        return dt, True
    raise ValueError(f"Unsupported date/time type: {type(dt_or_date)}")


def parse_ics_events(raw_content: bytes | str) -> list[dict[str, Any]]:
    """Parse raw iCalendar content into a list of preview-friendly event dicts."""
    if isinstance(raw_content, str):
        raw_content = raw_content.encode("utf-8")

    cal = icalendar.Calendar.from_ical(raw_content)
    events: list[dict[str, Any]] = []

    for component in cal.walk():
        if component.name != "VEVENT":
            continue

        dtstart = component.get("dtstart")
        if not dtstart:
            continue

        dtstart_val = dtstart.dt
        default_tz = "UTC"
        if hasattr(dtstart, "params") and "tzid" in dtstart.params:
            default_tz = str(dtstart.params["tzid"])

        start_dt, all_day = _to_datetime(dtstart_val, default_tz)

        dtend = component.get("dtend")
        if dtend:
            end_dt, _ = _to_datetime(dtend.dt, default_tz)
        else:
            duration = component.get("duration")
            if duration:
                end_dt = start_dt + duration.dt
            elif all_day:
                from datetime import timedelta
                end_dt = start_dt + timedelta(days=1)
            else:
                from datetime import timedelta
                end_dt = start_dt + timedelta(hours=1)

        summary = str(component.get("summary", "Untitled Event"))
        location = str(component.get("location")) if component.get("location") else None
        description = str(component.get("description")) if component.get("description") else None
        uid = str(component.get("uid", ""))

        organizer_prop = component.get("organizer")
        organizer = None
        if organizer_prop:
            org_str = str(organizer_prop)
            email = org_str.removeprefix("mailto:").removeprefix("MAILTO:")
            cn = organizer_prop.params.get("CN") if hasattr(organizer_prop, "params") else None
            organizer = {"email": email, "name": str(cn) if cn else None}

        attendees: list[dict[str, Any]] = []
        raw_attendees = component.get("attendee")
        if raw_attendees:
            if not isinstance(raw_attendees, list):
                raw_attendees = [raw_attendees]
            for att in raw_attendees:
                att_str = str(att)
                email = att_str.removeprefix("mailto:").removeprefix("MAILTO:")
                cn = att.params.get("CN") if hasattr(att, "params") else None
                partstat = att.params.get("PARTSTAT", "NEEDS-ACTION") if hasattr(att, "params") else "NEEDS-ACTION"
                attendees.append({
                    "email": email,
                    "name": str(cn) if cn else None,
                    "status": str(partstat).lower(),
                })

        rrule_prop = component.get("rrule")
        recurrence = rrule_prop.to_ical().decode("utf-8") if rrule_prop else None

        events.append({
            "uid": uid,
            "title": summary,
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "all_day": all_day,
            "timezone": default_tz,
            "location": location,
            "description": description,
            "organizer": organizer,
            "attendees": attendees,
            "recurrence": recurrence,
        })

    return events


import hashlib
import ipaddress
import socket
from urllib.parse import urlparse

MAX_ICS_FEED_BYTES = 5 * 1024 * 1024  # 5 MB safety limit


def parse_ics_to_remote_events(raw_content: bytes | str) -> list[RemoteEvent]:
    """Parse raw iCalendar content into RemoteEvent objects for syncing."""
    parsed = parse_ics_events(raw_content)
    remotes: list[RemoteEvent] = []
    for item in parsed:
        start_dt = datetime.fromisoformat(item["start"])
        end_dt = datetime.fromisoformat(item["end"])

        # If UID is missing or empty, generate a deterministic hash based on event identity
        uid = item.get("uid")
        if not uid or not uid.strip():
            identity_str = f"{item['start']}_{item['end']}_{item.get('title', '')}_{item.get('recurrence', '')}"
            digest = hashlib.sha256(identity_str.encode("utf-8")).hexdigest()[:16]
            uid = f"ics-{digest}"

        remotes.append(
            RemoteEvent(
                provider_event_id=uid,
                title=item["title"],
                description=item["description"],
                start=start_dt,
                end=end_dt,
                timezone=item["timezone"],
                all_day=item["all_day"],
                organizer=item["organizer"],
                attendees=item["attendees"],
                location=item["location"],
                conference=None,
                recurrence={"rule": item["recurrence"]} if item["recurrence"] else None,
                visibility="standard",
                busy_status="busy",
                writable=False,
                provider_updated_at=None,
            )
        )
    return remotes


def _validate_feed_url(url: str) -> None:
    """Validate URL scheme and ensure the target is not a private/loopback address (SSRF guard)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Invalid URL scheme '{parsed.scheme}'. Only http and https are allowed.")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Missing hostname in feed URL.")

    # Guard against localhost, metadata endpoints, and private IPs
    if hostname.lower() in ("localhost", "127.0.0.1", "::1", "metadata.google.internal"):
        raise ValueError("Connecting to local/internal network addresses is not allowed.")

    try:
        # Resolve address to check IP range
        addr_infos = socket.getaddrinfo(hostname, None)
        for _, _, _, _, sockaddr in addr_infos:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local:
                raise ValueError("Feed URL resolves to a private or reserved network address.")
    except socket.gaierror:
        # If DNS fails here, httpx will fail later with resolution error
        pass


async def fetch_ics_feed(url: str, timeout: float = 20.0) -> bytes:
    """Fetch an external ICS subscription feed over HTTP/HTTPS with SSRF and size safeguards (BR-CAL-004)."""
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    elif url.startswith("webcals://"):
        url = "https://" + url[len("webcals://"):]

    _validate_feed_url(url)

    headers = {
        "User-Agent": "Chronarch/1.0 (Calendar Subscription Sync; +https://github.com/aayushus/Chronarch)",
        "Accept": "text/calendar, text/plain, */*",
    }
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        current = url
        for hop in range(6):
            _validate_feed_url(current)
            async with client.stream("GET", current, headers=headers) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise ValueError("ICS feed redirect did not include a location")
                    current = urljoin(current, location)
                    continue
                resp.raise_for_status()
                content = bytearray()
                async for chunk in resp.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > MAX_ICS_FEED_BYTES:
                        raise ValueError(f"ICS feed exceeds size limit of {MAX_ICS_FEED_BYTES // (1024*1024)}MB")
                return bytes(content)
        raise ValueError("ICS feed exceeded the maximum redirect limit")
