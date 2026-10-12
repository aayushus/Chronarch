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


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _enumlabels(name: str) -> set[str]:
    """Labels of a PostgreSQL enum type; empty on dialects without enums.

    SQLite has no enum type, so `pg_enum` does not exist there. Returning an
    empty set makes the `ADD VALUE` guards no-ops instead of crashing the run.
    """
    if not _is_postgres():
        return set()
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
    if not _is_postgres():
        # No enum type to extend and no cast to apply: on SQLite `action` is
        # already a plain VARCHAR, so there is nothing to uppercase in place.
        return
    for label in _LABELS:
        if label not in _enumlabels("auditaction"):
            op.execute(sa.text(f"ALTER TYPE auditaction ADD VALUE '{label}'"))
    # PG forbids ADD VALUE and its use in one transaction.
    op.execute(sa.text("COMMIT"))
    op.execute(
        sa.text(
            "UPDATE audit_log SET action = UPPER(action::text)::auditaction "
            "WHERE action::text <> UPPER(action::text)"
        )
    )


def downgrade() -> None:
    pass
