import asyncio
import logging
import os

from celery import Celery
from sqlalchemy import select

from chronarch_core.db import SessionLocal
from chronarch_core.models.account import Account
from chronarch_core.models.enums import ProviderType
from chronarch_core.sync.google_sync import sync_google_account

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery("chronarch_worker", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"])


async def _reconcile_single(session, account: Account) -> dict:
    if account.provider == ProviderType.GOOGLE:
        return await sync_google_account(session, account)
    elif account.provider == ProviderType.MICROSOFT:
        try:
            from chronarch_core.sync.microsoft_sync import sync_microsoft_account

            return await sync_microsoft_account(session, account)
        except ImportError:
            return {"status": "microsoft_sync_pending"}
    elif account.provider == ProviderType.CALDAV:
        from chronarch_core.sync.caldav_sync import sync_caldav_account

        return await sync_caldav_account(session, account)
    elif account.provider == ProviderType.ICS:
        from chronarch_core.models.calendar import Calendar
        from chronarch_core.sync.ics_sync import sync_ics_subscription_calendar

        cals = list((await session.execute(select(Calendar).where(Calendar.account_id == account.id))).scalars())
        stats = []
        for cal in cals:
            stats.append(await sync_ics_subscription_calendar(session, cal))
        return {"status": "ok", "ics_calendars_synced": len(cals), "details": stats}
    return {"status": "unsupported_provider", "provider": account.provider.value}


async def _reconcile_async(account_id: str) -> dict:
    from chronarch_core.contacts import refresh_contacts_for_account

    async def _refresh_best_effort(session, account_id: str) -> None:
        """Rebuild the contact directory from the account's invites.

        Best-effort by design: contact extraction must never fail a sync —
        polling correctness outranks directory freshness.
        """
        try:
            await refresh_contacts_for_account(session, account_id)
        except Exception:
            logger.exception("Contact refresh failed for account %s", account_id)

    async with SessionLocal() as session:
        if account_id == "__all__":
            accounts = list((await session.execute(select(Account))).scalars())
            results = {}
            for acct in accounts:
                try:
                    res = await _reconcile_single(session, acct)
                    await _refresh_best_effort(session, acct.id)
                    results[acct.id] = {"status": "ok", "stats": res}
                except Exception as exc:
                    logger.exception("Failed to reconcile account %s", acct.id)
                    results[acct.id] = {"status": "error", "error": str(exc)}
            await session.commit()
            return {"reconciled_count": len(accounts), "results": results}

        account = await session.get(Account, account_id)
        if not account:
            return {"error": f"account {account_id} not found"}

        try:
            stats = await _reconcile_single(session, account)
            await _refresh_best_effort(session, account_id)
            await session.commit()
            return {"account_id": account_id, "status": "ok", "stats": stats}
        except Exception as exc:
            logger.exception("Failed to reconcile account %s", account_id)
            await session.commit()
            return {"account_id": account_id, "status": "error", "error": str(exc)}


@celery_app.task(name="chronarch.reconcile_account")
def reconcile_account(account_id: str) -> dict:
    return asyncio.run(_reconcile_async(account_id))


async def _renew_async() -> dict:
    from chronarch_core.sync.webhooks import renew_due_webhooks

    base_url = os.environ.get("APP_BASE_URL", "http://localhost:3000")
    async with SessionLocal() as session:
        try:
            result = await renew_due_webhooks(session, base_url)
            await session.commit()
            return result
        except Exception as exc:
            logger.exception("Webhook renewal sweep failed")
            await session.commit()
            return {"error": str(exc)}


@celery_app.task(name="chronarch.renew_webhooks")
def renew_webhooks() -> dict:
    return asyncio.run(_renew_async())

