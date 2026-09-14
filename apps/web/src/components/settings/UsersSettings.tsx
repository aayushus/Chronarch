import React, { useEffect, useMemo, useState } from "react";
import { friendlyError } from "../../api/client";
import {
  AdminUser,
  adminCreateUser,
  adminListUsers,
  adminUpdateUser,
} from "../../api/admin";
import { useAuth } from "../../api/auth";

export default function UsersSettings() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  function load() {
    adminListUsers()
      .then(setUsers)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleUpdate(u: AdminUser, patch: Partial<AdminUser>) {
    const originalUsers = users;
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...patch } : x)));
    try {
      await adminUpdateUser(u.id, patch);
      setBanner({
        kind: "success",
        text: `Updated settings for ${u.display_name || u.email}.`,
      });
    } catch (e) {
      setError(friendlyError(e));
      setUsers(originalUsers);
    }
  }

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          u.display_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, search, roleFilter]);

  const stats = useMemo(() => {
    const admins = users.filter((u) => u.role === "admin").length;
    const delegates = users.filter((u) => u.role === "delegate").length;
    return { admins, delegates, total: users.length };
  }, [users]);

  if (loading) {
    return (
      <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>
        Loading user accounts…
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              Users & Identities
            </h2>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 12,
                background: "rgba(10, 132, 255, 0.12)",
                color: "var(--primary)",
                border: "1px solid rgba(10, 132, 255, 0.25)",
              }}
            >
              {stats.total} {stats.total === 1 ? "Account" : "Accounts"}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
            Manage admins, delegates, and custom role memberships.
            Roles govern settings access; calendar sharing lives on the Delegates page.
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary hoverable"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          <span>Add User</span>
        </button>
      </div>

      {banner && (
        <div
          style={{
            fontSize: 13,
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 20,
            background: banner.kind === "success" ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 69, 58, 0.15)",
            border: `1px solid ${banner.kind === "success" ? "var(--success)" : "var(--danger)"}`,
            color: banner.kind === "success" ? "var(--success)" : "var(--danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 13,
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 20,
            background: "rgba(255, 69, 58, 0.15)",
            border: "1px solid var(--danger)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "rgba(10, 132, 255, 0.15)",
              color: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            👤
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: 600 }}>
              Admins
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
              {stats.admins}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "rgba(175, 82, 222, 0.15)",
              color: "#bf5af2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            🤝
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: 600 }}>
              Delegates
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
              {stats.delegates}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "rgba(255, 159, 10, 0.15)",
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            🛡️
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: 600 }}>
              System Admins
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
              {stats.admins}
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar / Search */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: "10px 14px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, position: "relative" }}>
          <input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              background: "var(--bg-app)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              padding: "7px 12px 7px 32px",
              fontSize: 12.5,
              boxSizing: "border-box",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 13,
              color: "var(--text-tertiary)",
              pointerEvents: "none",
            }}
          >
            🔍
          </span>
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: 13,
                padding: 2,
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Role:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{
              background: "var(--bg-app)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              padding: "7px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All Roles</option>
            <option value="admin">Admins</option>
            <option value="delegate">Delegates</option>
          </select>
        </div>
      </div>

      {/* User Cards List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filteredUsers.map((u) => {
          const isMe = u.id === currentUser?.id;
          const isAdminRole = u.role === "admin";

          return (
            <div
              key={u.id}
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 12,
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                opacity: u.is_active ? 1 : 0.6,
                transition: "all 0.15s ease",
              }}
            >
              {/* Avatar + Info */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 260 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    background: isAdminRole ? "rgba(10, 132, 255, 0.15)" : "rgba(175, 82, 222, 0.15)",
                    color: isAdminRole ? "var(--primary)" : "#bf5af2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    flexShrink: 0,
                    border: `1px solid ${isAdminRole ? "rgba(10, 132, 255, 0.25)" : "rgba(175, 82, 222, 0.25)"}`,
                  }}
                >
                  {getInitials(u.display_name || u.email)}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                      {u.display_name || "Unnamed User"}
                    </span>
                    {isMe && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: "rgba(10, 132, 255, 0.15)",
                          color: "var(--primary)",
                        }}
                      >
                        YOU
                      </span>
                    )}
                    {u.role === "admin" && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: "rgba(255, 159, 10, 0.15)",
                          color: "var(--warning)",
                          border: "1px solid rgba(255, 159, 10, 0.3)",
                        }}
                      >
                        ADMIN
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                    {u.email}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {/* Role Switcher */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Role:</span>
                  <select
                    value={u.role}
                    onChange={(e) => handleUpdate(u, { role: e.target.value })}
                    style={{
                      background: "var(--bg-app)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--text-primary)",
                      padding: "5px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <option value="admin">Admin</option>
                    <option value="delegate">Delegate</option>
                  </select>
                </div>

                {/* Role memberships (custom roles managed on the Roles tab) */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", maxWidth: 220 }}>
                  {(u.roles ?? []).map((r) => (
                    <span
                      key={r}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background: r === "admin" ? "rgba(255, 159, 10, 0.15)" : "rgba(10, 132, 255, 0.12)",
                        color: r === "admin" ? "var(--warning)" : "var(--primary)",
                      }}
                    >
                      {r}
                    </span>
                  ))}
                  {(u.roles ?? []).length === 0 && (
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>no roles</span>
                  )}
                </div>

                {/* Active Toggle */}
                <label
                  className="hoverable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: isMe ? "not-allowed" : "pointer",
                    padding: "5px 8px",
                    borderRadius: 6,
                    background: u.is_active ? "rgba(40, 200, 64, 0.1)" : "rgba(255, 69, 58, 0.1)",
                    color: u.is_active ? "var(--success)" : "var(--danger)",
                    opacity: isMe ? 0.7 : 1,
                  }}
                  title={isMe ? "You cannot deactivate your own account" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={u.is_active}
                    disabled={isMe}
                    onChange={(e) => handleUpdate(u, { is_active: e.target.checked })}
                    style={{ accentColor: "var(--success)", width: 14, height: 14 }}
                  />
                  <span>Active</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create User Modal */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setBanner({ kind: "success", text: "Successfully added new user." });
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("delegate");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminCreateUser({
        email: email.trim(),
        display_name: displayName.trim(),
        password,
        role,
      });
      onCreated();
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)",
          borderRadius: 14,
          padding: 26,
          width: 440,
          maxWidth: "92vw",
          border: "1px solid var(--border)",
          boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Add New User</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              fontSize: 20,
              cursor: "pointer",
              padding: "2px 6px",
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
          Create an organizational user account and assign calendar authority.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Full Name
            </label>
            <input
              placeholder="e.g. Eleanor Vance"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoFocus
              style={modalInputStyle}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Email Address
            </label>
            <input
              type="email"
              placeholder="e.g. eleanor@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={modalInputStyle}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Temporary Password
            </label>
            <input
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={modalInputStyle}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Primary Role (admin sees everything; delegate sees calendar + copilot)
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={modalInputStyle}
            >
              <option value="delegate">Delegate</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {error && (
            <div
              style={{
                color: "var(--danger)",
                fontSize: 12,
                background: "rgba(255, 69, 58, 0.1)",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} className="btn-secondary hoverable">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary hoverable"
              style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
            >
              {saving ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-app)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  padding: "8px 12px",
  fontSize: 13,
  boxSizing: "border-box",
  colorScheme: "dark",
};
