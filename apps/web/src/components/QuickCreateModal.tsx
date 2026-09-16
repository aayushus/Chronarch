import React, { useState } from "react";

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!calendarId || !title) return;
    const withAttendees = attendees.length > 0 ? { attendees } : {};
    if (allDay) {
      const dayStart = new Date(`${date}T00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      onCreate({ calendar_id: calendarId, title, start: dayStart.toISOString(), end: dayEnd.toISOString(), all_day: true, ...withAttendees });
    } else {
      onCreate({
        calendar_id: calendarId,
        title,
        start: new Date(`${date}T${startTime}`).toISOString(),
        end: new Date(`${date}T${endTime}`).toISOString(),
        all_day: false,
        ...withAttendees,
      });
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card mount-rise"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          padding: 24,
          width: 360,
          gap: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>New Event</div>
        <input
          autoFocus
          placeholder="Event Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
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
        <AttendeePicker value={attendees} onChange={setAttendees} label="Attendees" />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>
            Cancel
          </button>
          <button type="submit" disabled={writable.length === 0} className="btn-primary" style={{ flex: 1 }}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

