import React from "react";

import { ConflictInfo } from "../api/calendar";
import Icon from "./Icon";
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
    <div className="modal-backdrop" onClick={onDiscard}>
      <div
        className="modal-card mount-rise"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 24,
          width: 380,
          maxWidth: "90vw",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "var(--warning)", display: "inline-flex" }}>
            <Icon name="alert" size={16} />
          </span>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>{title}</div>
        </div>
        <div style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.4 }}>{summary}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18, maxHeight: 180, overflowY: "auto" }}>
          {conflicts.map((c) => (
            <div
              key={c.event_id}
              style={{
                background: "var(--bg-raised)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 12px",
                fontSize: "var(--text-sm)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontWeight: 600, color: c.redacted ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                {c.redacted ? "Busy" : c.title}
                {c.redacted && (
                  <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}> · {c.calendar_name}</span>
                )}
              </div>
              <div className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 2 }}>
                {formatTimeRange(new Date(c.start), new Date(c.end))}
                {!c.redacted && ` · ${c.calendar_name}`}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <button type="button" onClick={onBack} className="btn-secondary" style={{ flex: 1, whiteSpace: "nowrap" }}>
            Back
          </button>
          <button type="button" onClick={onDiscard} className="btn-secondary" style={{ flex: 1, whiteSpace: "nowrap" }}>
            Discard
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-primary"
            style={{ flex: 1.2, minWidth: 0, whiteSpace: "nowrap", background: "var(--warning)", color: "var(--text-on-warning)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
