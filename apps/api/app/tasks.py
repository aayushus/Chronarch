"""Fire-and-forget worker dispatch (BRD §24 push handling).

The API image must not import worker code — it shares only the broker.
`enqueue_reconcile` publishes the existing `chronarch.reconcile_account`
task by name; the worker executes the normal reconciliation path.
Failures to publish must never break a provider callback (they retry).
"""

import logging
import os

logger = logging.getLogger(__name__)

_REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

_celery = None


def _sender():
    global _celery
    if _celery is None:
        from celery import Celery

        _celery = Celery("chronarch_api_sender", broker=_REDIS_URL, backend=_REDIS_URL)
        _celery.conf.update(
            task_serializer="json", result_serializer="json", accept_content=["json"]
        )
    return _celery


def enqueue_reconcile(account_id: str) -> bool:
    """Publish a reconciliation job. Returns False when the broker is
    unreachable (caller logs and moves on — polling still covers us)."""
    try:
        _sender().send_task("chronarch.reconcile_account", args=[account_id])
        return True
    except Exception as exc:
        logger.warning("Failed to enqueue reconcile for account %s: %s", account_id, exc)
        return False
