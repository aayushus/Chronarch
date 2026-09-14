"""Timezone helpers (BRD §27).

The browser/client owns the timezone: the web UI sends its IANA zone on
every request (`X-Timezone` header, plus an explicit `user_timezone` on
copilot calls), and MCP callers pass theirs per-call. These helpers
validate and normalize those values so a garbage zone never reaches the
database or a provider payload — unknown zones fall back to UTC.
"""

from __future__ import annotations

import zoneinfo
from datetime import datetime

DEFAULT_TIMEZONE = "UTC"


def normalize_timezone(name: str | None) -> str:
    """Return a canonical IANA zone name, or DEFAULT_TIMEZONE when missing."""
    if not name or not str(name).strip():
        return DEFAULT_TIMEZONE
    cleaned = str(name).strip()
    try:
        return zoneinfo.ZoneInfo(cleaned).key
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return DEFAULT_TIMEZONE


def validate_timezone(name: str) -> str:
    """Like normalize, but raises ValueError for unknown zones (for 422s)."""
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("timezone must not be blank")
    try:
        return zoneinfo.ZoneInfo(cleaned).key
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"unknown timezone '{name}'")


def ensure_aware(dt: datetime, tz_name: str | None) -> datetime:
    """Attach a zone to a naive datetime; aware datetimes pass through.

    Naive inputs are interpreted as wall time in `tz_name` (the caller's
    zone, or their stored home zone) — never the server's local zone.
    """
    if dt.tzinfo is not None:
        return dt
    zone = normalize_timezone(tz_name)
    return dt.replace(tzinfo=zoneinfo.ZoneInfo(zone))
