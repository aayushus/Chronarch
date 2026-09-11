import React from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { WEEKDAY_SHORT, formatHour, sameDay, startOfWeek } from "../lib/dates";
import { packOverlaps } from "../lib/layout";

const HOUR_HEIGHT = 44;
const START_HOUR = 6;
const END_HOUR = 22;

interface Props {
  weekAnchor: Date;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  onSelectDay: (d: Date) => void;
}

export default function WeekView({ weekAnchor, events, calendarById, onSelectEvent, onSelectDay }: Props) {
  const weekStart = startOfWeek(weekAnchor);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const today = new Date();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div />
        {days.map((d) => (
          <button
            key={d.toISOString()}
            onClick={() => onSelectDay(d)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px 4px",
              textAlign: "center",
              color: sameDay(d, today) ? "var(--danger)" : "var(--text-primary)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{WEEKDAY_SHORT[d.getDay()]}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{d.getDate()}</div>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", position: "relative" }}>
          <div style={{ position: "relative", height: hours.length * HOUR_HEIGHT }}>
            {hours.map((h, i) => (
              <span
                key={h}
                style={{
                  position: "absolute",
                  top: i * HOUR_HEIGHT - 6,
                  left: 8,
                  fontSize: 10,
                  color: "var(--text-tertiary)",
                }}
              >
                {formatHour(h)}
              </span>
            ))}
          </div>

          {days.map((day) => {
            const dayEvents = events.filter((e) => !e.all_day && sameDay(new Date(e.start), day));
            const laidOut = packOverlaps(
              dayEvents,
              (e) => new Date(e.start),
              (e) => new Date(e.end)
            );
            return (
              <div key={day.toISOString()} style={{ position: "relative", height: hours.length * HOUR_HEIGHT, borderLeft: "1px solid var(--border-subtle)" }}>
                {hours.map((h, i) => (
                  <div key={h} style={{ position: "absolute", top: i * HOUR_HEIGHT, left: 0, right: 0, borderTop: "1px solid var(--border-subtle)" }} />
                ))}
                {laidOut.map(({ event, column, columnCount }) => {
                  const start = new Date(event.start);
                  const end = new Date(event.end);
                  const top = ((start.getHours() * 60 + start.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max(16, ((end.getTime() - start.getTime()) / 60000 / 60) * HOUR_HEIGHT - 2);
                  const cal = calendarById[event.calendar_id];
                  const widthPct = 100 / columnCount;
                  return (
                    <div
                      key={event.id}
                      onClick={() => onSelectEvent(event)}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: `${column * widthPct}%`,
                        width: `calc(${widthPct}% - 3px)`,
                        background: "var(--bg-raised)",
                        borderLeft: `3px solid ${cal?.color ?? "var(--accent)"}`,
                        borderRadius: 4,
                        padding: "2px 5px",
                        overflow: "hidden",
                        cursor: "pointer",
                        fontSize: 10.5,
                        fontWeight: 600,
                      }}
                    >
                      {event.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
