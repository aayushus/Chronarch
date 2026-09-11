# Chronarch

Self-hosted, privacy-first calendar aggregation and management platform for professionals who maintain calendars across multiple organizations and providers — with Executive Assistant delegation, an external MCP server for AI agents (ChatGPT, Claude), and an optional LiteLLM/OpenRouter-backed built-in copilot.

Full requirements: [brd.md](brd.md).

## Status

Early foundation build. Implemented so far:

- **`packages/core`** — the shared calendar engine: normalized `UnifiedEvent`/`Calendar`/`Account`/`Delegation`/`AuditEntry` models, the permission engine (`resolve_permission`), the availability engine (free/busy, `find_free_slots`, conflict detection), the internal AI tool layer, and the connector interface (`BaseConnector`).
- **`apps/api`** — FastAPI REST API for the web UI: auth, calendars, events (create/move/delete), all routed through the shared permission engine.
- **`apps/mcp`** — MCP server exposing the BRD §17/§18 tool set (`list_calendars`, `get_events`, `get_schedule`, `get_availability`, `find_free_slots`, `find_conflicts`, `create_event`, `move_event`, `delete_event`) over HTTP with scoped API-key auth.
- **`apps/web`** — React/TypeScript calendar UI (login + week view) wired to the API.
- **`apps/worker`** / **`apps/scheduler`** — Celery task queue and beat scheduler skeletons, ready for provider sync tasks.

**Not yet implemented**: Google/Microsoft OAuth connectors (provider sync is stubbed), ICS import, drag/resize interactions, the built-in AI copilot UI, and the admin settings UI. See [brd.md](brd.md) §31 for full MVP scope.

## Running locally (Docker Compose + Colima)

```bash
colima start --cpu 4 --memory 8 --disk 60
cp .env.example .env  # fill in TOKEN_ENCRYPTION_KEY at minimum
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

`--env-file .env` is required: Compose looks for `.env` next to the compose file by default, and ours lives at the repo root alongside `infra/`.

Then seed an executive/admin login:

```bash
docker compose -f infra/docker-compose.yml exec api python scripts/seed_admin.py you@example.com "Your Name" a-strong-password
```

- Web UI: http://localhost:3000
- API: http://localhost:8000 (docs at `/docs`)
- MCP server: http://localhost:8001
- LiteLLM proxy: http://localhost:4000

For local development with hot reload:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d --build
```

## Running the core package tests

```bash
cd packages/core
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q
```

## Architecture

See the [implementation plan](brd.md) and inline module docstrings, starting with:

- [`packages/core/chronarch_core/permissions/engine.py`](packages/core/chronarch_core/permissions/engine.py) — the permission engine
- [`packages/core/chronarch_core/availability/engine.py`](packages/core/chronarch_core/availability/engine.py) — the availability engine
- [`packages/core/chronarch_core/ai_tools/tools.py`](packages/core/chronarch_core/ai_tools/tools.py) — the internal tool layer shared by MCP and the copilot
- [`apps/mcp/app/server.py`](apps/mcp/app/server.py) — the MCP server
