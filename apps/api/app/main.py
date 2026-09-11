from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import (
    admin_accounts_router,
    admin_audit_router,
    admin_delegations_router,
    admin_google_router,
    admin_mcp_router,
    admin_router,
    admin_users_router,
    auth_router,
    calendars_router,
    events_router,
    health,
)

app = FastAPI(title="Chronarch API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten for production deployments
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth_router.router)
app.include_router(calendars_router.router)
app.include_router(events_router.router)
app.include_router(admin_router.router)
app.include_router(admin_users_router.router)
app.include_router(admin_delegations_router.router)
app.include_router(admin_mcp_router.router)
app.include_router(admin_accounts_router.router)
app.include_router(admin_audit_router.router)
app.include_router(admin_google_router.router)
