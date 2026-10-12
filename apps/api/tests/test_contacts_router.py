"""Contact search endpoint tests (BRD §32).

Calls the handler directly with a stub user — no server, no tokens. The DB
is the real sqlite session with invite-extracted rows.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.routers import contacts_router as cr
from chronarch_core.models.contact import Contact
from chronarch_core.models.enums import UserRole
from chronarch_core.models.user import User


async def _user():
    return User(id="u-x", email="x@x.com", display_name="X",
                password_hash="x", role=UserRole.ADMIN)


async def _seed(session):
    session.add_all([
        Contact(email="sarah@acme.com", display_name="Sarah Lin", event_count=10),
        Contact(email="sam@acme.com", display_name="Sam", event_count=1),
        Contact(email="noname@x.com", display_name=None, event_count=3),
    ])
    await session.flush()


async def test_search_empty_query_returns_all_most_met_first(session):
    await _seed(session)
    out = await cr.search_contacts(q="", limit=10, _user=await _user(), session=session)
    assert [c["email"] for c in out["contacts"]] == [
        "sarah@acme.com", "noname@x.com", "sam@acme.com"]
    assert out["contacts"][0]["display_name"] == "Sarah Lin"
    assert out["contacts"][1]["display_name"] is None


async def test_search_filters_names_and_emails(session):
    await _seed(session)
    user = await _user()
    out = await cr.search_contacts(q="sam", limit=10, _user=user, session=session)
    assert [c["email"] for c in out["contacts"]] == ["sam@acme.com"]
    out = await cr.search_contacts(q="ACME.COM", limit=10, _user=user, session=session)
    assert {c["email"] for c in out["contacts"]} == {"sarah@acme.com", "sam@acme.com"}
    out = await cr.search_contacts(q="nobody", limit=10, _user=user, session=session)
    assert out == {"contacts": []}


async def test_search_limit_capped(session):
    await _seed(session)
    out = await cr.search_contacts(q="", limit=2, _user=await _user(), session=session)
    assert len(out["contacts"]) == 2


async def test_create_update_delete_restore_round_trip(session, monkeypatch):
    from fastapi import HTTPException

    user = await _user()
    created = await cr.create_contact(
        cr.ContactCreate(email="Ada@x.com", display_name="Ada",
                         company="Acme", job_title="Eng", phone="+1"),
        _user=user, session=session)
    assert created["email"] == "ada@x.com"
    assert created["company"] == "Acme" and created["phone"] == "+1"
    contact_id = created["id"]

    try:
        await cr.create_contact(cr.ContactCreate(email="ada@x.com"),
                                _user=user, session=session)
        raise AssertionError("expected 409")
    except HTTPException as exc:
        assert exc.status_code == 409
    try:
        await cr.create_contact(cr.ContactCreate(email="bad"),
                                _user=user, session=session)
        raise AssertionError("expected 409")
    except HTTPException as exc:
        assert exc.status_code == 409

    updated = await cr.update_contact(
        contact_id, cr.ContactUpdate(display_name="Ada Lovelace"),
        _user=user, session=session)
    assert updated["display_name"] == "Ada Lovelace"

    fetched = await cr.get_contact(contact_id, _user=user, session=session)
    assert fetched["id"] == contact_id

    await cr.delete_contact(contact_id, _user=user, session=session)
    assert (await cr.search_contacts(q="ada", limit=10, _user=user, session=session)) == {"contacts": []}
    try:
        await cr.get_contact(contact_id, _user=user, session=session)
        raise AssertionError("expected 404")
    except HTTPException as exc:
        assert exc.status_code == 404

    restored = await cr.restore_contact(contact_id, _user=user, session=session)
    assert restored["display_name"] == "Ada Lovelace"
    try:
        await cr.delete_contact("missing", _user=user, session=session)
        raise AssertionError("expected 404")
    except HTTPException as exc:
        assert exc.status_code == 404


async def test_patch_unowned_contact_is_not_writable(session):
    """COV-003: a legacy unowned row must not be editable by an unrelated user.

    `update_contact` now uses the same strict owner check as `delete_contact`
    and `restore_contact`. This asserts the router surfaces the rejection as
    404 — the same answer another user's row gets — rather than performing the
    write, and that the row is left untouched.
    """
    session.add(Contact(email="legacy@acme.com", display_name="Legacy"))
    await session.flush()
    row = (await session.execute(
        select(Contact).where(Contact.email == "legacy@acme.com")
    )).scalar_one()
    assert row.owner_user_id is None

    with pytest.raises(HTTPException) as exc:
        await cr.update_contact(
            row.id,
            cr.ContactUpdate(phone="+1-555-0000", display_name="Hacked"),
            _user=await _user(),
            session=session,
        )
    assert exc.value.status_code == 404

    await session.refresh(row)
    assert row.phone is None
    assert row.display_name == "Legacy"
    assert row.name_locked is False
