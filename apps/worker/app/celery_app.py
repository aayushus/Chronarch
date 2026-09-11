"""Celery worker: sync jobs, webhook processing, ICS parsing (BRD §23-25).

Real provider sync (Google push channels / Graph subscriptions + backfill,
BR-CAL-001/002) is not implemented yet — that is the next build phase after
this foundation. This module wires up the task queue and a placeholder
reconciliation task so `docker compose up` brings up a working worker
process today, ready for connector tasks to be added.
"""

import os

from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery("chronarch_worker", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"])


@celery_app.task(name="chronarch.reconcile_account")
def reconcile_account(account_id: str) -> dict:
    """Placeholder for per-account reconciliation (BR-CAL pull sync). Will
    instantiate the account's connector (chronarch_core.connectors) and
    diff provider state against cached UnifiedEvent rows once connectors
    are implemented."""
    return {"account_id": account_id, "status": "not_implemented"}
