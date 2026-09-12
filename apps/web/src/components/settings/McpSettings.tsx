import React, { useEffect, useState } from "react";

import {
  AdminUser,
  MCPCredential,
  adminCreateMcpCredential,
  adminListMcpCredentials,
  adminListUsers,
  adminRevokeMcpCredential,
} from "../../api/admin";

interface ScopeDefinition {
  key: string;
  label: string;
  desc: string;
  category: "read" | "write";
}

const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  {
    key: "availability.read",
    label: "Availability (Free/Busy)",
    desc: "Inspect executive busy blocks without seeing meeting titles or details",
    category: "read",
  },
  {
    key: "calendar.read",
    label: "Calendar Details (Read)",
    desc: "Read full meeting titles, descriptions, locations, video links, and attendees",
    category: "read",
  },
  {
    key: "calendar.write",
    label: "Create & Update (Write)",
    desc: "Schedule new meetings and modify existing event parameters",
    category: "write",
  },
  {
    key: "calendar.delete",
    label: "Delete Events",
    desc: "Cancel and remove scheduled calendar entries",
    category: "write",
  },
];

const SCOPE_PRESETS: { id: string; name: string; desc: string; scopes: string[] }[] = [
  {
    id: "read-only",
    name: "Read Only",
    desc: "Free/busy availability + event reading",
    scopes: ["availability.read", "calendar.read"],
  },
  {
    id: "scheduling",
    name: "Scheduler",
    desc: "Read availability & schedule events (no deletion)",
    scopes: ["availability.read", "calendar.read", "calendar.write"],
  },
  {
    id: "full-access",
    name: "Full Authority",
    desc: "Complete calendar read, write, and delete permissions",
    scopes: ["availability.read", "calendar.read", "calendar.write", "calendar.delete"],
  },
];

export default function McpSettings() {
  const [creds, setCreds] = useState<MCPCredential[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

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
    if (!confirm(`Are you sure you want to revoke the credential "${c.name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      const updated = await adminRevokeMcpCredential(c.id);
      setCreds((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
      setBanner({ kind: "success", text: `Credential "${c.name}" has been revoked.` });
    } catch (e) {
      setError(String(e));
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  if (loading) {
    return (
      <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>
        Loading MCP credentials…
      </div>
    );
  }

  const activeCreds = creds.filter((c) => !c.revoked);
  const revokedCreds = creds.filter((c) => c.revoked);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              Model Context Protocol (MCP)
            </h2>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 12,
                background: activeCreds.length > 0 ? "rgba(40, 200, 64, 0.15)" : "rgba(255, 159, 10, 0.15)",
                color: activeCreds.length > 0 ? "var(--success)" : "var(--warning)",
                border: `1px solid ${activeCreds.length > 0 ? "rgba(40, 200, 64, 0.3)" : "rgba(255, 159, 10, 0.3)"}`,
              }}
            >
              {activeCreds.length} Active {activeCreds.length === 1 ? "Client" : "Clients"}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
            Scoped access tokens for external AI clients like Claude Desktop, Cursor, and ChatGPT (BRD §19).
            Provider OAuth tokens are never exposed — agents only receive granular calendar permissions.
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
          <span>New Credential</span>
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

      {/* Quick Server Info / Guide Banner */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(10, 132, 255, 0.15)",
              color: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            ⚡
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              MCP Server Endpoint
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              Connect clients using endpoint <code style={{ fontSize: 12, background: "var(--bg-app)", padding: "1px 6px", borderRadius: 4 }}>http://localhost:8001</code>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowGuide(!showGuide)}
          style={{
            background: "none",
            border: "none",
            color: "var(--primary)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            padding: "4px 8px",
          }}
        >
          {showGuide ? "Hide Setup Guide" : "Client Setup Guide ↗"}
        </button>
      </div>

      {showGuide && (
        <div
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>
            Connecting Claude Desktop or Cursor
          </div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
            Add the following block to your <code>claude_desktop_config.json</code> under the <code>mcpServers</code> key:
          </p>
          <pre
            style={{
              background: "var(--bg-app)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 14,
              fontSize: 12,
              overflowX: "auto",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono, monospace)",
              margin: 0,
            }}
          >{JSON.stringify(
            {
              mcpServers: {
                chronarch: {
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-fetch", "http://localhost:8001/mcp"],
                  env: {
                    CHRONARCH_API_KEY: "chronarch_YOUR_KEY_HERE",
                  },
                },
              },
            },
            null,
            2
          )}</pre>
        </div>
      )}

      {/* Credentials List */}
      {creds.length === 0 ? (
        <div
          style={{
            background: "var(--bg-raised)",
            borderRadius: 12,
            border: "1px dashed var(--border)",
            padding: "40px 20px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.8 }}>🔑</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            No MCP credentials yet
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 18, maxWidth: 460, margin: "0 auto 18px" }}>
            Create an API key to allow external tools like Claude Desktop or ChatGPT to access calendar tools with strict scope isolation.
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary hoverable"
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
          >
            + Create First Credential
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {creds.map((c) => {
            const isRevoked = c.revoked;

            return (
              <div
                key={c.id}
                style={{
                  background: "var(--bg-raised)",
                  borderRadius: 12,
                  border: "1px solid var(--border-subtle)",
                  padding: 20,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  opacity: isRevoked ? 0.6 : 1,
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                  {/* Left: Client info */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 10,
                        background: isRevoked ? "rgba(255, 69, 58, 0.12)" : "rgba(10, 132, 255, 0.15)",
                        color: isRevoked ? "var(--danger)" : "var(--primary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                        flexShrink: 0,
                      }}
                    >
                      {isRevoked ? "🚫" : "🤖"}
                    </div>

                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                          {c.name}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 6,
                            background: isRevoked ? "rgba(255, 69, 58, 0.15)" : "rgba(40, 200, 64, 0.15)",
                            color: isRevoked ? "var(--danger)" : "var(--success)",
                            border: `1px solid ${isRevoked ? "rgba(255, 69, 58, 0.25)" : "rgba(40, 200, 64, 0.25)"}`,
                          }}
                        >
                          {isRevoked ? "REVOKED" : "ACTIVE"}
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                        Acts as identity: <strong style={{ color: "var(--text-primary)" }}>{c.user_email}</strong>
                      </div>

                      {/* Scopes Badges */}
                      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                        {c.scopes.map((s) => {
                          const isWrite = s.includes("write") || s.includes("delete");
                          return (
                            <span
                              key={s}
                              style={{
                                fontSize: 11,
                                fontWeight: 500,
                                color: isWrite ? "var(--warning)" : "var(--primary)",
                                background: isWrite ? "rgba(255, 159, 10, 0.1)" : "rgba(10, 132, 255, 0.1)",
                                border: `1px solid ${isWrite ? "rgba(255, 159, 10, 0.25)" : "rgba(10, 132, 255, 0.25)"}`,
                                borderRadius: 6,
                                padding: "2px 8px",
                              }}
                            >
                              {s}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {!isRevoked && (
                      <button
                        onClick={() => handleRevoke(c)}
                        className="btn-danger hoverable"
                        style={{ padding: "6px 14px", fontSize: 12 }}
                      >
                        Revoke Token
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
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

      {/* One-time Key Display Modal */}
      {newKey && (
        <div
          className="modal-backdrop"
          onClick={() => setNewKey(null)}
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
              width: 480,
              maxWidth: "92vw",
              border: "1px solid var(--border)",
              boxShadow: "0 16px 36px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(40, 200, 64, 0.15)",
                  color: "var(--success)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                }}
              >
                ✓
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>MCP Token Generated</h3>
            </div>

            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.5 }}>
              This API key is only displayed <strong>once</strong>. Store it in a secure location or password manager now.
            </p>

            <div
              style={{
                position: "relative",
                background: "var(--bg-app)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "12px 14px",
                marginBottom: 16,
              }}
            >
              <code
                style={{
                  display: "block",
                  fontSize: 13,
                  fontFamily: "var(--font-mono, monospace)",
                  wordBreak: "break-all",
                  color: "var(--text-primary)",
                  paddingRight: 60,
                }}
              >
                {newKey}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(newKey)}
                className="btn-primary hoverable"
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {copiedKey ? "Copied!" : "Copy"}
              </button>
            </div>

            <button
              onClick={() => setNewKey(null)}
              className="btn-primary hoverable"
              style={{ width: "100%", padding: "9px 0", fontSize: 13, fontWeight: 600 }}
            >
              I have safely copied this key
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
  const [scopes, setScopes] = useState<Set<string>>(
    new Set(["availability.read", "calendar.read"])
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function applyPreset(presetScopes: string[]) {
    setScopes(new Set(presetScopes));
  }

  function toggleScope(scope: string) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (scopes.size === 0) {
      setError("Please select at least one permission scope.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cred = await adminCreateMcpCredential(name.trim(), userId, [...scopes]);
      onCreated(cred.api_key);
    } catch (err) {
      setError(String(err));
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
          width: 500,
          maxWidth: "92vw",
          border: "1px solid var(--border)",
          boxShadow: "0 16px 36px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            Add MCP Client Credential
          </h3>
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
          Generate a scoped token for an autonomous agent or tool client acting on behalf of a specific user.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Client Label */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Client Name
            </label>
            <input
              placeholder="e.g. Claude Desktop, Cursor AI, ChatGPT Agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              style={modalInputStyle}
            />
          </div>

          {/* User selection */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Authorized User Identity
            </label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              style={modalInputStyle}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ? `${u.display_name} (${u.email})` : u.email}
                </option>
              ))}
            </select>
          </div>

          {/* Scope Presets */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                Permission Scopes
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {SCOPE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.scopes)}
                    className="hoverable"
                    title={p.desc}
                    style={{
                      background: "var(--bg-app)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-secondary)",
                      borderRadius: 4,
                      padding: "2px 7px",
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Scope Matrix */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-app)", padding: 12, borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
              {SCOPE_DEFINITIONS.map(({ key, label, desc, category }) => {
                const checked = scopes.has(key);
                return (
                  <label
                    key={key}
                    className="hoverable"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: checked ? "rgba(10, 132, 255, 0.08)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleScope(key)}
                      style={{
                        marginTop: 2,
                        accentColor: category === "write" ? "var(--warning)" : "var(--primary)",
                        width: 14,
                        height: 14,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: checked ? "var(--text-primary)" : "var(--text-secondary)" }}>
                          {label}
                        </span>
                        <code style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{key}</code>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                        {desc}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
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
              disabled={saving || users.length === 0}
              className="btn-primary hoverable"
              style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
            >
              {saving ? "Generating Key…" : "Generate Key"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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

