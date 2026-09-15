from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid, utcnow


class Contact(Base, TimestampMixin):
    """Our own contact directory, extracted from invites (BRD §32).

    Built exclusively from organizer/attendee entries on synced events —
    never a CRM, never an email client (BRD §34 non-goals). One row per
    lowercase email, shared deployment-wide: the addresses were already
    visible to anyone who could view the source calendars.

    `event_count` is a relevance signal (ordering quick-add suggestions),
    not an exact census — it increments on sight during reconciliation.
    """

    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
