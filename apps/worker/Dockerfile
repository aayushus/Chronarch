FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY packages/core /srv/packages/core
RUN pip install -e /srv/packages/core

COPY apps/worker /srv/apps/worker
RUN pip install -e /srv/apps/worker

WORKDIR /srv/apps/worker

CMD ["celery", "-A", "app.celery_app.celery_app", "worker", "--loglevel=INFO"]
