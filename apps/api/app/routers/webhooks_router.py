"""Provider push callbacks (BRD §24).

Unauthenticated by design — Google/Microsoft can't present our JWTs.
Authentication is per-notification instead: the channel token / clientState
we generated at registration, compared in constant time. Unknown channel
ids get a bare 404 (no oracle for enumerating subscriptions).

Notifications never do sync work inline: they touch the row timestamp and
enqueue the normal reconciliation job. A 10s per-row coalesce window keeps
a chatty calendar from queueing storms; polling remains the backstop.
"""

import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.enums import ProviderType
from chronarch_core.models.webhook import ProviderWebhook

from ..deps import get_db_session
from ..tasks import enqueue_reconcile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])

COALESCE_SECONDS = 10


def _secrets_equal(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode(), b.encode())


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _kick(session: AsyncSession, row: ProviderWebhook) -> None:
    """Coalesced reconcile trigger for one subscription row."""
    now = _now()
    row.last_notification_at = now
    await session.flush()
    enqueue_reconcile(row.account_id)


async def _kick_coalesced(session: AsyncSession, row: ProviderWebhook) -> None:
    # Coalesce bursts: reconcile at most once per window per subscription.
    # The notification timestamp is always touched (cheap); only the
    # reconcile enqueue is skipped inside the window.
    now = _now()
    last = row.last_notification_at
    if last is not None:
        last_aware = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
        if (now - last_aware).total_seconds() < COALESCE_SECONDS:
            row.last_notification_at = now
            await session.flush()
            return
    await _kick(session, row)


@router.post("/google")
async def google_notification(request: Request, session: AsyncSession = Depends(get_db_session)):
    headers = request.headers
    channel_id = headers.get("x-goog-channel-id", "")
    row = (
        await session.execute(
            select(ProviderWebhook).where(
                ProviderWebhook.provider == ProviderType.GOOGLE,
                ProviderWebhook.channel_id == channel_id,
            )
        )
    ).scalar_one_or_none()
    if row is None or not _secrets_equal(headers.get("x-goog-channel-token"), row.client_secret):
        return JSONResponse({"detail": "unknown subscription"}, status_code=status.HTTP_404_NOT_FOUND)

    # 'sync' is the registration handshake ping, not a data change.
    if headers.get("x-goog-resource-state") == "sync":
        return JSONResponse({"status": "ok"})

    await _kick_coalesced(session, row)
    return JSONResponse({"status": "accepted"})


@router.post("/microsoft")
async def microsoft_notification(request: Request, session: AsyncSession = Depends(get_db_session)):
    # Graph's subscription handshake: echo the validation token as text.
    validation_token = request.query_params.get("validationToken")
    if validation_token is not None:
        return PlainTextResponse(validation_token, media_type="text/plain")

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"detail": "invalid body"}, status_code=status.HTTP_400_BAD_REQUEST)

    accepted = 0
    for note in body.get("value", []) if isinstance(body, dict) else []:
        if not isinstance(note, dict):
            continue
        row = (
            await session.execute(
                select(ProviderWebhook).where(
                    ProviderWebhook.provider == ProviderType.MICROSOFT,
                    ProviderWebhook.channel_id == note.get("subscriptionId", ""),
                )
            )
        ).scalar_one_or_none()
        if row is None or not _secrets_equal(note.get("clientState"), row.client_secret):
            continue
        lifecycle = note.get("lifecycleEvent")
        if lifecycle == "reauthorizationRequired":
            # Subscription needs consent again: mark error so renewal re-arms
            # it (and an admin sees why push went quiet).
            row.status = "error"
            row.last_error = "Microsoft requested reauthorization"
            await session.flush()
            continue
        if lifecycle in ("subscriptionRemoved", "missed"):
            logger.warning("Microsoft lifecycle event %s for subscription %s", lifecycle, row.channel_id)
            if lifecycle == "subscriptionRemoved":
                row.status = "error"
                row.last_error = "subscription removed by provider"
                await session.flush()
            continue
        await _kick_coalesced(session, row)
        accepted += 1
    return JSONResponse({"status": "accepted", "notifications": accepted})
