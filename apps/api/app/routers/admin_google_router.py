"""Google account connect flow (BR-CAL-001, BRD §30 "Accounts").

Flow: the Settings > Accounts page calls GET .../connect-url (authenticated
like any other admin endpoint) to get a consent URL, then does a full-page
redirect to it. Google eventually redirects the browser back to
GET .../callback — a plain navigation with no Authorization header, so that
endpoint authenticates via the signed `state` param instead (see
app/oauth_state.py) rather than the usual get_current_user dependency.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.connectors.google import build_consent_url, exchange_code, fetch_userinfo
from chronarch_core.crypto import get_cipher
from chronarch_core.models.account import Account
from chronarch_core.models.enums import ProviderType, UserRole
from chronarch_core.models.user import User
from chronarch_core.oauth import resolve_google_credentials
from chronarch_core.sync import sync_google_account

from ..admin_guard import require_permission
from ..config import APP_BASE_URL
from ..deps import get_db_session
from ..oauth_state import sign_oauth_state, verify_oauth_state

router = APIRouter(prefix="/api/v1/admin/accounts/google", tags=["admin"])
logger = logging.getLogger(__name__)

async def _ensure_push_best_effort(session, account) -> None:
    """Arm push subscriptions after connect. Never fails the OAuth flow:
    polling covers every deployment push can't reach."""
    import logging

    from chronarch_core.sync.webhooks import ensure_account_webhooks

    try:
        result = await ensure_account_webhooks(session, account, APP_BASE_URL)
        if result.get("skipped"):
            logging.getLogger(__name__).info("Push not armed for account %s: %s", account.id, result["skipped"])
    except Exception:
        logging.getLogger(__name__).exception("Push ensure failed for account %s", account.id)

REDIRECT_URI = f"{APP_BASE_URL}/api/v1/admin/accounts/google/callback"


class ConnectUrlOut(BaseModel):
    url: str


@router.get("/connect-url", response_model=ConnectUrlOut)
async def get_connect_url(
    admin: User = Depends(require_permission("oauth.view")),
    session: AsyncSession = Depends(get_db_session),
):
    try:
        client_id, _client_secret = await resolve_google_credentials(session)
        url = build_consent_url(REDIRECT_URI, state=sign_oauth_state(admin.id), client_id=client_id)
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
        client_id, client_secret = await resolve_google_credentials(session)
        tokens = await exchange_code(code, REDIRECT_URI, client_id=client_id, client_secret=client_secret)
        userinfo = await fetch_userinfo(tokens["access_token"])
        email = userinfo["email"]

        cipher = get_cipher()
        existing = (
            await session.execute(
                select(Account).where(
                    Account.provider == ProviderType.GOOGLE, Account.provider_account_email == email
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            account = Account(
                owner_user_id=admin.id,
                provider=ProviderType.GOOGLE,
                provider_account_email=email,
                provider_account_id=userinfo.get("id", email),
            )
            session.add(account)
        else:
            account = existing

        account.encrypted_access_token = cipher.encrypt(tokens["access_token"])
        if tokens.get("refresh_token"):
            # Google only returns a refresh_token on the first consent (or
            # with prompt=consent, which we always pass) — don't overwrite
            # a previously stored one with nothing on a re-auth that omits it.
            account.encrypted_refresh_token = cipher.encrypt(tokens["refresh_token"])
        await session.flush()

        stats = await sync_google_account(session, account)
        await _ensure_push_best_effort(session, account)
        await session.commit()
        logger.info("Connected Google account %s: %s", email, stats)
        return RedirectResponse(f"{settings_url}?accounts_connected=google")

    except Exception:
        logger.exception("Google OAuth callback failed")
        await session.rollback()
        return RedirectResponse(f"{settings_url}?accounts_error=connect_failed")
