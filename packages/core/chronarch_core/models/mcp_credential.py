from sqlalchemy import String, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class MCPCredential(Base, TimestampMixin):
    """A scoped API key for external MCP clients (BRD §19).

    Provider OAuth credentials are never reachable from here — this table
    only maps a hashed key to a user + a set of scopes
    (calendar.read/write/delete, availability.read).
    """

    __tablename__ = "mcp_credentials"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    key_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    scopes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    revoked: Mapped[bool] = mapped_column(default=False)
