"""Microsoft 365 / Outlook account connect flow (BR-CAL-002, BRD §30 "Accounts").
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.connectors.microsoft import (
    build_consent_url,
    exchange_code,
    fetch_userinfo,
)
from chronarch_core.crypto import get_cipher
from chronarch_core.models.account import Account
from chronarch_core.models.enums import ProviderType, UserRole
from chronarch_core.models.user import User
from chronarch_core.oauth import resolve_microsoft_credentials
from chronarch_core.sync.microsoft_sync import sync_microsoft_account

from ..admin_guard import require_permission
from ..config import APP_BASE_URL
from ..deps import get_db_session
from ..oauth_state import sign_oauth_state, verify_oauth_state

router = APIRouter(prefix="/api/v1/admin/accounts/microsoft", tags=["admin"])
logger = logging.getLogger(__name__)

REDIRECT_URI = f"{APP_BASE_URL}/api/v1/admin/accounts/microsoft/callback"


class ConnectUrlOut(BaseModel):
    url: str


@router.get("/connect-url", response_model=ConnectUrlOut)
async def get_connect_url(
    admin: User = Depends(require_permission("oauth.view")),
    session: AsyncSession = Depends(get_db_session),
):
    try:
        client_id, _client_secret, tenant_id = await resolve_microsoft_credentials(session)
        url = build_consent_url(
            REDIRECT_URI,
            state=sign_oauth_state(admin.id),
            client_id=client_id,
            tenant_id=tenant_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    return ConnectUrlOut(url=url)


@router.get("/callback")
async def callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: AsyncSession = Depends(get_db_session),
):
    settings_url = f"{APP_BASE_URL}/settings"

    if error:
        return RedirectResponse(f"{settings_url}?accounts_error={error}")
    if not code or not state:
        return RedirectResponse(f"{settings_url}?accounts_error=missing_code_or_state")

    try:
        admin_user_id = verify_oauth_state(state)
    except ValueError:
        return RedirectResponse(f"{settings_url}?accounts_error=invalid_state")

    admin = await session.get(User, admin_user_id)
    if admin is None or admin.role != UserRole.ADMIN:
        return RedirectResponse(f"{settings_url}?accounts_error=unauthorized")

    try:
        client_id, client_secret, tenant_id = await resolve_microsoft_credentials(session)
        tokens = await exchange_code(
            code,
            REDIRECT_URI,
            client_id=client_id,
            client_secret=client_secret,
            tenant_id=tenant_id,
        )
        userinfo = await fetch_userinfo(tokens["access_token"])
        email = userinfo.get("mail") or userinfo.get("userPrincipalName")
        if not email:
            raise ValueError("Microsoft account profile did not return an email or userPrincipalName")

        cipher = get_cipher()
        existing = (
            await session.execute(
                select(Account).where(
                    Account.provider == ProviderType.MICROSOFT,
                    Account.provider_account_email == email,
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            account = Account(
                owner_user_id=admin.id,
                provider=ProviderType.MICROSOFT,
                provider_account_email=email,
                provider_account_id=userinfo.get("id", email),
            )
            session.add(account)
        else:
            account = existing

        account.encrypted_access_token = cipher.encrypt(tokens["access_token"])
        if tokens.get("refresh_token"):
            account.encrypted_refresh_token = cipher.encrypt(tokens["refresh_token"])
        await session.flush()

        stats = await sync_microsoft_account(session, account)
        await session.commit()
        logger.info("Connected Microsoft account %s: %s", email, stats)
        return RedirectResponse(f"{settings_url}?accounts_connected=microsoft")

    except Exception:
        logger.exception("Microsoft OAuth callback failed")
        await session.rollback()
        return RedirectResponse(f"{settings_url}?accounts_error=connect_failed")
