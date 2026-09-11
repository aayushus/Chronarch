import React, { useEffect, useState } from "react";

import { AdminUser, adminCreateUser, adminListUsers, adminUpdateUser } from "../../api/admin";
import { useAuth } from "../../api/auth";

export default function UsersSettings() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    adminListUsers()
      .then(setUsers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleUpdate(u: AdminUser, patch: Partial<AdminUser>) {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...patch } : x)));
    try {
      await adminUpdateUser(u.id, patch);
    } catch (e) {
      setError(String(e));
      load();
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Users</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Executive, assistant, and admin accounts (BRD §4). Role determines the default calendar experience;
            admin access is separate and grants this Settings area.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="hoverable" style={btnStyle}>
          + Add User
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {users.map((u) => (
          <div key={u.id} style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{u.display_name}</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{u.email}</div>
            </div>

            <select
              value={u.role}
              onChange={(e) => handleUpdate(u, { role: e.target.value })}
              style={selectStyle}
            >
              <option value="executive">Executive</option>
              <option value="assistant">Assistant</option>
            </select>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={u.is_admin}
                disabled={u.id === currentUser?.id}
                onChange={(e) => handleUpdate(u, { is_admin: e.target.checked })}
              />
              Admin
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={u.is_active}
                disabled={u.id === currentUser?.id}
                onChange={(e) => handleUpdate(u, { is_active: e.target.checked })}
              />
              Active
            </label>
          </div>
        ))}
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("assistant");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await adminCreateUser({ email, display_name: displayName, password, role, is_admin: false });
      onCreated();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={{ background: "var(--bg-panel)", borderRadius: 10, padding: 20, width: 320, display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Add User</div>
        <input placeholder="Full name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required style={inputStyle} />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
        <input type="password" placeholder="Temporary password" value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
          <option value="assistant">Assistant</option>
          <option value="executive">Executive</option>
        </select>
        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, flex: 1, background: "var(--bg-raised-hover)" }}>
            Cancel
          </button>
          <button type="submit" style={{ ...btnStyle, flex: 1, background: "var(--accent)" }}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 6,
  color: "#fff",
  background: "var(--accent)",
  padding: "7px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  colorScheme: "dark",
};

const selectStyle: React.CSSProperties = {
  background: "var(--bg-raised-hover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "5px 8px",
  fontSize: 12,
  colorScheme: "dark",
};
