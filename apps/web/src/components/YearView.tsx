import React, { useMemo } from "react";

import { EventSummary } from "../api/calendar";
import { CalendarSummary } from "../api/calendar";
import { sameDay } from "../lib/dates";
import { isCancelledEvent } from "./EventCard";

interface Props {
  year: number;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  selectedDate: Date;
  onSelectDay: (d: Date) => void;
  onSelectMonth: (d: Date) => void;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Bucket events onto every local day they span (capped — year data only). */
function bucketByDay(events: EventSummary[]): Map<string, EventSummary[]> {
  const map = new Map<string, EventSummary[]>();
  for (const e of events) {
    const start = new Date(e.start);
    const end = new Date(e.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    for (let i = 0; i < 370 && cursor <= last; i++) {
      const key = dayKey(cursor);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return map;
}

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export default function YearView({ year, events, calendarById, selectedDate, onSelectDay, onSelectMonth }: Props) {
  const byDay = useMemo(() => bucketByDay(events), [events]);
  const today = new Date();

  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const monthStart = new Date(year, m, 1);
      const leadDays = (monthStart.getDay() + 6) % 7; // Monday-start
      const gridStart = new Date(monthStart);
      gridStart.setDate(gridStart.getDate() - leadDays);
      const days = Array.from({ length: 42 }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(d.getDate() + i);
        return d;
      });
      // Trim to whole weeks that intersect the month (4-6 rows).
      const first = days.findIndex((d) => d.getMonth() === m);
      const lastIdx = days.length - 1 - [...days].reverse().findIndex((d) => d.getMonth() === m);
      const firstRow = Math.floor(first / 7) * 7;
      const lastRow = Math.ceil((lastIdx + 1) / 7) * 7;
      return { monthStart, days: days.slice(firstRow, lastRow) };
    });
  }, [year]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: 20,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16,
        alignContent: "start",
      }}
    >
      {months.map(({ monthStart, days }) => (
        <div
          key={monthStart.getMonth()}
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-line)",
            boxShadow: "var(--shadow-card)",
            borderRadius: "var(--radius-md)",
            padding: "10px 12px 12px",
          }}
        >
          <button
            onClick={() => onSelectMonth(new Date(year, monthStart.getMonth(), 1))}
            className="hoverable"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              marginBottom: 6,
              fontSize: "var(--text-md)",
              fontWeight: 700,
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            {monthStart.toLocaleDateString(undefined, { month: "long" })}
          </button>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 2 }}>
            {WEEKDAY_LETTERS.map((w, i) => (
              <div key={i} style={{ fontSize: "var(--text-2xs)", textAlign: "center", color: "var(--text-tertiary)" }}>
                {w}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
            {days.map((d) => {
              const inMonth = d.getMonth() === monthStart.getMonth();
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selectedDate);
              const dayEvents = inMonth ? byDay.get(dayKey(d)) ?? [] : [];
              const dots = dayEvents.slice(0, 3);
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => onSelectDay(d)}
                  className="tabular-nums hoverable"
                  title={`${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                  style={{
                    aspectRatio: "1",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    background: isSelected ? "var(--accent)" : "transparent",
                    color: !inMonth
                      ? "transparent"
                      : isSelected
                      ? "var(--text-on-fill)"
                      : isToday
                      ? "var(--danger)"
                      : "var(--text-primary)",
                    fontWeight: isToday || isSelected ? 700 : 400,
                    fontSize: "var(--text-sm)",
                    padding: 0,
                    pointerEvents: inMonth ? "auto" : "none",
                  }}
                >
                  <span>{d.getDate()}</span>
                  <span style={{ display: "flex", gap: 1.5, height: 4, alignItems: "center" }}>
                    {dots.map((e) => (
                      <span
                        key={e.id}
                        style={{
                          width: 3.5,
                          height: 3.5,
                          borderRadius: "var(--radius-pill)",
                          background: isCancelledEvent(e)
                            ? "repeating-linear-gradient(135deg, #8c8c93 0 2px, #d0d0d4 2px 4px)"
                            : calendarById[e.calendar_id]?.color ?? "var(--accent)",
                        }}
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <span style={{ fontSize: "var(--text-nano)", color: "var(--text-tertiary)", lineHeight: 1 }}>
                        +{dayEvents.length - 3}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
