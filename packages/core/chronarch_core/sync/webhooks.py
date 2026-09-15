"""Push-subscription lifecycle (BRD §24): ensure, renew, drop.

Polling stays the baseline — these functions only arm push when
`push.push_enabled()` holds, and every failure degrades to "no push"
(never an exception to the caller beyond recording the error on the row).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import push as _push
from ..crypto import get_cipher
from ..models.account import Account
from ..models.calendar import Calendar
from ..models.enums import ProviderType
from ..models.webhook import ProviderWebhook


def _expiration_from(value) -> datetime | None:
    """Google returns epoch millis (str/int); Microsoft returns ISO text."""
    if value is None:
        return None
    try:
        if isinstance(value, str) and ("T" in value or "-" in value):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


async def _connector_for(session: AsyncSession, account: Account):
    """Build an authenticated connector, or (None, reason) when impossible."""
    cipher = get_cipher()
    access_token = cipher.decrypt(account.encrypted_access_token) if account.encrypted_access_token else None
    refresh_token = cipher.decrypt(account.encrypted_refresh_token) if account.encrypted_refresh_token else None
    if not access_token:
        return None, "no stored access token"

    if account.provider == ProviderType.GOOGLE:
        from ..connectors.google import GoogleConnector
        from ..oauth import resolve_google_credentials

        try:
            client_id, client_secret = await resolve_google_credentials(session)
        except RuntimeError as exc:
            return None, str(exc)
        return GoogleConnector(access_token, refresh_token, client_id=client_id, client_secret=client_secret), ""
    if account.provider == ProviderType.MICROSOFT:
        from ..connectors.microsoft import MicrosoftConnector
        from ..oauth import resolve_microsoft_credentials

        try:
            client_id, client_secret, tenant_id = await resolve_microsoft_credentials(session)
        except RuntimeError as exc:
            return None, str(exc)
        return MicrosoftConnector(
            access_token, refresh_token,
            client_id=client_id, client_secret=client_secret, tenant_id=tenant_id,
        ), ""
    return None, f"provider {account.provider.value} has no push transport"


def _as_aware(dt: datetime | None) -> datetime | None:
    """SQLite drops tzinfo on read (prod Postgres timestamptz does not) —
    stored instants are UTC, so a naive side is assumed UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def ensure_account_webhooks(session: AsyncSession, account: Account, base_url: str) -> dict:
    """Arm push for every pushable calendar of `account` (idempotent).

    Google gets one channel per calendar; Microsoft gets one subscription
    per account. Existing healthy rows are left alone; expired/error rows
    are replaced. Returns counts + skip reason when push is disabled.
    `base_url` comes from the caller (the API's APP_BASE_URL) — core never
    reads deployment config itself.
    """
    enabled, reason = _push.push_enabled(base_url)
    if account.provider not in (ProviderType.GOOGLE, ProviderType.MICROSOFT):
        return {"ensured": 0, "replaced": 0,
                "skipped": reason or f"provider {account.provider.value} has no push transport"}
    if not enabled:
        return {"ensured": 0, "replaced": 0, "skipped": reason}

    now = datetime.now(timezone.utc)
    existing = {
        (w.provider_calendar_id or ""): w
        for w in (
            await session.execute(
                select(ProviderWebhook).where(
                    ProviderWebhook.account_id == account.id,
                    ProviderWebhook.status == "active",
                )
            )
        ).scalars()
    }
    renew_within = (
        _push.GOOGLE_RENEW_WITHIN if account.provider == ProviderType.GOOGLE
        else _push.MICROSOFT_RENEW_WITHIN
    )

    if account.provider == ProviderType.GOOGLE:
        calendars = list(
            (await session.execute(select(Calendar).where(Calendar.account_id == account.id))).scalars()
        )
        targets = [(c.provider_calendar_id, _push.callback_url(base_url, "google")) for c in calendars]
    else:
        targets = [("", _push.callback_url(base_url, "microsoft"))]

    # Fast path: every target already has a healthy row — no provider calls,
    # no token decryption, nothing to do.
    due = [
        target_cal_id
        for target_cal_id, _url in targets
        for row in [existing.get(target_cal_id)]
        for expires_at in [_as_aware(row.expires_at) if row is not None else None]
        if row is None or expires_at is None or expires_at <= now + renew_within
    ]
    if not due:
        return {"ensured": 0, "replaced": 0, "skipped": ""}

    connector, err = await _connector_for(session, account)
    if connector is None:
        return {"ensured": 0, "replaced": 0, "skipped": err}

    ensured = replaced = 0
    for target_cal_id, url in targets:
        row = existing.get(target_cal_id)
        expires_at = _as_aware(row.expires_at) if row is not None else None
        if row is not None and expires_at is not None and expires_at > now + renew_within:
            continue
        secret = _push.new_channel_secret()
        if (
            row is not None
            and account.provider == ProviderType.MICROSOFT
            and hasattr(connector, "renew_webhook")
        ):
            # Microsoft subscriptions renew in place — no churn, no gap.
            try:
                renewed = await connector.renew_webhook(row.channel_id)
                row.expires_at = _expiration_from(renewed.get("expiration")) or row.expires_at
                row.status = "active"
                row.last_error = None
                replaced += 1
                await session.flush()
                continue
            except Exception as exc:
                row.status = "error"
                row.last_error = str(exc)[:500]
                replaced += 1
                await session.flush()
                continue
        try:
            created = await connector.register_webhook(target_cal_id, url, token=secret)
        except Exception as exc:
            if row is not None:
                row.status = "error"
                row.last_error = str(exc)[:500]
                replaced += 1
            await session.flush()
            continue
        if row is not None:
            if account.provider == ProviderType.GOOGLE:
                try:
                    await connector.stop_webhook(row.channel_id, row.resource_id)
                except Exception:
                    pass
            await session.delete(row)
            await session.flush()
        session.add(ProviderWebhook(
            account_id=account.id,
            provider=account.provider,
            provider_calendar_id=target_cal_id or None,
            channel_id=created["channel_id"],
            resource_id=created.get("resource_id"),
            client_secret=secret,
            expires_at=_expiration_from(created.get("expiration")),
            status="active",
            last_error=None,
        ))
        if row is not None:
            replaced += 1
        else:
            ensured += 1
    await session.flush()
    return {"ensured": ensured, "replaced": replaced, "skipped": ""}


async def renew_due_webhooks(session: AsyncSession, base_url: str) -> dict:
    """Hourly beat body: re-arm every account with an expiring/error row.

    Google channels can't be renewed in place, so renewal == ensure (which
    replaces due rows). Returns per-account results; failures are recorded
    on rows and never raised.
    """
    accounts = list(((await session.execute(select(Account))).scalars()))
    results = {}
    for account in accounts:
        try:
            results[account.id] = await ensure_account_webhooks(session, account, base_url)
        except Exception as exc:
            results[account.id] = {"ensured": 0, "replaced": 0, "skipped": f"renew failed: {exc}"}
    await session.flush()
    return {"accounts": len(accounts), "results": results}


async def drop_account_webhooks(session: AsyncSession, account: Account) -> dict:
    """Tear down every push subscription of `account` (disconnect flow).

    Best-effort provider stops first, then rows are deleted. Never raises.
    """
    rows = list(
        (await session.execute(
            select(ProviderWebhook).where(ProviderWebhook.account_id == account.id)
        )).scalars()
    )
    if not rows:
        return {"dropped": 0}
    connector, _ = await _connector_for(session, account)
    dropped = 0
    for row in rows:
        if connector is not None:
            try:
                if account.provider == ProviderType.GOOGLE:
                    await connector.stop_webhook(row.channel_id, row.resource_id)
                elif account.provider == ProviderType.MICROSOFT and hasattr(connector, "stop_webhook"):
                    await connector.stop_webhook(row.channel_id)
            except Exception:
                pass
        await session.delete(row)
        dropped += 1
    await session.flush()
    return {"dropped": dropped}
