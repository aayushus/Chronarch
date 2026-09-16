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


def upgrade() -> None:
    op.add_column("contacts", sa.Column("phone", sa.String(), nullable=True))
    op.add_column("contacts", sa.Column("company", sa.String(), nullable=True))
    op.add_column("contacts", sa.Column("job_title", sa.String(), nullable=True))
    op.add_column(
        "contacts",
        sa.Column("name_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("contacts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for column in ("deleted_at", "name_locked", "job_title", "company", "phone"):
        op.drop_column("contacts", column)
