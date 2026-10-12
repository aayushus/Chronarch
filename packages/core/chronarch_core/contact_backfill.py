"""Operator backfill for contacts left unowned by migration `0019_contact_owner`.

`0019` assigns a contact to an owner only when event provenance is
*unambiguous* — the address appears on exactly one owner's account. Everything
else is deliberately left `owner_user_id IS NULL` rather than guessed at, since
assigning a contact to the wrong user is worse than hiding it.

The consequence is that those rows are invisible: every read is owner-scoped.
This module is the operator step that migration's comment refers to. It is
deliberately conservative:

* Nothing is inferred at write time. `--report` shows candidates; `--assign`
  only applies mappings an operator states explicitly, address by address.
* A row whose target owner already has that address is *skipped and reported*,
  never merged or overwritten. `0019` installs a partial unique index
  (`owner_user_id IS NOT NULL`), so duplicates among unowned rows are legal but
  two owned rows for one owner are not; blindly assigning would abort mid-run.
* Every applied change is emitted as a JSON audit record on stdout, so the run
  leaves a reviewable trail. It is not written to `audit_log` because that
  table's `action` column is a database enum with no contact-specific member;
  adding one would need an `ALTER TYPE` migration this script cannot assume has
  been deployed.

Run as `python -m chronarch_core.contact_backfill` (add `--assign` to apply).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .models.contact import Contact

__all__ = [
    "BackfillPlan",
    "candidate_owners",
    "plan_backfill",
    "apply_backfill",
    "main",
]


@dataclass
class BackfillPlan:
    """What a backfill would do, before any of it is written."""

    report: list[dict] = field(default_factory=list)
    unassignable: list[str] = field(default_factory=list)
    skipped_duplicates: list[tuple[str, str, str]] = field(default_factory=list)

    @property
    def assignable(self) -> list[str]:
        """Addresses with exactly one operator-confirmed owner and no conflict."""
        return [
            row["email"]
            for row in self.report
            if row.get("selected_owner") and not row.get("conflict")
        ]


async def candidate_owners(session: AsyncSession) -> dict[str, set[str]]:
    """Map each observed attendee/organizer address to the owners behind it.

    Mirrors the derivation in migration `0019`. Kept as a separate copy on
    purpose: a historical migration should not import live application code,
    because that code may change long after the migration has run everywhere.
    """
    accounts = (
        await session.execute(
            sa.text("SELECT id, owner_user_id, provider_account_email FROM accounts")
        )
    ).mappings().all()

    owners_by_email: dict[str, set[str]] = {}
    for account in accounts:
        owner = account["owner_user_id"]
        if not owner:
            continue
        self_email = str(account["provider_account_email"] or "").strip().lower()
        rows = (
            await session.execute(
                sa.text(
                    "SELECT attendees, organizer FROM events "
                    "WHERE provider_account_id = :account_id"
                ),
                {"account_id": account["id"]},
            )
        ).all()
        for attendees, organizer in rows:
            people: list = []
            for raw in (attendees, organizer):
                if raw is None:
                    continue
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                people.extend(raw if isinstance(raw, list) else [raw])
            for person in people:
                if not isinstance(person, dict):
                    continue
                email = str(person.get("email") or "").strip().lower()
                if email and email != self_email and "@" in email:
                    owners_by_email.setdefault(email, set()).add(owner)
    return owners_by_email


async def plan_backfill(session: AsyncSession) -> BackfillPlan:
    """Collect the unowned contacts and the candidates for each."""
    plan = BackfillPlan()
    owners_by_email = await candidate_owners(session)
    contacts = (
        await session.execute(
            sa.text(
                "SELECT id, email FROM contacts "
                "WHERE owner_user_id IS NULL AND deleted_at IS NULL"
            )
        )
    ).mappings().all()

    for contact in contacts:
        email = str(contact["email"] or "").strip().lower()
        candidates = sorted(owners_by_email.get(email, set()))
        row = {
            "id": contact["id"],
            "email": contact["email"],
            "candidates": candidates,
            # Auto-select only when provenance is unambiguous. The operator can
            # override by passing an explicit --assign for the other cases.
            "selected_owner": candidates[0] if len(candidates) == 1 else None,
            "conflict": None,
        }
        if not candidates:
            plan.unassignable.append(contact["email"])
        plan.report.append(row)
    return plan


async def apply_backfill(
    session: AsyncSession,
    mapping: dict[str, str],
    *,
    dry_run: bool = False,
) -> dict[str, list]:
    """Assign `email -> owner_user_id` for the given addresses.

    Skips (and reports) any address the target owner already holds, so a run
    cannot abort partway on the partial unique index in `0019`.
    """
    result: dict[str, list] = {"assigned": [], "skipped_duplicate": [], "unknown": []}
    for email, owner in mapping.items():
        contact = (
            await session.execute(
                sa.text(
                    "SELECT id FROM contacts "
                    "WHERE email = :email AND owner_user_id IS NULL LIMIT 1"
                ),
                {"email": email},
            )
        ).first()
        if contact is None:
            result["unknown"].append(email)
            continue

        clash = (
            await session.execute(
                sa.text(
                    "SELECT id FROM contacts WHERE owner_user_id = :owner AND email = :email"
                ),
                {"owner": owner, "email": email},
            )
        ).first()
        if clash is not None:
            result["skipped_duplicate"].append(f"{email} -> {owner} (already owned)")
            continue

        result["assigned"].append(f"{email} -> {owner}")
        if dry_run:
            continue

        await session.execute(
            sa.text("UPDATE contacts SET owner_user_id = :owner WHERE id = :contact_id"),
            {"owner": owner, "contact_id": contact[0]},
        )
        print(json.dumps({
            "event": "contact_owner_backfill",
            "contact_id": contact[0],
            "email": email,
            "assigned_owner": owner,
        }))
    if not dry_run:
        await session.commit()
    return result


def _parse_assignments(pairs: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            raise SystemExit(f"--assign expects email=owner_user_id, got {pair!r}")
        email, owner = pair.split("=", 1)
        mapping[email.strip()] = owner.strip()
    return mapping


async def _run(assign: list[str], dry_run: bool) -> int:
    mapping = _parse_assignments(assign)
    session = SessionLocal()
    try:
        plan = await plan_backfill(session)
        print(f"Unowned contacts: {len(plan.report)}")
        for row in plan.report:
            candidates = ", ".join(row["candidates"]) or "-"
            auto = row["selected_owner"] or "AMBIGUOUS"
            print(f"  {row['email']:<40} candidates=[{candidates}] auto={auto}")
        if plan.unassignable:
            print(
                f"\n{len(plan.unassignable)} contact(s) have no event provenance and "
                "cannot be inferred; assign them by hand with --assign."
            )

        if not mapping:
            print("\nRead-only report. Re-run with --assign email=owner_id to apply.")
            return 0

        print("\nApplying explicit operator mappings:")
        result = await apply_backfill(session, mapping, dry_run=dry_run)
        for key, values in result.items():
            for value in values:
                print(f"  {key}: {value}")
        if dry_run:
            await session.rollback()
            print("\nDry run — nothing written.")
    finally:
        await session.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m chronarch_core.contact_backfill",
        description="Report and resolve contacts left unowned by migration 0019.",
    )
    parser.add_argument(
        "--assign",
        action="append",
        default=[],
        metavar="EMAIL=OWNER_USER_ID",
        help="explicit owner for an address; repeatable. Nothing is inferred.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="with --assign, show what would change without writing.",
    )
    args = parser.parse_args(argv)
    try:
        return asyncio.run(_run(args.assign, args.dry_run))
    except KeyboardInterrupt:  # pragma: no cover
        return 130


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())