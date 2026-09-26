import React, { useEffect, useRef, useState } from "react";

import { CalendarSummary } from "../api/calendar";
import AttendeePicker, { PickerAttendee } from "./AttendeePicker";

export interface CreateDraft {
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  description?: string | null;
  location?: string | null;
  attendees?: PickerAttendee[];
  recurrence?: { freq: string } | null;
}

interface Props {
  calendars: CalendarSummary[];
  /** Prefilled range from a click/drag on the grid (BRD §9.6-9.7). */
  initialStart: Date;
  initialEnd: Date;
  initialAllDay: boolean;
  /** Kept when returning from the conflict warning (Back). */
  initialTitle?: string;
  initialCalendarId?: string;
  onClose: () => void;
  onCreate: (body: CreateDraft) => void;
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuickCreateModal({ calendars, initialStart, initialEnd, initialAllDay, initialTitle, initialCalendarId, onClose, onCreate }: Props) {
  const writable = calendars.filter((c) => c.can_create ?? c.writable);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [calendarId, setCalendarId] = useState(
    initialCalendarId && writable.some((c) => c.id === initialCalendarId) ? initialCalendarId : (writable[0]?.id ?? "")
  );
  const [date, setDate] = useState(toDateInput(initialStart));
  const [startTime, setStartTime] = useState(toTimeInput(initialStart));
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd));
  const [allDay, setAllDay] = useState(initialAllDay);
  const [attendees, setAttendees] = useState<PickerAttendee[]>([]);
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!calendarId) { setError("Choose a writable calendar."); return; }
    if (!cleanTitle) { setError("Enter an event title."); return; }
    if (!date || (!allDay && (!startTime || !endTime))) { setError("Choose a date and time."); return; }
    const start = new Date(`${date}T${startTime || "00:00"}`);
    const end = new Date(`${date}T${endTime || "00:00"}`);
    if (!allDay && end <= start) { setError("End time must be after start time."); return; }
    if (saving) return;
    setError(null); setSaving(true);
    const withAttendees = attendees.length > 0 ? { attendees } : {};
    const withRepeat = repeat ? { recurrence: { freq: repeat } } : {};
    if (allDay) {
      const dayStart = new Date(`${date}T00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      onCreate({ calendar_id: calendarId, title: cleanTitle, start: dayStart.toISOString(), end: dayEnd.toISOString(), all_day: true, ...withAttendees, ...withRepeat });
    } else {
      onCreate({
        calendar_id: calendarId,
        title: cleanTitle,
        start: start.toISOString(),
        end: end.toISOString(),
        all_day: false,
        ...withAttendees,
        ...withRepeat,
      });
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form
        className="modal-card mount-rise"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-create-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          padding: 24,
          width: 360,
          gap: 12,
        }}
      >
        <div id="quick-create-title" style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>New Event</div>
        <input
          ref={titleRef}
          placeholder="Event Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="input-standard"
        />
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: "var(--text-sm)" }}>{error}</div>}
        {writable.length === 0 ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--warning)" }}>No writable calendars available.</div>
        ) : (
          <select className="input-standard select" value={calendarId} onChange={(e) => setCalendarId(e.target.value)} >
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input className="input-standard input-native" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {!allDay && (
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input-standard input-native" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}  style={{ flex: 1 }} />
            <input className="input-standard input-native" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}  style={{ flex: 1 }} />
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-md)", color: "var(--text-secondary)", cursor: "pointer" }}>
          <input className="checkbox" type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All-day event
        </label>
        <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600 }}>
          Repeat
          <select className="input-standard select" value={repeat} onChange={(e) => setRepeat(e.target.value)}  style={{ width: "100%", marginTop: 6}}>
            <option value="">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <AttendeePicker value={attendees} onChange={setAttendees} label="Attendees" />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>
            Cancel
          </button>
          <button type="submit" disabled={writable.length === 0 || saving} className="btn-primary" style={{ flex: 1 }}>
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
