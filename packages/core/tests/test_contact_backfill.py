"""Tests for the operator contact-ownership backfill (`contact_backfill`).

Migration `0019` deliberately leaves ambiguous contacts unowned, which makes
them invisible. This module is the operator step for resolving them, and its
value depends entirely on *not* guessing: these tests pin the conservative
behaviour, including the duplicate handling that the partial unique index in
`0019` forces.
"""

from datetime import datetime, timezone

import pytest

from chronarch_core.contact_backfill import apply_backfill, candidate_owners, plan_backfill
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.contact import Contact
from chronarch_core.models.enums import CalendarKind, ProviderType, UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User

DAY = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)


async def _owner(session, user_id: str, email: str) -> User:
    user = User(
        id=user_id,
        email=email,
        display_name=user_id,
        password_hash="x",
        role=UserRole.ADMIN,
    )
    session.add(user)
    await session.flush()
    return user


async def _account(session, account_id: str, owner: User, address: str) -> Account:
    account = Account(
        id=account_id,
        owner_user_id=owner.id,
        provider=ProviderType.GOOGLE,
        provider_account_email=address,
        provider_account_id=f"prov-{account_id}",
    )
    session.add(account)
    calendar = Calendar(
        id=f"cal-{account_id}",
        account_id=account_id,
        provider_calendar_id=f"pcal-{account_id}",
        kind=CalendarKind.PRIMARY,
        name="Work",
        provider_writable=True,
        blocks_availability=True,
    )
    session.add(calendar)
    await session.flush()
    return account


async def _event(session, event_id: str, account: Account, attendees: list[dict]) -> None:
    session.add(
        UnifiedEvent(
            id=event_id,
            provider_account_id=account.id,
            calendar_id=f"cal-{account.id}",
            provider_event_id=event_id,
            title="Meeting",
            start=DAY,
            end=DAY.replace(hour=16),
            attendees=attendees,
        )
    )
    await session.flush()


async def _contact(session, contact_id: str, email: str, owner: str | None) -> Contact:
    contact = Contact(
        id=contact_id,
        email=email,
        owner_user_id=owner,
        first_seen_at=DAY,
        last_seen_at=DAY,
        event_count=1,
    )
    session.add(contact)
    await session.flush()
    return contact


async def test_candidate_owners_excludes_the_accounts_own_address(session):
    owner = await _owner(session, "u1", "owner@example.com")
    account = await _account(session, "acct-1", owner, "owner@example.com")
    await _event(session, "e1", account, [
        {"email": "owner@example.com"},  # the account itself
        {"email": "guest@example.com"},
    ])
    await _contact(session, "c1", "guest@example.com", None)
    await session.commit()

    candidates = await candidate_owners(session)

    assert candidates.get("guest@example.com") == {"u1"}
    assert "owner@example.com" not in candidates


async def test_plan_auto_selects_only_unambiguous_addresses(session):
    one = await _owner(session, "u1", "one@example.com")
    two = await _owner(session, "u2", "two@example.com")
    acct_one = await _account(session, "acct-1", one, "one@example.com")
    acct_two = await _account(session, "acct-2", two, "two@example.com")
    await _event(session, "e1", acct_one, [{"email": "clear@example.com"}])
    await _event(session, "e2", acct_one, [{"email": "shared@example.com"}])
    await _event(session, "e3", acct_two, [{"email": "shared@example.com"}])
    await _contact(session, "c1", "clear@example.com", None)
    await _contact(session, "c2", "shared@example.com", None)
    await _contact(session, "c3", "unknown@example.com", None)
    await session.commit()

    plan = await plan_backfill(session)
    by_email = {row["email"]: row for row in plan.report}

    assert by_email["clear@example.com"]["selected_owner"] == "u1"
    assert by_email["shared@example.com"]["selected_owner"] is None
    assert by_email["shared@example.com"]["candidates"] == ["u1", "u2"]
    assert by_email["unknown@example.com"]["selected_owner"] is None
    assert plan.unassignable == ["unknown@example.com"]
    assert plan.assignable == ["clear@example.com"]


async def test_apply_assigns_and_is_persisted(session):
    owner = await _owner(session, "u1", "one@example.com")
    contact = await _contact(session, "c1", "guest@example.com", None)
    await session.commit()

    result = await apply_backfill(session, {"guest@example.com": owner.id})

    assert result["assigned"] == [f"guest@example.com -> {owner.id}"]
    await session.refresh(contact)
    assert contact.owner_user_id == "u1"


async def test_apply_skips_an_address_the_owner_already_holds(session):
    """OPEN-008: a plain assign would abort on the partial unique index."""
    owner = await _owner(session, "u1", "one@example.com")
    await _contact(session, "owned", "guest@example.com", owner.id)
    await _contact(session, "unowned", "guest@example.com", None)
    await session.commit()

    result = await apply_backfill(session, {"guest@example.com": owner.id})

    assert result["assigned"] == []
    assert result["skipped_duplicate"] == [
        f"guest@example.com -> {owner.id} (already owned)"
    ]
    # Nothing was merged or overwritten.
    rows = (await session.execute(
        Contact.__table__.select().where(Contact.email == "guest@example.com")
    )).fetchall()
    assert len(rows) == 2


async def test_apply_dry_run_changes_nothing(session):
    owner = await _owner(session, "u1", "one@example.com")
    contact = await _contact(session, "c1", "guest@example.com", None)
    await session.commit()

    result = await apply_backfill(session, {"guest@example.com": owner.id}, dry_run=True)

    assert result["assigned"] == [f"guest@example.com -> {owner.id}"]
    await session.rollback()
    await session.refresh(contact)
    assert contact.owner_user_id is None


async def test_apply_reports_an_address_that_is_not_unowned(session):
    owner = await _owner(session, "u1", "one@example.com")
    await _contact(session, "c1", "guest@example.com", owner.id)
    await session.commit()

    result = await apply_backfill(session, {"guest@example.com": owner.id})

    assert result["unknown"] == ["guest@example.com"]


async def test_plan_ignores_soft_deleted_contacts(session):
    owner = await _owner(session, "u1", "one@example.com")
    account = await _account(session, "acct-1", owner, "one@example.com")
    await _event(session, "e1", account, [{"email": "gone@example.com"}])
    deleted = await _contact(session, "c1", "gone@example.com", None)
    deleted.deleted_at = DAY
    await session.commit()

    plan = await plan_backfill(session)

    assert plan.report == []