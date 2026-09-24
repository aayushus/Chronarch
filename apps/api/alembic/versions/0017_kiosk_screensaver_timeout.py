"""Configure kiosk inactivity timeout."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("kiosk_displays", sa.Column("screensaver_timeout_seconds", sa.Integer(), nullable=False, server_default="30"))


def downgrade() -> None:
    op.drop_column("kiosk_displays", "screensaver_timeout_seconds")
