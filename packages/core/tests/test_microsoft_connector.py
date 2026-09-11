"""Tests for Microsoft Graph connector mappings and serialization (BR-CAL-002)."""

from datetime import datetime, timezone

from chronarch_core.connectors.base import RemoteEvent
from chronarch_core.connectors.microsoft import (
    _from_remote_event,
    _parse_graph_time,
    _to_remote_event,
    build_consent_url,
)


def test_build_consent_url():
    url = build_consent_url(
        redirect_uri="http://localhost:3000/callback",
        state="test-state-123",
        client_id="my-client-id",
        tenant_id="contoso.com",
    )
    assert "https://login.microsoftonline.com/contoso.com/oauth2/v2.0/authorize" in url
    assert "client_id=my-client-id" in url
    assert "state=test-state-123" in url
    assert "scope=Calendars.ReadWrite+User.Read+offline_access" in url or "scope=Calendars.ReadWrite" in url


def test_parse_graph_time_timed():
    dt = _parse_graph_time({"dateTime": "2026-09-15T14:30:00", "timeZone": "UTC"}, is_all_day=False)
    assert dt.hour == 14
    assert dt.minute == 30
    assert dt.tzinfo == timezone.utc


def test_parse_graph_time_all_day():
    dt = _parse_graph_time({"dateTime": "2026-09-15T00:00:00.0000000"}, is_all_day=True)
    assert dt.date().isoformat() == "2026-09-15"
    assert dt.tzinfo == timezone.utc


def test_to_remote_event_microsoft_mapping():
    graph_item = {
        "id": "ms-evt-999",
        "subject": "Executive Strategy Sync",
        "bodyPreview": "Discussion on Q4 roadmap",
        "isAllDay": False,
        "start": {"dateTime": "2026-09-15T10:00:00.0000000", "timeZone": "UTC"},
        "end": {"dateTime": "2026-09-15T11:00:00.0000000", "timeZone": "UTC"},
        "showAs": "busy",
        "organizer": {"emailAddress": {"name": "Alice Exec", "address": "alice@company.com"}},
        "attendees": [
            {
                "emailAddress": {"name": "Bob Assistant", "address": "bob@company.com"},
                "status": {"response": "accepted"},
            }
        ],
        "location": {"displayName": "Building 4, Room 201"},
        "onlineMeetingUrl": "https://teams.microsoft.com/l/meetup-join/123",
        "sensitivity": "normal",
        "isCancelled": False,
        "lastModifiedDateTime": "2026-09-10T08:00:00Z",
    }

    event = _to_remote_event(graph_item, writable=True)
    assert event.provider_event_id == "ms-evt-999"
    assert event.title == "Executive Strategy Sync"
    assert event.description == "Discussion on Q4 roadmap"
    assert event.all_day is False
    assert event.busy_status == "busy"
    assert event.organizer == {"email": "alice@company.com", "name": "Alice Exec"}
    assert event.attendees == [{"email": "bob@company.com", "name": "Bob Assistant", "response_status": "accepted"}]
    assert event.location == "Building 4, Room 201"
    assert event.conference == {"url": "https://teams.microsoft.com/l/meetup-join/123"}
    assert event.writable is True


def test_to_remote_event_cancelled_is_not_writable():
    graph_item = {
        "id": "ms-evt-cancelled",
        "subject": "Canceled call",
        "isAllDay": False,
        "start": {"dateTime": "2026-09-15T10:00:00"},
        "end": {"dateTime": "2026-09-15T10:30:00"},
        "isCancelled": True,
    }
    event = _to_remote_event(graph_item, writable=True)
    assert event.writable is False


def test_from_remote_event_timed():
    remote = RemoteEvent(
        provider_event_id="",
        title="1:1 Meeting",
        description="Weekly check-in",
        start=datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 15, 14, 45, tzinfo=timezone.utc),
        timezone="America/New_York",
        all_day=False,
        organizer=None,
        attendees=[{"email": "colleague@company.com", "name": "Colleague"}],
        location="Coffee Shop",
        conference=None,
        recurrence=None,
        visibility="standard",
        busy_status="busy",
        writable=True,
        provider_updated_at=None,
    )

    body = _from_remote_event(remote)
    assert body["subject"] == "1:1 Meeting"
    assert body["isAllDay"] is False
    assert body["start"]["dateTime"] == "2026-09-15T14:00:00"
    assert body["start"]["timeZone"] == "America/New_York"
    assert body["location"] == {"displayName": "Coffee Shop"}
    assert len(body["attendees"]) == 1
    assert body["attendees"][0]["emailAddress"]["address"] == "colleague@company.com"
