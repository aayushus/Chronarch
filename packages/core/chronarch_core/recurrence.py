"""Recurrence expansion (BRD §24-series correctness, BR-EVT-006).

Stored shapes differ per provider but mean the same thing:
- Google: {"rule": ["RRULE:FREQ=WEEKLY;...", "EXDATE;...:..."]}
- ICS/CalDAV: {"rule": "FREQ=WEEKLY;..."} (bare value, no RRULE: prefix)
- Microsoft: {"type": {Graph recurrence object with pattern + range}}

This module expands all three into concrete occurrences inside a window so
availability, conflicts, and free-slot search see recurring meetings — a
weekly standup blocks its future instances, not just its first row.
Date math rides on python-dateutil (already a core dependency).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

MAX_OCCURRENCES = 2000


def _as_utc(dt: datetime) -> datetime:
    """Stored instants are UTC; naive sides (sqlite reads) are assumed UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _rule_lines(recurrence) -> list[str]:
    """Pull RRULE/EXDATE/RDATE lines out of the Google/ICS shapes."""
    if not isinstance(recurrence, dict):
        return []
    raw = recurrence.get("rule")
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else [raw]
    lines = []
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        upper = text.upper()
        if upper.startswith(("RRULE:", "EXDATE", "RDATE")):
            lines.append(text)
        else:
            # Bare ICS value ("FREQ=WEEKLY;...") — qualify it.
            lines.append(f"RRULE:{text}")
    return lines


def _expand_rrule_lines(lines: list[str], dtstart: datetime,
                        window_start: datetime, window_end: datetime) -> list[datetime]:
    from dateutil.rrule import rrulestr

    try:
        rule = rrulestr("\n".join(lines), dtstart=dtstart, forceset=True)
    except (ValueError, TypeError):
        return []
    try:
        return list(rule.between(window_start, window_end, inc=True))[:MAX_OCCURRENCES]
    except (ValueError, TypeError, OverflowError):
        return []


def _microsoft_rrule(pattern: dict, range_: dict, dtstart: datetime):
    """Translate a Graph recurrence pattern+range into a dateutil rrule."""
    from dateutil.rrule import DAILY, MONTHLY, WEEKLY, YEARLY, FR, MO, SA, SU, TH, TU, WE, rrule

    if not isinstance(pattern, dict):
        return None
    days = {"sunday": SU, "monday": MO, "tuesday": TU, "wednesday": WE,
            "thursday": TH, "friday": FR, "saturday": SA}
    interval = pattern.get("interval") or 1
    try:
        interval = max(1, int(interval))
    except (ValueError, TypeError):
        interval = 1

    kind = str(pattern.get("type", "")).lower()
    kwargs: dict = {"dtstart": dtstart, "interval": interval}
    if kind == "daily":
        kwargs["freq"] = DAILY
    elif kind == "weekly":
        kwargs["freq"] = WEEKLY
        byday = [days[d.lower()] for d in (pattern.get("daysOfWeek") or [])
                 if isinstance(d, str) and d.lower() in days]
        if byday:
            kwargs["byweekday"] = byday
        first = str(pattern.get("firstDayOfWeek", "")).lower()
        if first in days:
            kwargs["wkst"] = days[first]
    elif kind in ("absolutemonthly", "relativemonthly"):
        kwargs["freq"] = MONTHLY
        if kind == "absolutemonthly":
            try:
                kwargs["bymonthday"] = int(pattern.get("dayOfMonth", dtstart.day))
            except (ValueError, TypeError):
                pass
        else:
            byday = [days[d.lower()] for d in (pattern.get("daysOfWeek") or [])
                     if isinstance(d, str) and d.lower() in days]
            index = str(pattern.get("index", "first")).lower()
            nth = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "last": -1}.get(index, 1)
            if byday:
                kwargs["byweekday"] = [d(nth) for d in byday]
    elif kind in ("absoluteyearly", "relativeyearly"):
        kwargs["freq"] = YEARLY
        try:
            kwargs["bymonth"] = int(pattern.get("month", dtstart.month))
        except (ValueError, TypeError):
            pass
        if kind == "absoluteyearly":
            try:
                kwargs["bymonthday"] = int(pattern.get("dayOfMonth", dtstart.day))
            except (ValueError, TypeError):
                pass
        else:
            byday = [days[d.lower()] for d in (pattern.get("daysOfWeek") or [])
                     if isinstance(d, str) and d.lower() in days]
            index = str(pattern.get("index", "first")).lower()
            nth = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "last": -1}.get(index, 1)
            if byday:
                kwargs["byweekday"] = [d(nth) for d in byday]
    else:
        return None

    if isinstance(range_, dict):
        rtype = str(range_.get("type", "")).lower()
        if rtype == "enddate" and range_.get("endDate"):
            try:
                end_day = datetime.fromisoformat(str(range_["endDate"])[:10])
                kwargs["until"] = end_day.replace(
                    hour=23, minute=59, second=59, tzinfo=timezone.utc)
            except ValueError:
                pass
        elif rtype == "numbered":
            try:
                kwargs["count"] = max(1, int(range_.get("numberOfOccurrences", 1)))
            except (ValueError, TypeError):
                pass
    try:
        return rrule(**kwargs)
    except (ValueError, TypeError):
        return None


def occurrences(event, window_start: datetime, window_end: datetime,
                limit: int = MAX_OCCURRENCES) -> list[tuple[datetime, datetime]]:
    """Concrete (start, end) instances of `event` overlapping the window.

    Non-recurring events return [] — callers keep the stored row. Malformed
    rules degrade to [] (the series is invisible to availability rather than
    crashing the search).
    """
    recurrence = getattr(event, "recurrence", None)
    if not recurrence:
        return []
    try:
        dtstart = _as_utc(event.start)
        duration = _as_utc(event.end) - dtstart
        ws, we = _as_utc(window_start), _as_utc(window_end)
    except (TypeError, ValueError):
        return []
    if duration.total_seconds() <= 0:
        return []

    starts: list[datetime] = []
    lines = _rule_lines(recurrence)
    if lines:
        starts = _expand_rrule_lines(lines, dtstart, ws, we)
    elif isinstance(recurrence, dict) and isinstance(recurrence.get("type"), dict):
        graph = recurrence["type"]
        rule = _microsoft_rrule(graph.get("pattern") or {}, graph.get("range") or {}, dtstart)
        if rule is not None:
            try:
                starts = list(rule.between(ws, we, inc=True))[:MAX_OCCURRENCES]
            except (ValueError, TypeError, OverflowError):
                starts = []
    out = []
    for s in starts[:limit]:
        s_utc = _as_utc(s)
        e_utc = s_utc + duration
        if e_utc > ws and s_utc < we:
            out.append((s_utc, e_utc))
    return out
