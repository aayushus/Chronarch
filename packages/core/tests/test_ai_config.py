"""Tests for UI-managed LiteLLM settings (BRD §20.2-20.4)."""

import os

import pytest

from chronarch_core import ai_config  # noqa: F401 — import side-effect check
from chronarch_core.ai_config import (
    DEFAULTS,
    apply_ai_settings,
    effective_settings,
    render_litellm_config,
)
from chronarch_core.crypto import get_cipher
from chronarch_core.models.ai_settings import AILiteLLMSettings


@pytest.fixture
def fernet_key(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    get_cipher.cache_clear()
    yield
    get_cipher.cache_clear()


def test_effective_defaults_without_row():
    effective = effective_settings(None)

    for key, value in DEFAULTS.items():
        assert effective[key] == value
    assert effective["sources"] == {key: "default" for key in DEFAULTS}
    assert effective["openrouter_key_configured"] is False


def test_db_row_overrides_per_field():
    row = AILiteLLMSettings(id="default", primary_model="openrouter/custom/model", timeout_seconds=60)

    effective = effective_settings(row)

    assert effective["primary_model"] == "openrouter/custom/model"
    assert effective["sources"]["primary_model"] == "db"
    assert effective["fallback_model"] == DEFAULTS["fallback_model"]
    assert effective["sources"]["fallback_model"] == "default"
    assert effective["timeout_seconds"] == 60


def test_rendered_config_carries_effective_values():
    row = AILiteLLMSettings(id="default", primary_model="openrouter/custom/model")
    rendered = render_litellm_config(effective_settings(row))

    assert 'model: "openrouter/custom/model"' in rendered
    assert f'model: "{DEFAULTS["fallback_model"]}"' in rendered
    assert rendered.count("api_key: os.environ/OPENROUTER_API_KEY") == 3
    assert f"timeout: {DEFAULTS['timeout_seconds']}" in rendered
    assert "master_key: os.environ/LITELLM_MASTER_KEY" in rendered


async def test_apply_writes_config_and_env(session, fernet_key, monkeypatch, tmp_path):
    monkeypatch.setenv("LITELLM_DYNAMIC_DIR", str(tmp_path))
    cipher = get_cipher()
    session.add(
        AILiteLLMSettings(
            id="default",
            encrypted_openrouter_api_key=cipher.encrypt("sk-or-test-key"),
            routing_strategy="least-busy",
        )
    )
    await session.flush()

    effective = await apply_ai_settings(session)

    assert effective["env_written"] is True
    assert effective["routing_strategy"] == "least-busy"
    env_text = (tmp_path / "litellm.env").read_text()
    assert "OPENROUTER_API_KEY=sk-or-test-key" in env_text
    config_text = (tmp_path / "config.yaml").read_text()
    assert "least-busy" in config_text
    assert "sk-or-test-key" not in config_text  # key never lands in the yaml
    assert os.stat(tmp_path / "litellm.env").st_mode & 0o777 == 0o600


async def test_apply_without_key_removes_env_file(session, monkeypatch, tmp_path):
    monkeypatch.setenv("LITELLM_DYNAMIC_DIR", str(tmp_path))
    stale = tmp_path / "litellm.env"
    stale.write_text("OPENROUTER_API_KEY=stale\n")
    session.add(AILiteLLMSettings(id="default", primary_model="openrouter/custom/m"))
    await session.flush()

    effective = await apply_ai_settings(session)

    assert effective["env_written"] is False
    assert not stale.exists()
    assert (tmp_path / "config.yaml").exists()
