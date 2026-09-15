"""Invite-extracted contact directory table (BRD §32).

Model is the source of truth (like 0002/0003/0009): materializes contacts
for existing deployments.
"""

from typing import Sequence, Union

from alembic import op

from chronarch_core.models.contact import Contact

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    Contact.__table__.create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Contact.__table__.drop(bind, checkfirst=True)
