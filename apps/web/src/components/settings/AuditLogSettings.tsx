import React, { useEffect, useState } from "react";

import { AuditEntry, adminListAuditLog } from "../../api/admin";

const ACTOR_LABELS: Record<string, string> = {
  executive_ui: "Executive UI",
  ea_ui: "EA UI",
  ics_import: "ICS Import",
  copilot: "Copilot",
  mcp: "MCP",
  api: "API",
  system: "System",
};

export default function AuditLogSettings() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminListAuditLog(200)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Audit Log</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        Every mutation across Executive UI, EA UI, ICS import, MCP, and the copilot (BRD §22) — same audit writer,
        one log.
      </p>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {entries.length === 0 && <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No activity yet.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {entries.map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 12, padding: "9px 10px", fontSize: 12, borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="tabular-nums" style={{ color: "var(--text-tertiary)", width: 130, flexShrink: 0 }}>
              {new Date(e.occurred_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
            <div style={{ width: 90, flexShrink: 0, color: "var(--text-secondary)" }}>{ACTOR_LABELS[e.actor_type] ?? e.actor_type}</div>
            <div style={{ width: 130, flexShrink: 0, fontWeight: 600 }}>{e.action.replace(/_/g, " ")}</div>
            <div style={{ color: "var(--text-secondary)", flex: 1 }}>
              {e.actor_email && <span>{e.actor_email}</span>}
              {e.calendar_name && <span> · {e.calendar_name}</span>}
              {Object.keys(e.detail).length > 0 && (
                <span style={{ color: "var(--text-tertiary)" }}> · {summarizeDetail(e.detail)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function summarizeDetail(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
}
