from typing import Optional

from sqlalchemy import String, ForeignKey, Enum as SAEnum, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, new_uuid, utcnow
from .enums import ActorType, AuditAction


class AuditEntry(Base):
    """Append-only audit log (BRD §22). Never store secrets in `detail`."""

    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    occurred_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    actor_type: Mapped[ActorType] = mapped_column(SAEnum(ActorType), nullable=False)
    actor_user_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id"), nullable=True)

    action: Mapped[AuditAction] = mapped_column(SAEnum(AuditAction), nullable=False)
    calendar_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("calendars.id"), nullable=True)
    event_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    detail: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
