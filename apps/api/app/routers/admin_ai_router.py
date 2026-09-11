"""Admin AI / LiteLLM settings management (BRD §20.2-20.4).

Lets admins set the OpenRouter API key and model routing from Settings > AI /
LiteLLM instead of editing `packages/litellm-config/config.yaml` and server
env vars. The key is Fernet-encrypted at rest (same cipher as Account tokens,
BRD §29) and NEVER returned by any endpoint — reads only report
configured/not-configured plus the effective (DB-over-defaults) routing.

Saving re-renders the shared litellm-dynamic volume; the litellm container
picks it up on restart (`docker compose restart litellm`).
"""

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.ai_config import (
    DEFAULTS,
    SETTINGS_ID,
    apply_ai_settings,
    effective_settings,
    get_settings,
)
from chronarch_core.crypto import get_cipher
from chronarch_core.models.ai_settings import AILiteLLMSettings
from chronarch_core.models.user import User

from ..admin_guard import require_admin
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/ai", tags=["admin"])

# Provider keys are opaque tokens — whitespace means a paste error and would
# break the sourced env file the litellm entrypoint reads.
_KEY_RE = re.compile(r"^[^\s'\"\\]+$")


class AISettingsOut(BaseModel):
    openrouter_key_configured: bool
    primary_model: str
    fallback_model: str
    emergency_model: str
    routing_strategy: str
    timeout_seconds: int
    sources: dict[str, str]
    litellm_endpoint: str = "http://litellm:4000"


class AISettingsUpdate(BaseModel):
    # Omitted or empty = keep stored value (the form never round-trips the
    # key back to the browser). Explicit null for a model field resets it to
    # the shipped default.
    openrouter_api_key: str | None = None
    primary_model: str | None = None
    fallback_model: str | None = None
    emergency_model: str | None = None
    routing_strategy: str | None = None
    timeout_seconds: int | None = None


def _to_out(effective: dict) -> AISettingsOut:
    return AISettingsOut(
        openrouter_key_configured=bool(effective["openrouter_key_configured"]),
        primary_model=str(effective["primary_model"]),
        fallback_model=str(effective["fallback_model"]),
        emergency_model=str(effective["emergency_model"]),
        routing_strategy=str(effective["routing_strategy"]),
        timeout_seconds=int(effective["timeout_seconds"]),
        sources=dict(effective["sources"]),
    )


@router.get("/settings", response_model=AISettingsOut)
async def get_ai_settings(
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)
):
    return _to_out(effective_settings(await get_settings(session)))


@router.put("/settings", response_model=AISettingsOut)
async def update_ai_settings(
    body: AISettingsUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    row = await get_settings(session)
    if row is None:
        row = AILiteLLMSettings(id=SETTINGS_ID)
        session.add(row)

    if body.openrouter_api_key:
        key = body.openrouter_api_key.strip()
        if not _KEY_RE.match(key):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "OpenRouter API key looks invalid (whitespace or quotes) — check for a paste error.",
            )
        row.encrypted_openrouter_api_key = get_cipher().encrypt(key)

    for field in ("primary_model", "fallback_model", "emergency_model", "routing_strategy"):
        value = getattr(body, field)
        if value is None:
            continue
        setattr(row, field, value.strip() or None)

    if body.timeout_seconds is not None:
        if not 5 <= body.timeout_seconds <= 300:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "timeout_seconds must be between 5 and 300"
            )
        row.timeout_seconds = body.timeout_seconds

    await session.flush()
    effective = await apply_ai_settings(session)
    return _to_out(effective)


@router.delete("/settings", response_model=AISettingsOut)
async def clear_ai_settings(
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)
):
    row = await get_settings(session)
    if row is not None:
        await session.delete(row)
        await session.flush()
    effective = await apply_ai_settings(session)
    return _to_out(effective)


@router.get("/defaults")
async def get_ai_defaults(_admin: User = Depends(require_admin)):
    """Shipped defaults, for placeholder text in the settings form."""
    return dict(DEFAULTS)
