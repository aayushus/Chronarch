# Chronarch

Self-hosted, calendar aggregation and management platform for professionals who maintain calendars across multiple organizations and providers — with Executive Assistant delegation, an external MCP server for AI agents (Claude Desktop, Cursor, ChatGPT), an embedded contextual AI copilot drawer, and live bi-directional Google, Microsoft Graph, and ICS calendar sync.

Full requirements and design specification: [brd.md](brd.md).

## Features & Capabilities

- **Unified Multi-Calendar Aggregation**: Aggregate multiple corporate Google Workspace, Microsoft 365 / Outlook, and ICS subscription calendars into a single, cohesive view.
- **Privacy & Delegation Matrix**: Granular Executive Assistant (EA) access control per calendar, privacy masking (private vs. free/busy vs. full details), and source-of-truth write protection.
- **Provider Sync Engine**: Live bi-directional event sync for Google Calendar and Microsoft Graph, plus automated periodic and on-demand reconciliation for ICS feeds and connected accounts.
- **MCP Server for AI Agents**: Standards-compliant Model Context Protocol server exposing scheduling tools (`list_calendars`, `get_schedule`, `find_free_slots`, `find_conflicts`, `create_event`, `move_event`, `delete_event`) over HTTP with scoped API keys.
- **Contextual Copilot Drawer**: Built-in AI scheduling assistant running alongside the calendar view with quick prompt chips, date awareness, and direct function-calling capabilities.
- **Comprehensive Settings Suite**: Unified macOS-inspired dark theme UI across all settings tabs:
  - **Accounts & Calendars**: Provider connection management, OAuth credentials configuration, and calendar visibility toggles.
  - **Delegation**: EA delegation grants with scoped permissions.
  - **MCP Clients**: API key issuance, token rotation, and permission flags.
  - **AI / LLM Settings**: Primary and fallback model routing with LiteLLM proxy integration.
  - **Audit Logs**: Filterable, immutable security and activity log inspection.
  - **Users**: Admin user management and role assignment.

## Running Locally (Docker Compose + Colima)

```bash
colima start --cpu 4 --memory 8 --disk 60
cp .env.example .env  # fill in TOKEN_ENCRYPTION_KEY and secrets
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

`--env-file .env` is required because Compose loads `.env` next to the compose file by default, while the environment file resides at the repo root.

### Seed Admin User

Seed an initial executive/admin account:

```bash
docker compose --env-file .env -f infra/docker-compose.yml exec api python scripts/seed_admin.py you@example.com "Your Name" a-strong-password
```

### Services & Ports

- **Web UI**: http://localhost:3100
- **API**: http://localhost:8000 (Swagger docs at `/docs`)
- **MCP Server**: http://localhost:8001
- **LiteLLM Proxy**: http://localhost:4000

For local development with hot reload:

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d --build
```

## Running the Test Suite

Run the full suite (core engine + API callback tests) inside the API
container (from `/srv`, where the relative paths in the root
`pyproject.toml` resolve):

```bash
docker compose --env-file .env -f infra/docker-compose.yml exec api sh -c "cd /srv && python -m pytest -q"
```

Or locally in a Python virtual environment (repo root). The API callback
tests import fastapi, so it is installed alongside the core dev extras:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e "packages/core[dev]" "fastapi>=0.111"
pytest -q
```

## Architecture

- [`packages/core/chronarch_core/permissions/engine.py`](packages/core/chronarch_core/permissions/engine.py) — Granular permission and delegation engine (`resolve_permission`).
- [`packages/core/chronarch_core/availability/engine.py`](packages/core/chronarch_core/availability/engine.py) — High-performance free/busy and conflict resolution engine.
- [`packages/core/chronarch_core/ai_tools/tools.py`](packages/core/chronarch_core/ai_tools/tools.py) — Shared tool layer called identically by both the MCP server and built-in copilot.
- [`packages/core/chronarch_core/sync/`](packages/core/chronarch_core/sync/) — Provider synchronization adapters for Google, Microsoft, and ICS subscriptions.
- [`apps/mcp/app/server.py`](apps/mcp/app/server.py) — Model Context Protocol HTTP service.
- [`apps/api/`](apps/api/) — FastAPI application routing web requests, OAuth flows, and background sync triggers.
- [`apps/web/`](apps/web/) — Modern React calendar frontend with multi-calendar overlay, contextual AI copilot drawer, and unified settings layout.

