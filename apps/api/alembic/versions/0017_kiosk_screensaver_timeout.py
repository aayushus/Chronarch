"""Configure kiosk inactivity timeout."""

from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[Sequence[str], str, None] = None
depends_on: Union[Sequence[str], str, None] = None

_COLUMN = "screensaver_timeout_seconds"


def upgrade() -> None:
    # Guarded because `0001_initial_schema` builds the schema with
    # `Base.metadata.create_all`, so on a fresh database this column already
    # exists and an unconditional add_column fails with "duplicate column".
    # Matches the guard style already used by 0004/0006.
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("kiosk_displays")}
    if _COLUMN not in existing:
        op.add_column(
            "kiosk_displays",
            sa.Column(_COLUMN, sa.Integer(), nullable=False, server_default="30"),
        )


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("kiosk_displays")}
    if _COLUMN not in existing:
        return
    if op.get_bind().dialect.name == "postgresql":
        op.drop_column("kiosk_displays", _COLUMN)
    else:
        # SQLite cannot DROP COLUMN before 3.35 and cannot do it through
        # batch mode on older Alembic either; recreate the table instead.
        with op.batch_alter_table("kiosk_displays", recreate="always") as batch_op:
            batch_op.drop_column(_COLUMN)