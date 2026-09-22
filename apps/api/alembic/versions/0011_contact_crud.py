"""Contact enrichment columns + manual-edit protections (BRD §32 CRUD).

Adds phone/company/job_title (manual detail form), name_locked (manual
names survive extraction), and deleted_at (soft delete; refresh skips
deleted rows instead of resurrecting them).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    cols = _columns("contacts")
    if "phone" not in cols:
        op.add_column("contacts", sa.Column("phone", sa.String(), nullable=True))
    if "company" not in cols:
        op.add_column("contacts", sa.Column("company", sa.String(), nullable=True))
    if "job_title" not in cols:
        op.add_column("contacts", sa.Column("job_title", sa.String(), nullable=True))
    if "name_locked" not in cols:
        op.add_column(
            "contacts",
            sa.Column("name_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if "deleted_at" not in cols:
        op.add_column("contacts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))



def downgrade() -> None:
    for column in ("deleted_at", "name_locked", "job_title", "company", "phone"):
        op.drop_column("contacts", column)
