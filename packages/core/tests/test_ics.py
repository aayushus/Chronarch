import pytest
from datetime import datetime, timezone
from chronarch_core.ics import parse_ics_events, parse_ics_to_remote_events

SAMPLE_ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chronarch//Test Calendar//EN
BEGIN:VEVENT
UID:test-event-1@chronarch.local
DTSTAMP:20260911T120000Z
DTSTART:20260915T140000Z
DTEND:20260915T150000Z
SUMMARY:Board Meeting
DESCRIPTION:Quarterly executive board alignment
LOCATION:Conference Room A
ORGANIZER;CN=Executive:mailto:exec@chronarch.local
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Sarah EA:mailto:sarah@chronarch.local
END:VEVENT
BEGIN:VEVENT
UID:test-event-2@chronarch.local
DTSTAMP:20260911T120000Z
DTSTART;VALUE=DATE:20260916
SUMMARY:All Day Strategy Retreat
LOCATION:Offsite
END:VEVENT
END:VCALENDAR"""


def test_parse_ics_events():
    events = parse_ics_events(SAMPLE_ICS)
    assert len(events) == 2

    # Timed event
    ev1 = events[0]
    assert ev1["title"] == "Board Meeting"
    assert ev1["location"] == "Conference Room A"
    assert ev1["description"] == "Quarterly executive board alignment"
    assert ev1["all_day"] is False
    assert ev1["organizer"]["email"] == "exec@chronarch.local"
    assert len(ev1["attendees"]) == 1
    assert ev1["attendees"][0]["email"] == "sarah@chronarch.local"

    # All-day event
    ev2 = events[1]
    assert ev2["title"] == "All Day Strategy Retreat"
    assert ev2["all_day"] is True
    assert ev2["location"] == "Offsite"


def test_parse_ics_to_remote_events():
    remotes = parse_ics_to_remote_events(SAMPLE_ICS)
    assert len(remotes) == 2
    assert remotes[0].provider_event_id == "test-event-1@chronarch.local"
    assert remotes[0].writable is False
    assert remotes[1].all_day is True
