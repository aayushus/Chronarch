"""Tests for UI-managed LiteLLM settings (BRD §20.2-20.4)."""

import os

import pytest

from chronarch_core import ai_config  # noqa: F401 — import side-effect check
from chronarch_core.ai_config import (
    DEFAULTS,
    apply_ai_settings,
    check_gemini_key,
    check_groq_key,
    check_openrouter_key,
    effective_settings,
    provider_env_for,
    render_litellm_config,
    render_litellm_env,
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


def test_rendered_config_carries_effective_values(fernet_key):
    from chronarch_core.crypto import get_cipher

    row = AILiteLLMSettings(
        id="default", primary_model="openrouter/custom/model",
        encrypted_openrouter_api_key=get_cipher().encrypt("sk-or-x"),
        encrypted_gemini_api_key=get_cipher().encrypt("AIza-x"),
    )
    rendered = render_litellm_config(effective_settings(row))

    assert 'model: "openrouter/custom/model"' in rendered
    assert f'model: "{DEFAULTS["fallback_model"]}"' in rendered
    # Per-model provider envs: custom openrouter primary, gemini fallback default.
    assert "api_key: os.environ/OPENROUTER_API_KEY" in rendered
    assert "api_key: os.environ/GEMINI_API_KEY" in rendered
    assert f"timeout: {DEFAULTS['timeout_seconds']}" in rendered
    assert "master_key: os.environ/LITELLM_MASTER_KEY" in rendered


def test_render_skips_tiers_without_keys(fernet_key):
    # No keys stored and no custom models: only the boot tier renders, so
    # the proxy starts and calls fail into the "no key saved" message.
    from chronarch_core.ai_config import render_litellm_config, effective_settings

    rendered = render_litellm_config(effective_settings(None))
    assert rendered.count("model_name:") == 1
    assert "model_name: primary" in rendered


def test_render_keeps_custom_model_without_key(fernet_key):
    # Explicit admin choice is never silently dropped, even unkeyed.
    from chronarch_core.ai_config import render_litellm_config, effective_settings

    row = AILiteLLMSettings(id="default", emergency_model="gemini/gemini-2.5-pro")
    rendered = render_litellm_config(effective_settings(row))
    assert "emergency-fallback" in rendered
    assert "gemini-2.5-pro" in rendered


def test_provider_env_mapping():
    assert provider_env_for("groq/llama-3.3-70b-versatile") == "GROQ_API_KEY"
    assert provider_env_for("gemini/gemini-2.5-flash") == "GEMINI_API_KEY"
    assert provider_env_for("openrouter/x/y:free") == "OPENROUTER_API_KEY"
    assert provider_env_for("weird-model") == "OPENROUTER_API_KEY"


def test_effective_reports_per_provider_keys(fernet_key):
    cipher = get_cipher()
    row = AILiteLLMSettings(id="default", encrypted_groq_api_key=cipher.encrypt("gsk-test"))
    effective = effective_settings(row)
    assert effective["groq_key_configured"] is True
    assert effective["gemini_key_configured"] is False
    assert effective["openrouter_key_configured"] is False


def test_render_env_writes_only_stored_keys():
    text = render_litellm_env({"GROQ_API_KEY": "gsk-test"})
    assert "GROQ_API_KEY=gsk-test" in text
    assert "GEMINI_API_KEY" not in text
    assert "OPENROUTER_API_KEY" not in text


async def test_apply_writes_config_and_env(session, fernet_key, monkeypatch, tmp_path):
    monkeypatch.setenv("LITELLM_DYNAMIC_DIR", str(tmp_path))
    cipher = get_cipher()
    session.add(
        AILiteLLMSettings(
            id="default",
            encrypted_openrouter_api_key=cipher.encrypt("sk-or-test-key"),
            encrypted_groq_api_key=cipher.encrypt("gsk-test-key"),
            routing_strategy="least-busy",
        )
    )
    await session.flush()

    effective = await apply_ai_settings(session)

    assert effective["env_written"] is True
    assert effective["routing_strategy"] == "least-busy"
    assert effective["groq_key_configured"] is True
    env_text = (tmp_path / "litellm.env").read_text()
    assert "OPENROUTER_API_KEY=sk-or-test-key" in env_text
    assert "GROQ_API_KEY=gsk-test-key" in env_text
    assert "GEMINI_API_KEY" not in env_text
    config_text = (tmp_path / "config.yaml").read_text()
    assert "least-busy" in config_text
    assert "sk-or-test-key" not in config_text  # key never lands in the yaml
    assert "gsk-test-key" not in config_text
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


class _FakeClient:
    def __init__(self, status_code: int | None, exc: Exception | None = None, json_data: dict | None = None):
        self._status_code = status_code
        self._exc = exc
        self._json_data = json_data or {}
        self.seen_url: str | None = None
        self.seen_auth: str | None = None
        self.seen_params = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None, params=None):
        import httpx

        self.seen_url = url
        self.seen_auth = (headers or {}).get("Authorization")
        self.seen_params = params
        if self._exc is not None:
            raise self._exc
        # Real Response: .json()/.raise_for_status() behave exactly like
        # production, including HTTPStatusError with .response set.
        return httpx.Response(self._status_code, json=self._json_data,
                              request=httpx.Request("GET", url))


async def test_check_openrouter_key_valid(monkeypatch):
    import httpx

    fake = _FakeClient(200)
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)

    assert await check_openrouter_key("sk-or-good") == "valid"
    assert fake.seen_url == "https://openrouter.ai/api/v1/auth/key"
    assert fake.seen_auth == "Bearer sk-or-good"


async def test_check_openrouter_key_invalid(monkeypatch):
    import httpx

    for status_code in (401, 403):
        fake = _FakeClient(status_code)
        monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)
        assert await check_openrouter_key("sk-or-bad") == "invalid"


async def test_check_openrouter_key_unknown_on_network_error(monkeypatch):
    import httpx

    fake = _FakeClient(None, exc=httpx.ConnectError("dns down"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)
    assert await check_openrouter_key("sk-or-anything") == "unknown"


async def test_check_openrouter_key_unknown_on_unexpected_status(monkeypatch):
    import httpx

    fake = _FakeClient(500)
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)
    assert await check_openrouter_key("sk-or-anything") == "unknown"


async def test_check_groq_key_valid_and_invalid(monkeypatch):
    import httpx

    fake = _FakeClient(200)
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)
    assert await check_groq_key("gsk-good") == "valid"
    assert fake.seen_auth == "Bearer gsk-good"
    assert "groq.com" in (fake.seen_url or "")

    fake401 = _FakeClient(401)
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake401)
    assert await check_groq_key("gsk-bad") == "invalid"


async def test_check_gemini_key_valid_and_invalid(monkeypatch):
    import httpx

    fake = _FakeClient(200)
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)
    assert await check_gemini_key("AIza-good") == "valid"
    assert fake.seen_auth is None  # key travels as a query param, not a header
    assert "googleapis.com" in (fake.seen_url or "")

    fake400 = _FakeClient(400)
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake400)
    assert await check_gemini_key("AIza-bad") == "invalid"


async def test_fetch_groq_models_live_shape(session, fernet_key, monkeypatch):
    import httpx

    from chronarch_core.ai_config import fetch_provider_models
    from chronarch_core.models.ai_settings import AILiteLLMSettings
    from chronarch_core.crypto import get_cipher

    session.add(AILiteLLMSettings(
        id="default", encrypted_groq_api_key=get_cipher().encrypt("gsk-test")))
    await session.flush()

    fake = _FakeClient(200, json_data={"data": [{"id": "llama-x"}, {"id": "gpt-oss-20b"}]})
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)
    models = await fetch_provider_models(session, "groq")
    assert models == [{"id": "groq/llama-x", "label": "llama-x"},
                      {"id": "groq/gpt-oss-20b", "label": "gpt-oss-20b"}]
    assert fake.seen_auth == "Bearer gsk-test"


async def test_fetch_gemini_models_filters_and_prefixes(session, fernet_key, monkeypatch):
    import httpx

    from chronarch_core.ai_config import fetch_provider_models
    from chronarch_core.models.ai_settings import AILiteLLMSettings
    from chronarch_core.crypto import get_cipher

    session.add(AILiteLLMSettings(
        id="default", encrypted_gemini_api_key=get_cipher().encrypt("AIza-test")))
    await session.flush()

    fake = _FakeClient(200, json_data={"models": [
        {"name": "models/gemini-3.8-pro", "displayName": "Gemini 3.8 Pro",
         "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/embedding-001", "displayName": "Embedding",
         "supportedGenerationMethods": ["embedContent"]},
    ]})
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: fake)
    models = await fetch_provider_models(session, "gemini")
    assert models == [{"id": "gemini/gemini-3.8-pro", "label": "Gemini 3.8 Pro"}]
    assert fake.seen_auth is None


async def test_fetch_models_unknown_provider_and_missing_key(session):
    import pytest as _pytest

    from chronarch_core.ai_config import fetch_provider_models

    with _pytest.raises(ValueError):
        await fetch_provider_models(session, "cerebras")
    with _pytest.raises(RuntimeError, match="No groq key"):
        await fetch_provider_models(session, "groq")


def test_validate_model_id():
    from chronarch_core.ai_config import validate_model_id

    assert validate_model_id("groq/openai/gpt-oss-20b") == "groq/openai/gpt-oss-20b"
    assert validate_model_id("gemini/gemini-2.5-flash") == "gemini/gemini-2.5-flash"
    with pytest.raises(ValueError):
        validate_model_id("gpt-oss-20b")
    with pytest.raises(ValueError):
        validate_model_id("  ")
