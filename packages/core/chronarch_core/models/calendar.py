from typing import Optional

from sqlalchemy import String, ForeignKey, Enum as SAEnum, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid
from .enums import CalendarKind


class Calendar(Base, TimestampMixin):
    """A calendar discovered under a connected Account.

    Settings here implement BRD §12 (Calendar Configuration). `writable` is
    derived from the provider and must never be set true locally when the
    provider disallows writes — see chronarch_core.permissions.engine.
    """

    __tablename__ = "calendars"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    account_id: Mapped[str] = mapped_column(String, ForeignKey("accounts.id"), nullable=False, index=True)
    provider_calendar_id: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[CalendarKind] = mapped_column(SAEnum(CalendarKind), nullable=False, default=CalendarKind.PRIMARY)

    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#3B82F6")

    # Provider-derived capability (source of truth authority).
    provider_writable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Admin-configurable settings (BRD §12).
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    blocks_availability: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ea_can_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ea_can_edit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_can_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_can_write: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    privacy_mask: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    ics_subscription_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
