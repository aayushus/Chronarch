"""Preserve booking history when its calendar event is cancelled."""

from typing import Sequence, Union

from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("bookings_event_id_fkey", "bookings", type_="foreignkey")
    op.create_foreign_key("bookings_event_id_fkey", "bookings", "events", ["event_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("bookings_event_id_fkey", "bookings", type_="foreignkey")
    op.create_foreign_key("bookings_event_id_fkey", "bookings", "events", ["event_id"], ["id"])
