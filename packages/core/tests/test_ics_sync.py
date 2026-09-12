from datetime import datetime, timezone
from unittest.mock import patch
import pytest

from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ProviderType
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.sync.ics_sync import sync_ics_subscription_calendar

SAMPLE_ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chronarch//Test//EN
BEGIN:VEVENT
UID:event-101@chronarch.test
DTSTART:20260915T090000Z
DTEND:20260915T100000Z
SUMMARY:Strategy Review
DESCRIPTION:Review quarterly goals and deliverables
LOCATION:Boardroom A
END:VEVENT
BEGIN:VEVENT
UID:event-102@chronarch.test
DTSTART:20260916T140000Z
DTEND:20260916T150000Z
SUMMARY:Engineering Sync
LOCATION:Virtual
END:VEVENT
END:VCALENDAR"""


async def test_sync_ics_subscription_calendar(session):
    account = Account(
        id="acc-ics-test",
        owner_user_id="user-1",
        provider=ProviderType.ICS,
        provider_account_email="feed@example.com",
        provider_account_id="feed@example.com",
    )
    calendar = Calendar(
        id="cal-ics-test",
        account_id=account.id,
        provider_calendar_id="feed-1",
        name="Team Holidays & Events",
        ics_subscription_url="https://example.com/calendar.ics",
        provider_writable=False,
    )
    session.add_all([account, calendar])
    await session.flush()

    with patch("chronarch_core.sync.ics_sync.fetch_ics_feed", return_value=SAMPLE_ICS):
        result = await sync_ics_subscription_calendar(session, calendar)

    assert result["calendar_id"] == calendar.id
    assert result["upserted"] == 2
    assert result["pruned"] == 0

    from sqlalchemy import select

    events = list((await session.execute(select(UnifiedEvent).where(UnifiedEvent.calendar_id == calendar.id))).scalars())
    assert len(events) == 2
    titles = {e.title for e in events}
    assert "Strategy Review" in titles
    assert "Engineering Sync" in titles

    strategy_ev = next(e for e in events if e.title == "Strategy Review")
    assert strategy_ev.provider_event_id == "event-101@chronarch.test"
    assert strategy_ev.source_permissions == {"write": False}
    assert strategy_ev.description == "Review quarterly goals and deliverables"
    assert strategy_ev.location == "Boardroom A"
