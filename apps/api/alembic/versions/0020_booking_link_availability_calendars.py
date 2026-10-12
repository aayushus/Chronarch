"""Add availability_calendar_ids to booking_links.

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-11
"""

from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("booking_links")}

    with op.batch_alter_table("booking_links", recreate="auto") as batch:
        if "availability_calendar_ids" not in columns:
            batch.add_column(sa.Column("availability_calendar_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("booking_links")}

    with op.batch_alter_table("booking_links", recreate="auto") as batch:
        if "availability_calendar_ids" in columns:
            batch.drop_column("availability_calendar_ids")
