import React from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { contrastText } from "../lib/color";
import { WEEKDAY_SHORT, sameDay, startOfMonth } from "../lib/dates";

interface Props {
  monthAnchor: Date;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  onSelectDay: (d: Date) => void;
  onEventMenu?: (e: React.MouseEvent, event: EventSummary) => void;
  onEmptyMenu?: (e: React.MouseEvent, at: Date) => void;
}

export default function MonthView({ monthAnchor, events, calendarById, onSelectEvent, onSelectDay, onEventMenu, onEmptyMenu }: Props) {
  const monthStart = startOfMonth(monthAnchor);
  const gridStart = new Date(monthStart);
  const leadDays = (monthStart.getDay() + 6) % 7;
  gridStart.setDate(gridStart.getDate() - leadDays);

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = new Date();

  return (
    <div className="cal-wash view-enter" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border-subtle)" }}>
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={i} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "var(--text-tertiary)" }}>
            {w}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateRows: "repeat(6, 1fr)" }}>
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border-subtle)" }}>
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const dayEvents = events.filter((e) => sameDay(new Date(e.start), d));
              const isCurrentMonth = d.getMonth() === monthStart.getMonth();
              return (
                <div
                  key={d.toISOString()}
                  onClick={() => onSelectDay(d)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!onEmptyMenu) return;
                    const at = new Date(d);
                    at.setHours(9, 0, 0, 0);
                    onEmptyMenu(e, at);
                  }}
                  className="hoverable"
                  style={{
                    borderLeft: "1px solid var(--border-subtle)",
                    padding: 6,
                    cursor: "pointer",
                    overflow: "hidden",
                    opacity: isCurrentMonth ? 1 : 0.4,
                  }}
                >
                  <div
                    className="tabular-nums"
                    style={{
                      fontSize: 12,
                      fontWeight: sameDay(d, today) ? 700 : 400,
                      color: sameDay(d, today) ? "var(--danger)" : "var(--text-primary)",
                      marginBottom: 4,
                    }}
                  >
                    {d.getDate()}
                  </div>
                  {dayEvents.slice(0, 3).map((e) => {
                    const cal = calendarById[e.calendar_id];
                    const color = cal?.color ?? "var(--accent)";
                    return (
                      <div
                        key={e.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelectEvent(e);
                        }}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          onEventMenu?.(ev, e);
                        }}
                        className="event-block"
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: contrastText(color.startsWith("#") ? color : "#0a84ff"),
                          background: color,
                          borderRadius: 3,
                          padding: "1px 4px",
                          marginBottom: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {e.title}
                      </div>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <div style={{ fontSize: 9, color: "var(--text-tertiary)" }}>+{dayEvents.length - 3} more</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
