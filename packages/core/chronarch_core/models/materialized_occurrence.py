from typing import Optional
from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class MaterializedOccurrence(Base, TimestampMixin):
    """Pre-expanded materialized occurrences for recurring events (Performance 1B).

    Stores expanded instances for fast range queries, avoiding runtime RRULE
    expansion on every calendar view render or availability computation.
    """

    __tablename__ = "materialized_occurrences"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    event_id: Mapped[str] = mapped_column(String, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    calendar_id: Mapped[str] = mapped_column(String, ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False, index=True)

    start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    busy_status: Mapped[str] = mapped_column(String, nullable=False, default="busy")

    __table_args__ = (
        Index("idx_mat_occ_cal_window", "calendar_id", "start", "end"),
    )
