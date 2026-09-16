import React, { useState } from "react";

import { CalendarSummary, EventSummary, updateEvent } from "../api/calendar";
import { friendlyError } from "../api/client";
import AttendeePicker, { PickerAttendee } from "./AttendeePicker";
import Icon from "./Icon";
import { formatTimeRange } from "../lib/dates";

interface Props {
  event: EventSummary | null;
  calendar: CalendarSummary | undefined;
  onClose: () => void;
  onDelete: (id: string, scope?: string, instanceStart?: string) => void;
  canDelete: boolean;
  canEdit: boolean;
  onSaved: (event: EventSummary) => void;
}

export type RecurrenceScope = "this" | "future" | "series";

function ScopeDialog({
  title, nextLabel, onPick, onClose,
}: {
  title: string;
  nextLabel: string | null;
  onPick: (scope: RecurrenceScope) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card mount-rise"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 340, maxWidth: "90vw", padding: 22 }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: "0 0 14px", lineHeight: 1.5 }}>
          This is a repeating event{nextLabel ? ` (next: ${nextLabel})` : ""}. Which occurrences change?
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => onPick("this")} className="btn-secondary hoverable" style={{ textAlign: "left", padding: "9px 12px" }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>Only this event</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)" }}>The series continues unchanged</span>
          </button>
          <button onClick={() => onPick("future")} className="btn-secondary hoverable" style={{ textAlign: "left", padding: "9px 12px" }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>This and future events</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)" }}>Earlier occurrences stay as they are</span>
          </button>
          <button onClick={() => onPick("series")} className="btn-secondary hoverable" style={{ textAlign: "left", padding: "9px 12px" }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>Entire series</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)" }}>Every occurrence, past and future</span>
          </button>
        </div>
        <button onClick={onClose} className="hoverable" style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12.5, cursor: "pointer", padding: "10px 0 0", width: "100%" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const RSVP_ICON: Record<string, string> = {
  accepted: "✓",
  declined: "✕",
  tentative: "?",
  needs_action: "○",
  organizer: "★",
};

export default function EventDetailPanel({ event, calendar, onClose, onDelete, canDelete, canEdit, onSaved }: Props) {
  const [editingAttendees, setEditingAttendees] = useState(false);
  const [draft, setDraft] = useState<PickerAttendee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeFor, setScopeFor] = useState<"delete" | "save" | null>(null);

  // The panel only exists while an event is selected — no placeholder chrome.
  if (!event) {
    return null;
  }

  const start = new Date(event.start);
  const end = new Date(event.end);
  const isRecurring = !!event.recurrence;
  const nextLabel = event.next_occurrence
    ? new Date(event.next_occurrence).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  function beginEdit() {
    setDraft((event?.attendees ?? []).map((a) => ({ name: a.name || a.email, email: a.email })));
    setError(null);
    setEditingAttendees(true);
  }

  async function saveAttendees(scope: RecurrenceScope = "series") {
    if (!event) return;
    setSaving(true);
    setError(null);
    try {
      const patch: Parameters<typeof updateEvent>[1] =
        scope === "series"
          ? { attendees: draft }
          : { attendees: draft, scope, ...(event.next_occurrence ? { instance_start: event.next_occurrence } : {}) };
      onSaved(await updateEvent(event.id, patch));
      setEditingAttendees(false);
      setScopeFor(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="vibrancy mount-rise" style={panelStyle}>
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
        {isRecurring && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
            Repeats{nextLabel ? ` · next ${nextLabel}` : ""}
          </div>
        )}
        {event.location && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="mapPin" size={13} /> {event.location}
          </div>
        )}
      </div>

      {event.description && (
        <div style={{ padding: "0 20px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{event.description}</div>
      )}

      {(editingAttendees || (event.attendees && event.attendees.length > 0)) && (
        <div style={{ padding: "8px 20px", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: editingAttendees ? 8 : 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Attendees
            </span>
            {!editingAttendees && canEdit && (
              <button
                onClick={beginEdit}
                className="hoverable"
                aria-label="Edit attendees"
                style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 4, display: "inline-flex" }}
              >
                <Icon name="pencil" size={13} />
              </button>
            )}
          </div>
          {editingAttendees ? (
            <div>
              <AttendeePicker value={draft} onChange={setDraft} />
              {error && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => setEditingAttendees(false)} className="btn-secondary hoverable" style={{ flex: 1, fontSize: 12 }}>
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (isRecurring) setScopeFor("save");
                    else void saveAttendees();
                  }}
                  disabled={saving}
                  className="btn-primary hoverable"
                  style={{ flex: 1, fontSize: 12 }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            (event.attendees ?? []).map((a, i) => (
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
            ))
          )}
        </div>
      )}
      {!editingAttendees && canEdit && (!event.attendees || event.attendees.length === 0) && (
        <div style={{ padding: "8px 20px", borderTop: "1px solid var(--border-subtle)" }}>
          <button
            onClick={beginEdit}
            className="hoverable"
            style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12.5, cursor: "pointer", padding: "5px 0", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="plus" size={13} /> Add attendees
          </button>
        </div>
      )}

      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: calendar?.color ?? "var(--accent)" }} />
        <span style={{ fontSize: 13 }}>{calendar?.name ?? "Calendar"}</span>
        {!(calendar?.can_reschedule ?? calendar?.writable) && (
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>Read-only</span>
        )}
      </div>

      {canDelete && (
        <div style={{ padding: "16px 20px", marginTop: "auto" }}>
          <button
            onClick={() => {
              if (!event) return;
              if (isRecurring) setScopeFor("delete");
              else onDelete(event.id);
            }}
            className="btn-danger"
            style={{ width: "100%" }}
          >
            Delete Event
          </button>
        </div>
      )}
      {scopeFor && (
        <ScopeDialog
          title={scopeFor === "delete" ? "Delete repeating event" : "Save attendees"}
          nextLabel={nextLabel}
          onClose={() => setScopeFor(null)}
          onPick={(scope) => {
            if (!event) return;
            const instance = scope === "series" ? undefined : event.next_occurrence ?? undefined;
            if (scopeFor === "delete") {
              setScopeFor(null);
              onDelete(event.id, scope, instance);
            } else {
              void saveAttendees(scope);
            }
          }}
        />
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
