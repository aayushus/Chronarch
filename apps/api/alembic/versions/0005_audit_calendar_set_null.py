"""Audit trail survives calendar deletion (account disconnect fix).

`audit_log.calendar_id` was RESTRICT: deleting an account whose calendars had
any audited action failed with an FK violation. It is now ON DELETE SET NULL
— the entry (actor, action, time, detail) is append-only and must outlive its
subject; only the link is cleared.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("audit_log_calendar_id_fkey", "audit_log", type_="foreignkey")
    op.create_foreign_key(
        "audit_log_calendar_id_fkey",
        "audit_log", "calendars",
        ["calendar_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("audit_log_calendar_id_fkey", "audit_log", type_="foreignkey")
    op.create_foreign_key(
        "audit_log_calendar_id_fkey",
        "audit_log", "calendars",
        ["calendar_id"], ["id"],
    )
