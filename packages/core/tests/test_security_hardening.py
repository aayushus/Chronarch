import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from chronarch_core.crypto import TokenCipher, rotate_all_encrypted_data
from chronarch_core.models.account import Account
from chronarch_core.models.ai_settings import AILiteLLMSettings
from chronarch_core.models.audit import AuditEntry, AuditLogImmutableError
from chronarch_core.models.enums import ActorType, AuditAction, ProviderType
from chronarch_core.models.oauth_config import OAuthProviderConfig


async def test_audit_entry_immutable_prevents_update(session):
    entry = AuditEntry(
        actor_type=ActorType.EXECUTIVE_UI,
        action=AuditAction.CREATE_EVENT,
        detail={"title": "Original"},
    )
    session.add(entry)
    await session.flush()

    entry.detail = {"title": "Modified"}
    with pytest.raises(AuditLogImmutableError, match="cannot be modified"):
        await session.flush()


async def test_audit_entry_immutable_prevents_delete(session):
    entry = AuditEntry(
        actor_type=ActorType.EXECUTIVE_UI,
        action=AuditAction.CREATE_EVENT,
        detail={"title": "To be preserved"},
    )
    session.add(entry)
    await session.flush()

    await session.delete(entry)
    with pytest.raises(AuditLogImmutableError, match="cannot be deleted"):
        await session.flush()


async def test_rotate_all_encrypted_data(session):
    old_key = Fernet.generate_key().decode()
    new_key = Fernet.generate_key().decode()

    old_cipher = TokenCipher(old_key.encode())
    new_cipher = TokenCipher(new_key.encode())

    # 1. Seed account with old-key tokens
    acct = Account(
        id="acct-rotate",
        owner_user_id="u1",
        provider=ProviderType.GOOGLE,
        provider_account_email="test@example.com",
        provider_account_id="google-user-123",
        encrypted_access_token=old_cipher.encrypt("google-access-secret"),
        encrypted_refresh_token=old_cipher.encrypt("google-refresh-secret"),
    )

    # 2. Seed AI settings with old-key openrouter token
    ai_setting = AILiteLLMSettings(
        id="default",
        encrypted_openrouter_api_key=old_cipher.encrypt("sk-openrouter-secret"),
    )

    # 3. OAuth config with old-key client id and secret
    oauth_cfg = OAuthProviderConfig(
        provider=ProviderType.GOOGLE,
        encrypted_client_id=old_cipher.encrypt("client-id-123"),
        encrypted_client_secret=old_cipher.encrypt("client-secret-abc"),
    )

    session.add_all([acct, ai_setting, oauth_cfg])
    await session.flush()

    # Verify decryption with old key works before rotation
    assert old_cipher.decrypt(acct.encrypted_access_token) == "google-access-secret"
    assert old_cipher.decrypt(ai_setting.encrypted_openrouter_api_key) == "sk-openrouter-secret"
    assert old_cipher.decrypt(oauth_cfg.encrypted_client_id) == "client-id-123"
    assert old_cipher.decrypt(oauth_cfg.encrypted_client_secret) == "client-secret-abc"

    # Execute rotation
    counts = await rotate_all_encrypted_data(session, old_key=old_key, new_key=new_key)
    assert counts["accounts_tokens"] == 1
    assert counts["ai_settings_keys"] == 1
    assert counts["oauth_secrets"] == 1

    # Reload from session
    await session.refresh(acct)
    await session.refresh(ai_setting)
    await session.refresh(oauth_cfg)

    # Old key should now fail to decrypt
    with pytest.raises(Exception):
        old_cipher.decrypt(acct.encrypted_access_token)

    # New key should cleanly decrypt all values
    assert new_cipher.decrypt(acct.encrypted_access_token) == "google-access-secret"
    assert new_cipher.decrypt(acct.encrypted_refresh_token) == "google-refresh-secret"
    assert new_cipher.decrypt(ai_setting.encrypted_openrouter_api_key) == "sk-openrouter-secret"
    assert new_cipher.decrypt(oauth_cfg.encrypted_client_id) == "client-id-123"
    assert new_cipher.decrypt(oauth_cfg.encrypted_client_secret) == "client-secret-abc"
