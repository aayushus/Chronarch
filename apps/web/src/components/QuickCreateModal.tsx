import React, { useState } from "react";

import { CalendarSummary } from "../api/calendar";

export interface CreateDraft {
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!calendarId || !title) return;
    if (allDay) {
      const dayStart = new Date(`${date}T00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      onCreate({ calendar_id: calendarId, title, start: dayStart.toISOString(), end: dayEnd.toISOString(), all_day: true });
    } else {
      onCreate({
        calendar_id: calendarId,
        title,
        start: new Date(`${date}T${startTime}`).toISOString(),
        end: new Date(`${date}T${endTime}`).toISOString(),
        all_day: false,
      });
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "var(--bg-panel)",
          borderRadius: 10,
          padding: 20,
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>New Event</div>
        <input
          autoFocus
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          style={inputStyle}
        />
        {writable.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--warning)" }}>No writable calendars available.</div>
        ) : (
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} style={inputStyle}>
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        {!allDay && (
          <div style={{ display: "flex", gap: 8 }}>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All-day event
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, background: "var(--bg-raised)" }}>
            Cancel
          </button>
          <button type="submit" disabled={writable.length === 0} style={{ ...btnStyle, background: "var(--accent)" }}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  flex: 1,
  colorScheme: "dark",
};

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
