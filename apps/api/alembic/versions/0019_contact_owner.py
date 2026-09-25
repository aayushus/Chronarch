"""Scope contacts to their owning user."""

from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("contacts", sa.Column("owner_user_id", sa.String(), nullable=True))
    op.create_index("ix_contacts_owner_user_id", "contacts", ["owner_user_id"])
    # Existing rows are intentionally left unowned and therefore hidden from
    # user-scoped reads until a controlled backfill associates them.
    op.drop_constraint("contacts_email_key", "contacts", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("contacts_email_key", "contacts", ["email"])
    op.drop_index("ix_contacts_owner_user_id", table_name="contacts")
    op.drop_column("contacts", "owner_user_id")
