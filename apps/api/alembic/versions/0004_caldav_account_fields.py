"""CalDAV account fields on accounts table (BR-CAL-003).

Revision ID: 0004
Revises: 0003
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    cols = _columns("accounts")
    if "caldav_server_url" not in cols:
        op.add_column("accounts", sa.Column("caldav_server_url", sa.String(), nullable=True))
    if "caldav_username" not in cols:
        op.add_column("accounts", sa.Column("caldav_username", sa.String(), nullable=True))
    if "encrypted_caldav_password" not in cols:
        op.add_column("accounts", sa.Column("encrypted_caldav_password", sa.LargeBinary(), nullable=True))



def downgrade() -> None:
    op.drop_column("accounts", "encrypted_caldav_password")
    op.drop_column("accounts", "caldav_username")
    op.drop_column("accounts", "caldav_server_url")
