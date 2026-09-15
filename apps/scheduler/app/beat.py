"""Periodic reconciliation + webhook-renewal scheduler (BRD §24, and the
webhook-renewal gap noted in the plan — push subscriptions expire and need
active renewal, not just a reconciliation fallback).

`celery beat` only needs a Celery app configured with the same broker as
the worker and the target task's *name* — it enqueues by name, it does not
need to import the worker's task implementation.
"""

import os

from celery import Celery
from celery.schedules import crontab

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery("chronarch_scheduler", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"])

celery_app.conf.beat_schedule = {
    "reconcile-all-accounts": {
        "task": "chronarch.reconcile_account",
        "schedule": crontab(minute="*/5"),
        "args": ("__all__",),
    },
    "renew-push-subscriptions": {
        "task": "chronarch.renew_webhooks",
        "schedule": crontab(minute="17"),
        "args": (),
    },
}
