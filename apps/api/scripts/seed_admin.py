"""Seed the first admin user for a fresh deployment.

Usage (inside the api container or with DATABASE_URL pointed at the DB):
    python scripts/seed_admin.py admin@example.com "Jane Admin" <password>
"""

import asyncio
import sys

sys.path.insert(0, ".")

from sqlalchemy import select

from chronarch_core import rbac as _rbac
from chronarch_core.db import SessionLocal
from chronarch_core.models.enums import UserRole
from chronarch_core.models.rbac import Role, RoleAssignment
from chronarch_core.models.user import User

from app.auth import hash_password


async def main(email: str, display_name: str, password: str) -> None:
    async with SessionLocal() as session:
        existing = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if existing:
            print(f"User {email} already exists (id={existing.id})")
            return

        user = User(
            email=email,
            display_name=display_name,
            password_hash=hash_password(password),
            role=UserRole.ADMIN,
        )
        session.add(user)
        await session.flush()
        admin_role = (
            await session.execute(select(Role).where(Role.name == _rbac.ADMIN_ROLE_NAME))
        ).scalar_one_or_none()
        if admin_role is not None:
            session.add(RoleAssignment(user_id=user.id, role_id=admin_role.id))
        await session.commit()
        print(f"Created admin user {email} (id={user.id})")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        raise SystemExit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3]))
