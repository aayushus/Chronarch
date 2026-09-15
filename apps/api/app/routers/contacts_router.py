"""Contact directory reads (BRD §32).

The directory is built automatically from invites by reconciliation — there
is deliberately no manual add/edit API (this is not a CRM, BRD §34). Any
authenticated user may search: every address here was already visible on a
synced calendar event.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import contacts as _contacts
from chronarch_core.models.user import User

from ..auth import get_current_user
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/contacts", tags=["contacts"])


@router.get("/search")
async def search_contacts(
    q: str = "",
    limit: int = 10,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    rows = await _contacts.search_contacts(session, q, limit)
    return {
        "contacts": [
            {"email": c.email, "display_name": c.display_name,
             "event_count": c.event_count, "last_seen_at": c.last_seen_at}
            for c in rows
        ]
    }
