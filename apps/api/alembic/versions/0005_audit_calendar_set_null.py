"""Audit trail survives calendar deletion (account disconnect fix).

`audit_log.calendar_id` was RESTRICT: deleting an account whose calendars had
any audited action failed with an FK violation. It is now ON DELETE SET NULL
— the entry (actor, action, time, detail) is append-only and must outlive its
subject; only the link is cleared.

Two dialect hazards are handled here:

1. SQLite cannot ALTER a constraint in place, so the table is rebuilt with
   batch mode's copy-and-move strategy. PostgreSQL takes the plain ALTER path.
2. `0001_initial_schema` creates the schema with `Base.metadata.create_all`, so
   on a fresh database this FK is *already* `SET NULL` and was never created
   under a name this migration can look up. The upgrade is therefore guarded:
   it only rebuilds when the reflected constraint is actually wrong. Databases
   created before the model gained `ondelete="SET NULL"` still take the
   rebuild path, and lose their audited rows only if the copy step drops them.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT_NAME = "audit_log_calendar_id_fkey"


def _current_ondelete() -> str | None:
    """The ON DELETE action on audit_log.calendar_id, or None if no such FK."""
    for fk in sa.inspect(op.get_bind()).get_foreign_keys("audit_log"):
        if fk["referred_table"] == "calendars" and fk["constrained_columns"] == ["calendar_id"]:
            options = fk.get("options") or {}
            return options.get("ondelete") or "NO ACTION"
    return None


def _recreate(ondelete: str | None) -> None:
    """Rebuild audit_log with calendar_id's FK set to `ondelete`.

    Reflects the live table rather than naming the constraint, because SQLite
    does not persist FK names — a `drop_constraint("audit_log_calendar_id_fkey")`
    raises "No such constraint" there even though the constraint exists.
    """
    metadata = sa.MetaData()
    table = sa.Table("audit_log", metadata, autoload_with=op.get_bind())
    for fk in list(table.foreign_keys):
        if fk.parent.name == "calendar_id":
            table.foreign_keys.discard(fk)
    table.append_constraint(
        sa.ForeignKeyConstraint(
            ["calendar_id"], ["calendars.id"],
            ondelete=ondelete,
            name=_CONSTRAINT_NAME if ondelete else None,
        )
    )
    with op.batch_alter_table("audit_log", recreate="always", copy_from=table):
        pass


def upgrade() -> None:
    current = _current_ondelete()
    if current == "SET NULL":
        return  # already correct — nothing to rebuild
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(_CONSTRAINT_NAME, "audit_log", type_="foreignkey")
        op.create_foreign_key(
            _CONSTRAINT_NAME, "audit_log", "calendars",
            ["calendar_id"], ["id"], ondelete="SET NULL",
        )
    else:
        _recreate("SET NULL")


def downgrade() -> None:
    current = _current_ondelete()
    if current in (None, "NO ACTION"):
        return  # already correct — nothing to rebuild
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(_CONSTRAINT_NAME, "audit_log", type_="foreignkey")
        op.create_foreign_key(
            _CONSTRAINT_NAME, "audit_log", "calendars",
            ["calendar_id"], ["id"],
        )
    else:
        _recreate(None)