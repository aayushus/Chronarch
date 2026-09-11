from typing import Optional

from sqlalchemy import String, ForeignKey, Enum as SAEnum, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid
from .enums import EventVisibility, BusyStatus


class UnifiedEvent(Base, TimestampMixin):
    """The normalized event model (BRD §23).

    `source_permissions` reflects what the *provider* allows (e.g. read-only
    corporate meeting). `effective_permissions` is computed per-viewer at
    request time by chronarch_core.permissions.engine and is NOT persisted
    here — kept off this row so a cached value never goes stale relative to
    delegation changes.
    """

    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)

    provider_account_id: Mapped[str] = mapped_column(String, ForeignKey("accounts.id"), nullable=False, index=True)
    calendar_id: Mapped[str] = mapped_column(String, ForeignKey("calendars.id"), nullable=False, index=True)
    provider_event_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    start: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    timezone: Mapped[str] = mapped_column(String, nullable=False, default="UTC")
    all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    organizer: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    attendees: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    conference: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    recurrence: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    visibility: Mapped[EventVisibility] = mapped_column(
        SAEnum(EventVisibility), nullable=False, default=EventVisibility.STANDARD
    )
    busy_status: Mapped[BusyStatus] = mapped_column(SAEnum(BusyStatus), nullable=False, default=BusyStatus.BUSY)

    # What the *provider* allows on this specific event, e.g. {"write": false}.
    source_permissions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    provider_updated_at: Mapped[Optional[DateTime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[Optional[DateTime]] = mapped_column(DateTime(timezone=True), nullable=True)
