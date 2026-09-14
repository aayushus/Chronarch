from typing import Optional

from sqlalchemy import String, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class Role(Base, TimestampMixin):
    """An RBAC role: a named bag of permissions assignable to users.

    `admin` and `delegate` are seeded system roles. Admins may edit any
    role (including the system ones) and create custom roles — except the
    last-holder guard keeps at least one ADMIN-role user at all times.
    Calendar sharing stays separate (Delegation rows), never roles.
    """

    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class RolePermission(Base):
    """One permission string granted to a role (see chronarch_core.rbac)."""

    __tablename__ = "role_permissions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    role_id: Mapped[str] = mapped_column(String, ForeignKey("roles.id"), nullable=False, index=True)
    permission: Mapped[str] = mapped_column(String, nullable=False, index=True)


class RoleAssignment(Base, TimestampMixin):
    """A user's membership in a role. Effective permissions are the union
    across all assigned roles; the ADMIN user-role short-circuits to all."""

    __tablename__ = "role_assignments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    role_id: Mapped[str] = mapped_column(String, ForeignKey("roles.id"), nullable=False, index=True)
