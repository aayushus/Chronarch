"""Recurrence expansion tests (BR-EVT-006): weekly standups block their
future instances, malformed rules degrade to invisible, and each provider
shape (Google list, ICS bare string, Graph object) expands."""

from datetime import datetime, timedelta, timezone

from chronarch_core import recurrence as _r


class _Ev:
    def __init__(self, start, end, recurrence=None):
        self.start = start
        self.end = end
        self.recurrence = recurrence


def _monday() -> datetime:
    # 2026-09-14 is a Monday.
    return datetime(2026, 9, 14, 14, 0, tzinfo=timezone.utc)


def _window(days=21):
    start = datetime(2026, 9, 14, 0, 0, tzinfo=timezone.utc)
    return start, start + timedelta(days=days)


def test_google_weekly_expands():
    ev = _Ev(_monday(), _monday() + timedelta(minutes=30),
             {"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]})
    ws, we = _window()
    occs = _r.occurrences(ev, ws, we)
    assert len(occs) == 3
    assert occs[0][0] == _monday()
    assert all((e - s) == timedelta(minutes=30) for s, e in occs)


def test_ics_bare_string_expands():
    ev = _Ev(_monday(), _monday() + timedelta(minutes=30),
             {"rule": "FREQ=DAILY;COUNT=3"})
    ws, we = _window(days=7)
    occs = _r.occurrences(ev, ws, we)
    assert [s.day for s, _ in occs] == [14, 15, 16]


def test_exdate_excluded():
    ev = _Ev(_monday(), _monday() + timedelta(minutes=30), {"rule": [
        "RRULE:FREQ=DAILY;COUNT=3",
        "EXDATE:20260915T140000Z",
    ]})
    ws, we = _window(days=7)
    occs = _r.occurrences(ev, ws, we)
    assert [s.day for s, _ in occs] == [14, 16]


def test_microsoft_weekly_and_monthly():
    weekly = _Ev(_monday(), _monday() + timedelta(minutes=30), {"type": {
        "pattern": {"type": "weekly", "interval": 1, "daysOfWeek": ["monday"]},
        "range": {"type": "noEnd"}}})
    ws, we = _window()
    assert len(_r.occurrences(weekly, ws, we)) == 3

    monthly = _Ev(_monday(), _monday() + timedelta(minutes=30), {"type": {
        "pattern": {"type": "absoluteMonthly", "interval": 1, "dayOfMonth": 14},
        "range": {"type": "noEnd"}}})
    ws2, we2 = _window(days=60)
    occs = _r.occurrences(monthly, ws2, we2)
    assert [(s.month, s.day) for s, _ in occs] == [(9, 14), (10, 14)]

    numbered = _Ev(_monday(), _monday() + timedelta(minutes=30), {"type": {
        "pattern": {"type": "daily", "interval": 1},
        "range": {"type": "numbered", "numberOfOccurrences": 2}}})
    ws3, we3 = _window(days=30)
    assert len(_r.occurrences(numbered, ws3, we3)) == 2


def test_malformed_and_plain_events():
    ws, we = _window()
    assert _r.occurrences(_Ev(_monday(), _monday() + timedelta(hours=1)), ws, we) == []
    assert _r.occurrences(_Ev(_monday(), _monday() + timedelta(hours=1),
                              {"rule": ["GARBAGE"]}), ws, we) == []
    assert _r.occurrences(_Ev(_monday(), _monday() + timedelta(hours=1),
                              {"type": {"pattern": {"type": "nonsense"}}}), ws, we) == []


async def test_conflicts_see_future_instances(session):
    from chronarch_core import ai_tools
    from chronarch_core.models.account import Account
    from chronarch_core.models.calendar import Calendar
    from chronarch_core.models.enums import (
        ActorType, CalendarKind, ProviderType, UserRole,
    )
    from chronarch_core.models.event import UnifiedEvent
    from chronarch_core.models.user import User
    from chronarch_core.permissions import AuthContext

    user = User(id="u-recur", email="recur@x.com", display_name="R",
                password_hash="x", role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=ProviderType.GOOGLE,
                      provider_account_email=user.email, provider_account_id=user.email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:r",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=False, blocks_availability=True)
    session.add(calendar)
    await session.flush()
    # Series anchored Sep 14; the probe window is a week later — the stored
    # row doesn't overlap it, only its expansion does.
    session.add(UnifiedEvent(
        provider_account_id=account.id, calendar_id=calendar.id,
        provider_event_id="series-1", title="Standup",
        start=_monday(), end=_monday() + timedelta(minutes=30),
        recurrence={"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]}))
    await session.flush()

    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    hits = await ai_tools.get_conflicts(
        session, ctx,
        window_start=datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc),
        window_end=datetime(2026, 9, 21, 14, 30, tzinfo=timezone.utc),
        owner_calendar_ids={calendar.id})
    assert len(hits) == 1 and hits[0]["title"] == "Standup"

    slots = await ai_tools.find_free_slots(
        session, ctx,
        window_start=datetime(2026, 9, 21, 13, 0, tzinfo=timezone.utc),
        window_end=datetime(2026, 9, 21, 18, 0, tzinfo=timezone.utc),
        duration=timedelta(hours=1),
        owner_calendar_ids={calendar.id})
    # 13:00–14:00 and 14:30–18:00 are the only hour-long gaps.
    assert [(s["start"].hour, s["end"].hour) for s in slots] == [(13, 14), (14, 15)]
