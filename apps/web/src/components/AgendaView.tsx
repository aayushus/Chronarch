import React, { useMemo } from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { sameDay } from "../lib/dates";

interface Props {
  days: Date[];
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  onSelectDay: (d: Date) => void;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function AgendaView({ days, events, calendarById, onSelectEvent, onSelectDay }: Props) {
  const today = new Date();

  const byDay = useMemo(() => {
    const map = new Map<string, { timed: EventSummary[]; allDay: EventSummary[] }>();
    for (const d of days) {
      map.set(d.toDateString(), { timed: [], allDay: [] });
    }
    for (const e of events) {
      const start = new Date(e.start);
      const key = days.find((d) => sameDay(start, d))?.toDateString();
      if (!key) continue;
      const bucket = map.get(key)!;
      if (e.all_day) bucket.allDay.push(e);
      else bucket.timed.push(e);
    }
    for (const bucket of map.values()) {
      bucket.timed.sort((a, b) => +new Date(a.start) - +new Date(b.start));
    }
    return map;
  }, [days, events]);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px 24px 32px", maxWidth: 760, margin: "0 auto", width: "100%" }}>
      {days.map((d) => {
        const bucket = byDay.get(d.toDateString())!;
        const isToday = sameDay(d, today);
        const empty = bucket.timed.length === 0 && bucket.allDay.length === 0;
        return (
          <div key={d.toISOString()} style={{ marginBottom: 4 }}>
            <button
              onClick={() => onSelectDay(d)}
              className="hoverable"
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "10px 4px 6px",
                textAlign: "left",
              }}
            >
              <span
                className="tabular-nums"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: isToday ? "var(--danger)" : "var(--text-primary)",
                  minWidth: 28,
                  textAlign: "center",
                  background: isToday ? "rgba(255, 69, 58, 0.12)" : "transparent",
                  borderRadius: 6,
                  padding: "1px 0",
                }}
              >
                {d.getDate()}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: isToday ? "var(--danger)" : "var(--text-secondary)" }}>
                {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                {isToday ? " · Today" : ""}
              </span>
            </button>

            <div style={{ marginLeft: 42, borderLeft: "1px solid var(--border-subtle)", paddingLeft: 12 }}>
              {empty && (
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "2px 0 8px" }}>
                  No events
                </div>
              )}
              {[...bucket.allDay, ...bucket.timed].map((e) => {
                const cal = calendarById[e.calendar_id];
                const color = cal?.color ?? "var(--accent)";
                const start = new Date(e.start);
                const end = new Date(e.end);
                return (
                  <button
                    key={e.id}
                    onClick={() => onSelectEvent(e)}
                    className="hoverable"
                    style={{
                      display: "flex",
                      gap: 10,
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      borderRadius: 6,
                      padding: "5px 6px",
                      marginLeft: -6,
                      cursor: "pointer",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span style={{ width: 3, borderRadius: 2, background: color, flexShrink: 0, alignSelf: "stretch" }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.title}
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)", marginTop: 1 }}>
                        {e.all_day ? "All day" : `${fmtTime(start)} – ${fmtTime(end)}`}
                        {e.location ? ` · ${e.location}` : ""}
                        {e.attendees?.length ? ` · ${e.attendees.length} attendee${e.attendees.length === 1 ? "" : "s"}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
