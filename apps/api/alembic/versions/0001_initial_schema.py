"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-11

Creates all tables directly from chronarch_core's SQLAlchemy metadata rather
than a hand-transcribed op.create_table sequence, so this migration can
never drift from the models it mirrors — chronarch_core.models is the single
source of truth for the schema.
"""
from typing import Sequence, Union

from alembic import op

from chronarch_core.models import Base

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind)
