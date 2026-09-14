from typing import AsyncGenerator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.db import SessionLocal
from chronarch_core.timezones import normalize_timezone


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
        await session.commit()


def get_client_timezone(request: Request) -> str:
    """The caller's IANA timezone from the `X-Timezone` header (browser or
    agent). Unknown/missing values normalize to UTC — never the server zone."""
    return normalize_timezone(request.headers.get("x-timezone"))
