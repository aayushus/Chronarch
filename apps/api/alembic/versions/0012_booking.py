"""Booking links + bookings tables (Cal.com-style public scheduling).

Model is the source of truth: materializes booking_links and bookings for
existing deployments.
"""

from typing import Sequence, Union

from alembic import op

from chronarch_core.models.booking import Booking, BookingLink

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    BookingLink.__table__.create(bind, checkfirst=True)
    Booking.__table__.create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Booking.__table__.drop(bind, checkfirst=True)
    BookingLink.__table__.drop(bind, checkfirst=True)
