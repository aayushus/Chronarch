"""Public signup tests (ALLOW_SIGNUPS gate).

The gate reads env at import, so tests flip the router-level flag directly.
Sessions use isolated in-memory DBs — "first user" means first in that DB.
"""

import pytest
from sqlalchemy import select

from app.routers import auth_router as auth
from app.routers.auth_router import LoginRequest, SignupRequest
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User


@pytest.fixture
def signups_on(monkeypatch):
    monkeypatch.setattr(auth, "ALLOW_SIGNUPS", True, raising=False)
    # NOTE: auth_router reads config.ALLOW_SIGNUPS via `from .. import config`
    # at call time, so patch the source of truth instead.
    import app.config as config

    monkeypatch.setattr(config, "ALLOW_SIGNUPS", True)
    return True


async def test_signup_disabled_by_default(session, monkeypatch):
    import app.config as config

    monkeypatch.setattr(config, "ALLOW_SIGNUPS", False)
    assert (await auth.signup_status()) == {"allowed": False}
    with pytest.raises(Exception) as exc:
        await auth.signup(
            SignupRequest(email="a@x.com", display_name="A", password="long-enough"),
            session=session,
        )
    assert getattr(exc.value, "status_code", None) == 403
    assert (await session.execute(select(User))).scalars().all() == []


async def test_first_signup_becomes_admin_and_can_login(session, signups_on):
    assert (await auth.signup_status()) == {"allowed": True}
    out = await auth.signup(
        SignupRequest(email="  Founder@X.com ", display_name=" Founder ", password="long-enough"),
        session=session,
    )
    assert out.access_token
    user = (await session.execute(select(User))).scalar_one()
    assert user.email == "founder@x.com"
    assert user.display_name == "Founder"
    assert user.role == UserRole.ADMIN
    assert user.is_active is True

    logged = await auth.login(
        LoginRequest(email="founder@x.com", password="long-enough", remember_me=False),
        session=session,
    )
    assert logged.access_token


async def test_later_signups_are_also_admins(session, signups_on):
    await auth.signup(
        SignupRequest(email="first@x.com", display_name="First", password="long-enough"),
        session=session,
    )
    await auth.signup(
        SignupRequest(email="second@x.com", display_name="Second", password="long-enough"),
        session=session,
    )
    roles = {
        u.email: u.role
        for u in (await session.execute(select(User))).scalars()
    }
    assert roles == {"first@x.com": UserRole.ADMIN, "second@x.com": UserRole.ADMIN}


async def test_signup_rejects_duplicates_and_weak_input(session, signups_on):
    from fastapi import HTTPException

    await auth.signup(
        SignupRequest(email="dup@x.com", display_name="Dup", password="long-enough"),
        session=session,
    )
    with pytest.raises(HTTPException) as exc:
        await auth.signup(
            SignupRequest(email="DUP@x.com", display_name="Dup2", password="long-enough"),
            session=session,
        )
    assert exc.value.status_code == 409

    with pytest.raises(HTTPException) as exc:
        await auth.signup(
            SignupRequest(email="new@x.com", display_name="New", password="short"),
            session=session,
        )
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc:
        await auth.signup(
            SignupRequest(email="new@x.com", display_name="   ", password="long-enough"),
            session=session,
        )
    assert exc.value.status_code == 422
