"""Resolve provider OAuth client credentials (BRD §30).

Precedence: admin-configured DB row (`OAuthProviderConfig`, set from
Settings > Accounts) wins; server env vars are the fallback. This keeps
self-hosters who prefer env-only deploys working while letting everyone else
configure credentials entirely from the UI.
"""

from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .crypto import get_cipher
from .models.enums import ProviderType
from .models.oauth_config import OAuthProviderConfig


async def get_oauth_config(session: AsyncSession, provider: ProviderType) -> OAuthProviderConfig | None:
    return await session.get(OAuthProviderConfig, provider)


def _decrypt_if_present(value: bytes | None) -> str | None:
    if not value:
        return None
    return get_cipher().decrypt(value) or None


async def resolve_google_credentials(session: AsyncSession) -> tuple[str, str]:
    """Return (client_id, client_secret) for Google OAuth.

    Raises RuntimeError naming what's missing when neither the DB config nor
    the env vars provide a value — the admin router maps this to 503 with a
    pointer at the Settings > Accounts form.
    """
    config = await get_oauth_config(session, ProviderType.GOOGLE)
    client_id = _decrypt_if_present(config.encrypted_client_id) if config else None
    client_secret = _decrypt_if_present(config.encrypted_client_secret) if config else None

    client_id = client_id or os.environ.get("GOOGLE_OAUTH_CLIENT_ID") or None
    client_secret = client_secret or os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET") or None

    missing = [
        name
        for name, value in (("GOOGLE_OAUTH_CLIENT_ID", client_id), ("GOOGLE_OAUTH_CLIENT_SECRET", client_secret))
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"{' and '.join(missing)} is not set — configure it under Settings > Accounts "
            "> Provider credentials, or via env vars."
        )
    assert client_id is not None and client_secret is not None
    return client_id, client_secret


async def resolve_microsoft_credentials(session: AsyncSession) -> tuple[str, str, str]:
    """Return (client_id, client_secret, tenant_id) for Microsoft Graph OAuth.

    Raises RuntimeError when credentials are not configured.
    """
    config = await get_oauth_config(session, ProviderType.MICROSOFT)
    client_id = _decrypt_if_present(config.encrypted_client_id) if config else None
    client_secret = _decrypt_if_present(config.encrypted_client_secret) if config else None
    tenant_id = (
        (config.tenant_id if config and config.tenant_id else None)
        or os.environ.get("MICROSOFT_TENANT_ID")
        or "common"
    )

    client_id = client_id or os.environ.get("MICROSOFT_OAUTH_CLIENT_ID") or None
    client_secret = client_secret or os.environ.get("MICROSOFT_OAUTH_CLIENT_SECRET") or None

    missing = [
        name
        for name, value in (
            ("MICROSOFT_OAUTH_CLIENT_ID", client_id),
            ("MICROSOFT_OAUTH_CLIENT_SECRET", client_secret),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"{' and '.join(missing)} is not set — configure it under Settings > Accounts "
            "> Provider credentials, or via env vars."
        )
    assert client_id is not None and client_secret is not None
    return client_id, client_secret, tenant_id


async def list_oauth_configs(session: AsyncSession) -> list[OAuthProviderConfig]:
    return list((await session.execute(select(OAuthProviderConfig))).scalars())

