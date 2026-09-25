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


def _live_only(stmt):
    """Exclude soft-deleted rows from every directory read."""
    return stmt.where(Contact.deleted_at.is_(None))


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
                    await session.execute(select(Contact).where(
                        Contact.email == email,
                        Contact.owner_user_id == account.owner_user_id,
                    ))
                ).scalar_one_or_none()
                now = _now()
                if contact is None:
                    session.add(Contact(
                        email=email, display_name=name or None,
                        owner_user_id=account.owner_user_id,
                        first_seen_at=now, last_seen_at=now, event_count=1,
                    ))
                elif contact.deleted_at is not None:
                    # Soft-deleted stays deleted: never resurrect, never count.
                    continue
                else:
                    contact.last_seen_at = now
                    contact.event_count = (contact.event_count or 0) + 1
                    if not contact.display_name and name and not contact.name_locked:
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
            await session.execute(
                _live_only(select(Contact).where(Contact.email == _clean_email(q))))
        ).scalar_one_or_none()
        if contact is None:
            return {"status": "not_found", "candidates": []}
        return {"status": "found", "contact": contact}

    contacts = list((await session.execute(_live_only(select(Contact)))).scalars())
    hits = [c for c in contacts
            if (c.display_name and _name_match(q, c.display_name)) or _name_match(q, c.email)]
    if not hits:
        return {"status": "not_found", "candidates": []}
    if len(hits) == 1:
        return {"status": "found", "contact": hits[0]}
    hits.sort(key=lambda c: (-(c.event_count or 0), c.display_name or c.email))
    return {"status": "ambiguous", "candidates": hits}


async def search_contacts(session: AsyncSession, query: str, limit: int = 10, owner_user_id: str | None = None) -> list[Contact]:
    """Substring search over names, emails, and companies, most-met first."""
    q = _norm(query)
    stmt = _live_only(select(Contact))
    if owner_user_id is not None:
        stmt = stmt.where(Contact.owner_user_id == owner_user_id)
    contacts = list((await session.execute(stmt)).scalars())
    if q:
        contacts = [c for c in contacts
                    if q in _norm(c.display_name or "") or q in _norm(c.email)
                    or q in _norm(c.company or "")]
    contacts.sort(key=lambda c: (-(c.event_count or 0), c.display_name or c.email))
    return contacts[:max(1, min(limit, 50))]


async def known_people_for_prompt(session: AsyncSession, limit: int = 50) -> list[dict]:
    """Most-met contacts formatted for the quick-add system prompt."""
    contacts = list((await session.execute(_live_only(select(Contact)))).scalars())
    contacts.sort(key=lambda c: (-(c.event_count or 0), c.display_name or c.email))
    return [{"name": c.display_name, "email": c.email}
            for c in contacts[:max(1, min(limit, 200))] if c.display_name]


def _validate_email(email: str) -> str:
    cleaned = _clean_email(email)
    if "@" not in cleaned or "." not in cleaned.split("@")[-1]:
        raise ValueError(f"'{email}' is not a valid email address.")
    return cleaned


async def create_contact(
    session: AsyncSession, *, email: str, display_name: str | None = None,
    phone: str | None = None, company: str | None = None,
    job_title: str | None = None, owner_user_id: str | None = None,
) -> Contact:
    """Manually add someone extraction hasn't seen. Manual rows start
    name-locked so a later invite can't overwrite what was typed here.
    Re-adding a soft-deleted address restores it. Raises ValueError on
    invalid or duplicate email."""
    cleaned = _validate_email(email)
    existing = (
        await session.execute(select(Contact).where(
            Contact.email == cleaned, Contact.owner_user_id == owner_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        if existing.deleted_at is not None:
            existing.deleted_at = None
            existing.last_seen_at = _now()
            await session.flush()
            return existing
        raise ValueError(f"{cleaned} is already in your contacts.")
    contact = Contact(
        email=cleaned, display_name=_clean_name(display_name) or None,
        phone=(phone or "").strip() or None,
        company=(company or "").strip() or None,
        job_title=(job_title or "").strip() or None,
        name_locked=True,
        owner_user_id=owner_user_id,
    )
    session.add(contact)
    await session.flush()
    return contact


async def update_contact(
    session: AsyncSession, contact_id: str, **fields,
) -> Contact | None:
    """Edit name/email/phone/company/job title. Returns None for missing or
    deleted rows. Setting a name locks it against extraction. Changing email
    re-validates and rejects duplicates. Raises ValueError on bad input."""
    contact = await session.get(Contact, contact_id)
    if contact is None or contact.deleted_at is not None:
        return None
    allowed = {"display_name", "email", "phone", "company", "job_title"}
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"Cannot update: {', '.join(sorted(unknown))}.")
    if "email" in fields and fields["email"] is not None:
        cleaned = _validate_email(fields["email"])
        clash = (
            await session.execute(select(Contact).where(
                Contact.email == cleaned, Contact.id != contact_id))
        ).scalar_one_or_none()
        if clash is not None:
            raise ValueError(f"{cleaned} is already in your contacts.")
        contact.email = cleaned
    if "display_name" in fields:
        contact.display_name = _clean_name(fields["display_name"]) or None
        contact.name_locked = True
    for key in ("phone", "company", "job_title"):
        if key in fields:
            setattr(contact, key, (fields[key] or "").strip() or None)
    await session.flush()
    return contact


async def delete_contact(session: AsyncSession, contact_id: str, owner_user_id: str | None = None) -> bool:
    """Soft delete: the row stays (counts intact) but leaves every read, and
    refresh won't resurrect it. Returns False for missing rows."""
    contact = await session.get(Contact, contact_id)
    if contact is None or contact.deleted_at is not None or (owner_user_id is not None and contact.owner_user_id != owner_user_id):
        return False
    contact.deleted_at = _now()
    await session.flush()
    return True


async def restore_contact(session: AsyncSession, contact_id: str, owner_user_id: str | None = None) -> Contact | None:
    """Undo a soft delete. Returns None for missing or live rows."""
    contact = await session.get(Contact, contact_id)
    if contact is None or contact.deleted_at is None or (owner_user_id is not None and contact.owner_user_id != owner_user_id):
        return None
    contact.deleted_at = None
    await session.flush()
    return contact
