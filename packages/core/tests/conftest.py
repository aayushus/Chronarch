import os

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from chronarch_core.models import Base


def _ensure_test_cipher() -> None:
    """Tests encrypt throwaway values; they need *a* key, never the real one.
    Provision an ephemeral Fernet key when the environment has none so the
    suite runs with zero setup (container and local alike)."""
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


@pytest.fixture
def anyio_backend():
    return "asyncio"
