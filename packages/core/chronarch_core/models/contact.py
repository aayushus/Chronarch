from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid, utcnow


class Contact(Base, TimestampMixin):
    """Our contact directory (BRD §32 contact integration).

    Two origins: invite-extracted (from organizer/attendee entries on synced
    events) and manually added. Manual content always wins — `name_locked`
    rows keep their display name through refreshes, and soft-deleted rows
    stay deleted (refresh skips them instead of resurrecting them).

    `event_count` is a relevance signal (ordering suggestions, Frequent),
    not an exact census — it increments on sight during reconciliation.
    """

    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Manual enrichment (Google-Contacts-style detail form; invites never
    # provide these, so they are only ever set by hand).
    phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    company: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    job_title: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Manual content wins over extraction: locked names survive refresh.
    name_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Soft delete: refresh skips these instead of resurrecting them; restore
    # clears this back to NULL.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
