"""Contact search endpoint tests (BRD §32).

Calls the handler directly with a stub user — no server, no tokens. The DB
is the real sqlite session with invite-extracted rows.
"""

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
