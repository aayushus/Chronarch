"""Store provider incremental tokens per calendar."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("accounts")}
    if "sync_tokens" not in columns:
        op.add_column("accounts", sa.Column("sync_tokens", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    if "delta_tokens" not in columns:
        op.add_column("accounts", sa.Column("delta_tokens", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column("accounts", "delta_tokens")
    op.drop_column("accounts", "sync_tokens")
