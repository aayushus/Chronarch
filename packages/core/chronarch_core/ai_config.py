"""Admin-managed LiteLLM settings (BRD §20.2-20.4).

`AILiteLLMSettings` (set from Settings > AI / LiteLLM) overrides the shipped
defaults below per-field; unset fields fall back to the defaults. The admin
router renders the effective settings into the shared litellm-dynamic volume
(`config.yaml` + `litellm.env`), which the litellm container's entrypoint
watches and applies within seconds — so no `.env` edits, image rebuilds, or
manual restarts are needed to rotate the OpenRouter key or switch models.
"""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncSession

from .crypto import get_cipher
from .models.ai_settings import AILiteLLMSettings

SETTINGS_ID = "default"

# Default chain spans three independent free tiers so exhausting one never
# takes the copilot down: Groq (fast open-weights) → Gemini (quality) →
# OpenRouter free (last resort). Every entry needs tool-calling support for
# the copilot's function loop. Defaults match models on a standard Groq
# free plan (gpt-oss-20b: 1K req/day) — override in Settings if yours differ.
DEFAULTS = {
    "primary_model": "groq/openai/gpt-oss-20b",
    "fallback_model": "gemini/gemini-2.5-flash",
    "emergency_model": "openrouter/nvidia/nemotron-3.5-lightning:free",
    "routing_strategy": "simple-shuffle",
    "timeout_seconds": 30,
}

CONFIG_FILENAME = "config.yaml"
ENV_FILENAME = "litellm.env"

OPENROUTER_KEY_CHECK_URL = "https://openrouter.ai/api/v1/auth/key"
GROQ_KEY_CHECK_URL = "https://api.groq.com/openai/v1/models"
GEMINI_KEY_CHECK_URL = "https://generativelanguage.googleapis.com/v1beta/models"
KEY_CHECK_TIMEOUT = 10.0
# Back-compat alias for the earlier single-provider name.
OPENROUTER_KEY_CHECK_TIMEOUT = KEY_CHECK_TIMEOUT

# Model-id prefix → env var holding that provider's key inside litellm.
PROVIDER_ENV = {
    "groq/": "GROQ_API_KEY",
    "gemini/": "GEMINI_API_KEY",
    "openrouter/": "OPENROUTER_API_KEY",
}
# All provider prefixes LiteLLM accepts (for validating custom model ids —
# a bare id like "gpt-oss-20b" would silently route to the wrong provider).
KNOWN_PROVIDER_PREFIXES = (
    "groq/", "gemini/", "openrouter/", "anthropic/", "openai/", "azure/",
    "bedrock/", "vertex_ai/", "vertex_ai_beta/", "mistral/", "deepseek/",
    "together_ai/", "fireworks_ai/", "cerebras/", "ollama/", "huggingface/",
    "cohere/", "xai/", "gemini/", "deepinfra/", "novita/", "klusterai/",
)


def validate_model_id(value: str) -> str:
    """Reject model ids without a provider prefix (they route to the wrong
    provider and fail with a confusing 401). Raises ValueError."""
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValueError("model id must not be blank")
    if not any(cleaned.startswith(p) for p in KNOWN_PROVIDER_PREFIXES):
        raise ValueError(
            f"model '{cleaned}' needs a provider prefix "
            f"(e.g. groq/{cleaned}, gemini/{cleaned}, openrouter/{cleaned})"
        )
    return cleaned
# Settings row field holding each provider's encrypted key.
PROVIDER_KEY_FIELD = {
    "GROQ_API_KEY": "encrypted_groq_api_key",
    "GEMINI_API_KEY": "encrypted_gemini_api_key",
    "OPENROUTER_API_KEY": "encrypted_openrouter_api_key",
}


def provider_env_for(model_id: str) -> str:
    for prefix, env_var in PROVIDER_ENV.items():
        if str(model_id).startswith(prefix):
            return env_var
    return "OPENROUTER_API_KEY"


def dynamic_dir() -> str:
    return os.environ.get("LITELLM_DYNAMIC_DIR", "/srv/litellm-dynamic")


async def get_settings(session: AsyncSession) -> AILiteLLMSettings | None:
    return await session.get(AILiteLLMSettings, SETTINGS_ID)


def _q(value: str) -> str:
    """Double-quote a YAML scalar (model ids contain `/` and `:`)."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def effective_settings(row: AILiteLLMSettings | None) -> dict:
    """Merge DB row over DEFAULTS. `sources` reports db/default per field."""
    effective = dict(DEFAULTS)
    sources = {key: "default" for key in DEFAULTS}
    effective["openrouter_key_configured"] = False
    effective["groq_key_configured"] = False
    effective["gemini_key_configured"] = False
    if row is not None:
        for key in DEFAULTS:
            value = getattr(row, key)
            if value:
                effective[key] = value
                sources[key] = "db"
        effective["openrouter_key_configured"] = bool(row.encrypted_openrouter_api_key)
        effective["groq_key_configured"] = bool(getattr(row, "encrypted_groq_api_key", None))
        effective["gemini_key_configured"] = bool(getattr(row, "encrypted_gemini_api_key", None))
    effective["sources"] = sources
    return effective


def _tier_default_primary() -> list[str]:
    """Last-resort single tier so the proxy boots with zero keys saved."""
    model_id = str(DEFAULTS["primary_model"])
    return [
        "  - model_name: primary",
        "    litellm_params:",
        f"      model: {_q(model_id)}",
        f"      api_key: os.environ/{provider_env_for(model_id)}",
        "",
    ]


def render_litellm_config(effective: dict) -> str:
    """Render the litellm proxy config.yaml from effective settings.

    Hand-rolled (no pyyaml dependency) — the shape is fixed, only the model
    ids / strategy / timeout vary. Provider keys stay as
    `os.environ/...` references resolved inside the litellm container, and
    those env vars come ONLY from the DB-rendered litellm.env (never .env).

    A tier is rendered when its provider key is configured; an explicitly
    customized model id (differs from the shipped default) is always kept
    so an admin's choice isn't silently dropped. With zero keys configured
    the chain still renders (proxy starts) and every call fails into the
    "no key saved yet" message.
    """
    configured = {
        "GROQ_API_KEY": bool(effective.get("groq_key_configured")),
        "GEMINI_API_KEY": bool(effective.get("gemini_key_configured")),
        "OPENROUTER_API_KEY": bool(effective.get("openrouter_key_configured")),
    }

    def _tier(model_key: str, group: str) -> list[str]:
        model_id = str(effective[model_key])
        env_var = provider_env_for(model_id)
        custom = model_id != DEFAULTS[model_key]
        if not configured.get(env_var, False) and not custom:
            return []
        return [
            f"  - model_name: {group}",
            "    litellm_params:",
            f"      model: {_q(model_id)}",
            f"      api_key: os.environ/{env_var}",
            "",
        ]

    tiers = (
        _tier("primary_model", "primary")
        + _tier("fallback_model", "fallback")
        + _tier("emergency_model", "emergency-fallback")
    )
    if not tiers:
        # No keys anywhere: keep primary so the proxy still starts; every
        # call then fails into the "no key saved yet" message.
        tiers = _tier_default_primary()

    lines = [
        "# Generated from admin Settings > AI / LiteLLM (DB row over shipped defaults).",
        "# Do not edit by hand — rewritten on every settings save.",
        "# The litellm container watches this file and reloads it automatically.",
        "# Provider keys come from the DB-rendered litellm.env only.",
        "",
        "model_list:",
        *tiers,
        "router_settings:",
        f"  routing_strategy: {_q(str(effective['routing_strategy']))}",
        '  fallbacks: [{ "primary": ["fallback", "emergency-fallback"] }]',
        f"  timeout: {int(effective['timeout_seconds'])}",
        "",
        "general_settings:",
        "  master_key: os.environ/LITELLM_MASTER_KEY",
        "",
    ]
    return "\n".join(lines)


def render_litellm_env(keys: dict[str, str]) -> str:
    """Render sourced env with every stored provider key (absent keys omitted
    so compose-level fallback envs, if set, still apply)."""
    lines = [
        "# Written by the Chronarch API from admin Settings > AI / LiteLLM.",
        "# Sourced by the litellm entrypoint on start and every auto-reload.",
    ]
    for env_var in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"):
        if keys.get(env_var):
            lines.append(f"{env_var}={keys[env_var].strip()}")
    return "\n".join(lines) + "\n"


async def _check_key(url: str, key: str, *, bearer: bool = True,
                     params: dict | None = None, provider: str = "provider") -> str:
    """Shared verify-one-key helper: valid / invalid (401/403, or 400 for
    key-in-query APIs) / unknown (network/timeout/unexpected)."""
    import logging

    import httpx

    logger = logging.getLogger(__name__)
    headers = {"Authorization": f"Bearer {key}"} if bearer else {}
    try:
        async with httpx.AsyncClient(timeout=KEY_CHECK_TIMEOUT) as client:
            resp = await client.get(url, headers=headers, params=params)
    except httpx.RequestError as exc:
        logger.warning("%s key check unreachable: %s", provider, exc)
        return "unknown"
    if resp.status_code == 200:
        return "valid"
    if resp.status_code in (400, 401, 403):
        return "invalid"
    logger.warning("%s key check unexpected status %d", provider, resp.status_code)
    return "unknown"


async def check_openrouter_key(key: str) -> str:
    """Verify a candidate key against OpenRouter's auth endpoint.

    Returns "valid" (OpenRouter accepted it), "invalid" (rejected 401/403),
    or "unknown" (network/timeout/unexpected status — caller decides; saving
    anyway with a warning beats blocking an offline admin from configuring
    anything). The key is sent only to OpenRouter, never logged.
    """
    return await _check_key(OPENROUTER_KEY_CHECK_URL, key, provider="OpenRouter")


async def check_groq_key(key: str) -> str:
    """Verify a candidate key against Groq's model list (Bearer auth)."""
    return await _check_key(GROQ_KEY_CHECK_URL, key, provider="Groq")


async def check_gemini_key(key: str) -> str:
    """Verify a candidate key against Google's model list (key query param).
    Google answers 400 for a bad key, hence invalid includes 400."""
    return await _check_key(GEMINI_KEY_CHECK_URL, key, bearer=False,
                            params={"key": key, "pageSize": 1}, provider="Gemini")


async def fetch_provider_models(session: AsyncSession, provider: str) -> list[dict[str, str]]:
    """Live model catalog for a provider's dropdown, using the STORED key —
    the browser never sees keys. Returns [{id, label}] in litellm id form.

    Raises ValueError for unknown providers, RuntimeError when no key is
    stored or the provider call fails (caller maps to 422/502).
    """
    import httpx

    provider = (provider or "").strip().lower()
    if provider == "openrouter":
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get("https://openrouter.ai/api/v1/models")
            resp.raise_for_status()
            out = []
            for m in resp.json().get("data", []):
                mid = m.get("id", "")
                try:
                    free = float((m.get("pricing") or {}).get("prompt", "1") or "1") == 0
                except (ValueError, TypeError):
                    free = False
                out.append({"id": f"openrouter/{mid}",
                            "label": f"{mid}{' (free)' if free else ''}",
                            "free": free})
            out.sort(key=lambda e: (not e.pop("free"), e["id"]))
            return out[:150]
        except httpx.RequestError as exc:
            raise RuntimeError(f"OpenRouter model list unreachable: {exc}")
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"OpenRouter model list failed (HTTP {exc.response.status_code})")

    field = {"groq": "encrypted_groq_api_key", "gemini": "encrypted_gemini_api_key"}.get(provider)
    if field is None:
        raise ValueError(f"unknown provider '{provider}' (want groq, gemini, or openrouter)")
    row = await get_settings(session)
    blob = getattr(row, field, None) if row is not None else None
    if not blob:
        raise RuntimeError(f"No {provider} key saved yet — add one first")
    key = get_cipher().decrypt(blob)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if provider == "groq":
                resp = await client.get(GROQ_KEY_CHECK_URL, headers={"Authorization": f"Bearer {key}"})
                resp.raise_for_status()
                return [{"id": f"groq/{m['id']}", "label": m["id"]}
                        for m in resp.json().get("data", []) if m.get("id")]
            # gemini
            resp = await client.get(GEMINI_KEY_CHECK_URL,
                                    params={"key": key, "pageSize": 100})
            resp.raise_for_status()
            out = []
            for m in resp.json().get("models", []):
                methods = m.get("supportedGenerationMethods") or []
                if "generateContent" not in methods:
                    continue
                mid = str(m.get("name", "")).removeprefix("models/")
                if mid:
                    out.append({"id": f"gemini/{mid}", "label": m.get("displayName") or mid})
            return out
    except httpx.RequestError as exc:
        raise RuntimeError(f"{provider} model list unreachable: {exc}")
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (400, 401, 403):
            raise RuntimeError(f"Saved {provider} key was rejected — re-save it")
        raise RuntimeError(f"{provider} model list failed (HTTP {exc.response.status_code})")


async def apply_ai_settings(session: AsyncSession) -> dict:
    """Re-render the litellm-dynamic volume from current DB settings.

    Writes `config.yaml` always (effective settings); writes `litellm.env`
    with every stored provider key, removing it when none are stored so the
    container falls back to its own env. Returns the effective settings
    dict for the API response.
    """
    row = await get_settings(session)
    effective = effective_settings(row)

    base = dynamic_dir()
    os.makedirs(base, mode=0o700, exist_ok=True)

    config_path = os.path.join(base, CONFIG_FILENAME)
    with open(config_path, "w", encoding="utf-8") as fh:
        fh.write(render_litellm_config(effective))
    os.chmod(config_path, 0o600)

    env_path = os.path.join(base, ENV_FILENAME)
    keys: dict[str, str] = {}
    if row is not None:
        cipher = get_cipher()
        for env_var, field in PROVIDER_KEY_FIELD.items():
            blob = getattr(row, field, None)
            if blob:
                keys[env_var] = cipher.decrypt(blob)
    if keys:
        with open(env_path, "w", encoding="utf-8") as fh:
            fh.write(render_litellm_env(keys))
        os.chmod(env_path, 0o600)
        effective["env_written"] = True
    else:
        try:
            os.remove(env_path)
        except FileNotFoundError:
            pass
        effective["env_written"] = False

    effective["dynamic_dir"] = base
    return effective
