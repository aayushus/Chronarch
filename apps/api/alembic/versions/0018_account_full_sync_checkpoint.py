"""Track periodic provider full-sync checkpoints."""

from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


_COLUMN = "last_full_sync_at"


def upgrade() -> None:
    # Guarded because `0001_initial_schema` builds the schema with
    # `Base.metadata.create_all`, so on a fresh database this column already
    # exists and an unconditional add_column fails with "duplicate column".
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("accounts")}
    if _COLUMN not in existing:
        op.add_column("accounts", sa.Column(_COLUMN, sa.String(), nullable=True))


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("accounts")}
    if _COLUMN not in existing:
        return
    if op.get_bind().dialect.name == "postgresql":
        op.drop_column("accounts", _COLUMN)
    else:
        with op.batch_alter_table("accounts", recreate="always") as batch_op:
            batch_op.drop_column(_COLUMN)
