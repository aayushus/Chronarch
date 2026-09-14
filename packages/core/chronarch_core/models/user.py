from typing import Optional

from sqlalchemy import String, Enum as SAEnum, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid
from .enums import UserRole


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False, default=UserRole.DELEGATE)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    home_timezone: Mapped[str] = mapped_column(String, nullable=False, default="UTC")
    secondary_timezone: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Working-hours preferences (BRD §26), stored simply for MVP.
    working_days: Mapped[str] = mapped_column(String, nullable=False, default="1,2,3,4,5")  # ISO weekday, Mon=1
    working_hours_start: Mapped[str] = mapped_column(String, nullable=False, default="09:00")
    working_hours_end: Mapped[str] = mapped_column(String, nullable=False, default="17:00")
    min_meeting_notice_minutes: Mapped[int] = mapped_column(default=0)
    meeting_buffer_minutes: Mapped[int] = mapped_column(default=0)
