import React, { useState } from "react";

import { CalendarSummary, EventSummary, updateEvent } from "../api/calendar";
import { friendlyError } from "../api/client";
import AttendeePicker, { PickerAttendee } from "./AttendeePicker";
import Icon from "./Icon";
import { formatTimeRange } from "../lib/dates";
import { contrastText } from "../lib/color";

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

type ConferenceProvider = "teams" | "google" | "webex" | "zoom" | "other";

function conferenceInfo(event: EventSummary): { provider: ConferenceProvider; label: string; url: string | null } {
  const source = `${event.location ?? ""}\n${event.description ?? ""}`;
  const url = source.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;]+$/, "") ?? null;
  const lower = source.toLowerCase();
  if (lower.includes("teams.microsoft.com") || lower.includes("microsoft teams")) return { provider: "teams", label: "Microsoft Teams", url };
  if (lower.includes("meet.google.com") || lower.includes("google meet")) return { provider: "google", label: "Google Meet", url };
  if (lower.includes("webex.com") || lower.includes("webex")) return { provider: "webex", label: "Webex", url };
  if (lower.includes("zoom.us") || lower.includes("zoom meeting")) return { provider: "zoom", label: "Zoom", url };
  return { provider: "other", label: "Meeting link", url };
}

function ProviderBadge({ provider }: { provider: ConferenceProvider }) {
  const labels: Record<ConferenceProvider, string> = { teams: "MS", google: "G", webex: "W", zoom: "Z", other: "↗" };
  return <span className={`conference-badge conference-${provider}`} aria-hidden="true">{labels[provider]}</span>;
}

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

  const eventColor = calendar?.color ?? "var(--accent)";
  const headerText = contrastText(eventColor);
  const conference = conferenceInfo(event);
  const canJoin = !!conference.url;

  async function copyInvite() {
    if (!conference.url) return;
    try {
      await navigator.clipboard.writeText(conference.url);
    } catch {
      const input = document.createElement("textarea");
      input.value = conference.url;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
    <aside className="mount-rise" style={panelStyle} onClick={(e) => e.stopPropagation()}>
      <div style={{ background: eventColor, color: headerText, padding: "16px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{event.title}</div>
          <button
            onClick={onClose}
            className="icon-btn hoverable"
            style={{
              ...closeBtnStyle,
              color: headerText === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: headerText === "#ffffff" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.8)", marginTop: 2 }}>
          {start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
        <div className="tabular-nums" style={{ fontSize: 12, fontWeight: 500, color: headerText === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)", marginTop: 2 }}>
          {formatTimeRange(start, end)}
        </div>
        {isRecurring && (
          <div style={{ fontSize: 11.5, color: headerText === "#ffffff" ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.7)", marginTop: 4 }}>
            Repeats{nextLabel ? ` · next ${nextLabel}` : ""}
          </div>
        )}
        {event.location && (
          <div style={{ fontSize: 12, color: headerText === "#ffffff" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.8)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="mapPin" size={12} /> {event.location}
          </div>
        )}
      </div>

      <div style={{ padding: "18px 24px 0" }}>
        {canJoin && (
          <button className="btn-primary hoverable" style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: conference.provider === "teams" ? "#6264a7" : undefined }} onClick={() => window.open(conference.url!, "_blank", "noopener,noreferrer")}>
            <ProviderBadge provider={conference.provider} /> Join {conference.label}
          </button>
        )}
      </div>

      <section style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-subtle)" }}>
        <SectionLabel>At a glance</SectionLabel>
        <DetailRow label="When" value={`${start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${formatTimeRange(start, end)}`} />
        {event.location && <DetailRow label="Where" value={event.location ?? ""} />}
        {canJoin && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "9px 10px", background: "var(--bg-raised-hover)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}><ProviderBadge provider={conference.provider} /><a href={conference.url ?? undefined} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflow: "hidden", color: "var(--accent)", fontSize: 12, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conference.url}</a><button className="btn-secondary hoverable" style={{ padding: "5px 9px", fontSize: 11 }} onClick={copyInvite}>Copy invite</button></div>}
      </section>

      {event.description && <section style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-subtle)" }}><SectionLabel>Description</SectionLabel><div className="event-description">{event.description}</div></section>}

      <section style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-subtle)" }}><SectionLabel>Your response</SectionLabel><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{["✓ Accepted", "Maybe", "Decline", "Propose new time"].map((label) => <button key={label} className="btn-secondary hoverable" style={{ padding: "7px 10px", fontSize: 12, color: label.startsWith("✓") ? "var(--success)" : undefined }}>{label}</button>)}</div></section>

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
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 10, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>{children}</div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div style={{ margin: "10px 0" }}><div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{label}</div><div style={{ marginTop: 2, fontSize: 13, lineHeight: 1.45 }}>{value}</div></div>;
}

const panelStyle: React.CSSProperties = {
  width: "min(640px, calc(100vw - 40px))",
  maxHeight: "calc(100vh - 40px)",
  background: "var(--bg-raised)",
  opacity: 1,
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-pop)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
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
