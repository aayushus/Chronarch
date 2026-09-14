"""RBAC tests: catalog integrity, resolution, and default assignment."""

from chronarch_core import rbac
from chronarch_core.models.enums import UserRole
from chronarch_core.models.rbac import Role, RoleAssignment, RolePermission
from chronarch_core.models.user import User


def test_catalog_covers_expected_groups():
    assert "copilot.use" in rbac.ALL_PERMISSIONS
    assert "mcp_keys.create_self" in rbac.ALL_PERMISSIONS
    assert "ai.view" in rbac.ALL_PERMISSIONS and "ai.manage" in rbac.ALL_PERMISSIONS
    assert "audit.view" in rbac.ALL_PERMISSIONS
    # audit is read-only by design — no manage/delete variant may exist.
    assert not any("audit." in p and p != "audit.view" for p in rbac.ALL_PERMISSIONS)
    assert rbac.DELEGATE_DEFAULT_PERMISSIONS <= rbac.ALL_PERMISSIONS


async def _user(session, email, role):
    u = User(email=email, display_name=email, password_hash="x", role=role)
    session.add(u)
    await session.flush()
    return u


async def test_admin_short_circuits_to_all(session):
    admin = await _user(session, "a@x.com", UserRole.ADMIN)
    assert await rbac.get_user_permissions(session, admin) == rbac.ALL_PERMISSIONS
    assert await rbac.has_permission(session, admin, "oauth.manage")


async def test_delegate_union_and_unknown_filtered(session):
    delegate = await _user(session, "d@x.com", UserRole.DELEGATE)
    assert await rbac.get_user_permissions(session, delegate) == frozenset()

    role = Role(name="ai-viewer", description="")
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission="ai.view"))
    session.add(RolePermission(role_id=role.id, permission="bogus.perm"))
    session.add(RoleAssignment(user_id=delegate.id, role_id=role.id))
    await session.flush()

    assert await rbac.get_user_permissions(session, delegate) == frozenset({"ai.view"})
    assert await rbac.has_permission(session, delegate, "ai.view")
    assert not await rbac.has_permission(session, delegate, "ai.manage")


async def test_ensure_default_role(session):
    delegate = await _user(session, "e@x.com", UserRole.DELEGATE)
    role = Role(id="delegate", name="delegate", description="", is_system=True)
    session.add(role)
    await session.flush()

    await rbac.ensure_default_role(session, delegate.id)
    assert await rbac.get_user_role_names(session, delegate.id) == ["delegate"]
    # Idempotent: second call adds nothing.
    await rbac.ensure_default_role(session, delegate.id)
    assert await rbac.get_user_role_names(session, delegate.id) == ["delegate"]


async def test_admin_holder_count(session):
    a1 = await _user(session, "a1@x.com", UserRole.ADMIN)
    await _user(session, "d1@x.com", UserRole.DELEGATE)
    assert await rbac.admin_holder_count(session) == 1
    assert await rbac.admin_holder_count(session, exclude_user_id=a1.id) == 0
