from datetime import datetime
from typing import Optional

from sqlalchemy import String, ForeignKey, Enum as SAEnum, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid
from .enums import ProviderType


class ProviderWebhook(Base, TimestampMixin):
    """A provider push subscription (BRD §24): Google watch channel
    (per calendar) or Microsoft Graph subscription (per account).

    Holds only routing/validation state — no tokens, no event data. When a
    notification arrives, the callback looks the row up by channel /
    subscription id, verifies the secret, and enqueues a normal
    reconciliation (the same code path as periodic sync).
    """

    __tablename__ = "provider_webhooks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    account_id: Mapped[str] = mapped_column(String, ForeignKey("accounts.id"), nullable=False, index=True)
    provider: Mapped[ProviderType] = mapped_column(SAEnum(ProviderType), nullable=False)
    # Google needs one channel per calendar; Microsoft subscribes per account.
    provider_calendar_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Provider-side identifiers for stop/renew calls.
    channel_id: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Our validation secret (never the provider's): Google channel token /
    # Microsoft clientState. Compared on every notification.
    client_secret: Mapped[str] = mapped_column(String, nullable=False)

    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_notification_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    last_error: Mapped[Optional[str]] = mapped_column(String, nullable=True)
