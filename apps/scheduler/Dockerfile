FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY packages/core /srv/packages/core
RUN pip install -e /srv/packages/core

COPY apps/scheduler /srv/apps/scheduler
RUN pip install -e /srv/apps/scheduler

WORKDIR /srv/apps/scheduler

CMD ["celery", "-A", "app.beat.celery_app", "beat", "--loglevel=INFO"]
