"""Invite-extracted contact directory (BRD §32 contact integration).

Only source: organizer/attendee entries on synced events. Extraction runs
after every successful reconciliation (worker) and manual sync (API), so the
directory tracks the calendar corpus with no extra provider calls.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models.account import Account
from .models.contact import Contact
from .models.event import UnifiedEvent


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_email(value) -> str:
    return (value or "").strip().lower()


def _clean_name(value) -> str:
    return " ".join((value or "").strip().split())


def _norm(text: str) -> str:
    return " ".join(text.lower().strip().split())


async def refresh_contacts_for_account(session: AsyncSession, account_id: str) -> dict:
    """Upsert contacts from every attendee/organizer on the account's events.

    Skips entries without an email and the account's own address (that's the
    user, not someone they meet with). Idempotent: re-running only refreshes
    timestamps, fills in missing names, and bumps the relevance counter.
    Never raises on weird rows — one malformed attendee must not fail sync.
    """
    account = await session.get(Account, account_id)
    if account is None:
        return {"contacts": 0, "error": f"account {account_id} not found"}
    self_email = _clean_email(account.provider_account_email)

    events = list(
        (await session.execute(
            select(UnifiedEvent).where(UnifiedEvent.provider_account_id == account_id)
        )).scalars()
    )
    seen = 0
    for event in events:
        try:
            people = list(event.attendees or [])
            if isinstance(event.organizer, dict):
                people.append(event.organizer)
            for person in people:
                if not isinstance(person, dict):
                    continue
                email = _clean_email(person.get("email"))
                if not email or "@" not in email or email == self_email:
                    continue
                name = _clean_name(person.get("name"))
                contact = (
                    await session.execute(select(Contact).where(Contact.email == email))
                ).scalar_one_or_none()
                now = _now()
                if contact is None:
                    session.add(Contact(
                        email=email, display_name=name or None,
                        first_seen_at=now, last_seen_at=now, event_count=1,
                    ))
                else:
                    contact.last_seen_at = now
                    contact.event_count = (contact.event_count or 0) + 1
                    if not contact.display_name and name:
                        contact.display_name = name
                seen += 1
        except Exception:
            continue
    await session.flush()
    return {"contacts": seen}


def _name_tokens(name: str) -> set[str]:
    return {t for t in _norm(name).split() if t}


def _name_match(query: str, candidate: str) -> bool:
    """Lenient person matching: exact, substring either way, or shared token.

    "John" matches "John Appleseed"; "appleseed" matches too. Single tokens
    are deliberately loose — ambiguity is resolved by returning candidates,
    never by guessing.
    """
    q, c = _norm(query), _norm(candidate)
    if not q or not c:
        return False
    if q == c or q in c or c in q:
        return True
    return bool(_name_tokens(q) & _name_tokens(c))


async def resolve_contact(session: AsyncSession, query: str) -> dict:
    """Resolve "John" or "john@x.com" against the directory.

    Returns {"status": "found", "contact"} on an unambiguous hit,
    {"status": "ambiguous", "candidates": [...]} when several people match,
    {"status": "not_found"} otherwise. Email queries match exactly;
    name queries use lenient matching above.
    """
    q = (query or "").strip()
    if not q:
        return {"status": "not_found", "candidates": []}
    if "@" in q:
        contact = (
            await session.execute(select(Contact).where(Contact.email == _clean_email(q)))
        ).scalar_one_or_none()
        if contact is None:
            return {"status": "not_found", "candidates": []}
        return {"status": "found", "contact": contact}

    contacts = list((await session.execute(select(Contact))).scalars())
    hits = [c for c in contacts
            if (c.display_name and _name_match(q, c.display_name)) or _name_match(q, c.email)]
    if not hits:
        return {"status": "not_found", "candidates": []}
    if len(hits) == 1:
        return {"status": "found", "contact": hits[0]}
    hits.sort(key=lambda c: (-(c.event_count or 0), c.display_name or c.email))
    return {"status": "ambiguous", "candidates": hits}


async def search_contacts(session: AsyncSession, query: str, limit: int = 10) -> list[Contact]:
    """Substring search over names + emails, most-met first."""
    q = _norm(query)
    contacts = list((await session.execute(select(Contact))).scalars())
    if q:
        contacts = [c for c in contacts
                    if q in _norm(c.display_name or "") or q in _norm(c.email)]
    contacts.sort(key=lambda c: (-(c.event_count or 0), c.display_name or c.email))
    return contacts[:max(1, min(limit, 50))]


async def known_people_for_prompt(session: AsyncSession, limit: int = 50) -> list[dict]:
    """Most-met contacts formatted for the quick-add system prompt."""
    contacts = list((await session.execute(select(Contact))).scalars())
    contacts.sort(key=lambda c: (-(c.event_count or 0), c.display_name or c.email))
    return [{"name": c.display_name, "email": c.email}
            for c in contacts[:max(1, min(limit, 200))] if c.display_name]
