from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.db import SessionLocal


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
        await session.commit()
