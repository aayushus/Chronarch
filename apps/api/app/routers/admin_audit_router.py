"""Admin audit log viewer (BRD §22, §30 "Audit Log")."""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.models.audit import AuditEntry
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.user import User

from ..admin_guard import require_admin
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/audit-log", tags=["admin"])


class AuditEntryOut(BaseModel):
    id: str
    occurred_at: datetime
    actor_type: str
    actor_email: str | None
    action: str
    calendar_name: str | None
    event_id: str | None
    detail: dict


@router.get("", response_model=list[AuditEntryOut])
async def list_audit_log(
    limit: int = 100,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    entries = list(
        (
            await session.execute(
                select(AuditEntry).order_by(desc(AuditEntry.occurred_at)).limit(min(limit, 500))
            )
        ).scalars()
    )

    user_ids = {e.actor_user_id for e in entries if e.actor_user_id}
    users = {u.id: u for u in (await session.execute(select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}

    calendar_ids = {e.calendar_id for e in entries if e.calendar_id}
    calendars = (
        {c.id: c for c in (await session.execute(select(Calendar).where(Calendar.id.in_(calendar_ids)))).scalars()}
        if calendar_ids
        else {}
    )

    return [
        AuditEntryOut(
            id=e.id, occurred_at=e.occurred_at, actor_type=e.actor_type.value,
            actor_email=users[e.actor_user_id].email if e.actor_user_id in users else None,
            action=e.action.value,
            calendar_name=calendars[e.calendar_id].name if e.calendar_id in calendars else None,
            event_id=e.event_id, detail=e.detail,
        )
        for e in entries
    ]
