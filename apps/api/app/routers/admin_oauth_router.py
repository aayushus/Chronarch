"""Admin OAuth provider-credential management (BRD §30 "Accounts").

Lets admins configure Google/Microsoft OAuth client IDs and secrets from
Settings > Accounts > Provider credentials instead of requiring server env
vars. Secrets are Fernet-encrypted at rest (same cipher as Account tokens,
BRD §29) and NEVER returned by any endpoint — reads only report
configured/not-configured flags. Env vars remain as fallback (DB wins).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.crypto import get_cipher
from chronarch_core.models.enums import ProviderType
from chronarch_core.models.oauth_config import OAuthProviderConfig
from chronarch_core.models.user import User
from chronarch_core.oauth import list_oauth_configs

from ..admin_guard import require_permission
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/oauth", tags=["admin"])

# Only providers with an OAuth connect flow take client credentials.
OAUTH_PROVIDERS = {ProviderType.GOOGLE, ProviderType.MICROSOFT}


class OAuthConfigOut(BaseModel):
    provider: str
    client_id_configured: bool
    client_secret_configured: bool
    tenant_id: str | None = None


class OAuthConfigUpdate(BaseModel):
    # Omitted or empty string = keep the currently stored value (so the form
    # never has to round-trip secrets back to the browser).
    client_id: str | None = None
    client_secret: str | None = None
    tenant_id: str | None = None


def _to_out(config: OAuthProviderConfig) -> OAuthConfigOut:
    return OAuthConfigOut(
        provider=config.provider.value,
        client_id_configured=bool(config.encrypted_client_id),
        client_secret_configured=bool(config.encrypted_client_secret),
        tenant_id=config.tenant_id,
    )


def _parse_provider(provider: str) -> ProviderType:
    try:
        parsed = ProviderType(provider)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown provider: {provider}")
    if parsed not in OAUTH_PROVIDERS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Provider '{provider}' does not use OAuth client credentials"
        )
    return parsed


@router.get("", response_model=list[OAuthConfigOut])
async def list_configs(
    _user: User = Depends(require_permission("oauth.view")), session: AsyncSession = Depends(get_db_session)
):
    return [_to_out(c) for c in await list_oauth_configs(session)]


@router.get("/{provider}", response_model=OAuthConfigOut)
async def get_config(
    provider: str, _user: User = Depends(require_permission("oauth.view")), session: AsyncSession = Depends(get_db_session)
):
    config = await session.get(OAuthProviderConfig, _parse_provider(provider))
    if config is None:
        return OAuthConfigOut(provider=provider, client_id_configured=False, client_secret_configured=False)
    return _to_out(config)


@router.put("/{provider}", response_model=OAuthConfigOut)
async def upsert_config(
    provider: str,
    body: OAuthConfigUpdate,
    _user: User = Depends(require_permission("oauth.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    parsed = _parse_provider(provider)
    config = await session.get(OAuthProviderConfig, parsed)
    if config is None:
        config = OAuthProviderConfig(provider=parsed)
        session.add(config)

    cipher = get_cipher()
    if body.client_id:
        config.encrypted_client_id = cipher.encrypt(body.client_id.strip())
    if body.client_secret:
        config.encrypted_client_secret = cipher.encrypt(body.client_secret.strip())
    if body.tenant_id is not None:
        config.tenant_id = body.tenant_id.strip() or None
    await session.flush()
    return _to_out(config)


@router.delete("/{provider}", response_model=OAuthConfigOut)
async def clear_config(
    provider: str, _user: User = Depends(require_permission("oauth.view")), session: AsyncSession = Depends(get_db_session)
):
    config = await session.get(OAuthProviderConfig, _parse_provider(provider))
    if config is not None:
        await session.delete(config)
        await session.flush()
    return OAuthConfigOut(provider=provider, client_id_configured=False, client_secret_configured=False)
