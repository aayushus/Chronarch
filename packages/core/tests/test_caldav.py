"""CalDAV connector + sync tests (BR-CAL-003).

Connector HTTP is mocked at the httpx level; sync is exercised against
the sqlite test session with a stubbed connector.
"""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from chronarch_core.connectors.caldav import (
    CalDAVConnector,
    _ics_to_remote,
    _parse_calendar_list,
    _remote_to_ics,
)
from chronarch_core.connectors.base import RemoteEvent
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ProviderType, UserRole
from chronarch_core.models.user import User


SAMPLE_ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:test-uid-1
DTSTAMP:20260912T000000Z
DTSTART:20260915T140000Z
DTEND:20260915T150000Z
SUMMARY:Team sync
DESCRIPTION:Weekly sync
LOCATION:Room 1
END:VEVENT
END:VCALENDAR"""


def test_parse_calendar_list_finds_calendars():
    xml_text = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/work/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Work</d:displayname>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/user/contacts/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>
      <d:displayname>Contacts</d:displayname>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>"""
    found = _parse_calendar_list("https://cal.example.com", xml_text)
    assert len(found) == 1
    assert found[0][0] == "/calendars/user/work/"
    assert found[0][1] == "Work"


def test_ics_to_remote_uses_href_as_id():
    remote = _ics_to_remote("/calendars/user/work/abc.ics", "https://x/cal", SAMPLE_ICS, True)
    assert remote is not None
    assert remote.provider_event_id == "/calendars/user/work/abc.ics"
    assert remote.title == "Team sync"
    assert remote.start == datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)


def test_remote_to_ics_roundtrip():
    event = RemoteEvent(
        provider_event_id="", title="Hello", description="d",
        start=datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 15, 15, 0, tzinfo=timezone.utc),
        timezone="UTC", all_day=False, organizer=None, attendees=[],
        location=None, conference=None, recurrence=None,
        visibility="standard", busy_status="busy", writable=True,
        provider_updated_at=None,
    )
    ics_text = _remote_to_ics("uid-123", event)
    assert "UID:uid-123" in ics_text.replace("\r\n", "\n").replace("\r", "\n") or "uid-123" in ics_text
    remote = _ics_to_remote("/x/uid-123.ics", "https://x", ics_text, True)
    assert remote is not None and remote.title == "Hello"


async def test_sync_caldav_account_backfills(monkeypatch, session):
    from chronarch_core.crypto import get_cipher
    import os

    os.environ.setdefault("TOKEN_ENCRYPTION_KEY", "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMw==")
    try:
        get_cipher.cache_clear()
    except Exception:
        pass

    from cryptography.fernet import Fernet

    if "TOKEN_ENCRYPTION_KEY" not in os.environ or not os.environ["TOKEN_ENCRYPTION_KEY"]:
        os.environ["TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
    else:
        try:
            get_cipher.cache_clear()
            get_cipher()
        except Exception:
            os.environ["TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
            get_cipher.cache_clear()

    from chronarch_core.sync import caldav_sync

    user = User(id="u-1", email="u@x.com", display_name="U", password_hash="x", role=UserRole.ADMIN)
    account = Account(
        id="acct-caldav", owner_user_id="u-1", provider=ProviderType.CALDAV,
        provider_account_email="user@fastmail.com", provider_account_id="caldav:user",
        caldav_server_url="https://cal.example.com", caldav_username="user",
    )
    account.encrypted_caldav_password = get_cipher().encrypt("secret")
    session.add_all([user, account])
    await session.flush()

    class FakeConnector:
        def __init__(self, *a, **k):
            pass

        async def list_calendars(self):
            from chronarch_core.connectors.base import RemoteCalendar

            return [RemoteCalendar(provider_calendar_id="https://cal.example.com/cal/work", name="Work", kind="primary", writable=True)]

        async def list_events(self, calendar_id, **kwargs):
            remote = _ics_to_remote("/cal/work/abc.ics", calendar_id, SAMPLE_ICS, True)
            assert remote is not None
            return [remote], [], None

    monkeypatch.setattr(caldav_sync, "CalDAVConnector", FakeConnector)
    stats = await caldav_sync.sync_caldav_account(session, account)
    assert stats["calendars_synced"] == 1
    assert stats["events_synced"] == 1
