from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import ai_tools
from chronarch_core.models.enums import ActorType, UserRole
from chronarch_core.models.user import User

from ..auth import build_auth_context, get_current_user
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/calendars", tags=["calendars"])


def actor_type_for(user: User) -> ActorType:
    return ActorType.EA_UI if user.role == UserRole.ASSISTANT else ActorType.EXECUTIVE_UI


class CalendarOut(BaseModel):
    id: str
    name: str
    color: str
    visible: bool
    writable: bool
    blocks_availability: bool
    kind: str

    model_config = {"from_attributes": True}


@router.get("", response_model=list[CalendarOut])
async def list_calendars(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    ctx = build_auth_context(user, actor_type_for(user))
    calendars = await ai_tools.list_calendars(session, ctx)
    return [
        CalendarOut(
            id=c.id, name=c.name, color=c.color, visible=c.visible,
            writable=c.provider_writable, blocks_availability=c.blocks_availability,
            kind=c.kind.value,
        )
        for c in calendars
    ]
