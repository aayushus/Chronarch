"""Performance Indexes, Materialized Occurrences, and Incremental Sync Tokens (Tasks 1A, 1B, 2A).

1A: Adds composite indexes on events (calendar_id, start, end) and provider lookups.
1B: Creates materialized_occurrences table for pre-expanded recurring events.
2A: Adds sync_token and delta_token to accounts table for incremental delta sync.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from chronarch_core.models.materialized_occurrence import MaterializedOccurrence

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table)}


def _indexes(table: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {idx["name"] for idx in insp.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    # 1A: Compound Indexes on events table
    event_idx = _indexes("events")
    if "idx_events_calendar_window" not in event_idx:
        op.create_index("idx_events_calendar_window", "events", ["calendar_id", "start", "end"])
    if "idx_events_provider_lookup" not in event_idx:
        op.create_index("idx_events_provider_lookup", "events", ["provider_account_id", "provider_event_id"])

    # 1B: MaterializedOccurrences table
    MaterializedOccurrence.__table__.create(bind, checkfirst=True)

    # 2A: Sync tokens on accounts table
    acc_cols = _columns("accounts")
    if "sync_token" not in acc_cols:
        op.add_column("accounts", sa.Column("sync_token", sa.String(), nullable=True))
    if "delta_token" not in acc_cols:
        op.add_column("accounts", sa.Column("delta_token", sa.String(), nullable=True))



def downgrade() -> None:
    bind = op.get_bind()

    op.drop_column("accounts", "delta_token")
    op.drop_column("accounts", "sync_token")
    MaterializedOccurrence.__table__.drop(bind, checkfirst=True)
    op.drop_index("idx_events_provider_lookup", table_name="events")
    op.drop_index("idx_events_calendar_window", table_name="events")
