import secrets
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


def new_kiosk_token() -> str:
    return secrets.token_urlsafe(24)


class KioskDisplay(Base, TimestampMixin):
    """A wall display pairing (Skylight-style kiosk).

    The `token` is the entire capability — unguessable, bearer-style, same
    pattern as Booking.booker_token. No login on the display; revoking or
    regenerating the token decommissions it. The viewer is always treated
    as a non-owner: PRIVATE events render as Busy on the public surface.
    `sleep_start`/`sleep_end` are local "HH:MM" wall-clock bounds in the
    owner's home timezone; the display blanks itself between them.
    """

    __tablename__ = "kiosk_displays"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, default="Wall display")
    token: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True,
                                       default=new_kiosk_token)
    location_label: Mapped[str] = mapped_column(String, nullable=False, default="")
    sleep_start: Mapped[str] = mapped_column(String, nullable=False, default="22:00")
    sleep_end: Mapped[str] = mapped_column(String, nullable=False, default="07:00")
    screensaver_timeout_seconds: Mapped[int] = mapped_column(nullable=False, default=30)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
