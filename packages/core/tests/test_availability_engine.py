from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from chronarch_core.availability import find_conflicts, find_free_slots
from chronarch_core.models.enums import BusyStatus


def _event(id_, calendar_id, start, end, busy_status=BusyStatus.BUSY):
    return SimpleNamespace(id=id_, calendar_id=calendar_id, start=start, end=end, busy_status=busy_status)


def _dt(hour, minute=0, day=15):
    return datetime(2026, 9, day, hour, minute, tzinfo=timezone.utc)


def test_find_conflicts_detects_overlap_brd_section25():
    """Drag event to Thursday 2 PM, corporate meeting 2:30-3:00 conflicts."""
    events = [_event("corp-1", "cal-corp", _dt(14, 30), _dt(15, 0))]

    conflicts = find_conflicts(_dt(14, 0), _dt(15, 0), events, blocking_calendar_ids={"cal-corp"})

    assert len(conflicts) == 1
    assert conflicts[0].event_id == "corp-1"


def test_find_conflicts_ignores_non_blocking_calendar():
    events = [_event("e1", "cal-hidden", _dt(14, 0), _dt(15, 0))]

    conflicts = find_conflicts(_dt(14, 0), _dt(15, 0), events, blocking_calendar_ids={"cal-corp"})

    assert conflicts == []


def test_readonly_calendar_still_blocks_availability_brd_section11():
    """A read-only corporate meeting still blocks the executive's availability."""
    events = [_event("corp-1", "cal-corp", _dt(9, 0), _dt(17, 0))]

    slots = find_free_slots(
        window_start=_dt(9, 0),
        window_end=_dt(17, 0),
        duration=timedelta(minutes=45),
        events=events,
        blocking_calendar_ids={"cal-corp"},
    )

    assert slots == []


def test_find_free_slots_returns_gap_between_meetings():
    events = [
        _event("m1", "cal-corp", _dt(9, 0), _dt(11, 0)),
        _event("m2", "cal-corp", _dt(13, 0), _dt(17, 0)),
    ]

    slots = find_free_slots(
        window_start=_dt(9, 0),
        window_end=_dt(17, 0),
        duration=timedelta(minutes=45),
        events=events,
        blocking_calendar_ids={"cal-corp"},
    )

    assert len(slots) == 1
    assert slots[0].start == _dt(11, 0)
    assert slots[0].end == _dt(11, 45)


def test_tentative_and_out_of_office_block_but_free_status_does_not():
    events = [
        _event("free-1", "cal-1", _dt(9, 0), _dt(10, 0), busy_status=BusyStatus.FREE),
        _event("tent-1", "cal-1", _dt(10, 0), _dt(11, 0), busy_status=BusyStatus.TENTATIVE),
    ]

    conflicts_during_free = find_conflicts(_dt(9, 0), _dt(10, 0), events, blocking_calendar_ids={"cal-1"})
    conflicts_during_tentative = find_conflicts(_dt(10, 0), _dt(11, 0), events, blocking_calendar_ids={"cal-1"})

    assert conflicts_during_free == []
    assert len(conflicts_during_tentative) == 1
