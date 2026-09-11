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
