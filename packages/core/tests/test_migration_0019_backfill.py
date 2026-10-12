"""Execute migration 0019's backfill against a synthetic pre-0019 database.

OPEN-006 flagged that the migration had never been run, and that
`_backfill_unambiguous_owners()` was only ever reviewed by eye. These tests run
the real function against a hand-built legacy schema, so the SQL it emits and the
ownership decisions it makes are evidence rather than assumption.

The legacy shape is what 0018 leaves behind: `contacts` with a global unique
index on `email` and no `owner_user_id`.
"""

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "apps" / "api" / "alembic" / "versions" / "0019_contact_owner.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("mig_0019", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _legacy_db(tmp_path):
    """A contacts table shaped like 0018: global unique email, no owner column."""
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE accounts (
            id VARCHAR PRIMARY KEY,
            owner_user_id VARCHAR,
            provider_account_email VARCHAR NOT NULL
        );
        CREATE TABLE events (
            id VARCHAR PRIMARY KEY,
            provider_account_id VARCHAR NOT NULL,
            organizer JSON,
            attendees JSON NOT NULL
        );
        CREATE TABLE contacts (
            id VARCHAR PRIMARY KEY,
            email VARCHAR NOT NULL,
            display_name VARCHAR,
            owner_user_id VARCHAR
        );
        CREATE UNIQUE INDEX contacts_email_key ON contacts (email);
        """
    )
    return path, conn


def _account(conn, account_id, owner, email):
    conn.execute(
        "INSERT INTO accounts (id, owner_user_id, provider_account_email) VALUES (?,?,?)",
        (account_id, owner, email),
    )


def _event(conn, event_id, account_id, attendees, organizer=None):
    conn.execute(
        "INSERT INTO events (id, provider_account_id, organizer, attendees) VALUES (?,?,?,?)",
        (event_id, account_id, json.dumps(organizer), json.dumps(attendees)),
    )


def _contact(conn, contact_id, email):
    conn.execute(
        "INSERT INTO contacts (id, email, display_name, owner_user_id) VALUES (?,?,?,NULL)",
        (contact_id, email, "Legacy"),
    )


def _owners(conn):
    return dict(conn.execute("SELECT id, owner_user_id FROM contacts").fetchall())


def _run_backfill(path, monkeypatch):
    """Invoke the migration's backfill with `op.get_bind()` bound to `path`.

    Alembic hands the migration a SQLAlchemy Connection (the migration issues
    `sa.text(...)` and calls `.mappings()`), so the stand-in must be one too.
    """
    from alembic import op
    from sqlalchemy import create_engine

    module = _load_migration()
    engine = create_engine(f"sqlite:///{path}")
    try:
        with engine.connect() as conn:
            monkeypatch.setattr(op, "get_bind", lambda: conn)
            module._backfill_unambiguous_owners()
            conn.commit()
    finally:
        engine.dispose()
    # Re-open so the caller sees committed state.
    return sqlite3.connect(path)


def test_backfill_assigns_owner_when_provenance_is_unambiguous(tmp_path, monkeypatch):
    path, conn = _legacy_db(tmp_path)
    _account(conn, "acct-1", "user-1", "owner@example.com")
    _event(conn, "evt-1", "acct-1", [{"email": "alice@example.com", "name": "Alice"}])
    _contact(conn, "c-alice", "alice@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    assert _owners(conn) == {"c-alice": "user-1"}


def test_backfill_leaves_ambiguous_contact_unowned(tmp_path, monkeypatch):
    """The same address seen on two owners' accounts must not be guessed."""
    path, conn = _legacy_db(tmp_path)
    _account(conn, "acct-1", "user-1", "one@example.com")
    _account(conn, "acct-2", "user-2", "two@example.com")
    _event(conn, "evt-1", "acct-1", [{"email": "shared@example.com"}])
    _event(conn, "evt-2", "acct-2", [{"email": "shared@example.com"}])
    _contact(conn, "c-shared", "shared@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    # Mis-assigning contact data to the wrong user is worse than leaving it NULL.
    assert _owners(conn) == {"c-shared": None}


def test_backfill_skips_contact_with_no_event_provenance(tmp_path, monkeypatch):
    path, conn = _legacy_db(tmp_path)
    _account(conn, "acct-1", "user-1", "owner@example.com")
    _event(conn, "evt-1", "acct-1", [{"email": "alice@example.com"}])
    _contact(conn, "c-known", "alice@example.com")
    _contact(conn, "c-stranger", "stranger@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    assert _owners(conn) == {"c-known": "user-1", "c-stranger": None}


def test_backfill_ignores_the_accounts_own_address(tmp_path, monkeypatch):
    """An owner's own address must not make them a candidate for their contact."""
    path, conn = _legacy_db(tmp_path)
    _account(conn, "acct-1", "user-1", "owner@example.com")
    _event(conn, "evt-1", "acct-1", [{"email": "owner@example.com"}])
    _contact(conn, "c-self", "owner@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    assert _owners(conn) == {"c-self": None}


def test_backfill_reads_organizer_as_well_as_attendees(tmp_path, monkeypatch):
    path, conn = _legacy_db(tmp_path)
    _account(conn, "acct-1", "user-1", "owner@example.com")
    _event(conn, "evt-1", "acct-1", [], organizer={"email": "bob@example.com"})
    _contact(conn, "c-bob", "bob@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    assert _owners(conn) == {"c-bob": "user-1"}


def test_backfill_does_not_create_a_duplicate_for_an_owned_contact(tmp_path, monkeypatch):
    """An unowned duplicate must be skipped, not merged into the owned row.

    Modelled on the *post*-0019 index, which is partial
    (`owner_user_id IS NOT NULL`). Unlike the 0018 global unique index, that
    one permits duplicate addresses among unowned rows — the exact state this
    guard exists for.
    """
    path, conn = _legacy_db(tmp_path)
    conn.execute("DROP INDEX contacts_email_key")
    conn.execute(
        "CREATE UNIQUE INDEX contacts_owner_email_key "
        "ON contacts (owner_user_id, email) WHERE owner_user_id IS NOT NULL"
    )
    _account(conn, "acct-1", "user-1", "owner@example.com")
    _event(conn, "evt-1", "acct-1", [{"email": "alice@example.com"}])
    conn.execute(
        "INSERT INTO contacts (id, email, display_name, owner_user_id) VALUES (?,?,?,'user-1')",
        ("c-owned", "alice@example.com", "Alice"),
    )
    _contact(conn, "c-legacy", "alice@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    assert _owners(conn) == {"c-owned": "user-1", "c-legacy": None}


def test_legacy_global_unique_index_forbids_duplicate_addresses(tmp_path):
    """Documents why OPEN-008 exists: pre-0019 uniqueness is global, not per-owner."""
    path, conn = _legacy_db(tmp_path)
    _contact(conn, "c-1", "same@example.com")
    with pytest.raises(sqlite3.IntegrityError):
        _contact(conn, "c-2", "same@example.com")
    conn.rollback()


def test_backfill_tolerates_json_stored_as_text(tmp_path, monkeypatch):
    """Some dialects hand back JSON as a string; the migration must still parse it."""
    path, conn = _legacy_db(tmp_path)
    _account(conn, "acct-1", "user-1", "owner@example.com")
    conn.execute(
        "INSERT INTO events (id, provider_account_id, organizer, attendees) VALUES (?,?,?,?)",
        ("evt-1", "acct-1", None, '[{"email": "carol@example.com"}]'),
    )
    _contact(conn, "c-carol", "carol@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    assert _owners(conn) == {"c-carol": "user-1"}


def test_backfill_ignores_accounts_without_an_owner(tmp_path, monkeypatch):
    path, conn = _legacy_db(tmp_path)
    _account(conn, "acct-1", None, "orphan@example.com")
    _event(conn, "evt-1", "acct-1", [{"email": "dave@example.com"}])
    _contact(conn, "c-dave", "dave@example.com")
    conn.commit()

    conn = _run_backfill(path, monkeypatch)
    assert _owners(conn) == {"c-dave": None}