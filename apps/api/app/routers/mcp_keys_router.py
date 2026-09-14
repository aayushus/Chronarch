"""Self-service MCP credentials: any authenticated user can list, issue, and
revoke their OWN keys (delegates get this via `mcp_keys.create_self`).
Full management across users stays on the admin surface with `mcp.manage`.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core import rbac as _rbac
from chronarch_core.crypto import hash_mcp_key
from chronarch_core.models.mcp_credential import MCPCredential
from chronarch_core.models.user import User

from ..auth import get_current_user
from ..deps import get_db_session
from .admin_mcp_router import (
    VALID_SCOPES,
    MCPCredentialCreated,
    MCPCredentialOut,
)

router = APIRouter(prefix="/api/v1/mcp-keys", tags=["mcp-keys"])


async def _can_self_serve(session: AsyncSession, user: User) -> bool:
    return await _rbac.has_permission(
        session, user, "mcp.manage"
    ) or await _rbac.has_permission(session, user, "mcp_keys.create_self")


def _to_out(cred: MCPCredential) -> MCPCredentialOut:
    return MCPCredentialOut(
        id=cred.id, name=cred.name, user_id=cred.user_id, user_email="",
        scopes=cred.scopes, revoked=cred.revoked,
    )


@router.get("/self", response_model=list[MCPCredentialOut])
async def list_own_keys(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    creds = list(
        (await session.execute(select(MCPCredential).where(MCPCredential.user_id == user.id))).scalars()
    )
    return [
        MCPCredentialOut(
            id=c.id, name=c.name, user_id=c.user_id, user_email=user.email,
            scopes=c.scopes, revoked=c.revoked,
        )
        for c in creds
    ]


class SelfCredentialCreate(BaseModel):
    name: str
    scopes: list[str]


@router.post("/self", response_model=MCPCredentialCreated, status_code=status.HTTP_201_CREATED)
async def create_own_key(
    body: SelfCredentialCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    if not await _can_self_serve(session, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires the 'mcp_keys.create_self' permission")
    invalid = set(body.scopes) - VALID_SCOPES
    if invalid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid scopes: {sorted(invalid)}")

    raw_key = f"chronarch_{secrets.token_urlsafe(32)}"
    cred = MCPCredential(name=body.name, user_id=user.id, scopes=body.scopes, key_hash=hash_mcp_key(raw_key))
    session.add(cred)
    await session.flush()

    return MCPCredentialCreated(
        id=cred.id, name=cred.name, user_id=cred.user_id, user_email=user.email,
        scopes=cred.scopes, revoked=cred.revoked, api_key=raw_key,
    )


@router.delete("/self/{credential_id}", response_model=MCPCredentialOut)
async def revoke_own_key(
    credential_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    if not await _can_self_serve(session, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires the 'mcp_keys.create_self' permission")
    cred = await session.get(MCPCredential, credential_id)
    if cred is None or cred.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credential not found")
    cred.revoked = True
    await session.flush()
    return MCPCredentialOut(
        id=cred.id, name=cred.name, user_id=cred.user_id, user_email=user.email,
        scopes=cred.scopes, revoked=cred.revoked,
    )
