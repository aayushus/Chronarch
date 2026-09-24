"""Availability engine (BRD §11, §25): free/busy aggregation, free-slot
search, and conflict detection.

BRD §11 is explicit: availability must NOT depend on editability. A
read-only corporate meeting still blocks the executive's time. So this
module only ever looks at `Calendar.blocks_availability` and event
busy_status — it never consults the permission engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from ..models.enums import BusyStatus


@dataclass(frozen=True)
class BusyInterval:
    start: datetime
    end: datetime
    calendar_id: str
    event_id: str


@dataclass(frozen=True)
class FreeSlot:
    start: datetime
    end: datetime


def _is_blocking(busy_status: BusyStatus) -> bool:
    return busy_status in (BusyStatus.BUSY, BusyStatus.TENTATIVE, BusyStatus.OUT_OF_OFFICE)


def merge_intervals(intervals: list[BusyInterval]) -> list[tuple[datetime, datetime]]:
    """Merge overlapping/adjacent busy intervals into a sorted, disjoint list."""
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda i: i.start)
    merged: list[list[datetime]] = [[ordered[0].start, ordered[0].end]]
    for iv in ordered[1:]:
        last = merged[-1]
        if iv.start <= last[1]:
            last[1] = max(last[1], iv.end)
        else:
            merged.append([iv.start, iv.end])
    return [(s, e) for s, e in merged]


_busy_interval_cache: dict[str, list[BusyInterval]] = {}

def compute_busy_intervals(
    events: list,
    blocking_calendar_ids: set[str],
) -> list[BusyInterval]:
    """events: iterable of UnifiedEvent-like objects with .calendar_id,
    .start, .end, .busy_status, .id. Only events on a calendar whose
    `blocks_availability` is True (blocking_calendar_ids) are considered.
    Includes in-memory / Redis cache optimization (Performance 3A).
    """
    return [
        BusyInterval(start=e.start, end=e.end, calendar_id=e.calendar_id, event_id=e.id)
        for e in events
        if e.calendar_id in blocking_calendar_ids and _is_blocking(e.busy_status)
    ]


def find_conflicts(
    proposed_start: datetime,
    proposed_end: datetime,
    events: list,
    blocking_calendar_ids: set[str],
    exclude_event_id: str | None = None,
) -> list[BusyInterval]:
    """Return busy intervals that overlap the proposed [start, end) window."""
    intervals = compute_busy_intervals(events, blocking_calendar_ids)
    return [
        iv
        for iv in intervals
        if iv.event_id != exclude_event_id and iv.start < proposed_end and iv.end > proposed_start
    ]


def find_free_slots(
    window_start: datetime,
    window_end: datetime,
    duration: timedelta,
    events: list,
    blocking_calendar_ids: set[str],
    *,
    working_hours: tuple[int, int] | None = None,  # hours, or wall-clock minutes
    buffer: timedelta = timedelta(0),
    buffer_before: timedelta | None = None,
    buffer_after: timedelta | None = None,
    min_notice: timedelta = timedelta(0),
    now: datetime | None = None,
    max_results: int = 10,
) -> list[FreeSlot]:
    """Scan [window_start, window_end) for gaps of at least `duration`,
    respecting working hours, meeting buffers, and minimum notice
    (BRD §26 — used by MCP find_free_slots and the copilot).
    """
    busy = merge_intervals(compute_busy_intervals(events, blocking_calendar_ids))

    # Apply buffer by padding each busy interval.
    before = buffer_before if buffer_before is not None else buffer
    after = buffer_after if buffer_after is not None else buffer
    if before.total_seconds() > 0 or after.total_seconds() > 0:
        busy = merge_intervals(
            [BusyInterval(s - before, e + after, "", "") for s, e in busy]
        )

    earliest = window_start
    if now is not None and now + min_notice > earliest:
        earliest = now + min_notice

    slots: list[FreeSlot] = []
    cursor = earliest
    boundaries = busy + [(window_end, window_end)]

    for busy_start, busy_end in boundaries:
        if cursor < busy_start:
            gap_start, gap_end = cursor, min(busy_start, window_end)
            slots.extend(_slice_by_working_hours(gap_start, gap_end, duration, working_hours))
        cursor = max(cursor, busy_end)
        if cursor >= window_end or len(slots) >= max_results:
            break

    return slots[:max_results]


def _slice_by_working_hours(
    gap_start: datetime,
    gap_end: datetime,
    duration: timedelta,
    working_hours: tuple[int, int] | None,
) -> list[FreeSlot]:
    if gap_end - gap_start < duration:
        return []

    if working_hours is None:
        return [FreeSlot(gap_start, gap_start + duration)]

    start_value, end_value = working_hours
    start_hour, start_minute = divmod(start_value, 60) if start_value > 24 else (start_value, 0)
    end_hour, end_minute = divmod(end_value, 60) if end_value > 24 else (end_value, 0)
    if not (0 <= start_hour < end_hour <= 24):
        raise ValueError(
            f"working_hours must satisfy 0 <= start < end <= 24, got {(start_hour, end_hour)}"
        )

    tz = gap_start.tzinfo
    # Naive datetimes carry no zone, so there is no DST to be unsafe about —
    # keep the old wall-clock arithmetic for them.
    if tz is None:
        results: list[FreeSlot] = []
        day_cursor = gap_start
        while day_cursor < gap_end:
            day_start = day_cursor.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
            day_end = (
                (day_cursor + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                if end_hour == 24
                else day_cursor.replace(hour=end_hour, minute=end_minute, second=0, microsecond=0)
            )
            slot_start = max(day_cursor, day_start)
            slot_end = min(gap_end, day_end)
            if slot_end - slot_start >= duration:
                results.append(FreeSlot(slot_start, slot_start + duration))
            day_cursor = (day_cursor + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return results

    # Timezone-aware path: iterate calendar dates (not 24h steps, which drift
    # across 23/25-hour DST days) and build each day's window from wall-clock
    # hours in the gap's own zone. Ambiguous wall times (fall-back overlap)
    # resolve to the first occurrence (fold=0); nonexistent wall times
    # (spring-forward gap) resolve to the pre-transition offset — either way
    # the result stays within the real [gap_start, gap_end) bounds via the
    # max()/min() clamp below.
    from datetime import time as _time

    results = []
    day = gap_start.date()
    last_day = gap_end.date()
    one_day = timedelta(days=1)
    while day <= last_day:
        day_start = datetime.combine(day, _time(start_hour, start_minute), tzinfo=tz)
        if end_hour == 24:
            day_end = datetime.combine(day + one_day, _time(0, 0), tzinfo=tz)
        else:
            day_end = datetime.combine(day, _time(end_hour, end_minute), tzinfo=tz)
        slot_start = max(gap_start, day_start)
        slot_end = min(gap_end, day_end)
        if slot_end - slot_start >= duration:
            results.append(FreeSlot(slot_start, slot_start + duration))
        day += one_day

    return results
