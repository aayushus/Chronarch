"""Track periodic provider full-sync checkpoints."""

from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("last_full_sync_at", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "last_full_sync_at")
