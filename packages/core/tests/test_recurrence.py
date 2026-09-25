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


def test_normalize_recurrence_input():
    assert _r.normalize_recurrence_input({"freq": "Weekly"}) == {
        "freq": "weekly", "interval": 1}
    assert _r.normalize_recurrence_input(
        {"freq": "monthly", "interval": 2, "count": 6}) == {
        "freq": "monthly", "interval": 2, "count": 6}
    assert _r.normalize_recurrence_input(
        {"freq": "daily", "until": "2026-12-31"})["until"].startswith("2026-12-31")
    assert _r.normalize_recurrence_input(
        {"freq": "weekly", "byday": ["we", "MO"]})["byday"] == ["MO", "WE"]
    import pytest as _pytest
    for bad in ({"freq": "minutely"}, {"freq": "weekly", "interval": 0},
                {"freq": "daily", "count": 0}, {"freq": "daily", "until": "soon"},
                {"freq": "weekly", "byday": ["XX"]}, "weekly", {}):
        with _pytest.raises(ValueError):
            _r.normalize_recurrence_input(bad)


def test_to_rrule_and_graph_shapes():
    norm = {"freq": "weekly", "interval": 2, "byday": ["MO", "WE"], "count": 4}
    assert _r.to_rrule_text(norm) == "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4"
    graph = _r.to_graph_recurrence(norm)
    assert graph["pattern"]["type"] == "weekly"
    assert graph["pattern"]["daysOfWeek"] == ["monday", "wednesday"]
    assert graph["range"] == {"type": "numbered", "numberOfOccurrences": 4}
    assert _r.to_rrule_text({"freq": "daily", "interval": 1}).startswith("RRULE:FREQ=DAILY")


async def test_google_create_carries_rrule(monkeypatch):
    from chronarch_core.connectors.google import GoogleConnector

    seen = {}

    class _Resp:
        def json(self):
            return {"id": "e9", "summary": "Standup",
                    "start": {"dateTime": "2026-09-21T14:00:00+00:00"},
                    "end": {"dateTime": "2026-09-21T14:30:00+00:00"},
                    "recurrence": seen["json"]["recurrence"]}

    async def _fake_request(self, method, url, json=None):
        seen["json"] = json
        return _Resp()

    monkeypatch.setattr(GoogleConnector, "_request", _fake_request)
    from chronarch_core.connectors.base import RemoteEvent

    remote = RemoteEvent(
        provider_event_id="", title="Standup", description=None,
        start=datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 21, 14, 30, tzinfo=timezone.utc),
        timezone="UTC", all_day=False, organizer=None, attendees=[],
        location=None, conference=None,
        recurrence={"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]},
        visibility="standard", busy_status="busy", writable=True,
        provider_updated_at=None)
    created = await GoogleConnector("token").create_event("cal", remote)
    assert seen["json"]["recurrence"] == ["RRULE:FREQ=WEEKLY;BYDAY=MO"]
    assert created.recurrence == {"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]}


async def test_microsoft_create_carries_graph_recurrence(monkeypatch):
    from chronarch_core.connectors.microsoft import MicrosoftConnector

    seen = {}

    class _Resp:
        def json(self):
            return {"id": "e9", "subject": "Standup",
                    "start": {"dateTime": "2026-09-21T14:00:00", "timeZone": "UTC"},
                    "end": {"dateTime": "2026-09-21T14:30:00", "timeZone": "UTC"},
                    "recurrence": seen["json"].get("recurrence")}

    async def _fake_request(self, method, url, json=None):
        seen["json"] = json
        return _Resp()

    monkeypatch.setattr(MicrosoftConnector, "_request", _fake_request)
    from chronarch_core.connectors.base import RemoteEvent

    graph = {"pattern": {"type": "weekly", "interval": 1}, "range": {"type": "noEnd"}}
    remote = RemoteEvent(
        provider_event_id="", title="Standup", description=None,
        start=datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 21, 14, 30, tzinfo=timezone.utc),
        timezone="UTC", all_day=False, organizer=None, attendees=[],
        location=None, conference=None, recurrence={"type": graph},
        visibility="standard", busy_status="busy", writable=True,
        provider_updated_at=None)
    await MicrosoftConnector("token").create_event("cal", remote)
    assert seen["json"]["recurrence"] == graph


async def test_caldav_create_emits_rrule(monkeypatch):
    from chronarch_core.connectors.base import RemoteEvent
    from chronarch_core.connectors.caldav import CalDAVConnector, _remote_to_ics

    remote = RemoteEvent(
        provider_event_id="", title="Standup", description=None,
        start=datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 21, 14, 30, tzinfo=timezone.utc),
        timezone="UTC", all_day=False, organizer=None, attendees=[],
        location=None, conference=None,
        recurrence={"rule": ["RRULE:FREQ=DAILY;COUNT=5"]},
        visibility="standard", busy_status="busy", writable=True,
        provider_updated_at=None)
    text = _remote_to_ics("uid-1", remote)
    assert "RRULE" in text and "FREQ=DAILY" in text
    put_body = {}

    class _Put:
        def raise_for_status(self):
            pass

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def put(self, url, content=None, headers=None):
            put_body["content"] = content
            return _Put()

    monkeypatch.setattr(CalDAVConnector, "_client", lambda self: _FakeClient())
    connector = CalDAVConnector(server_url="https://dav.x.com", username="u", password="p")
    created = await connector.create_event("https://dav.x.com/cal/", remote)
    assert "RRULE:FREQ=DAILY;COUNT=5" in put_body["content"].decode()
    assert created.recurrence == {"rule": ["RRULE:FREQ=DAILY;COUNT=5"]}


async def test_ai_create_stores_recurrence_locally(session):
    from chronarch_core import ai_tools
    from chronarch_core.models.account import Account
    from chronarch_core.models.calendar import Calendar
    from chronarch_core.models.enums import (
        ActorType, CalendarKind, ProviderType, UserRole,
    )
    from chronarch_core.models.user import User
    from chronarch_core.permissions import AuthContext

    user = User(id="u-rl", email="rl@x.com", display_name="R",
                password_hash="x", role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=ProviderType.GOOGLE,
                      provider_account_email=user.email, provider_account_id=user.email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:rl",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=True, blocks_availability=True)
    session.add(calendar)
    await session.flush()

    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    event = await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title="Standup",
        start=datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 21, 14, 30, tzinfo=timezone.utc),
        recurrence={"freq": "weekly"}, is_owner=True)
    assert event.recurrence == {"rule": ["RRULE:FREQ=WEEKLY"]}
    # The stored series blocks its future instances.
    hits = await ai_tools.get_conflicts(
        session, ctx,
        window_start=datetime(2026, 9, 28, 14, 0, tzinfo=timezone.utc),
        window_end=datetime(2026, 9, 28, 14, 30, tzinfo=timezone.utc),
        owner_calendar_ids={calendar.id})
    assert len(hits) == 1 and hits[0]["title"] == "Standup"


def test_split_series_text_and_graph():
    cut = datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc)
    trunc, restart = _r.split_series({"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]}, cut)
    assert trunc == {"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260920"]}
    assert restart == {"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]}
    trunc, restart = _r.split_series(
        {"rule": ["RRULE:FREQ=DAILY;COUNT=10"]}, cut)
    assert trunc == {"rule": ["RRULE:FREQ=DAILY;UNTIL=20260920"]}
    assert restart == {"rule": ["RRULE:FREQ=DAILY;COUNT=10"]}
    graph = {"pattern": {"type": "weekly", "interval": 1},
             "range": {"type": "numbered", "numberOfOccurrences": 10}}
    trunc, restart = _r.split_series({"type": graph}, cut)
    assert trunc == {"type": {"pattern": graph["pattern"],
                              "range": {"type": "endDate", "endDate": "2026-09-20"}}}
    assert restart == {"type": {"pattern": graph["pattern"], "range": {"type": "numbered", "numberOfOccurrences": 10}}}
    assert _r.split_series({"rule": ["GARBAGE"]}, cut) == (None, None)
    assert _r.split_series(None, cut) == (None, None)


def test_exceptions_deleted_and_moved():
    base = _Ev(_monday(), _monday() + timedelta(minutes=30),
               {"rule": ["RRULE:FREQ=DAILY;COUNT=5"]})
    ws, we = _window(days=7)
    assert len(_r.occurrences(base, ws, we)) == 5
    key = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc).isoformat()
    exc = _Ev(_monday(), _monday() + timedelta(minutes=30), {
        "rule": ["RRULE:FREQ=DAILY;COUNT=5"],
        "exceptions": {
            key: {"deleted": True},
            datetime(2026, 9, 16, 14, 0, tzinfo=timezone.utc).isoformat(): {
                "start": "2026-09-16T16:00:00+00:00",
                "end": "2026-09-16T16:30:00+00:00"},
        }})
    occs = _r.occurrences(exc, ws, we)
    days = sorted(s.day for s, _ in occs)
    assert days == [14, 16, 17, 18]
    moved = [s for s, _ in occs if s.day == 16][0]
    assert (moved.hour, moved.minute) == (16, 0)


class _FakeConnector:
    provider = "google"

    def __init__(self):
        self.calls = []

    async def create_event(self, calendar_id, remote):
        from types import SimpleNamespace

        self.calls.append(("create_event", calendar_id))
        return SimpleNamespace(provider_event_id="new-1", recurrence=None)

    async def delete_instance(self, calendar_id, series_id, instance_start):
        self.calls.append(("delete_instance", series_id, instance_start.isoformat()))

    async def update_instance(self, calendar_id, series_id, instance_start, patch):
        self.calls.append(("update_instance", series_id, instance_start.isoformat(), sorted(patch)))
        return None

    async def update_event(self, calendar_id, provider_event_id, patch):
        self.calls.append(("update_event", provider_event_id, sorted(patch)))
        return None


async def _series_owner(session, provider="google"):
    from chronarch_core.ai_tools import tools as ai_tools
    from chronarch_core.models.account import Account
    from chronarch_core.models.calendar import Calendar
    from chronarch_core.models.enums import (
        ActorType, CalendarKind, ProviderType, UserRole,
    )
    from chronarch_core.models.event import UnifiedEvent
    from chronarch_core.models.user import User
    from chronarch_core.permissions import AuthContext

    user = User(id=f"u-sc-{provider}", email=f"sc-{provider}@x.com", display_name="S",
                password_hash="x", role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=ProviderType(provider),
                      provider_account_email=user.email, provider_account_id=user.email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:sc",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=True, blocks_availability=True)
    session.add(calendar)
    await session.flush()
    event = UnifiedEvent(
        provider_account_id=account.id, calendar_id=calendar.id,
        provider_event_id="series-9", title="Standup",
        start=_monday(), end=_monday() + timedelta(minutes=30),
        recurrence={"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]})
    session.add(event)
    await session.flush()
    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    return ai_tools, user, calendar, event, ctx


async def test_delete_this_records_exception_row_survives(session, monkeypatch):
    from chronarch_core import ai_tools
    from sqlalchemy import select
    from chronarch_core.models.event import UnifiedEvent

    ai_tools, user, calendar, event, ctx = await _series_owner(session)
    fake = _FakeConnector()

    async def _conn(session, calendar):
        return fake, await _account_for(session, calendar)

    monkeypatch.setattr(ai_tools, "_get_connector_for_calendar", _conn)
    out = await ai_tools.delete_event(
        session, ctx, event_id=event.id, scope="this",
        instance_start=_monday() + timedelta(days=7), is_owner=True)
    assert out["scope"] == "this"
    assert fake.calls[0][0] == "delete_instance"
    # Row survives with the exception recorded.
    row = (await session.execute(
        select(UnifiedEvent).where(UnifiedEvent.id == event.id))).scalar_one()
    assert row.recurrence["exceptions"] == {
        (_monday() + timedelta(days=7)).isoformat(): {"deleted": True}}
    # ...and expansion hides exactly that instance.
    from chronarch_core.recurrence import occurrences

    ws, we = _window()
    assert len(occurrences(row, ws, we)) == 2


async def _account_for(session, calendar):
    from chronarch_core.models.account import Account

    return await session.get(Account, calendar.account_id)


async def test_delete_future_truncates_and_keeps_row(session, monkeypatch):
    from chronarch_core import ai_tools
    from sqlalchemy import select
    from chronarch_core.models.event import UnifiedEvent

    ai_tools, user, calendar, event, ctx = await _series_owner(session)
    fake = _FakeConnector()

    async def _conn(session, calendar):
        return fake, await _account_for(session, calendar)

    monkeypatch.setattr(ai_tools, "_get_connector_for_calendar", _conn)
    out = await ai_tools.delete_event(
        session, ctx, event_id=event.id, scope="future",
        instance_start=_monday() + timedelta(days=7), is_owner=True)
    assert out["scope"] == "future"
    assert fake.calls[0] == ("update_event", "series-9", ["recurrence"])
    row = (await session.execute(
        select(UnifiedEvent).where(UnifiedEvent.id == event.id))).scalar_one()
    assert row.recurrence == {"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260920"]}


async def test_update_this_moves_instance_records_exception(session, monkeypatch):
    from chronarch_core import ai_tools
    from sqlalchemy import select
    from chronarch_core.models.event import UnifiedEvent

    ai_tools, user, calendar, event, ctx = await _series_owner(session)
    fake = _FakeConnector()

    async def _conn(session, calendar):
        return fake, await _account_for(session, calendar)

    monkeypatch.setattr(ai_tools, "_get_connector_for_calendar", _conn)
    new_start = _monday() + timedelta(days=7, hours=1)
    updated = await ai_tools.update_event(
        session, ctx, event_id=event.id, scope="this",
        instance_start=_monday() + timedelta(days=7),
        start=new_start, end=new_start + timedelta(minutes=30),
        is_owner=True)
    assert updated.id == event.id  # same row
    row = (await session.execute(
        select(UnifiedEvent).where(UnifiedEvent.id == event.id))).scalar_one()
    assert row.recurrence["exceptions"] == {
        (_monday() + timedelta(days=7)).isoformat(): {
            "start": new_start.isoformat(), "end": (new_start + timedelta(minutes=30)).isoformat()}}


async def test_update_future_splits_into_two_series(session, monkeypatch):
    from chronarch_core import ai_tools
    from sqlalchemy import select
    from chronarch_core.models.event import UnifiedEvent

    ai_tools, user, calendar, event, ctx = await _series_owner(session)
    fake = _FakeConnector()

    async def _conn(session, calendar):
        return fake, await _account_for(session, calendar)

    monkeypatch.setattr(ai_tools, "_get_connector_for_calendar", _conn)
    cut = _monday() + timedelta(days=14)
    continued = await ai_tools.update_event(
        session, ctx, event_id=event.id, scope="future", instance_start=cut,
        title="Standup v2", is_owner=True)
    assert continued.id != event.id
    assert continued.title == "Standup v2"
    assert continued.start.replace(tzinfo=None) == cut.replace(tzinfo=None)
    assert continued.recurrence == {"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]}
    rows = {e.id: e for e in (await session.execute(select(UnifiedEvent))).scalars()}
    assert rows[event.id].recurrence == {"rule": ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260927"]}
    assert fake.calls[0] == ("update_event", "series-9", ["recurrence"])


async def test_scoped_caldav_rejected(session, monkeypatch):
    from chronarch_core import ai_tools

    ai_tools, user, calendar, event, ctx = await _series_owner(session, provider="caldav")
    fake = _FakeConnector()

    async def _conn(session, calendar):
        return fake, await _account_for(session, calendar)

    monkeypatch.setattr(ai_tools, "_get_connector_for_calendar", _conn)
    import pytest as _pytest
    with _pytest.raises(ValueError, match="whole-series"):
        await ai_tools.delete_event(session, ctx, event_id=event.id, scope="this",
                                    instance_start=_monday(), is_owner=True)
    with _pytest.raises(ValueError, match="whole-series"):
        await ai_tools.update_event(session, ctx, event_id=event.id, scope="this",
                                    instance_start=_monday(), title="X", is_owner=True)
