import React, { useState } from "react";

import {
  CalendarSummary,
  ContactEntry,
  QuickAddAttendee,
  QuickAddDraft,
  getConflicts,
  searchContacts,
} from "../api/calendar";
import { friendlyError } from "../api/client";

interface Props {
  calendars: CalendarSummary[];
  initialDraft: QuickAddDraft;
  onClose: () => void;
  onConfirm: (calendarId: string, draft: QuickAddDraft) => Promise<void>;
}

/** Preview-and-confirm for a parsed quick-add draft (BRD §21: writes preview before commit). */
export default function QuickAddModal({ calendars, initialDraft, onClose, onConfirm }: Props) {
  const writable = calendars.filter((c) => c.can_create ?? c.writable);
  const [title, setTitle] = useState(initialDraft.title);
  const [calendarId, setCalendarId] = useState(writable[0]?.id ?? "");
  const [date, setDate] = useState(toDateInput(new Date(initialDraft.start)));
  const [startTime, setStartTime] = useState(toTimeInput(new Date(initialDraft.start)));
  const [endTime, setEndTime] = useState(toTimeInput(new Date(initialDraft.end)));
  const [allDay, setAllDay] = useState(initialDraft.all_day);
  const [location, setLocation] = useState(initialDraft.location ?? "");
  const [description, setDescription] = useState(initialDraft.description ?? "");
  const [attendees, setAttendees] = useState<QuickAddAttendee[]>(initialDraft.attendees);
  const [addName, setAddName] = useState("");
  const [suggestions, setSuggestions] = useState<ContactEntry[]>([]);
  const [conflicts, setConflicts] = useState<{ title: string; start: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unresolved = attendees.filter((a) => !a.email);

  function buildDraft(): QuickAddDraft {
    let start: string;
    let end: string;
    if (allDay) {
      const dayStart = new Date(`${date}T00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      start = dayStart.toISOString();
      end = dayEnd.toISOString();
    } else {
      start = new Date(`${date}T${startTime}`).toISOString();
      end = new Date(`${date}T${endTime}`).toISOString();
    }
    return {
      title: title.trim(),
      start,
      end,
      all_day: allDay,
      location: location.trim() || null,
      description: description.trim() || null,
      attendees,
    };
  }

  async function handleCreate(anyway = false) {
    setError(null);
    if (!calendarId || !title.trim()) {
      setError("Give the event a title and a calendar.");
      return;
    }
    if (unresolved.length > 0 && !anyway) {
      setError(
        `These people aren't in your contacts yet: ${unresolved.map((a) => a.name).join(", ")}. Pick a match or remove them.`
      );
      return;
    }
    const draft = buildDraft();
    if (new Date(draft.end) <= new Date(draft.start)) {
      setError("Event end must be after start.");
      return;
    }
    setConfirming(true);
    try {
      if (!anyway) {
        const found = await getConflicts(new Date(draft.start), new Date(draft.end));
        if (found.length > 0) {
          setConflicts(found.map((c) => ({ title: c.title, start: c.start })));
          setConfirming(false);
          return;
        }
      }
      await onConfirm(calendarId, draft);
    } catch (e) {
      setError(friendlyError(e));
      setConfirming(false);
    }
  }

  async function handleSearchPerson() {
    const q = addName.trim();
    if (!q) return;
    try {
      const res = await searchContacts(q);
      if (res.contacts.length === 1) {
        const c = res.contacts[0];
        setAttendees((prev) => [...prev, { name: c.display_name ?? c.email, email: c.email }]);
        setAddName("");
        setSuggestions([]);
      } else {
        setSuggestions(res.contacts.slice(0, 5));
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card mount-rise"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, width: 420, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", gap: 12 }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>Quick Add — confirm details</div>

        <input
          autoFocus
          placeholder="Event Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input-standard"
        />

        {writable.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--warning)" }}>No writable calendars available.</div>
        ) : (
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className="input-standard">
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-standard" />
        {!allDay && (
          <div style={{ display: "flex", gap: 8 }}>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input-standard" style={{ flex: 1 }} />
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input-standard" style={{ flex: 1 }} />
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All-day event
        </label>

        <input
          placeholder="Location (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="input-standard"
        />
        <input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input-standard"
        />

        {/* Attendees */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
            Attendees {attendees.length > 0 && `(${attendees.length})`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {attendees.map((a, i) => (
              <div
                key={`${a.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--bg-raised)",
                  border: `1px solid ${a.email ? "var(--border-subtle)" : "var(--warning)"}`,
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong>{a.name}</strong>
                  {a.email && <span style={{ color: "var(--text-secondary)" }}> · {a.email}</span>}
                  {!a.email && <span style={{ color: "var(--warning)" }}> · not in contacts</span>}
                </span>
                {!a.email && a.ambiguous && a.ambiguous.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const pick = a.ambiguous!.find((c) => c.email === e.target.value)!;
                      setAttendees((prev) =>
                        prev.map((x, j) => (j === i ? { name: pick.display_name ?? pick.email, email: pick.email } : x))
                      );
                    }}
                    className="input-standard"
                    style={{ fontSize: 11, padding: "2px 4px", maxWidth: 140 }}
                  >
                    <option value="">Pick match…</option>
                    {a.ambiguous.map((c) => (
                      <option key={c.email} value={c.email}>
                        {c.display_name ?? c.email}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => setAttendees((prev) => prev.filter((_, j) => j !== i))}
                  className="hoverable"
                  style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 14 }}
                  title="Remove attendee"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              placeholder="Add person by name or email…"
              value={addName}
              onChange={(e) => {
                setAddName(e.target.value);
                setSuggestions([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearchPerson();
                }
              }}
              className="input-standard"
              style={{ flex: 1 }}
            />
            <button onClick={handleSearchPerson} className="btn-secondary hoverable" style={{ fontSize: 12 }}>
              Add
            </button>
          </div>
          {suggestions.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {suggestions.map((c) => (
                <button
                  key={c.email}
                  onClick={() => {
                    setAttendees((prev) => [...prev, { name: c.display_name ?? c.email, email: c.email }]);
                    setAddName("");
                    setSuggestions([]);
                  }}
                  className="hoverable"
                  style={{
                    textAlign: "left",
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                    color: "var(--text-primary)",
                  }}
                >
                  {c.display_name ?? c.email} <span style={{ color: "var(--text-secondary)" }}>{c.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {conflicts.length > 0 && (
          <div
            style={{
              fontSize: 12,
              background: "rgba(255, 159, 10, 0.12)",
              border: "1px solid var(--warning)",
              borderRadius: 6,
              padding: "8px 10px",
              color: "var(--text-primary)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Overlaps {conflicts.length} event{conflicts.length === 1 ? "" : "s"}:</div>
            {conflicts.slice(0, 3).map((c, i) => (
              <div key={i} style={{ color: "var(--text-secondary)" }}>
                {c.title} · {new Date(c.start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>
            Cancel
          </button>
          {conflicts.length > 0 ? (
            <button onClick={() => handleCreate(true)} disabled={confirming} className="btn-primary" style={{ flex: 2 }}>
              {confirming ? "Creating…" : "Create anyway"}
            </button>
          ) : (
            <button onClick={() => handleCreate(false)} disabled={confirming || writable.length === 0} className="btn-primary" style={{ flex: 2 }}>
              {confirming ? "Checking…" : "Create event"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
