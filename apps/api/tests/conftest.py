"""API-test fixtures: ephemeral cipher key + in-memory sqlite session.

Mirrors packages/core/tests/conftest.py so the API suite is self-contained
(zero-setup runs, locally and in containers).
"""

import os

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
