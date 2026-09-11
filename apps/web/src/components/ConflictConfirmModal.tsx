import React from "react";

import { ConflictInfo } from "../api/calendar";
import { formatTimeRange } from "../lib/dates";

interface Props {
  title: string;
  summary: string;
  conflicts: ConflictInfo[];
  confirmLabel: string;
  onConfirm: () => void;
  onBack: () => void;
  onDiscard: () => void;
}

/** "Save anyway?" gate for the BRD §25 conflict warning flow: the server
 * already computed what the proposed window overlaps (redacted where the
 * viewer may not see titles), and the user decides whether to proceed. */
export default function ConflictConfirmModal({
  title,
  summary,
  conflicts,
  confirmLabel,
  onConfirm,
  onBack,
  onDiscard,
}: Props) {
  return (
    <div
      onClick={onDiscard}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)",
          borderRadius: 10,
          padding: 20,
          width: 340,
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 15 }}>⚠️</span>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>{summary}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, maxHeight: 180, overflowY: "auto" }}>
          {conflicts.map((c) => (
            <div
              key={c.event_id}
              style={{
                background: "var(--bg-raised)",
                borderRadius: 6,
                padding: "7px 10px",
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: c.redacted ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                {c.redacted ? "Busy" : c.title}
                {c.redacted && (
                  <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}> · {c.calendar_name}</span>
                )}
              </div>
              <div className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                {formatTimeRange(new Date(c.start), new Date(c.end))}
                {!c.redacted && ` · ${c.calendar_name}`}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onBack} style={{ ...btnStyle, background: "var(--bg-raised)" }}>
            Back
          </button>
          <button type="button" onClick={onDiscard} style={{ ...btnStyle, background: "var(--bg-raised)" }}>
            Discard
          </button>
          <button type="button" onClick={onConfirm} style={{ ...btnStyle, background: "var(--warning)", color: "#1a1200" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  flex: 1,
  border: "none",
  borderRadius: 6,
  color: "#fff",
  padding: "8px 0",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
