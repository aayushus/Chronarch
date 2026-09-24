"""CalDAV account connect flow (BR-CAL-003, BRD §30 "Accounts").

Unlike Google/Microsoft OAuth, CalDAV uses server URL + username +
password (Basic auth). This router validates the credentials with a
PROPFIND discovery call, stores the password encrypted (BRD §29), then
runs the same backfill sync as the other providers.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.connectors.caldav import CalDAVConnector
from chronarch_core.ics import _validate_feed_url
from chronarch_core.crypto import get_cipher
from chronarch_core.models.account import Account
from chronarch_core.models.enums import ProviderType
from chronarch_core.models.user import User
from chronarch_core.sync.caldav_sync import sync_caldav_account

from ..admin_guard import require_permission
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/accounts/caldav", tags=["admin"])
logger = logging.getLogger(__name__)


class CaldavConnect(BaseModel):
    server_url: str
    username: str
    password: str
    email_label: str | None = None

    @field_validator("server_url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not (v.startswith("https://") or v.startswith("http://")):
            raise ValueError("server_url must start with https:// or http://")
        if len(v) > 2000:
            raise ValueError("server_url is too long")
        return v


class CaldavTest(BaseModel):
    server_url: str
    username: str
    password: str


@router.post("/test")
async def test_connection(
    body: CaldavTest,
    _user: User = Depends(require_permission("accounts.manage")),
):
    """Validate CalDAV credentials without storing anything."""
    server_url = body.server_url.strip().rstrip("/")
    try:
        if not server_url.startswith("https://"):
            raise ValueError("CalDAV connections must use HTTPS")
        _validate_feed_url(server_url)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    connector = CalDAVConnector(
        server_url=server_url,
        username=body.username.strip(),
        password=body.password,
    )
    try:
        calendars = await connector.list_calendars()
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"CalDAV connection failed: {exc}")
    return {"ok": True, "calendars_found": len(calendars), "names": [c.name for c in calendars[:10]]}


@router.post("/connect", status_code=status.HTTP_201_CREATED)
async def connect(
    body: CaldavConnect,
    admin: User = Depends(require_permission("accounts.manage")),
    session: AsyncSession = Depends(get_db_session),
):
    server_url = body.server_url.strip().rstrip("/")
    username = body.username.strip()
    label = (body.email_label or username).strip()

    # Validate before creating a connector or making any network request.
    # This blocks private/link-local/metadata targets and DNS names resolving
    # to them, including the initial CalDAV discovery call.
    try:
        if not server_url.startswith("https://"):
            raise ValueError("CalDAV connections must use HTTPS")
        _validate_feed_url(server_url)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    connector = CalDAVConnector(server_url=server_url, username=username, password=body.password)
    try:
        await connector.list_calendars()
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"CalDAV connection failed: {exc}")

    cipher = get_cipher()
    existing = (
        await session.execute(
            select(Account).where(
                Account.provider == ProviderType.CALDAV,
                Account.caldav_server_url == server_url,
                Account.caldav_username == username,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        account = Account(
            owner_user_id=admin.id,
            provider=ProviderType.CALDAV,
            provider_account_email=label,
            provider_account_id=f"caldav:{username}@{server_url}",
            caldav_server_url=server_url,
            caldav_username=username,
            encrypted_caldav_password=cipher.encrypt(body.password),
        )
        session.add(account)
    else:
        account = existing
        account.caldav_server_url = server_url
        account.caldav_username = username
        account.provider_account_email = label
        account.encrypted_caldav_password = cipher.encrypt(body.password)
    await session.flush()

    try:
        stats = await sync_caldav_account(session, account)
        await session.commit()
    except Exception as exc:
        await session.rollback()
        logger.exception("CalDAV initial sync failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Connected, but initial sync failed: {exc}")
    logger.info("Connected CalDAV account %s: %s", label, stats)
    return {"account_id": account.id, "email_label": label, "sync_stats": stats}
