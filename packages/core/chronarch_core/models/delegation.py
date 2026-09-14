from sqlalchemy import String, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class Delegation(Base, TimestampMixin):
    """Grants an assistant user operational access to an executive's calendar.

    Calendar-specific overrides live in DelegationCalendarGrant; a Delegation
    row with no grants gives the assistant nothing (deny-by-default).
    """

    __tablename__ = "delegations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    delegate_user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class DelegationCalendarGrant(Base, TimestampMixin):
    """Per-calendar permission grant within a Delegation (BRD §14)."""

    __tablename__ = "delegation_calendar_grants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    delegation_id: Mapped[str] = mapped_column(String, ForeignKey("delegations.id"), nullable=False, index=True)
    calendar_id: Mapped[str] = mapped_column(String, ForeignKey("calendars.id"), nullable=False, index=True)

    can_view_availability: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_view_titles: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_view_full_details: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_create: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_edit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_reschedule: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_manage_attendees: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_respond_to_invitations: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_import_ics: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_move_between_calendars: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
