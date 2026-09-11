import React from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { formatTimeRange } from "../lib/dates";

interface Props {
  event: EventSummary | null;
  calendar: CalendarSummary | undefined;
  onClose: () => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
}

const RSVP_ICON: Record<string, string> = {
  accepted: "✓",
  declined: "✕",
  tentative: "?",
  needs_action: "○",
  organizer: "★",
};

export default function EventDetailPanel({ event, calendar, onClose, onDelete, canDelete }: Props) {
  if (!event) {
    return (
      <aside className="vibrancy" style={panelStyle}>
        <div style={{ padding: 24, color: "var(--text-tertiary)", fontSize: 13, textAlign: "center", marginTop: 60 }}>
          Select an event to see details
        </div>
      </aside>
    );
  }

  const start = new Date(event.start);
  const end = new Date(event.end);

  return (
    <aside className="vibrancy" style={panelStyle}>
      <div style={{ padding: 20, borderLeft: `3px solid ${calendar?.color ?? "var(--accent)"}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{event.title}</div>
          <button onClick={onClose} className="icon-btn" style={closeBtnStyle}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
        <div className="tabular-nums" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {formatTimeRange(start, end)}
        </div>
        {event.location && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>📍 {event.location}</div>
        )}
      </div>

      {event.description && (
        <div style={{ padding: "0 20px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{event.description}</div>
      )}

      {event.attendees && event.attendees.length > 0 && (
        <div style={{ padding: "8px 20px", borderTop: "1px solid var(--border-subtle)" }}>
          {event.attendees.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  background:
                    a.response_status === "accepted" || a.response_status === "organizer"
                      ? "var(--success)"
                      : a.response_status === "declined"
                        ? "var(--danger)"
                        : "var(--bg-raised-hover)",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {RSVP_ICON[a.response_status ?? "needs_action"]}
              </span>
              <span>{a.name || a.email}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: calendar?.color ?? "var(--accent)" }} />
        <span style={{ fontSize: 13 }}>{calendar?.name ?? "Calendar"}</span>
        {!(calendar?.can_reschedule ?? calendar?.writable) && (
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>Read only</span>
        )}
      </div>

      {canDelete && (
        <div style={{ padding: "16px 20px", marginTop: "auto" }}>
          <button
            onClick={() => onDelete(event.id)}
            className="btn-danger"
            style={{ width: "100%" }}
          >
            Delete Event
          </button>
        </div>
      )}
    </aside>
  );
}

const panelStyle: React.CSSProperties = {
  width: 300,
  minWidth: 300,
  background: "var(--bg-panel)",
  borderLeft: "1px solid var(--border-subtle)",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  borderRadius: 4,
  color: "var(--text-tertiary)",
  fontSize: 13,
  cursor: "pointer",
  padding: "3px 6px",
};
