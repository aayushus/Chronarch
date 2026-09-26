import React, { useMemo } from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { sameDay } from "../lib/dates";
import { AllDayChip, EventCard, isCancelledEvent } from "./EventCard";
import EventWeather from "./EventWeather";

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
                  fontSize: "var(--text-md)",
                  fontWeight: 700,
                  color: isToday ? "var(--danger)" : "var(--text-primary)",
                  minWidth: 28,
                  textAlign: "center",
                  background: isToday ? "rgba(255, 69, 58, 0.12)" : "transparent",
                  borderRadius: "var(--radius-sm)",
                  padding: "1px 0",
                }}
              >
                {d.getDate()}
              </span>
              <span style={{ fontSize: "var(--text-md)", fontWeight: 600, color: isToday ? "var(--danger)" : "var(--text-secondary)" }}>
                {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                {isToday ? " · Today" : ""}
              </span>
            </button>

            <div style={{ marginLeft: 42, borderLeft: "1px solid var(--border-subtle)", paddingLeft: 12 }}>
              {empty && (
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", padding: "2px 0 8px" }}>
                  No events
                </div>
              )}
              {[...bucket.allDay, ...bucket.timed].map((e) => {
                const cal = calendarById[e.calendar_id];
                const color = cal?.color ?? "var(--accent)";
                const badge = cal?.kind === "google" ? "G" : cal?.kind === "microsoft" ? "MS" : cal?.kind === "ics" ? "ICS" : undefined;
                const start = new Date(e.start);
                const end = new Date(e.end);
                return (
                  <div key={e.id} style={{ marginBottom: 8 }}>
                    {e.all_day ? (
                      <AllDayChip color={color} title={e.title} cancelled={isCancelledEvent(e)} onOpen={() => onSelectEvent(e)} />
                    ) : (
                      <EventCard
                        color={color}
                        title={e.title}
                        meta={<>{`${fmtTime(start)} – ${fmtTime(end)}`}{e.location ? ` · ${e.location}` : ""}<EventWeather location={e.location ?? null} start={e.start} /></>}
                        attendees={e.attendees}
                        providerBadge={badge}
                        cancelled={isCancelledEvent(e)}
                        onOpen={() => onSelectEvent(e)}
                      />
                    )}
                  </div>
                );
              })}

            </div>
          </div>
        );
      })}
    </div>
  );
}
