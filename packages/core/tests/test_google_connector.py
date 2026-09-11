"""Tests for the pure Google <-> RemoteEvent mapping functions — no network
calls, since those need real Google OAuth credentials (chronarch_core.
connectors.google.get_client_id/secret read from env)."""

from datetime import datetime, timezone

from chronarch_core.connectors.base import RemoteEvent
from chronarch_core.connectors.google import _from_remote_event, _parse_event_time, _to_remote_event


def test_parse_event_time_all_day():
    dt, all_day = _parse_event_time({"date": "2026-09-15"})
    assert all_day is True
    assert dt.date().isoformat() == "2026-09-15"


def test_parse_event_time_timed():
    dt, all_day = _parse_event_time({"dateTime": "2026-09-15T14:00:00-04:00", "timeZone": "America/New_York"})
    assert all_day is False
    assert dt.hour == 14


def test_to_remote_event_basic_mapping():
    item = {
        "id": "abc123",
        "summary": "Board Meeting",
        "description": "Quarterly review",
        "start": {"dateTime": "2026-09-15T10:00:00-04:00", "timeZone": "America/New_York"},
        "end": {"dateTime": "2026-09-15T11:00:00-04:00", "timeZone": "America/New_York"},
        "organizer": {"email": "exec@co.com", "displayName": "Jane Exec"},
        "attendees": [{"email": "sarah@co.com", "displayName": "Sarah", "responseStatus": "accepted"}],
        "location": "Conf Room A",
        "status": "confirmed",
        "updated": "2026-09-10T12:00:00.000Z",
    }

    event = _to_remote_event(item, writable=True)

    assert event.provider_event_id == "abc123"
    assert event.title == "Board Meeting"
    assert event.all_day is False
    assert event.organizer == {"email": "exec@co.com", "name": "Jane Exec"}
    assert event.attendees == [{"email": "sarah@co.com", "name": "Sarah", "response_status": "accepted"}]
    assert event.busy_status == "busy"
    assert event.writable is True


def test_to_remote_event_transparent_is_free():
    item = {
        "id": "e1", "summary": "Focus block",
        "start": {"date": "2026-09-15"}, "end": {"date": "2026-09-16"},
        "transparency": "transparent",
    }
    event = _to_remote_event(item, writable=True)
    assert event.busy_status == "free"
    assert event.all_day is True


def test_to_remote_event_tentative_status():
    item = {
        "id": "e2", "summary": "Maybe",
        "start": {"dateTime": "2026-09-15T09:00:00Z"}, "end": {"dateTime": "2026-09-15T09:30:00Z"},
        "status": "tentative",
    }
    event = _to_remote_event(item, writable=True)
    assert event.busy_status == "tentative"


def test_to_remote_event_cancelled_is_not_writable():
    item = {
        "id": "e3", "summary": "Cancelled thing",
        "start": {"dateTime": "2026-09-15T09:00:00Z"}, "end": {"dateTime": "2026-09-15T09:30:00Z"},
        "status": "cancelled",
    }
    event = _to_remote_event(item, writable=True)
    assert event.writable is False


def test_from_remote_event_timed():
    event = RemoteEvent(
        provider_event_id="", title="Sync", description="desc",
        start=datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 15, 11, 0, tzinfo=timezone.utc),
        timezone="UTC", all_day=False, organizer=None,
        attendees=[{"email": "a@b.com"}], location="Room 1",
        conference=None, recurrence=None, visibility="standard",
        busy_status="busy", writable=True, provider_updated_at=None,
    )
    body = _from_remote_event(event)
    assert body["summary"] == "Sync"
    assert "dateTime" in body["start"]
    assert body["attendees"] == [{"email": "a@b.com"}]


def test_from_remote_event_all_day():
    event = RemoteEvent(
        provider_event_id="", title="Holiday", description=None,
        start=datetime(2026, 9, 15, tzinfo=timezone.utc),
        end=datetime(2026, 9, 16, tzinfo=timezone.utc),
        timezone="UTC", all_day=True, organizer=None, attendees=[],
        location=None, conference=None, recurrence=None, visibility="standard",
        busy_status="busy", writable=True, provider_updated_at=None,
    )
    body = _from_remote_event(event)
    assert body["start"] == {"date": "2026-09-15"}
    assert body["end"] == {"date": "2026-09-16"}
