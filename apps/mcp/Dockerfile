FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY packages/core /srv/packages/core
RUN pip install -e /srv/packages/core

COPY apps/mcp /srv/apps/mcp
RUN pip install -e /srv/apps/mcp

WORKDIR /srv/apps/mcp

EXPOSE 8001

CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8001"]
