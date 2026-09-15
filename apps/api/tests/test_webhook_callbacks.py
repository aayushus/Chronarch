"""HTTP callback tests for the push-notification routers (BRD §24).

Calls the Google/Microsoft handlers directly with stub requests — no server,
no network, no broker. The DB is the real sqlite session; `enqueue_reconcile`
is recorded via monkeypatch. Covers: unknown channel → 404, secret mismatch
→ 404, handshake pings, accept + enqueue, 10s coalescing, lifecycle events.
"""

import json

from app.routers import webhooks_router as wr
from chronarch_core.models.account import Account
from chronarch_core.models.enums import ProviderType, UserRole
from chronarch_core.models.user import User
from chronarch_core.models.webhook import ProviderWebhook


class _Req:
    """Minimal stub: the handlers only touch headers/query_params/json()."""

    def __init__(self, headers=None, query=None, body=None, json_error=False):
        self.headers = headers or {}
        self.query_params = query or {}
        self._body = body
        self._json_error = json_error

    async def json(self):
        if self._json_error:
            raise ValueError("not json")
        return self._body


def _body(resp) -> dict:
    return json.loads(resp.body.decode())


async def _hook(session, provider, channel_id="chan-1", secret="s3cret", status="active"):
    email = f"cb-{provider.value}-{channel_id}@x.com"
    user = User(id=f"u-{email}", email=email, display_name="C",
                password_hash="x", role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=provider,
                      provider_account_email=email, provider_account_id=email)
    session.add(account)
    await session.flush()
    row = ProviderWebhook(account_id=account.id, provider=provider,
                          channel_id=channel_id, client_secret=secret, status=status)
    session.add(row)
    await session.flush()
    return account, row


def _recorder(monkeypatch):
    calls: list = []
    monkeypatch.setattr(wr, "enqueue_reconcile",
                        lambda account_id: calls.append(account_id) or True)
    return calls


# --- Google ---

async def test_google_unknown_channel_404(session, monkeypatch):
    calls = _recorder(monkeypatch)
    resp = await wr.google_notification(
        _Req(headers={"x-goog-channel-id": "nope", "x-goog-channel-token": "x"}),
        session=session)
    assert resp.status_code == 404
    assert calls == []


async def test_google_wrong_and_missing_token_404(session, monkeypatch):
    await _hook(session, ProviderType.GOOGLE)
    calls = _recorder(monkeypatch)
    for headers in ({"x-goog-channel-id": "chan-1", "x-goog-channel-token": "wrong"},
                    {"x-goog-channel-id": "chan-1"}):
        resp = await wr.google_notification(_Req(headers=headers), session=session)
        assert resp.status_code == 404
    assert calls == []


async def test_google_sync_handshake_no_enqueue(session, monkeypatch):
    _, row = await _hook(session, ProviderType.GOOGLE)
    calls = _recorder(monkeypatch)
    resp = await wr.google_notification(_Req(headers={
        "x-goog-channel-id": "chan-1", "x-goog-channel-token": "s3cret",
        "x-goog-resource-state": "sync"}), session=session)
    assert _body(resp) == {"status": "ok"}
    assert calls == []
    assert row.last_notification_at is None


async def test_google_valid_notification_enqueues(session, monkeypatch):
    account, row = await _hook(session, ProviderType.GOOGLE)
    calls = _recorder(monkeypatch)
    resp = await wr.google_notification(_Req(headers={
        "x-goog-channel-id": "chan-1", "x-goog-channel-token": "s3cret",
        "x-goog-resource-state": "exists"}), session=session)
    assert _body(resp) == {"status": "accepted"}
    assert calls == [account.id]
    assert row.last_notification_at is not None


async def test_google_burst_coalesced_but_timestamp_touched(session, monkeypatch):
    _, row = await _hook(session, ProviderType.GOOGLE)
    calls = _recorder(monkeypatch)
    headers = {"x-goog-channel-id": "chan-1", "x-goog-channel-token": "s3cret"}
    await wr.google_notification(_Req(headers=headers), session=session)
    first = row.last_notification_at
    assert first is not None
    resp = await wr.google_notification(_Req(headers=headers), session=session)
    assert _body(resp) == {"status": "accepted"}
    assert len(calls) == 1
    assert row.last_notification_at is not None and row.last_notification_at >= first


# --- Microsoft ---

async def test_microsoft_handshake_echoes_token(session):
    resp = await wr.microsoft_notification(
        _Req(query={"validationToken": "abc123"}), session=session)
    assert resp.body.decode() == "abc123"


async def test_microsoft_invalid_body_400(session):
    resp = await wr.microsoft_notification(_Req(json_error=True), session=session)
    assert resp.status_code == 400


async def test_microsoft_valid_notification_enqueues(session, monkeypatch):
    account, row = await _hook(session, ProviderType.MICROSOFT)
    calls = _recorder(monkeypatch)
    resp = await wr.microsoft_notification(_Req(body={"value": [{
        "subscriptionId": "chan-1", "clientState": "s3cret"}]}), session=session)
    assert _body(resp) == {"status": "accepted", "notifications": 1}
    assert calls == [account.id]
    assert row.last_notification_at is not None


async def test_microsoft_wrong_secret_skipped(session, monkeypatch):
    await _hook(session, ProviderType.MICROSOFT)
    calls = _recorder(monkeypatch)
    resp = await wr.microsoft_notification(_Req(body={"value": [
        {"subscriptionId": "chan-1", "clientState": "wrong"},
        {"subscriptionId": "unknown", "clientState": "s3cret"},
        "garbage",
    ]}), session=session)
    assert _body(resp) == {"status": "accepted", "notifications": 0}
    assert calls == []


async def test_microsoft_reauthorization_marks_error(session, monkeypatch):
    _, row = await _hook(session, ProviderType.MICROSOFT)
    calls = _recorder(monkeypatch)
    await wr.microsoft_notification(_Req(body={"value": [{
        "subscriptionId": "chan-1", "clientState": "s3cret",
        "lifecycleEvent": "reauthorizationRequired"}]}), session=session)
    assert row.status == "error"
    assert row.last_error == "Microsoft requested reauthorization"
    assert calls == []


async def test_microsoft_removed_marks_error_missed_only_logs(session, monkeypatch):
    _, row = await _hook(session, ProviderType.MICROSOFT)
    calls = _recorder(monkeypatch)
    await wr.microsoft_notification(_Req(body={"value": [{
        "subscriptionId": "chan-1", "clientState": "s3cret",
        "lifecycleEvent": "missed"}]}), session=session)
    assert row.status == "active"
    await wr.microsoft_notification(_Req(body={"value": [{
        "subscriptionId": "chan-1", "clientState": "s3cret",
        "lifecycleEvent": "subscriptionRemoved"}]}), session=session)
    assert row.status == "error"
    assert calls == []
