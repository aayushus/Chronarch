FROM python:3.14-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# Install core package first for better layer caching.
COPY packages/core /srv/packages/core
RUN pip install -e /srv/packages/core

COPY apps/api /srv/apps/api
RUN pip install -e /srv/apps/api

WORKDIR /srv/apps/api

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
