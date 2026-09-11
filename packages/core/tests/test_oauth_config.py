"""Tests for UI-managed OAuth provider credentials (BRD §30).

Precedence under test: admin-configured DB row wins, env vars are the
fallback, and a clear error names what's missing when neither is set.
"""

import pytest

from chronarch_core import oauth as oauth_module
from chronarch_core.crypto import get_cipher
from chronarch_core.models.enums import ProviderType
from chronarch_core.models.oauth_config import OAuthProviderConfig


@pytest.fixture
def fernet_key(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    get_cipher.cache_clear()
    yield
    get_cipher.cache_clear()


@pytest.fixture
def clean_google_env(monkeypatch):
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)


async def _store(session, client_id="db-id", client_secret="db-secret"):
    cipher = get_cipher()
    config = OAuthProviderConfig(
        provider=ProviderType.GOOGLE,
        encrypted_client_id=cipher.encrypt(client_id),
        encrypted_client_secret=cipher.encrypt(client_secret),
    )
    session.add(config)
    await session.flush()
    return config


async def test_db_config_resolves_plaintext(session, fernet_key, clean_google_env):
    await _store(session)

    client_id, client_secret = await oauth_module.resolve_google_credentials(session)

    assert (client_id, client_secret) == ("db-id", "db-secret")


async def test_db_wins_over_env(session, fernet_key, monkeypatch, clean_google_env):
    await _store(session, client_id="db-id", client_secret="db-secret")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "env-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "env-secret")

    assert await oauth_module.resolve_google_credentials(session) == ("db-id", "db-secret")


async def test_env_fallback_without_db_row(session, fernet_key, monkeypatch, clean_google_env):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "env-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "env-secret")

    assert await oauth_module.resolve_google_credentials(session) == ("env-id", "env-secret")


async def test_missing_everywhere_raises_with_ui_pointer(session, fernet_key, clean_google_env):
    with pytest.raises(RuntimeError, match="Settings > Accounts"):
        await oauth_module.resolve_google_credentials(session)


async def test_secrets_never_stored_plaintext(session, fernet_key, clean_google_env):
    config = await _store(session, client_id="db-id", client_secret="super-secret-value")

    assert config.encrypted_client_id != b"db-id"
    assert b"super-secret-value" not in (config.encrypted_client_secret or b"")
