"""API-test fixtures: ephemeral cipher key + in-memory sqlite session.

Mirrors packages/core/tests/conftest.py so the API suite is self-contained
(zero-setup runs, locally and in containers).
"""

import os

# The API config refuses to import without a JWT secret; tests never sign
# tokens, so allow the documented throwaway-dev value before importing app
# modules. Set before any app.* import below.
os.environ.setdefault("ALLOW_INSECURE_DEV_SECRET", "1")

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from chronarch_core.models import Base


def _ensure_test_cipher() -> None:
    if not os.environ.get("TOKEN_ENCRYPTION_KEY"):
        from cryptography.fernet import Fernet

        os.environ["TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode()


_ensure_test_cipher()


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as s:
        yield s

    await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def _fresh_redis_client():
    """Drop the cached Redis client before each test.

    `app.auth.get_redis_client` caches one global client, and each async
    test runs on its own event loop — reusing a client bound to a closed
    loop makes Redis-vs-memory-fallback routing nondeterministic per call
    (a write can land in Redis while the follow-up read falls back to
    memory, or vice versa). A fresh client per test binds to the current
    loop, so every call in the test takes the same path.
    """
    import app.auth as auth_mod

    auth_mod._redis_client = None
    yield
    auth_mod._redis_client = None
