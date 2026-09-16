"""Invite-extracted contact directory tests (BRD §32).

The DB is the real sqlite session. Sync providers are never touched —
events are inserted directly, exactly as the sync adapters persist them.
"""

from sqlalchemy import select

from chronarch_core import contacts as _contacts
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.contact import Contact
from chronarch_core.models.enums import CalendarKind, ProviderType, UserRole
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User


async def _account(session, email="boss@x.com"):
    user = User(id=f"u-{email}", email=email, display_name="O",
                password_hash="x", role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=ProviderType.GOOGLE,
                      provider_account_email=email, provider_account_id=email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:cal",
                        kind=CalendarKind.PRIMARY, name="Work", provider_writable=True)
    session.add(calendar)
    await session.flush()
    return account, calendar


async def _event(session, account, calendar, attendees, organizer=None):
    from datetime import datetime, timezone

    event = UnifiedEvent(
        provider_account_id=account.id, calendar_id=calendar.id,
        provider_event_id=f"ev-{len(attendees)}-{organizer is not None}",
        title="Sync", start=datetime(2026, 9, 16, 14, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 16, 14, 30, tzinfo=timezone.utc),
        attendees=attendees, organizer=organizer)
    session.add(event)
    await session.flush()
    return event


async def test_refresh_upserts_attendees_and_organizer(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar,
                 [{"email": "John@X.com", "name": "John Appleseed"},
                  {"email": "  jane@x.com  "}],
                 organizer={"email": "org@x.com", "name": "Orga Nizer"})
    out = await _contacts.refresh_contacts_for_account(session, account.id)
    assert out == {"contacts": 3}

    rows = {c.email: c for c in
            (await session.execute(select(Contact))).scalars()}
    assert set(rows) == {"john@x.com", "jane@x.com", "org@x.com"}
    assert rows["john@x.com"].display_name == "John Appleseed"
    assert rows["jane@x.com"].display_name is None
    assert all(c.event_count == 1 for c in rows.values())

    # Refresh re-scans every event, so Jane is sighted twice more (once per
    # event): the counter is a relevance signal, not a census.
    await _event(session, account, calendar, [{"email": "jane@x.com", "name": "Jane"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    assert rows["jane@x.com"].event_count == 3
    assert rows["jane@x.com"].display_name == "Jane"


async def test_refresh_skips_self_and_garbage(session):
    account, calendar = await _account(session, email="me@x.com")
    await _event(session, account, calendar,
                 [{"email": "me@x.com", "name": "Me"},  # own address: not a contact
                  {"email": ""}, {"name": "No Email"}, "garbage",
                  {"email": "not-an-email"}])
    out = await _contacts.refresh_contacts_for_account(session, account.id)
    assert out == {"contacts": 0}


async def test_refresh_unknown_account(session):
    assert await _contacts.refresh_contacts_for_account(session, "missing") == {
        "contacts": 0, "error": "account missing not found"}


async def test_resolve_exact_ambiguous_not_found(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar,
                 [{"email": "john@x.com", "name": "John Appleseed"},
                  {"email": "johnny@x.com", "name": "Johnny Cash"}])
    await _contacts.refresh_contacts_for_account(session, account.id)

    found = await _contacts.resolve_contact(session, "JOHN@x.com")
    assert found["status"] == "found" and found["contact"].email == "john@x.com"

    found = await _contacts.resolve_contact(session, "john appleseed")
    assert found["status"] == "found" and found["contact"].email == "john@x.com"

    # "john" matches both Johns — candidates, most-met first, never a guess.
    amb = await _contacts.resolve_contact(session, "john")
    assert amb["status"] == "ambiguous" and len(amb["candidates"]) == 2

    assert (await _contacts.resolve_contact(session, " stranger " ))["status"] == "not_found"
    assert (await _contacts.resolve_contact(session, ""))["status"] == "not_found"


async def test_search_orders_by_relevance(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar, [{"email": "z@x.com", "name": "Zed Zebra"}])
    await _event(session, account, calendar, [{"email": "a@x.com", "name": "Zed Ally"}])
    await _event(session, account, calendar, [{"email": "a@x.com", "name": "Zed Ally"}])
    await _contacts.refresh_contacts_for_account(session, account.id)

    rows = await _contacts.search_contacts(session, "zed")
    assert [c.email for c in rows] == ["a@x.com", "z@x.com"]
    assert [c.email for c in await _contacts.search_contacts(session, "")] == ["a@x.com", "z@x.com"]
    assert await _contacts.search_contacts(session, "nobody") == []


async def test_known_people_only_named(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar,
                 [{"email": "named@x.com", "name": "Named Person"}, {"email": "anon@x.com"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    assert await _contacts.known_people_for_prompt(session) == [
        {"name": "Named Person", "email": "named@x.com"}]


async def test_existing_name_never_overwritten(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar,
                 [{"email": "keep@x.com", "name": "Original Name"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    # Later sightings with a blank or different name must not clobber it.
    await _event(session, account, calendar,
                 [{"email": "keep@x.com"}, {"email": "keep@x.com", "name": "Different"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    row = (await session.execute(
        select(Contact).where(Contact.email == "keep@x.com"))).scalar_one()
    assert row.display_name == "Original Name"


async def test_ambiguous_candidates_most_met_first(session):
    account, calendar = await _account(session)
    for _ in range(3):
        await _event(session, account, calendar,
                     [{"email": "sam-rare@x.com", "name": "Sam Rare"}])
    await _event(session, account, calendar,
                 [{"email": "sam-often@x.com", "name": "Sam Often"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    out = await _contacts.resolve_contact(session, "sam")
    assert out["status"] == "ambiguous"
    assert [c.email for c in out["candidates"]] == ["sam-rare@x.com", "sam-often@x.com"]


async def test_organizer_without_email_skipped(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar, [],
                 organizer={"name": "No Email Organizer"})
    out = await _contacts.refresh_contacts_for_account(session, account.id)
    assert out == {"contacts": 0}


async def test_search_limit_capped_at_fifty(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar,
                 [{"email": f"p{i}@x.com", "name": f"Person {i}"} for i in range(3)])
    await _contacts.refresh_contacts_for_account(session, account.id)
    assert len(await _contacts.search_contacts(session, "", limit=2)) == 2
    assert len(await _contacts.search_contacts(session, "", limit=5000)) == 3


async def test_create_rejects_invalid_and_duplicate(session):
    import pytest as _pytest

    await _contacts.create_contact(session, email="new@x.com", display_name="New")
    with _pytest.raises(ValueError, match="already in your contacts"):
        await _contacts.create_contact(session, email="NEW@x.com")
    with _pytest.raises(ValueError, match="not a valid email"):
        await _contacts.create_contact(session, email="not-an-email")


async def test_manual_rows_start_locked(session):
    account, calendar = await _account(session)
    contact = await _contacts.create_contact(session, email="vip@x.com", display_name="VIP")
    assert contact.name_locked is True
    # A later invite with a different name must not overwrite the typed one.
    await _event(session, account, calendar,
                 [{"email": "vip@x.com", "name": "Someone Else"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    assert contact.display_name == "VIP"
    assert contact.event_count == 1


async def test_update_locks_name_and_rejects_email_clash(session):
    import pytest as _pytest

    account, calendar = await _account(session)
    await _event(session, account, calendar, [{"email": "flex@x.com"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    row = (await session.execute(
        select(Contact).where(Contact.email == "flex@x.com"))).scalar_one()
    assert row.name_locked is False

    updated = await _contacts.update_contact(
        session, row.id, display_name="Flex", company="Acme", phone="+1")
    assert updated is not None and updated.name_locked is True
    assert updated.company == "Acme" and updated.phone == "+1"

    await _contacts.create_contact(session, email="other@x.com")
    with _pytest.raises(ValueError, match="already in your contacts"):
        await _contacts.update_contact(session, row.id, email="other@x.com")
    assert await _contacts.update_contact(session, "missing", display_name="X") is None


async def test_delete_suppresses_resurrection_and_restore_works(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar, [{"email": "gone@x.com", "name": "Gone"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    row = (await session.execute(
        select(Contact).where(Contact.email == "gone@x.com"))).scalar_one()

    assert await _contacts.delete_contact(session, row.id) is True
    assert await _contacts.delete_contact(session, row.id) is False
    # Refresh sees the invite again but must not resurrect or count it.
    await _contacts.refresh_contacts_for_account(session, account.id)
    assert (await _contacts.resolve_contact(session, "gone@x.com"))["status"] == "not_found"
    assert (await _contacts.search_contacts(session, "gone")) == []

    restored = await _contacts.restore_contact(session, row.id)
    assert restored is not None and restored.deleted_at is None
    assert (await _contacts.resolve_contact(session, "gone@x.com"))["status"] == "found"
    assert await _contacts.restore_contact(session, "missing") is None


async def test_readding_deleted_address_restores(session):
    account, calendar = await _account(session)
    await _event(session, account, calendar, [{"email": "back@x.com", "name": "Back"}])
    await _contacts.refresh_contacts_for_account(session, account.id)
    row = (await session.execute(
        select(Contact).where(Contact.email == "back@x.com"))).scalar_one()
    await _contacts.delete_contact(session, row.id)
    revived = await _contacts.create_contact(session, email="back@x.com")
    assert revived.id == row.id and revived.deleted_at is None
