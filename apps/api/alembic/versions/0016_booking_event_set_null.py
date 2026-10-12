"""Preserve booking history when its calendar event is cancelled.

`bookings.event_id` was RESTRICT, so deleting the provider event failed with an
FK violation and a cancelled booking could not keep its history. It is now
ON DELETE SET NULL — the booking row survives, only the link is cleared.

Same two dialect hazards as `0005`:

1. SQLite cannot ALTER a constraint in place, so the table is rebuilt with
   batch mode's copy-and-move strategy. PostgreSQL takes the plain ALTER path.
2. SQLite does not persist constraint names, so a `drop_constraint("...")` by
   name raises "No such constraint" there even though the constraint exists.
   The rebuild reflects the live table and matches the FK on its target columns
   instead. Databases created from the current model already carry
   `ondelete="SET NULL"`, so the upgrade is guarded and skips the rebuild.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT_NAME = "bookings_event_id_fkey"


def _current_ondelete() -> str | None:
    """The ON DELETE action on bookings.event_id, or None if no such FK."""
    for fk in sa.inspect(op.get_bind()).get_foreign_keys("bookings"):
        if fk["referred_table"] == "events" and fk["constrained_columns"] == ["event_id"]:
            options = fk.get("options") or {}
            return options.get("ondelete") or "NO ACTION"
    return None


def _recreate(ondelete: str | None) -> None:
    """Rebuild bookings with event_id's FK set to `ondelete`."""
    metadata = sa.MetaData()
    table = sa.Table("bookings", metadata, autoload_with=op.get_bind())
    for fk in list(table.foreign_keys):
        if fk.parent.name == "event_id":
            table.foreign_keys.discard(fk)
    table.append_constraint(
        sa.ForeignKeyConstraint(
            ["event_id"], ["events.id"],
            ondelete=ondelete,
            name=_CONSTRAINT_NAME if ondelete else None,
        )
    )
    with op.batch_alter_table("bookings", recreate="always", copy_from=table):
        pass


def upgrade() -> None:
    current = _current_ondelete()
    if current == "SET NULL":
        return  # already correct — nothing to rebuild
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(_CONSTRAINT_NAME, "bookings", type_="foreignkey")
        op.create_foreign_key(
            _CONSTRAINT_NAME, "bookings", "events",
            ["event_id"], ["id"], ondelete="SET NULL",
        )
    else:
        _recreate("SET NULL")


def downgrade() -> None:
    current = _current_ondelete()
    if current in (None, "NO ACTION"):
        return  # already correct — nothing to rebuild
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(_CONSTRAINT_NAME, "bookings", type_="foreignkey")
        op.create_foreign_key(
            _CONSTRAINT_NAME, "bookings", "events",
            ["event_id"], ["id"],
        )
    else:
        _recreate(None)