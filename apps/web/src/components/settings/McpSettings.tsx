import React, { useEffect, useState } from "react";

import {
  AdminUser,
  MCPCredential,
  adminCreateMcpCredential,
  adminListMcpCredentials,
  adminListUsers,
  adminRevokeMcpCredential,
} from "../../api/admin";

const ALL_SCOPES = ["calendar.read", "calendar.write", "calendar.delete", "availability.read"];

export default function McpSettings() {
  const [creds, setCreds] = useState<MCPCredential[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  function load() {
    Promise.all([adminListMcpCredentials(), adminListUsers()])
      .then(([c, u]) => {
        setCreds(c);
        setUsers(u);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleRevoke(c: MCPCredential) {
    try {
      const updated = await adminRevokeMcpCredential(c.id);
      setCreds((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>MCP</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Scoped API keys for external MCP clients like ChatGPT and Claude (BRD §19). Provider OAuth credentials
            are never exposed through these — only the scopes below gate what a client can do.
          </p>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 6 }}>
            MCP server endpoint: <code>http://localhost:8001</code> (configure the port mapping for your deployment)
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="hoverable" style={btnStyle}>
          + New Credential
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {creds.length === 0 && <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No MCP credentials yet.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {creds.map((c) => (
          <div key={c.id} style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 12, opacity: c.revoked ? 0.5 : 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {c.name} {c.revoked && <span style={{ color: "var(--danger)", fontSize: 11, fontWeight: 400 }}>(revoked)</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>acts as {c.user_email}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                {c.scopes.map((s) => (
                  <span key={s} style={{ fontSize: 10, color: "var(--text-secondary)", background: "var(--bg-raised-hover)", borderRadius: 4, padding: "1px 6px" }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
            {!c.revoked && (
              <button onClick={() => handleRevoke(c)} className="hoverable" style={{ background: "none", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      {showCreate && (
        <CreateCredentialModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={(key) => {
            setShowCreate(false);
            setNewKey(key);
            load();
          }}
        />
      )}

      {newKey && (
        <div onClick={() => setNewKey(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", borderRadius: 10, padding: 20, width: 420, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Credential created</div>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
              This key is shown once — copy it now. It won't be retrievable again.
            </p>
            <code style={{ display: "block", background: "var(--bg-raised)", padding: 10, borderRadius: 6, fontSize: 12, wordBreak: "break-all", marginBottom: 12 }}>
              {newKey}
            </code>
            <button onClick={() => setNewKey(null)} style={{ ...btnStyle, width: "100%" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateCredentialModal({
  users,
  onClose,
  onCreated,
}: {
  users: AdminUser[];
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState("");
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [scopes, setScopes] = useState<Set<string>>(new Set(["calendar.read", "availability.read"]));
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const cred = await adminCreateMcpCredential(name, userId, [...scopes]);
      onCreated(cred.api_key);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={{ background: "var(--bg-panel)", borderRadius: 10, padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>New MCP Credential</div>
        <input placeholder="Name (e.g. 'Claude Desktop')" value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Acts as
          <select value={userId} onChange={(e) => setUserId(e.target.value)} style={inputStyle}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Scopes</div>
        {ALL_SCOPES.map((s) => (
          <label key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={scopes.has(s)}
              onChange={(e) =>
                setScopes((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(s);
                  else next.delete(s);
                  return next;
                })
              }
            />
            {s}
          </label>
        ))}
        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, flex: 1, background: "var(--bg-raised-hover)" }}>
            Cancel
          </button>
          <button type="submit" disabled={users.length === 0} style={{ ...btnStyle, flex: 1, background: "var(--accent)" }}>
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
  width: "100%",
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  marginTop: 4,
  colorScheme: "dark",
};
