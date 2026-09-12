import React, { useEffect, useMemo, useState } from "react";
import { AuditEntry, adminListAuditLog } from "../../api/admin";

interface ActionMeta {
  label: string;
  category: "create" | "update" | "delete" | "access" | "system";
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
}

const ACTION_METAS: Record<string, ActionMeta> = {
  create_event: {
    label: "Create Event",
    category: "create",
    badgeBg: "rgba(40, 200, 64, 0.15)",
    badgeColor: "var(--success)",
    badgeBorder: "rgba(40, 200, 64, 0.3)",
  },
  import_ics: {
    label: "Import ICS",
    category: "create",
    badgeBg: "rgba(40, 200, 64, 0.15)",
    badgeColor: "var(--success)",
    badgeBorder: "rgba(40, 200, 64, 0.3)",
  },
  connect_account: {
    label: "Connect Account",
    category: "create",
    badgeBg: "rgba(40, 200, 64, 0.15)",
    badgeColor: "var(--success)",
    badgeBorder: "rgba(40, 200, 64, 0.3)",
  },
  grant_delegation: {
    label: "Grant Delegation",
    category: "create",
    badgeBg: "rgba(40, 200, 64, 0.15)",
    badgeColor: "var(--success)",
    badgeBorder: "rgba(40, 200, 64, 0.3)",
  },

  update_event: {
    label: "Update Event",
    category: "update",
    badgeBg: "rgba(10, 132, 255, 0.15)",
    badgeColor: "var(--primary)",
    badgeBorder: "rgba(10, 132, 255, 0.3)",
  },
  move_event: {
    label: "Move Event",
    category: "update",
    badgeBg: "rgba(10, 132, 255, 0.15)",
    badgeColor: "var(--primary)",
    badgeBorder: "rgba(10, 132, 255, 0.3)",
  },
  reschedule_event: {
    label: "Reschedule",
    category: "update",
    badgeBg: "rgba(10, 132, 255, 0.15)",
    badgeColor: "var(--primary)",
    badgeBorder: "rgba(10, 132, 255, 0.3)",
  },
  resize_event: {
    label: "Resize Duration",
    category: "update",
    badgeBg: "rgba(10, 132, 255, 0.15)",
    badgeColor: "var(--primary)",
    badgeBorder: "rgba(10, 132, 255, 0.3)",
  },
  add_attendee: {
    label: "Add Attendee",
    category: "update",
    badgeBg: "rgba(10, 132, 255, 0.15)",
    badgeColor: "var(--primary)",
    badgeBorder: "rgba(10, 132, 255, 0.3)",
  },
  respond_to_event: {
    label: "RSVP Response",
    category: "update",
    badgeBg: "rgba(10, 132, 255, 0.15)",
    badgeColor: "var(--primary)",
    badgeBorder: "rgba(10, 132, 255, 0.3)",
  },
  update_calendar_settings: {
    label: "Update Settings",
    category: "update",
    badgeBg: "rgba(10, 132, 255, 0.15)",
    badgeColor: "var(--primary)",
    badgeBorder: "rgba(10, 132, 255, 0.3)",
  },

  delete_event: {
    label: "Delete Event",
    category: "delete",
    badgeBg: "rgba(255, 69, 58, 0.15)",
    badgeColor: "var(--danger)",
    badgeBorder: "rgba(255, 69, 58, 0.3)",
  },
  remove_attendee: {
    label: "Remove Attendee",
    category: "delete",
    badgeBg: "rgba(255, 69, 58, 0.15)",
    badgeColor: "var(--danger)",
    badgeBorder: "rgba(255, 69, 58, 0.3)",
  },
  disconnect_account: {
    label: "Disconnect Account",
    category: "delete",
    badgeBg: "rgba(255, 69, 58, 0.15)",
    badgeColor: "var(--danger)",
    badgeBorder: "rgba(255, 69, 58, 0.3)",
  },
  revoke_delegation: {
    label: "Revoke Delegation",
    category: "delete",
    badgeBg: "rgba(255, 69, 58, 0.15)",
    badgeColor: "var(--danger)",
    badgeBorder: "rgba(255, 69, 58, 0.3)",
  },
};

const ACTOR_METAS: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  executive_ui: {
    label: "Executive UI",
    icon: "👤",
    bg: "rgba(10, 132, 255, 0.12)",
    color: "var(--primary)",
  },
  ea_ui: {
    label: "Assistant",
    icon: "🤝",
    bg: "rgba(175, 82, 222, 0.15)",
    color: "#bf5af2",
  },
  copilot: {
    label: "AI Copilot",
    icon: "✨",
    bg: "rgba(255, 159, 10, 0.15)",
    color: "var(--warning)",
  },
  mcp: {
    label: "MCP Agent",
    icon: "🤖",
    bg: "rgba(50, 215, 75, 0.15)",
    color: "var(--success)",
  },
  ics_import: {
    label: "ICS File",
    icon: "📅",
    bg: "rgba(255, 255, 255, 0.08)",
    color: "var(--text-secondary)",
  },
  api: {
    label: "REST API",
    icon: "⚡",
    bg: "rgba(255, 255, 255, 0.08)",
    color: "var(--text-secondary)",
  },
  system: {
    label: "System",
    icon: "⚙️",
    bg: "rgba(255, 255, 255, 0.08)",
    color: "var(--text-secondary)",
  },
};

export default function AuditLogSettings() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedActor, setSelectedActor] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Selected item for modal details
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  useEffect(() => {
    adminListAuditLog(300)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      // Actor filter
      if (selectedActor !== "all" && e.actor_type !== selectedActor) {
        return false;
      }

      // Category filter
      if (selectedCategory !== "all") {
        const meta = ACTION_METAS[e.action];
        if (!meta || meta.category !== selectedCategory) {
          return false;
        }
      }

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const actionLabel = ACTION_METAS[e.action]?.label?.toLowerCase() ?? e.action.toLowerCase();
        const actorEmail = e.actor_email?.toLowerCase() ?? "";
        const calName = e.calendar_name?.toLowerCase() ?? "";
        const detailStr = JSON.stringify(e.detail).toLowerCase();

        return (
          actionLabel.includes(q) ||
          actorEmail.includes(q) ||
          calName.includes(q) ||
          detailStr.includes(q)
        );
      }

      return true;
    });
  }, [entries, search, selectedActor, selectedCategory]);

  if (loading) {
    return (
      <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>
        Loading immutable audit log…
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            Audit Log
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
            Append-Only · Cryptographically Scrubbed
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
          Immutable ledger recording every modification across Executive UI, Assistant UI, ICS Import,
          Copilot, and MCP tools. Sensitive authorization secrets are stripped before persistence.
        </p>
      </div>

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

      {/* Filter Toolbar Card */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
        }}
      >
        {/* Search */}
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <input
            placeholder="Search by action, user, calendar, or details…"
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

        {/* Actor Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Source:</span>
          <select
            value={selectedActor}
            onChange={(e) => setSelectedActor(e.target.value)}
            style={{
              background: "var(--bg-app)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              padding: "7px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All Sources</option>
            <option value="executive_ui">Executive UI</option>
            <option value="ea_ui">Assistant</option>
            <option value="copilot">AI Copilot</option>
            <option value="mcp">MCP Agent</option>
            <option value="ics_import">ICS Import</option>
            <option value="api">API</option>
            <option value="system">System</option>
          </select>
        </div>

        {/* Action Category Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Type:</span>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{
              background: "var(--bg-app)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              padding: "7px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All Operations</option>
            <option value="create">Created / Added</option>
            <option value="update">Updated / Rescheduled</option>
            <option value="delete">Deleted / Revoked</option>
          </select>
        </div>

        <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
          Showing {filteredEntries.length} of {entries.length} entries
        </span>
      </div>

      {/* Audit Log Table Card */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        {filteredEntries.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.8 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
              No audit records match your filter
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Try clearing your search terms or filter selections.
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 12.5 }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  background: "rgba(0,0,0,0.12)",
                }}
              >
                <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text-secondary)", width: 140 }}>
                  Timestamp
                </th>
                <th style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-secondary)", width: 130 }}>
                  Source
                </th>
                <th style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-secondary)", width: 160 }}>
                  Operation
                </th>
                <th style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-secondary)" }}>
                  Target / Actor
                </th>
                <th style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-secondary)", width: 220 }}>
                  Details
                </th>
                <th style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-secondary)", width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((e, idx) => {
                const actionMeta = ACTION_METAS[e.action] || {
                  label: e.action.replace(/_/g, " "),
                  category: "update",
                  badgeBg: "var(--bg-app)",
                  badgeColor: "var(--text-secondary)",
                  badgeBorder: "var(--border)",
                };
                const actorMeta = ACTOR_METAS[e.actor_type] || {
                  label: e.actor_type,
                  icon: "⚡",
                  bg: "var(--bg-app)",
                  color: "var(--text-secondary)",
                };

                const date = new Date(e.occurred_at);
                const isOdd = idx % 2 === 1;

                return (
                  <tr
                    key={e.id}
                    onClick={() => setSelectedEntry(e)}
                    className="hoverable"
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      background: isOdd ? "rgba(255, 255, 255, 0.015)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {/* Timestamp */}
                    <td
                      style={{
                        padding: "11px 16px",
                        whiteSpace: "nowrap",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 11.5,
                      }}
                    >
                      <div>
                        {date.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                      <div style={{ color: "var(--text-tertiary)", fontSize: 10.5 }}>
                        {date.toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </div>
                    </td>

                    {/* Actor Source */}
                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: actorMeta.bg,
                          color: actorMeta.color,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        <span>{actorMeta.icon}</span>
                        <span>{actorMeta.label}</span>
                      </div>
                    </td>

                    {/* Operation Badge */}
                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: actionMeta.badgeBg,
                          color: actionMeta.badgeColor,
                          border: `1px solid ${actionMeta.badgeBorder}`,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {actionMeta.label}
                      </span>
                    </td>

                    {/* Target / Actor */}
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {e.actor_email && (
                          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                            {e.actor_email}
                          </div>
                        )}
                        {e.calendar_name && (
                          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                            Calendar: <span style={{ color: "var(--text-secondary)" }}>{e.calendar_name}</span>
                          </div>
                        )}
                        {!e.actor_email && !e.calendar_name && (
                          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>System routine</div>
                        )}
                      </div>
                    </td>

                    {/* Detail Preview */}
                    <td style={{ padding: "11px 14px", maxWidth: 240 }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--text-tertiary)",
                          fontSize: 11.5,
                          fontFamily: "var(--font-mono, monospace)",
                        }}
                      >
                        {formatShortDetail(e.detail)}
                      </div>
                    </td>

                    {/* Inspect View */}
                    <td style={{ padding: "11px 14px", textAlign: "right" }}>
                      <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600 }}>
                        View ↗
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Inspect Modal */}
      {selectedEntry && (
        <div
          className="modal-backdrop"
          onClick={() => setSelectedEntry(null)}
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
              padding: 24,
              width: 540,
              maxWidth: "92vw",
              border: "1px solid var(--border)",
              boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Audit Entry Details</h3>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "var(--bg-app)",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    ID: {selectedEntry.id.slice(0, 8)}…
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                  Occurred on {new Date(selectedEntry.occurred_at).toLocaleString()}
                </div>
              </div>

              <button
                onClick={() => setSelectedEntry(null)}
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "var(--bg-app)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 600 }}>Operation</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                  {ACTION_METAS[selectedEntry.action]?.label || selectedEntry.action}
                </div>
              </div>

              <div style={{ background: "var(--bg-app)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 600 }}>Source System</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                  {ACTOR_METAS[selectedEntry.actor_type]?.label || selectedEntry.actor_type}
                </div>
              </div>

              <div style={{ background: "var(--bg-app)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 600 }}>Actor Email</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                  {selectedEntry.actor_email || "System"}
                </div>
              </div>

              <div style={{ background: "var(--bg-app)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 600 }}>Calendar</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                  {selectedEntry.calendar_name || "N/A"}
                </div>
              </div>
            </div>

            {selectedEntry.event_id && (
              <div style={{ marginBottom: 12, fontSize: 12, color: "var(--text-secondary)" }}>
                Event ID: <code style={{ fontSize: 11, background: "var(--bg-app)", padding: "2px 6px", borderRadius: 4 }}>{selectedEntry.event_id}</code>
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                Payload Attributes
              </div>
              <pre
                style={{
                  background: "var(--bg-app)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 12,
                  maxHeight: 220,
                  overflowY: "auto",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono, monospace)",
                  margin: 0,
                }}
              >
                {JSON.stringify(selectedEntry.detail, null, 2)}
              </pre>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button
                onClick={() => setSelectedEntry(null)}
                className="btn-primary hoverable"
                style={{ padding: "7px 18px", fontSize: 12 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatShortDetail(detail: Record<string, unknown>): string {
  if (!detail || Object.keys(detail).length === 0) {
    return "—";
  }
  const pairs = Object.entries(detail).slice(0, 2);
  return pairs.map(([k, v]) => `${k}=${String(v)}`).join(" · ");
}
