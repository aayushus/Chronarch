"""RBAC: admin/delegate roles, custom role tables, terminology renames.

SQLAlchemy persists enum NAMES, so labels are uppercase (ADMIN/DELEGATE)
while the API exposes lowercase values. Steps:

- users: remap by actual privilege (is_admin true -> ADMIN else DELEGATE),
  drop is_admin. Partial reruns safe (each step checks state first).
- actortype enum: EXECUTIVE_UI -> ADMIN_UI, EA_UI -> DELEGATE_UI (history
  stays readable).
- delegations columns renamed to owner/delegate_user_id (data preserved).
- auditaction gains role-lifecycle labels.
- New roles / role_permissions / role_assignments tables (model is source
  of truth, checkfirst like 0002/0003), seeded admin + delegate roles;
  every existing non-admin user gets the delegate role so copilot.use
  keeps working.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from chronarch_core.models.rbac import Role, RoleAssignment, RolePermission

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table)}


def _enumlabels(name: str) -> set[str]:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
            "WHERE t.typname = :name"
        ),
        {"name": name},
    )
    return {r[0] for r in rows}


def upgrade() -> None:
    # 0. Enum labels first, committed before use (PG forbids both in one txn).
    # NOTE: exact-case match only — 'admin' present does NOT imply 'ADMIN'.
    for label in ("ADMIN", "DELEGATE"):
        if label not in _enumlabels("userrole"):
            op.execute(sa.text(f"ALTER TYPE userrole ADD VALUE '{label}'"))
    for label in ("create_role", "update_role", "delete_role", "assign_role", "revoke_role"):
        if label not in _enumlabels("auditaction"):
            op.execute(sa.text(f"ALTER TYPE auditaction ADD VALUE '{label}'"))
    op.execute(sa.text("COMMIT"))

    user_cols = _columns("users")
    if "is_admin" in user_cols:
        # Privilege-preserving remap, then drop the boolean.
        op.execute(sa.text("UPDATE users SET role = 'DELEGATE' WHERE NOT is_admin"))
        op.execute(sa.text("UPDATE users SET role = 'ADMIN' WHERE is_admin"))
        op.drop_column("users", "is_admin")
    # Normalize any lowercase leftovers (incl. a previously partial run) and
    # any pre-existing EXECUTIVE/ASSISTANT rows missed above.
    op.execute(sa.text("UPDATE users SET role = 'ADMIN' WHERE role::text = 'admin'"))
    op.execute(sa.text("UPDATE users SET role = 'DELEGATE' WHERE role::text = 'delegate'"))
    op.execute(sa.text("UPDATE users SET role = 'DELEGATE' WHERE role::text IN ('EXECUTIVE', 'ASSISTANT')"))


    # 2. Actor type renames (audit history preserved).
    actor_labels = _enumlabels("actortype")
    if "EXECUTIVE_UI" in actor_labels:
        op.execute(sa.text("ALTER TYPE actortype RENAME VALUE 'EXECUTIVE_UI' TO 'ADMIN_UI'"))
    if "EA_UI" in actor_labels:
        op.execute(sa.text("ALTER TYPE actortype RENAME VALUE 'EA_UI' TO 'DELEGATE_UI'"))


    # 3. Delegation column renames (skip if already done).
    deleg_cols = _columns("delegations")
    if "executive_user_id" in deleg_cols:
        op.alter_column("delegations", "executive_user_id", new_column_name="owner_user_id")
    if "assistant_user_id" in deleg_cols:
        op.alter_column("delegations", "assistant_user_id", new_column_name="delegate_user_id")

    # 4. RBAC tables (model is the source of truth, like 0002/0003).
    bind = op.get_bind()
    Role.__table__.create(bind, checkfirst=True)
    RolePermission.__table__.create(bind, checkfirst=True)
    RoleAssignment.__table__.create(bind, checkfirst=True)

    # 5. Seed system roles + delegate defaults + assignments (all guarded).
    op.execute(
        sa.text(
            "INSERT INTO roles (id, name, description, is_system, created_at, updated_at) "
            "SELECT 'admin', 'admin', 'Full access to everything.', true, now(), now() "
            "WHERE NOT EXISTS (SELECT 1 FROM roles WHERE id = 'admin')"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO roles (id, name, description, is_system, created_at, updated_at) "
            "SELECT 'delegate', 'delegate', 'Calendar use, copilot, and own MCP keys.', true, now(), now() "
            "WHERE NOT EXISTS (SELECT 1 FROM roles WHERE id = 'delegate')"
        )
    )
    for perm in ("copilot.use", "mcp_keys.create_self"):
        op.execute(
            sa.text(
                "INSERT INTO role_permissions (id, role_id, permission) "
                "SELECT gen_random_uuid(), 'delegate', :perm WHERE NOT EXISTS "
                "(SELECT 1 FROM role_permissions WHERE role_id = 'delegate' AND permission = :perm)"
            ).bindparams(perm=perm)
        )
    op.execute(
        sa.text(
            "INSERT INTO role_assignments (id, user_id, role_id, created_at, updated_at) "
            "SELECT gen_random_uuid(), u.id, 'delegate', now(), now() FROM users u "
            "WHERE u.role = 'DELEGATE' AND NOT EXISTS "
            "(SELECT 1 FROM role_assignments a WHERE a.user_id = u.id AND a.role_id = 'delegate')"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM role_assignments"))
    op.execute(sa.text("DELETE FROM role_permissions"))
    op.execute(sa.text("DELETE FROM roles"))
    bind = op.get_bind()
    RoleAssignment.__table__.drop(bind, checkfirst=True)
    RolePermission.__table__.drop(bind, checkfirst=True)
    Role.__table__.drop(bind, checkfirst=True)
    op.alter_column("delegations", "owner_user_id", new_column_name="executive_user_id")
    op.alter_column("delegations", "delegate_user_id", new_column_name="assistant_user_id")
    op.execute(sa.text("ALTER TYPE actortype RENAME VALUE 'ADMIN_UI' TO 'EXECUTIVE_UI'"))
    op.execute(sa.text("ALTER TYPE actortype RENAME VALUE 'DELEGATE_UI' TO 'EA_UI'"))
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="false"))
    op.execute(sa.text("UPDATE users SET is_admin = (role = 'ADMIN')"))
    op.execute(sa.text("UPDATE users SET role = 'EXECUTIVE' WHERE role = 'ADMIN'"))
    op.execute(sa.text("UPDATE users SET role = 'ASSISTANT' WHERE role = 'DELEGATE'"))
