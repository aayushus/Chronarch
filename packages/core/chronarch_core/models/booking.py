import re
import secrets
from datetime import datetime
from typing import Optional

from sqlalchemy import String, ForeignKey, Enum as SAEnum, DateTime, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid, utcnow
from .enums import BookingStatus

#: Custom slugs: lowercase alphanumerics + hyphens, 3–60 chars.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")

#: Slugs that would collide with app/API routes or confuse.
RESERVED_SLUGS = frozenset({
    "new", "settings", "api", "book", "admin", "login", "login", "logout",
    "static", "assets", "health", "mcp", "events", "calendars", "contacts",
    "booking", "bookings", "account", "accounts", "users", "roles",
})


def normalize_slug(raw: str) -> str:
    """Lowercase + validate a custom slug. Raises ValueError."""
    slug = (raw or "").strip().lower()
    if slug in RESERVED_SLUGS:
        raise ValueError(f"'{slug}' is reserved — pick another link address.")
    if not _SLUG_RE.match(slug):
        raise ValueError(
            "Link address must be 3–60 characters of lowercase letters, numbers, and hyphens.")
    return slug


def random_slug() -> str:
    return secrets.token_urlsafe(9).lower().replace("_", "-").replace("~", "-")


class BookingLink(Base, TimestampMixin):
    """A public bookable meeting type (Cal.com-style link).

    Owned by one user; books into one destination calendar. The `slug` is
    the entire capability — unguessable by default, custom when the host
    picks one. Availability reuses the standard engine (working prefs,
    buffers, notice) plus per-link windows.
    """

    __tablename__ = "booking_links"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)

    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    calendar_id: Mapped[str] = mapped_column(String, ForeignKey("calendars.id"), nullable=False)

    buffer_before_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    buffer_after_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    min_notice_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=1440)
    max_days_ahead: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Booking(Base, TimestampMixin):
    """One booked meeting. `event_id` is NULL while approval is pending —
    nothing tentative leaks onto the calendar. `booker_token` authorizes the
    booker's own cancel path (no login on the public surface)."""

    __tablename__ = "bookings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    link_id: Mapped[str] = mapped_column(String, ForeignKey("booking_links.id"), nullable=False, index=True)
    booker_name: Mapped[str] = mapped_column(String, nullable=False, default="")
    booker_email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    note: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    booked_timezone: Mapped[str] = mapped_column(String, nullable=False, default="UTC")

    event_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[BookingStatus] = mapped_column(
        SAEnum(BookingStatus), nullable=False, default=BookingStatus.PENDING)
    booker_token: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True,
                                              default=lambda: secrets.token_urlsafe(24))


def new_booker_token() -> str:
    return secrets.token_urlsafe(24)
