from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import pytest
from starlette.requests import Request

import app.auth as auth_module
import app.rate_limiter as rate_limiter_module
from app.auth import create_access_token, get_current_user, hash_password
from app.oauth_state import sign_oauth_state, verify_oauth_state
from app.routers import admin_accounts_router
from app.routers import admin_caldav_router as caldav_router
from app.routers import booking_links_router as booking_router
from app.routers import contacts_router
from chronarch_core.connectors.caldav import CalDAVConnector
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import ProviderType, UserRole
from chronarch_core.models.user import User


class _Redis:
    def __init__(self):
        self.counts = {}
        self.expiries = {}

    async def incr(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, seconds):
        self.expiries[key] = seconds
        return True

    async def ttl(self, key):
        return 42

    async def exists(self, key):
        return 0

    async def set(self, key, value):
        self.counts[key] = value

    async def setex(self, key, seconds, value):
        self.counts[key] = value
        self.expiries[key] = seconds

    async def get(self, key):
        return self.counts.get(key)

    async def getdel(self, key):
        return self.counts.pop(key, None)


def _request(ip: str, forwarded: str) -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-forwarded-for", forwarded.encode())],
        "client": (ip, 12345),
        "scheme": "http",
        "server": ("testserver", 80),
        "query_string": b"",
    })


async def _admin(session, suffix: str = "one") -> User:
    user = User(
        id=f"admin-{suffix}",
        email=f"{suffix}@example.com",
        display_name="Admin",
        password_hash=hash_password("correct-horse-battery-staple"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


async def _host_calendar(session, user: User) -> Calendar:
    account = Account(
        owner_user_id=user.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=user.email,
        provider_account_id=f"provider-{user.id}",
    )
    session.add(account)
    await session.flush()
    calendar = Calendar(
        account_id=account.id,
        provider_calendar_id=f"calendar-{user.id}",
        name="Work",
        provider_writable=True,
        blocks_availability=True,
    )
    session.add(calendar)
    await session.flush()
    return calendar


async def test_rate_limiter_ignores_forwarded_header_spoofing(monkeypatch):
    redis = _Redis()
    monkeypatch.setattr(rate_limiter_module, "get_redis_client", lambda: redis)
    limiter = rate_limiter_module.RateLimiter(
        requests=2,
        window_seconds=60,
        key_prefix="security-test",
        by_ip=True,
    )

    await limiter(_request("10.0.0.5", "1.1.1.1"))
    await limiter(_request("10.0.0.5", "2.2.2.2"))
    with pytest.raises(HTTPException) as raised:
        await limiter(_request("10.0.0.5", "3.3.3.3"))

    assert raised.value.status_code == 429
    assert raised.value.headers["Retry-After"] == "42"
    assert list(redis.counts) == ["rate_limit:security-test:10.0.0.5"]
    assert redis.expiries["rate_limit:security-test:10.0.0.5"] == 60


async def test_temporary_password_cannot_use_protected_routes(session, monkeypatch):
    monkeypatch.setattr(auth_module, "get_redis_client", lambda: _Redis())
    user = await _admin(session, "temporary")
    user.force_password_change = True
    await session.flush()
    token = create_access_token(user.id)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    with pytest.raises(HTTPException) as raised:
        await get_current_user(credentials=credentials, session=session)

    assert raised.value.status_code in {403, 428}


async def test_password_change_revokes_previous_sessions(session, monkeypatch):
    redis = _Redis()
    monkeypatch.setattr(auth_module, "get_redis_client", lambda: redis)
    user = await _admin(session, "password-change")
    old_token = create_access_token(user.id)
    other_token = create_access_token(user.id)
    from app.routers.auth_router import PasswordChange, change_my_password

    await change_my_password(
        PasswordChange(
            current_password="correct-horse-battery-staple",
            new_password="new-correct-horse-battery-staple",
        ),
        user=user,
        session=session,
    )

    with pytest.raises(HTTPException) as raised:
        await get_current_user(
            credentials=HTTPAuthorizationCredentials(
                scheme="Bearer",
                credentials=other_token,
            ),
            session=session,
        )

    assert old_token != other_token
    assert raised.value.status_code == 401


async def test_oauth_state_is_single_use(monkeypatch):
    redis = _Redis()
    monkeypatch.setattr(auth_module, "get_redis_client", lambda: redis)
    state = await sign_oauth_state("admin-1")
    assert await verify_oauth_state(state) == "admin-1"
    with pytest.raises(ValueError):
        await verify_oauth_state(state)


async def test_caldav_connect_rejects_private_target_before_network(session, monkeypatch):
    user = await _admin(session, "caldav-security")
    called = False

    async def fake_list_calendars(self):
        nonlocal called
        called = True
        return []

    async def fake_sync(session, account):
        return {"calendars_synced": 0, "events_synced": 0, "events_deleted": 0}

    monkeypatch.setattr(CalDAVConnector, "list_calendars", fake_list_calendars)
    monkeypatch.setattr(caldav_router, "sync_caldav_account", fake_sync)

    with pytest.raises(HTTPException) as raised:
        await caldav_router.connect(
            caldav_router.CaldavConnect(
                server_url="http://169.254.169.254",
                username="user",
                password="password",
            ),
            admin=user,
            session=session,
        )

    assert raised.value.status_code == 422
    assert called is False


@pytest.mark.xfail(
    strict=True,
    reason="contact email validation accepts CR/LF header injection characters",
)
async def test_contact_rejects_crlf_email(session):
    user = await _admin(session, "contact-security")
    body = contacts_router.ContactCreate(
        email="victim@example.com\r\nBcc:attacker@example.com",
        display_name="Victim",
    )

    with pytest.raises(HTTPException) as raised:
        await contacts_router.create_contact(
            body,
            _user=user,
            session=session,
        )

    assert raised.value.status_code == 422


async def test_booking_update_rejects_negative_minimum_notice(session):
    user = await _admin(session, "booking-security")
    calendar = await _host_calendar(session, user)
    link = await booking_router.create_link(
        booking_router.BookingLinkCreate(
            title="Intro",
            calendar_id=calendar.id,
            slug="security-intro",
            min_notice_minutes=0,
        ),
        user=user,
        session=session,
    )

    with pytest.raises(HTTPException) as raised:
        await booking_router.update_link(
            link["id"],
            booking_router.BookingLinkUpdate(min_notice_minutes=-1),
            user=user,
            session=session,
        )

    assert raised.value.status_code == 422


async def test_sync_errors_do_not_expose_provider_secrets(session, monkeypatch):
    from chronarch_core.sync import google_sync

    user = await _admin(session, "sync-security")
    account = Account(
        id="sync-security-account",
        owner_user_id=user.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=user.email,
        provider_account_id="sync-security-provider",
    )
    session.add(account)
    await session.flush()
    sync_called = False

    async def fail_sync(session, account):
        nonlocal sync_called
        sync_called = True
        raise RuntimeError("provider rejected Bearer provider-secret-token")

    monkeypatch.setattr(google_sync, "sync_google_account", fail_sync)
    with pytest.raises(HTTPException) as raised:
        await admin_accounts_router.sync_account(
            account.id,
            _user=user,
            session=session,
        )

    assert raised.value.status_code == 500
    assert sync_called is True
    assert "provider-secret-token" not in str(raised.value.detail)
    assert "provider-secret-token" not in (account.last_sync_error or "")
