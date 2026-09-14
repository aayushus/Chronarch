"""Admin AI / LiteLLM settings management (BRD §20.2-20.4).

Lets admins set the OpenRouter API key and model routing from Settings > AI /
LiteLLM instead of editing `packages/litellm-config/config.yaml` and server
env vars. The key is Fernet-encrypted at rest (same cipher as Account tokens,
BRD §29) and NEVER returned by any endpoint — reads only report
configured/not-configured plus the effective (DB-over-defaults) routing.

Saving re-renders the shared litellm-dynamic volume, which the litellm
container's entrypoint watches and applies within seconds (no restart).
A pasted key is verified against OpenRouter before it is stored, so a typo
fails fast at save time instead of surfacing later as a copilot 401.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.ai_config import (
    DEFAULTS,
    SETTINGS_ID,
    apply_ai_settings,
    check_openrouter_key,
    effective_settings,
    get_settings,
)
from chronarch_core.crypto import get_cipher
from chronarch_core.models.ai_settings import AILiteLLMSettings
from chronarch_core.models.user import User

from ..admin_guard import require_permission
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/ai", tags=["admin"])

# Provider keys are opaque tokens — whitespace means a paste error and would
# break the sourced env file the litellm entrypoint reads.
_KEY_RE = re.compile(r"^[^\s'\"\\]+$")


class AISettingsOut(BaseModel):
    openrouter_key_configured: bool
    groq_key_configured: bool = False
    gemini_key_configured: bool = False
    primary_model: str
    fallback_model: str
    emergency_model: str
    routing_strategy: str
    timeout_seconds: int
    sources: dict[str, str]
    litellm_endpoint: str = "http://litellm:4000"
    # Result of the provider key check(s) on the save that just happened:
    # {"groq": "valid", ...}; values valid/unknown, or None when no key saved.
    key_check: str | dict[str, str] | None = None


class AISettingsUpdate(BaseModel):
    # Omitted or empty = keep stored value (the form never round-trips the
    # key back to the browser). Explicit null for a model field resets it to
    # the shipped default.
    openrouter_api_key: str | None = None
    groq_api_key: str | None = None
    gemini_api_key: str | None = None
    primary_model: str | None = None
    fallback_model: str | None = None
    emergency_model: str | None = None
    routing_strategy: str | None = None
    timeout_seconds: int | None = None


def _to_out(effective: dict, *, key_check: str | dict[str, str] | None = None) -> AISettingsOut:
    if isinstance(key_check, dict) and len(key_check) == 1:
        key_check = next(iter(key_check.values()))
    return AISettingsOut(
        openrouter_key_configured=bool(effective["openrouter_key_configured"]),
        groq_key_configured=bool(effective.get("groq_key_configured")),
        gemini_key_configured=bool(effective.get("gemini_key_configured")),
        primary_model=str(effective["primary_model"]),
        fallback_model=str(effective["fallback_model"]),
        emergency_model=str(effective["emergency_model"]),
        routing_strategy=str(effective["routing_strategy"]),
        timeout_seconds=int(effective["timeout_seconds"]),
        sources=dict(effective["sources"]),
        key_check=key_check,
    )


async def check_openrouter_key(key: str) -> str:
    """Back-compat re-export: the check lives in chronarch_core.ai_config so
    the core test suite can cover it without importing FastAPI routers."""
    from chronarch_core.ai_config import check_openrouter_key as _check

    return await _check(key)


# provider label, request field, row field, checker
_KEY_SLOTS = (
    ("OpenRouter", "openrouter_api_key", "encrypted_openrouter_api_key",
     "chronarch_core.ai_config:check_openrouter_key"),
    ("Groq", "groq_api_key", "encrypted_groq_api_key",
     "chronarch_core.ai_config:check_groq_key"),
    ("Gemini", "gemini_api_key", "encrypted_gemini_api_key",
     "chronarch_core.ai_config:check_gemini_key"),
)


async def _check_slot(dotted: str, key: str) -> str:
    module_name, func_name = dotted.split(":")
    import importlib

    func = getattr(importlib.import_module(module_name), func_name)
    return await func(key)


@router.get("/settings", response_model=AISettingsOut)
async def get_ai_settings(
    _user: User = Depends(require_permission("ai.view")), session: AsyncSession = Depends(get_db_session)
):
    return _to_out(effective_settings(await get_settings(session)))


@router.put("/settings", response_model=AISettingsOut)
async def update_ai_settings(
    body: AISettingsUpdate,
    _user: User = Depends(require_permission("ai.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    row = await get_settings(session)
    if row is None:
        row = AILiteLLMSettings(id=SETTINGS_ID)
        session.add(row)

    key_checks: dict[str, str] = {}
    for label, req_field, row_field, checker in _KEY_SLOTS:
        raw = getattr(body, req_field)
        if not raw:
            continue
        key = raw.strip()
        if not _KEY_RE.match(key):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{label} API key looks invalid (whitespace or quotes) — check for a paste error.",
            )
        result = await _check_slot(checker, key)
        if result == "invalid":
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{label} rejected this API key (unauthorized). "
                f"Check the key in the {label} dashboard and paste it again — nothing was saved.",
            )
        setattr(row, row_field, get_cipher().encrypt(key))
        key_checks[label.lower()] = result

    for field in ("primary_model", "fallback_model", "emergency_model", "routing_strategy"):
        value = getattr(body, field)
        if value is None:
            continue
        text = value.strip() or None
        if text and field.endswith("_model"):
            from chronarch_core.ai_config import validate_model_id

            try:
                text = validate_model_id(text)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        setattr(row, field, text)

    if body.timeout_seconds is not None:
        if not 5 <= body.timeout_seconds <= 300:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "timeout_seconds must be between 5 and 300"
            )
        row.timeout_seconds = body.timeout_seconds

    await session.flush()
    effective = await apply_ai_settings(session)
    return _to_out(effective, key_check=key_checks or None)


@router.delete("/settings", response_model=AISettingsOut)
async def clear_ai_settings(
    _user: User = Depends(require_permission("ai.manage")), session: AsyncSession = Depends(get_db_session)
):
    row = await get_settings(session)
    if row is not None:
        await session.delete(row)
        await session.flush()
    effective = await apply_ai_settings(session)
    return _to_out(effective)


@router.get("/defaults")
async def get_ai_defaults(_user: User = Depends(require_permission("ai.view"))):
    """Shipped defaults, for placeholder text in the settings form."""
    return dict(DEFAULTS)


class ProviderModel(BaseModel):
    id: str
    label: str


class ProviderModelList(BaseModel):
    provider: str
    models: list[ProviderModel]


@router.get("/models/{provider}", response_model=ProviderModelList)
async def list_provider_models(
    provider: str,
    _user: User = Depends(require_permission("ai.view")),
    session: AsyncSession = Depends(get_db_session),
):
    """Live model catalog for the tier dropdowns, resolved server-side with
    the stored key (keys never reach the browser). Falls back to the curated
    list in the UI when this fails."""
    from chronarch_core.ai_config import fetch_provider_models

    try:
        models = await fetch_provider_models(session, provider)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    return ProviderModelList(provider=provider, models=models)
