FROM python:3.14-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# Install core package first for better layer caching.
COPY packages/core /srv/packages/core
RUN pip install -e /srv/packages/core

# Root pytest config (testpaths/asyncio_mode) so `cd /srv && pytest` works.
COPY pyproject.toml /srv/pyproject.toml

COPY apps/api /srv/apps/api
RUN pip install -e /srv/apps/api

# Test tooling ships in the image so `exec api ... pytest` works anywhere
# without a local venv (a few MB; never imported at runtime).
RUN pip install "pytest>=8.0" "pytest-asyncio>=0.23" "aiosqlite>=0.20" "freezegun>=1.4"

WORKDIR /srv/apps/api

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
