"""Scope contacts to their owning user."""

from alembic import op
import sqlalchemy as sa
import json

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("contacts", recreate="auto") as batch:
        batch.add_column(sa.Column("owner_user_id", sa.String(), nullable=True))
        batch.drop_constraint("contacts_email_key", type_="unique")
    op.create_index("ix_contacts_owner_user_id", "contacts", ["owner_user_id"])
    # Legacy rows have no owner and must remain nullable until an explicit,
    # auditable backfill can identify their source account. A normal
    # composite UNIQUE constraint would still allow duplicate NULL owners and
    # would be awkward to evolve during that backfill. Enforce uniqueness for
    # owned rows only; both supported databases implement partial indexes.
    op.create_index(
        "uq_contacts_owner_email", "contacts", ["owner_user_id", "email"],
        unique=True,
        postgresql_where=sa.text("owner_user_id IS NOT NULL"),
        sqlite_where=sa.text("owner_user_id IS NOT NULL"),
    )
    _backfill_unambiguous_owners()
    # Rows whose provenance is ambiguous remain unowned and are deliberately
    # hidden until an operator performs an explicit, auditable backfill.


def downgrade() -> None:
    op.drop_index("uq_contacts_owner_email", table_name="contacts")
    op.drop_index("ix_contacts_owner_user_id", table_name="contacts")
    with op.batch_alter_table("contacts", recreate="auto") as batch:
        batch.drop_column("owner_user_id")
        batch.create_unique_constraint("contacts_email_key", ["email"])


def _backfill_unambiguous_owners() -> None:
    """Backfill legacy contacts only when event provenance is unambiguous.

    Older contact rows had no account relation. We derive candidate owners
    from attendee/organizer emails on that account's stored events, but leave
    ambiguous rows NULL rather than assigning data to the wrong user.
    """
    conn = op.get_bind()
    accounts = conn.execute(sa.text(
        "SELECT id, owner_user_id, provider_account_email FROM accounts"
    )).mappings().all()
    owners_by_email: dict[str, set[str]] = {}
    for account in accounts:
        owner = account["owner_user_id"]
        if not owner:
            continue
        self_email = str(account["provider_account_email"] or "").strip().lower()
        rows = conn.execute(sa.text(
            "SELECT attendees, organizer FROM unified_events WHERE provider_account_id = :account_id"
        ), {"account_id": account["id"]}).all()
        for attendees, organizer in rows:
            values = []
            for raw in (attendees, organizer):
                if raw is None:
                    continue
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                values.extend(raw if isinstance(raw, list) else [raw])
            for person in values:
                if not isinstance(person, dict):
                    continue
                email = str(person.get("email") or "").strip().lower()
                if email and email != self_email and "@" in email:
                    owners_by_email.setdefault(email, set()).add(owner)

    contacts = conn.execute(sa.text(
        "SELECT id, email FROM contacts WHERE owner_user_id IS NULL"
    )).mappings().all()
    for contact in contacts:
        candidates = owners_by_email.get(str(contact["email"] or "").strip().lower(), set())
        if len(candidates) != 1:
            continue
        owner = next(iter(candidates))
        duplicate = conn.execute(sa.text(
            "SELECT 1 FROM contacts WHERE owner_user_id = :owner AND email = :email LIMIT 1"
        ), {"owner": owner, "email": contact["email"]}).first()
        if duplicate is None:
            conn.execute(sa.text(
                "UPDATE contacts SET owner_user_id = :owner WHERE id = :id"
            ), {"owner": owner, "id": contact["id"]})
