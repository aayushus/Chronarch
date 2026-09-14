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
    # Dereferenced (SET NULL) when the calendar is deleted — e.g. account
    # disconnect. The entry itself is append-only and survives: `detail`
    # keeps what happened, and the DB-level SET NULL (not an ORM update)
    # never trips the immutability guard below.
    calendar_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("calendars.id", ondelete="SET NULL"), nullable=True
    )
    event_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    detail: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class AuditLogImmutableError(RuntimeError):
    """Raised when an update or delete operation is attempted on an AuditEntry."""
    pass


from sqlalchemy import event


@event.listens_for(AuditEntry, "before_update")
def _prevent_audit_update(mapper, connection, target):
    raise AuditLogImmutableError(f"AuditEntry {target.id} cannot be modified: audit logs are append-only.")


@event.listens_for(AuditEntry, "before_delete")
def _prevent_audit_delete(mapper, connection, target):
    raise AuditLogImmutableError(f"AuditEntry {target.id} cannot be deleted: audit logs are append-only.")

