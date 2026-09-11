"""Admin-managed LiteLLM settings (BRD §20.2-20.4).

`AILiteLLMSettings` (set from Settings > AI / LiteLLM) overrides the shipped
defaults below per-field; unset fields fall back to the defaults. The admin
router renders the effective settings into the shared litellm-dynamic volume
(`config.yaml` + `litellm.env`), which the litellm container consumes on
(re)start — so no `.env` edits or image rebuilds are needed to rotate the
OpenRouter key or switch models.
"""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncSession

from .crypto import get_cipher
from .models.ai_settings import AILiteLLMSettings

SETTINGS_ID = "default"

DEFAULTS = {
    "primary_model": "openrouter/meta-llama/llama-3.1-8b-instruct:free",
    "fallback_model": "openrouter/google/gemma-2-9b-it:free",
    "emergency_model": "openrouter/nousresearch/hermes-3-llama-3.1-405b:free",
    "routing_strategy": "simple-shuffle",
    "timeout_seconds": 30,
}

CONFIG_FILENAME = "config.yaml"
ENV_FILENAME = "litellm.env"


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
    key_configured = False
    if row is not None:
        for key in DEFAULTS:
            value = getattr(row, key)
            if value:
                effective[key] = value
                sources[key] = "db"
        key_configured = bool(row.encrypted_openrouter_api_key)
    effective["openrouter_key_configured"] = key_configured
    effective["sources"] = sources
    return effective


def render_litellm_config(effective: dict) -> str:
    """Render the litellm proxy config.yaml from effective settings.

    Hand-rolled (no pyyaml dependency) — the shape is fixed, only the model
    ids / strategy / timeout vary. Provider keys stay as
    `os.environ/...` references resolved inside the litellm container.
    """
    lines = [
        "# Generated from admin Settings > AI / LiteLLM (DB row over shipped defaults).",
        "# Do not edit by hand — rewritten on every settings save.",
        "# Restart the litellm service to apply changes: docker compose restart litellm",
        "",
        "model_list:",
        "  - model_name: primary",
        "    litellm_params:",
        f"      model: {_q(str(effective['primary_model']))}",
        "      api_key: os.environ/OPENROUTER_API_KEY",
        "",
        "  - model_name: fallback",
        "    litellm_params:",
        f"      model: {_q(str(effective['fallback_model']))}",
        "      api_key: os.environ/OPENROUTER_API_KEY",
        "",
        "  - model_name: emergency-fallback",
        "    litellm_params:",
        f"      model: {_q(str(effective['emergency_model']))}",
        "      api_key: os.environ/OPENROUTER_API_KEY",
        "",
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


def render_litellm_env(openrouter_api_key: str) -> str:
    return (
        "# Written by the Chronarch API from admin Settings > AI / LiteLLM.\n"
        "# Sourced by the litellm entrypoint at container start.\n"
        "# Restart the litellm service to apply changes.\n"
        f"OPENROUTER_API_KEY={openrouter_api_key.strip()}\n"
    )


async def apply_ai_settings(session: AsyncSession) -> dict:
    """Re-render the litellm-dynamic volume from current DB settings.

    Writes `config.yaml` always (effective settings); writes `litellm.env`
    only when a key is stored, removing it when cleared so the container
    falls back to its own `OPENROUTER_API_KEY` env. Returns the effective
    settings dict for the API response.
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
    if row is not None and row.encrypted_openrouter_api_key:
        key = get_cipher().decrypt(row.encrypted_openrouter_api_key)
        with open(env_path, "w", encoding="utf-8") as fh:
            fh.write(render_litellm_env(key))
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
