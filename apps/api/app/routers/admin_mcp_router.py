"""Admin MCP credential management (BRD §19, §30 "MCP").

Raw API keys are only ever returned once, at creation time — only the
SHA-256 hash is stored (apps/mcp/app/auth.py verifies against the same
hash), matching the "provider credentials never exposed" principle for the
MCP-issued credential itself.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chronarch_core.crypto import hash_mcp_key
from chronarch_core.models.mcp_credential import MCPCredential
from chronarch_core.models.user import User

from ..admin_guard import require_admin
from ..deps import get_db_session

router = APIRouter(prefix="/api/v1/admin/mcp-credentials", tags=["admin"])

VALID_SCOPES = {"calendar.read", "calendar.write", "calendar.delete", "availability.read"}


class MCPCredentialOut(BaseModel):
    id: str
    name: str
    user_id: str
    user_email: str
    scopes: list[str]
    revoked: bool

    model_config = {"from_attributes": True}


class MCPCredentialCreate(BaseModel):
    name: str
    user_id: str
    scopes: list[str]


class MCPCredentialCreated(MCPCredentialOut):
    api_key: str  # shown exactly once


@router.get("", response_model=list[MCPCredentialOut])
async def list_credentials(_admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)):
    creds = list((await session.execute(select(MCPCredential))).scalars())
    out = []
    for c in creds:
        user = await session.get(User, c.user_id)
        out.append(
            MCPCredentialOut(
                id=c.id, name=c.name, user_id=c.user_id, user_email=user.email if user else "Unknown",
                scopes=c.scopes, revoked=c.revoked,
            )
        )
    return out


@router.post("", response_model=MCPCredentialCreated, status_code=status.HTTP_201_CREATED)
async def create_credential(
    body: MCPCredentialCreate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    invalid = set(body.scopes) - VALID_SCOPES
    if invalid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid scopes: {sorted(invalid)}")
    user = await session.get(User, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    raw_key = f"chronarch_{secrets.token_urlsafe(32)}"
    cred = MCPCredential(name=body.name, user_id=body.user_id, scopes=body.scopes, key_hash=hash_mcp_key(raw_key))
    session.add(cred)
    await session.flush()

    return MCPCredentialCreated(
        id=cred.id, name=cred.name, user_id=cred.user_id, user_email=user.email,
        scopes=cred.scopes, revoked=cred.revoked, api_key=raw_key,
    )


@router.delete("/{credential_id}", response_model=MCPCredentialOut)
async def revoke_credential(
    credential_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    cred = await session.get(MCPCredential, credential_id)
    if cred is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credential not found")
    cred.revoked = True
    await session.flush()
    user = await session.get(User, cred.user_id)
    return MCPCredentialOut(
        id=cred.id, name=cred.name, user_id=cred.user_id, user_email=user.email if user else "Unknown",
        scopes=cred.scopes, revoked=cred.revoked,
    )
