"""Push-subscription lifecycle tests (BRD §24).

Provider HTTP is mocked at the connector level; the DB is the real sqlite
session. Nothing here touches the network.
"""

from datetime import datetime, timedelta, timezone

from chronarch_core import push as _push
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import CalendarKind, ProviderType, UserRole
from chronarch_core.models.user import User
from chronarch_core.models.webhook import ProviderWebhook
from chronarch_core.sync import webhooks as _webhooks


def test_push_enabled_matrix():
    assert _push.push_enabled("https://calendar.example.com") == (True, "")
    assert _push.push_enabled("http://localhost:3000")[0] is False
    assert _push.push_enabled("http://localhost:3000")[1] != ""
    assert _push.push_enabled("https://localhost:8443")[0] is False
    assert _push.push_enabled("http://calendar.example.com")[0] is False
    assert _push.push_enabled("https://192.168.1.10")[0] is False
    assert _push.push_enabled("https://mydevice.local")[0] is False
    assert _push.push_enabled("https://singlelabel")[0] is False
    assert _push.push_enabled("")[0] is False
    assert _push.push_enabled(None)[0] is False


def test_expiration_parsing():
    assert _webhooks._expiration_from(None) is None
    assert _webhooks._expiration_from("garbage") is None
    # Google epoch millis (str and int) — 1789430400000 == 2026-09-15T00:00Z.
    assert _webhooks._expiration_from("1789430400000") == datetime(2026, 9, 15, tzinfo=timezone.utc)
    assert _webhooks._expiration_from(1789430400000) == datetime(2026, 9, 15, tzinfo=timezone.utc)
    # Microsoft ISO text.
    assert _webhooks._expiration_from("2026-09-15T12:00:00.000Z") == datetime(
        2026, 9, 15, 12, 0, tzinfo=timezone.utc)


async def _account(session, provider=ProviderType.GOOGLE, email="push@x.com"):
    user = User(id=f"u-{email}", email=email, display_name="P", password_hash="x", role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=provider,
                      provider_account_email=email, provider_account_id=email)
    session.add(account)
    await session.flush()
    return account


async def test_ensure_skips_non_pushable(session, monkeypatch):
    account = await _account(session, ProviderType.ICS)
    out = await _webhooks.ensure_account_webhooks(session, account, "https://cal.example.com")
    assert out["ensured"] == 0 and "no push transport" in out["skipped"]


async def test_ensure_skips_localhost(session):
    account = await _account(session, ProviderType.GOOGLE)
    out = await _webhooks.ensure_account_webhooks(session, account, "http://localhost:3000")
    assert out["ensured"] == 0 and "https" in out["skipped"]


class _FakeConnector:
    instances: list = []

    def __init__(self, *args, **kwargs):
        self.stopped = []
        _FakeConnector.instances.append(self)

    async def register_webhook(self, calendar_id, url, token=None):
        from datetime import datetime as _dt, timezone as _tz

        assert token, "validation secret must be generated per subscription"
        assert url.startswith("https://cal.example.com/api/v1/webhooks/")
        far = _dt.now(_tz.utc) + timedelta(days=30)
        return {"channel_id": f"chan-{calendar_id or 'acct'}", "resource_id": "res-1",
                "expiration": str(int(far.timestamp() * 1000))}

    async def stop_webhook(self, channel_id, resource_id=None):
        self.stopped.append(channel_id)


async def test_ensure_google_per_calendar_and_idempotent(session, monkeypatch):
    from sqlalchemy import select

    _FakeConnector.instances.clear()
    account = await _account(session, ProviderType.GOOGLE)
    for name in ("Work", "Family"):
        session.add(Calendar(account_id=account.id, provider_calendar_id=f"g:{name}",
                             kind=CalendarKind.PRIMARY, name=name, provider_writable=True))
    await session.flush()

    async def fake_connector(session_, account_):
        return _FakeConnector(), ""

    monkeypatch.setattr(_webhooks, "_connector_for", fake_connector)
    out = await _webhooks.ensure_account_webhooks(session, account, "https://cal.example.com")
    assert out == {"ensured": 2, "replaced": 0, "skipped": ""}

    rows = list((await session.execute(
        select(ProviderWebhook).where(ProviderWebhook.account_id == account.id))).scalars())
    assert len(rows) == 2
    assert {r.provider_calendar_id for r in rows} == {"g:Work", "g:Family"}
    assert all(r.client_secret and r.channel_id.startswith("chan-") for r in rows)

    # Second run: healthy rows untouched (no new registrations).
    _FakeConnector.instances.clear()
    out = await _webhooks.ensure_account_webhooks(session, account, "https://cal.example.com")
    assert out == {"ensured": 0, "replaced": 0, "skipped": ""}
    assert _FakeConnector.instances == []


async def test_renew_replaces_expired_google_channel(session, monkeypatch):
    from sqlalchemy import select

    account = await _account(session, ProviderType.GOOGLE, email="push2@x.com")
    session.add(Calendar(account_id=account.id, provider_calendar_id="g:Work",
                         kind=CalendarKind.PRIMARY, name="Work", provider_writable=True))
    session.add(ProviderWebhook(
        account_id=account.id, provider=ProviderType.GOOGLE, provider_calendar_id="g:Work",
        channel_id="chan-old", resource_id="res-old", client_secret="s3cret",
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1), status="active"))
    await session.flush()

    async def fake_connector(session_, account_):
        return _FakeConnector(), ""

    monkeypatch.setattr(_webhooks, "_connector_for", fake_connector)
    out = await _webhooks.ensure_account_webhooks(session, account, "https://cal.example.com")
    assert out["replaced"] == 1
    rows = list((await session.execute(
        select(ProviderWebhook).where(ProviderWebhook.account_id == account.id))).scalars())
    assert len(rows) == 1 and rows[0].channel_id == "chan-g:Work"
    assert rows[0].client_secret != "s3cret"


async def test_drop_stops_and_deletes(session, monkeypatch):
    from sqlalchemy import select

    _FakeConnector.instances.clear()
    account = await _account(session, ProviderType.GOOGLE, email="push3@x.com")
    session.add(ProviderWebhook(
        account_id=account.id, provider=ProviderType.GOOGLE, provider_calendar_id="g:Work",
        channel_id="chan-x", resource_id="res-x", client_secret="s3cret", status="active"))
    await session.flush()

    async def fake_connector(session_, account_):
        return _FakeConnector(), ""

    monkeypatch.setattr(_webhooks, "_connector_for", fake_connector)
    out = await _webhooks.drop_account_webhooks(session, account)
    assert out == {"dropped": 1}
    remaining = list((await session.execute(
        select(ProviderWebhook).where(ProviderWebhook.account_id == account.id))).scalars())
    assert remaining == []
    assert _FakeConnector.instances[0].stopped == ["chan-x"]


async def test_renew_sweep_skips_unsupported(session):
    account = await _account(session, ProviderType.ICS, email="push4@x.com")
    out = await _webhooks.renew_due_webhooks(session, "https://cal.example.com")
    assert out["accounts"] >= 1
    assert out["results"][account.id]["skipped"] != ""
