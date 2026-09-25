"""Contact directory reads + manual curation (BRD §32).

The directory fills itself from invites during reconciliation; these
endpoints cover what extraction can't know: adding someone new, fixing a
name, enriching company/phone/job title, and removing people. Manual edits
always win over extraction (locked names, soft deletes that refresh won't
resurrect). Any authenticated user may curate: every address here was
already visible on a synced calendar event.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from pydantic import field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import contacts as _contacts
from chronarch_core.models.contact import Contact
from chronarch_core.models.user import User

from ..auth import get_current_user
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/contacts", tags=["contacts"])


def _out(c: Contact) -> dict:
    return {
        "id": c.id, "email": c.email, "display_name": c.display_name,
        "phone": c.phone, "company": c.company, "job_title": c.job_title,
        "event_count": c.event_count, "last_seen_at": c.last_seen_at,
    }


class ContactCreate(BaseModel):
    email: str
    display_name: str | None = None
    phone: str | None = None
    company: str | None = None
    job_title: str | None = None

    @field_validator("email")
    @classmethod
    def _safe_email(cls, value: str) -> str:
        if "\r" in value or "\n" in value:
            raise ValueError("email must not contain line breaks")
        return value.strip()


class ContactUpdate(BaseModel):
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    job_title: str | None = None

    @field_validator("email")
    @classmethod
    def _safe_email(cls, value: str | None) -> str | None:
        if value is not None and ("\r" in value or "\n" in value):
            raise ValueError("email must not contain line breaks")
        return value.strip() if value is not None else None


@router.get("/search")
async def search_contacts(
    q: str = "",
    limit: int = 10,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    rows = await _contacts.search_contacts(session, q, limit, _user.id)
    return {"contacts": [_out(c) for c in rows]}


@router.get("/{contact_id}")
async def get_contact(
    contact_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    contact = await session.get(Contact, contact_id)
    if contact is None or contact.deleted_at is not None or contact.owner_user_id != _user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found.")
    return _out(contact)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_contact(
    body: ContactCreate,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    try:
        contact = await _contacts.create_contact(
            session, email=body.email, display_name=body.display_name,
            phone=body.phone, company=body.company, job_title=body.job_title,
            owner_user_id=_user.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return _out(contact)


@router.patch("/{contact_id}")
async def update_contact(
    contact_id: str,
    body: ContactUpdate,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    try:
        contact = await _contacts.update_contact(
            session, contact_id,
            **{k: v for k, v in body.model_dump().items() if v is not None})
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found.")
    return _out(contact)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    if not await _contacts.delete_contact(session, contact_id, owner_user_id=_user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found.")
    return None


@router.post("/{contact_id}/restore")
async def restore_contact(
    contact_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    contact = await _contacts.restore_contact(session, contact_id, owner_user_id=_user.id)
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found.")
    return _out(contact)
