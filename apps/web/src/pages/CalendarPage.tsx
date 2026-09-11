import React, { useEffect, useState } from "react";

import { useAuth } from "../api/auth";
import { CalendarSummary, EventSummary, listCalendars, listEvents } from "../api/calendar";

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday-start week
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default function CalendarPage() {
  const { logout } = useAuth();
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCalendars().then(setCalendars).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    listEvents(weekStart, weekEnd)
      .then(setEvents)
      .catch((e) => setError(String(e)));
  }, [weekStart]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const calendarById = Object.fromEntries(calendars.map((c) => [c.id, c]));

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <aside style={{ width: 220, borderRight: "1px solid #e2e2e2", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Chronarch</strong>
          <button onClick={logout} style={{ fontSize: 12, cursor: "pointer" }}>
            Sign out
          </button>
        </div>
        <h4 style={{ marginTop: 24, marginBottom: 8, fontSize: 13, color: "#666" }}>My Calendars</h4>
        {calendars.map((c) => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13 }}>
            <input type="checkbox" defaultChecked={c.visible} />
            <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color, display: "inline-block" }} />
            {c.name}
            {!c.writable && <span style={{ color: "#999", fontSize: 11 }}>(read only)</span>}
          </label>
        ))}
        {calendars.length === 0 && <div style={{ fontSize: 12, color: "#999" }}>No calendars connected yet.</div>}
      </aside>

      <main style={{ flex: 1, padding: 16, overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button
            onClick={() => setWeekStart((d) => new Date(d.getTime() - 7 * 86400000))}
            style={{ cursor: "pointer" }}
          >
            {"<"}
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={{ cursor: "pointer" }}>
            Today
          </button>
          <button
            onClick={() => setWeekStart((d) => new Date(d.getTime() + 7 * 86400000))}
            style={{ cursor: "pointer" }}
          >
            {">"}
          </button>
          <span style={{ fontSize: 14, color: "#666" }}>
            Week of {weekStart.toLocaleDateString()}
          </span>
        </div>

        {error && <div style={{ color: "crimson", marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
          {days.map((day) => {
            const dayEvents = events.filter((e) => new Date(e.start).toDateString() === day.toDateString());
            return (
              <div key={day.toISOString()} style={{ border: "1px solid #eee", borderRadius: 6, minHeight: 300, padding: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  {day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </div>
                {dayEvents.map((e) => {
                  const cal = calendarById[e.calendar_id];
                  return (
                    <div
                      key={e.id}
                      style={{
                        background: cal?.color ?? "#3B82F6",
                        color: "white",
                        borderRadius: 4,
                        padding: "4px 6px",
                        fontSize: 11,
                        marginBottom: 4,
                      }}
                    >
                      {e.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
