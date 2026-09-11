from typing import Optional

from sqlalchemy import String, ForeignKey, Enum as SAEnum, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid
from .enums import ProviderType


class Account(Base, TimestampMixin):
    """A connected provider account (OAuth) owned by a user.

    OAuth tokens are stored as encrypted bytes (`packages/core/chronarch_core/audit`
    peer module `crypto.py` provides the envelope encryption helpers) — never
    stored or returned as plaintext through any API, MCP tool, or log line.
    """

    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    provider: Mapped[ProviderType] = mapped_column(SAEnum(ProviderType), nullable=False)
    provider_account_email: Mapped[str] = mapped_column(String, nullable=False)
    provider_account_id: Mapped[str] = mapped_column(String, nullable=False)
    tenant_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # Microsoft tenant, if applicable

    encrypted_access_token: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    encrypted_refresh_token: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    token_expires_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    sync_status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    last_synced_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    last_sync_error: Mapped[Optional[str]] = mapped_column(String, nullable=True)
