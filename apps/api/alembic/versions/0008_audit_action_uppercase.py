"""Uppercase auditaction labels for role-lifecycle actions.

SQLAlchemy persists enum NAMES (CREATE_ROLE), but 0007 added lowercase
labels. Add the uppercase variants and normalize any rows written in
between. The lowercase labels stay (Postgres cannot drop enum labels) —
harmless leftovers.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LABELS = ("CREATE_ROLE", "UPDATE_ROLE", "DELETE_ROLE", "ASSIGN_ROLE", "REVOKE_ROLE")


def _enumlabels(name: str) -> set[str]:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
            "WHERE t.typname = :name"
        ),
        {"name": name},
    )
    return {r[0] for r in rows}


def upgrade() -> None:
    for label in _LABELS:
        if label not in _enumlabels("auditaction"):
            op.execute(sa.text(f"ALTER TYPE auditaction ADD VALUE '{label}'"))
    op.execute(sa.text("COMMIT"))
    op.execute(
        sa.text(
            "UPDATE audit_log SET action = UPPER(action::text)::auditaction "
            "WHERE action::text <> UPPER(action::text)"
        )
    )


def downgrade() -> None:
    pass
