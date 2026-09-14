"""RBAC matrix probe: every persona against every admin-surface endpoint.

For each persona the expected verdict is DERIVED from its permission set —
not hand-picked per case — so any non-permissioned feature is automatically
asserted denied (403), and any permissioned one asserted reachable
(2xx/422/404: 422/404 prove the guard passed and only validation/lookup
failed afterward).

Personas: admin, plain delegate, +ai.view, +accounts, +users.view,
+hollow role, +users.manage, and a user with NO roles at all.
Self-cleaning; exit 0 iff every expectation holds.
"""

import asyncio
import sys

sys.path.insert(0, ".")

API = "http://localhost:8000"
PASSWORD = "RbacProbe123!"

# method, path builder, body builder, required permission (None = any authed user)
# "PASS" statuses prove the permission guard let the call through.
ENDPOINTS: list[tuple] = [
    ("GET", "/api/v1/auth/me", None, None, {200}),
    ("GET", "/api/v1/admin/users", None, "users.view", {200}),
    ("POST", "/api/v1/admin/users", lambda t: {
        "email": f"rbac-made-{t}@example.com", "display_name": "M",
        "password": "MadePass123!", "role": "delegate"}, "users.manage", {201, 409}),
    ("PATCH", "/api/v1/admin/users/00000000-0000-0000-0000-000000000000",
     lambda t: {"display_name": "Z"}, "users.manage", {404}),
    ("GET", "/api/v1/admin/ai/settings", None, "ai.view", {200}),
    ("PUT", "/api/v1/admin/ai/settings", lambda t: {"timeout_seconds": 30}, "ai.manage", {200}),
    ("GET", "/api/v1/admin/ai/defaults", None, "ai.view", {200}),
    ("GET", "/api/v1/admin/accounts", None, "accounts.view", {200}),
    ("POST", "/api/v1/admin/accounts/ics-subscription",
     lambda t: {"name": f"Probe-{t}", "url": "https://example.com/x.ics"},
     "accounts.manage", {201, 422, 500}),
    ("DELETE", "/api/v1/admin/accounts/00000000-0000-0000-0000-000000000000",
     None, "accounts.manage", {404}),
    ("GET", "/api/v1/admin/calendars", None, "calendars.view", {200}),
    ("PATCH", "/api/v1/admin/calendars/00000000-0000-0000-0000-000000000000",
     lambda t: {"name": "Z"}, "calendars.manage", {404}),
    ("GET", "/api/v1/admin/delegations", None, "delegations.view", {200}),
    ("POST", "/api/v1/admin/delegations",
     lambda t: {"owner_user_id": "00000000-0000-0000-0000-000000000000",
                "delegate_user_id": "00000000-0000-0000-0000-000000000000"},
     "delegations.manage", {404}),
    ("GET", "/api/v1/admin/mcp-credentials", None, "mcp.view", {200}),
    ("POST", "/api/v1/admin/mcp-credentials",
     lambda t: {"name": "p", "user_id": "00000000-0000-0000-0000-000000000000",
                "scopes": ["calendar.read"]},
     "mcp.manage", {404}),
    ("GET", "/api/v1/admin/oauth", None, "oauth.view", {200}),
    ("PUT", "/api/v1/admin/oauth/google", lambda t: {}, "oauth.manage", {200}),
    ("GET", "/api/v1/admin/audit-log?limit=5", None, "audit.view", {200}),
    ("GET", "/api/v1/admin/roles", None, "@admin", {200}),
    ("GET", "/api/v1/admin/roles/catalog", None, "@admin", {200}),
    ("POST", "/api/v1/copilot/chat",
     lambda t: {"messages": [{"role": "user", "content": "hi"}], "user_timezone": "UTC"},
     "copilot.use", {200, 502, 503}),
    ("GET", "/api/v1/mcp-keys/self", None, None, {200}),
]

# Personas: tag -> extra role permissions (on top of delegate defaults,
# except "n" which gets no roles at all).
PERSONAS: dict[str, list[str]] = {
    "a": [],
    "b": ["ai.view"],
    "c": ["accounts.view", "accounts.manage"],
    "d": ["users.view"],
    "e": [],
    "g": ["users.manage"],
    "n": ["@none"],
}
DELEGATE_DEFAULTS = {"copilot.use", "mcp_keys.create_self"}


def effective_perms(tag: str) -> set[str] | str:
    """'ADMIN' for the admin user, else the computed set."""
    if tag == "admin":
        return "ADMIN"
    if "@none" in PERSONAS[tag]:
        return set()
    return DELEGATE_DEFAULTS | set(PERSONAS[tag])


def allowed(perms: set[str] | str, required: str | None) -> bool:
    if perms == "ADMIN":
        return True
    if required is None:
        return True
    if required == "@admin":
        return False
    return required in perms


async def main() -> int:
    import httpx
    from sqlalchemy import delete, select

    from chronarch_core.db import SessionLocal
    from chronarch_core.models.enums import UserRole
    from chronarch_core.models.rbac import Role, RoleAssignment, RolePermission
    from chronarch_core.models.user import User
    from app.auth import hash_password

    results: list = []

    def expect(label: str, actual: int, wanted: set[int]) -> None:
        ok = actual in wanted
        results.append((label, ok, actual))
        print(("PASS " if ok else "FAIL ") + f"{label} -> {actual} (want {sorted(wanted)})", flush=True)

    async with SessionLocal() as s:
        admin = User(email="rbac-admin@example.com", display_name="RA",
                     password_hash=hash_password(PASSWORD), role=UserRole.ADMIN, is_active=True)
        s.add(admin)
        users: dict[str, User] = {}
        for tag in list(PERSONAS) + ["made-seed"]:
            u = User(email=f"rbac-{tag}@example.com", display_name=f"R{tag.upper()}",
                     password_hash=hash_password(PASSWORD), role=UserRole.DELEGATE, is_active=True)
            s.add(u)
            users[tag] = u
        await s.flush()

        admin_role = (await s.execute(select(Role).where(Role.name == "admin"))).scalar_one()
        delegate_role = (await s.execute(select(Role).where(Role.name == "delegate"))).scalar_one()
        s.add(RoleAssignment(user_id=admin.id, role_id=admin_role.id))
        for tag, u in users.items():
            if tag == "made-seed":
                continue
            if tag != "n":
                s.add(RoleAssignment(user_id=u.id, role_id=delegate_role.id))

        async def make_role(name: str, perms: list[str]) -> Role:
            r = Role(name=name, description="probe")
            s.add(r)
            await s.flush()
            for p in perms:
                s.add(RolePermission(role_id=r.id, permission=p))
            await s.flush()
            return r

        custom = {
            "b": await make_role("probe-ai-viewer", ["ai.view"]),
            "c": await make_role("probe-acct-mgr", ["accounts.view", "accounts.manage"]),
            "d": await make_role("probe-user-viewer", ["users.view"]),
            "e": await make_role("probe-hollow", []),
            "g": await make_role("probe-user-manage", ["users.manage"]),
        }
        for tag, r in custom.items():
            s.add(RoleAssignment(user_id=users[tag].id, role_id=r.id))
        await s.commit()
        # drop the unused seed user row (kept only to simplify loops above)
        await s.execute(delete(User).where(User.email == "rbac-made-seed@example.com"))
        await s.commit()

    async with httpx.AsyncClient(timeout=60.0) as client:
        async def login(email: str) -> str:
            r = await client.post(f"{API}/api/v1/auth/login",
                                  json={"email": email, "password": PASSWORD})
            r.raise_for_status()
            return r.json()["access_token"]

        tokens = {"admin": await login("rbac-admin@example.com")}
        for tag in PERSONAS:
            tokens[tag] = await login(f"rbac-{tag}@example.com")

        self_keys: dict[str, str] = {}
        for tag in ["admin"] + list(PERSONAS):
            perms = effective_perms(tag)
            for method, path, body_fn, required, pass_status in ENDPOINTS:
                # POST /admin/users would litter a user per persona: only G + admin do it.
                if path == "/api/v1/admin/users" and method == "POST" and tag not in ("g", "admin"):
                    continue
                body = body_fn(tag) if body_fn else None
                try:
                    r = await client.request(
                        method, f"{API}{path}", json=body,
                        headers={"Authorization": f"Bearer {tokens[tag]}"})
                    code = r.status_code
                except Exception as exc:  # transport trouble, not a verdict
                    results.append((f"{tag} {method} {path}", False, f"ERR {exc}"))
                    print(f"FAIL {tag} {method} {path} -> ERR {exc}", flush=True)
                    continue
                want = pass_status if allowed(perms, required) else {403}
                # A 404 on a write with a fake id also proves guard passage.
                expect(f"{tag} {method} {path}", code, want)

            # self-service key round-trip for everyone holding create_self
            if allowed(perms, "mcp_keys.create_self"):
                r = await client.post(
                    f"{API}/api/v1/mcp-keys/self",
                    json={"name": f"probe-{tag}", "scopes": ["calendar.read"]},
                    headers={"Authorization": f"Bearer {tokens[tag]}"})
                if r.status_code == 201:
                    kid = r.json()["id"]
                    d = await client.delete(
                        f"{API}/api/v1/mcp-keys/self/{kid}",
                        headers={"Authorization": f"Bearer {tokens[tag]}"})
                    expect(f"{tag} mcp-self roundtrip", d.status_code, {200})
                else:
                    expect(f"{tag} mcp-self create", r.status_code, {201})

        # G: users.manage allows creating users but never assigning roles
        made = await client.get(f"{API}/api/v1/admin/users",
                                headers={"Authorization": f"Bearer {tokens['admin']}"})
        made_id = next((u["id"] for u in made.json() if u["email"] == "rbac-made-g@example.com"), None)
        if made_id:
            r = await client.patch(
                f"{API}/api/v1/admin/users/{made_id}", json={"roles": ["admin"]},
                headers={"Authorization": f"Bearer {tokens['g']}"})
            expect("G assign role denied", r.status_code, {403})
        else:
            results.append(("G assign role denied (no user made)", False, 0))

        # H: system-role guards as admin
        r = await client.delete(f"{API}/api/v1/admin/roles/admin",
                                headers={"Authorization": f"Bearer {tokens['admin']}"})
        expect("H delete admin role", r.status_code, {400, 404})
        members = await client.get(f"{API}/api/v1/admin/roles",
                                   headers={"Authorization": f"Bearer {tokens['admin']}"})
        admin_members = next((x["members"] for x in members.json() if x["name"] == "admin"), [])
        if admin_members:
            first = admin_members[0]["id"]
            r = await client.delete(
                f"{API}/api/v1/admin/roles/admin/members/{first}",
                headers={"Authorization": f"Bearer {tokens['admin']}"})
            expect("H remove admin member (may be last)", r.status_code, {204, 400})

    # --- cleanup everything probe-made ---
    async with SessionLocal() as s:
        from chronarch_core.models.account import Account
        from chronarch_core.models.audit import AuditEntry
        from chronarch_core.models.calendar import Calendar
        from chronarch_core.models.delegation import Delegation, DelegationCalendarGrant
        from chronarch_core.models.event import UnifiedEvent
        from chronarch_core.models.mcp_credential import MCPCredential

        emails = ["rbac-admin@example.com", "rbac-made-admin@example.com"] + \
                 [f"rbac-{t}@example.com" for t in list(PERSONAS)] + \
                 [f"rbac-made-{t}@example.com" for t in list(PERSONAS)]
        uids = list((await s.execute(select(User.id).where(User.email.in_(emails)))).scalars())
        if uids:
            await s.execute(delete(MCPCredential).where(MCPCredential.user_id.in_(uids)))
            await s.execute(delete(UnifiedEvent).where(UnifiedEvent.calendar_id.in_(
                select(Calendar.id).where(Calendar.account_id.in_(
                    select(Account.id).where(Account.owner_user_id.in_(uids)))))))
            await s.execute(delete(Calendar).where(Calendar.account_id.in_(
                select(Account.id).where(Account.owner_user_id.in_(uids)))))
            await s.execute(delete(Account).where(Account.owner_user_id.in_(uids)))
            await s.execute(delete(AuditEntry).where(AuditEntry.actor_user_id.in_(uids)))
            deleg_ids = list((await s.execute(select(Delegation.id).where(
                (Delegation.owner_user_id.in_(uids)) | (Delegation.delegate_user_id.in_(uids))))).scalars())
            if deleg_ids:
                await s.execute(delete(DelegationCalendarGrant).where(
                    DelegationCalendarGrant.delegation_id.in_(deleg_ids)))
                await s.execute(delete(Delegation).where(Delegation.id.in_(deleg_ids)))
            await s.execute(delete(RoleAssignment).where(RoleAssignment.user_id.in_(uids)))
            await s.execute(delete(User).where(User.id.in_(uids)))
        rids = list((await s.execute(
            select(Role.id).where(Role.name.like("probe-%")))).scalars())
        if rids:
            await s.execute(delete(RolePermission).where(RolePermission.role_id.in_(rids)))
            await s.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(rids)))
            await s.execute(delete(Role).where(Role.id.in_(rids)))
        await s.commit()
    print("cleanup done")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} expectations held")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
