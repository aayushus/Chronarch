from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .routers import (
    admin_accounts_router,
    admin_ai_router,
    admin_audit_router,
    admin_caldav_router,
    admin_delegations_router,
    admin_google_router,
    admin_mcp_router,
    admin_microsoft_router,
    admin_oauth_router,
    admin_roles_router,
    admin_router,
    admin_users_router,
    auth_router,
    calendars_router,
    copilot_router,
    events_router,
    health,
    mcp_keys_router,
    webhooks_router,
)

app = FastAPI(title="Chronarch API", version="0.1.0")

# Wildcard origins cannot be combined with credentials (browsers reject
# `Access-Control-Allow-Origin: *` when `Access-Control-Allow-Credentials`
# is true), so only send credentials for an explicit allowlist.
_allow_credentials = CORS_ORIGINS != ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth_router.router)
app.include_router(calendars_router.router)
app.include_router(events_router.router)
app.include_router(copilot_router.router)
app.include_router(admin_router.router)
app.include_router(admin_users_router.router)
app.include_router(admin_delegations_router.router)
app.include_router(admin_mcp_router.router)
app.include_router(admin_accounts_router.router)
app.include_router(admin_audit_router.router)
app.include_router(admin_google_router.router)
app.include_router(admin_microsoft_router.router)
app.include_router(admin_caldav_router.router)
app.include_router(admin_oauth_router.router)
app.include_router(admin_ai_router.router)
app.include_router(admin_roles_router.router)
app.include_router(mcp_keys_router.router)
app.include_router(webhooks_router.router)


