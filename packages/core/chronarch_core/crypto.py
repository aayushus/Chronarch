"""Envelope encryption for OAuth tokens at rest (BRD §29).

MVP default: a single local key from the `TOKEN_ENCRYPTION_KEY` env var
(Fernet). Self-hosters can swap `Cipher` for a KMS-backed implementation
(AWS/GCP KMS, age/sops) without touching callers — every caller only ever
sees `encrypt`/`decrypt`.
"""

import hashlib
import os
from functools import lru_cache

from cryptography.fernet import Fernet


def hash_mcp_key(raw_key: str) -> str:
    """SHA-256 hash of a raw MCP API key. Shared by the issuing side
    (apps/api admin credential creation) and the verifying side
    (apps/mcp request auth) so they can never drift out of sync."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


class TokenCipher:
    def __init__(self, key: bytes):
        self._fernet = Fernet(key)

    def encrypt(self, plaintext: str) -> bytes:
        return self._fernet.encrypt(plaintext.encode("utf-8"))

    def decrypt(self, ciphertext: bytes) -> str:
        return self._fernet.decrypt(ciphertext).decode("utf-8")


@lru_cache
def get_cipher() -> TokenCipher:
    key = os.environ.get("TOKEN_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is not set. Generate one with: "
            "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    return TokenCipher(key.encode("utf-8"))


def reencrypt(ciphertext: bytes, old_cipher: TokenCipher, new_cipher: TokenCipher) -> bytes:
    """Decrypt with old_cipher and re-encrypt with new_cipher."""
    plaintext = old_cipher.decrypt(ciphertext)
    return new_cipher.encrypt(plaintext)


async def rotate_all_encrypted_data(
    session,
    old_key: str,
    new_key: str,
) -> dict[str, int]:
    """Re-encrypt all stored secrets from `old_key` to `new_key`.

    Atomically migrates:
    - Account.encrypted_access_token & encrypted_refresh_token
    - AILiteLLMSettings.encrypted_openrouter_api_key
    - OAuthProviderConfig.encrypted_client_secret

    Returns a dict with counts of re-encrypted fields.
    """
    from sqlalchemy import select
    from .models.account import Account
    from .models.ai_settings import AILiteLLMSettings
    from .models.oauth_config import OAuthProviderConfig

    old_cipher = TokenCipher(old_key.encode("utf-8"))
    new_cipher = TokenCipher(new_key.encode("utf-8"))

    counts = {
        "accounts_tokens": 0,
        "ai_settings_keys": 0,
        "oauth_secrets": 0,
    }

    # 1. Accounts
    accounts = list((await session.execute(select(Account))).scalars())
    for acct in accounts:
        changed = False
        if acct.encrypted_access_token:
            acct.encrypted_access_token = reencrypt(acct.encrypted_access_token, old_cipher, new_cipher)
            changed = True
        if acct.encrypted_refresh_token:
            acct.encrypted_refresh_token = reencrypt(acct.encrypted_refresh_token, old_cipher, new_cipher)
            changed = True
        if changed:
            counts["accounts_tokens"] += 1

    # 2. AI Settings (one encrypted key per provider)
    ai_settings = list((await session.execute(select(AILiteLLMSettings))).scalars())
    for setting in ai_settings:
        for field in ("encrypted_openrouter_api_key", "encrypted_groq_api_key",
                      "encrypted_gemini_api_key"):
            if getattr(setting, field, None):
                setattr(setting, field, reencrypt(
                    getattr(setting, field), old_cipher, new_cipher
                ))
                counts["ai_settings_keys"] += 1

    # 3. OAuth Provider Configs
    oauth_configs = list((await session.execute(select(OAuthProviderConfig))).scalars())
    for cfg in oauth_configs:
        changed = False
        if cfg.encrypted_client_id:
            cfg.encrypted_client_id = reencrypt(cfg.encrypted_client_id, old_cipher, new_cipher)
            changed = True
        if cfg.encrypted_client_secret:
            cfg.encrypted_client_secret = reencrypt(cfg.encrypted_client_secret, old_cipher, new_cipher)
            changed = True
        if changed:
            counts["oauth_secrets"] += 1

    await session.flush()
    return counts

