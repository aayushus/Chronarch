"""Kiosk wall-display pairings.

Model is the source of truth: materializes kiosk_displays for existing
deployments.
"""

from typing import Sequence, Union

from alembic import op

from chronarch_core.models.kiosk import KioskDisplay

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    KioskDisplay.__table__.create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    KioskDisplay.__table__.drop(bind, checkfirst=True)
