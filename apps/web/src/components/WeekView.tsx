import React, { useEffect, useState } from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { tint } from "../lib/color";
import { WEEKDAY_SHORT, formatHour, sameDay, startOfWeek } from "../lib/dates";
import { packOverlaps } from "../lib/layout";

const HOUR_HEIGHT = 44;
const START_HOUR = 6;
const END_HOUR = 22;
const SNAP_MINUTES = 15;

interface Props {
  weekAnchor: Date;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  onSelectDay: (d: Date) => void;
  onMoveEvent?: (eventId: string, newStart: Date, newEnd: Date) => void;
}

interface DragState {
  eventId: string;
  startY: number;
  originStart: Date;
  originEnd: Date;
  deltaMinutes: number;
}

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export default function WeekView({ weekAnchor, events, calendarById, onSelectEvent, onSelectDay, onMoveEvent }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const weekStart = startOfWeek(weekAnchor);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const today = new Date();

  useEffect(() => {
    if (!drag) return;

    function handleMouseMove(e: MouseEvent) {
      setDrag((prev) => {
        if (!prev) return prev;
        const deltaPx = e.clientY - prev.startY;
        return { ...prev, deltaMinutes: snap((deltaPx / HOUR_HEIGHT) * 60) };
      });
    }

    function handleMouseUp() {
      setDrag((prev) => {
        if (prev && prev.deltaMinutes !== 0 && onMoveEvent) {
          const newStart = new Date(prev.originStart.getTime() + prev.deltaMinutes * 60000);
          const newEnd = new Date(prev.originEnd.getTime() + prev.deltaMinutes * 60000);
          onMoveEvent(prev.eventId, newStart, newEnd);
        }
        return null;
      });
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drag !== null, onMoveEvent]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div />
        {days.map((d) => (
          <button
            key={d.toISOString()}
            onClick={() => onSelectDay(d)}
            className="hoverable"
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
                className="tabular-nums"
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
                  const isDragging = drag?.eventId === event.id;
                  const start = new Date(event.start);
                  const end = new Date(event.end);
                  let displayStart = start;
                  let displayEnd = end;
                  if (isDragging && drag) {
                    displayStart = new Date(drag.originStart.getTime() + drag.deltaMinutes * 60000);
                    displayEnd = new Date(drag.originEnd.getTime() + drag.deltaMinutes * 60000);
                  }
                  const top = ((displayStart.getHours() * 60 + displayStart.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max(16, ((displayEnd.getTime() - displayStart.getTime()) / 60000 / 60) * HOUR_HEIGHT - 2);
                  const cal = calendarById[event.calendar_id];
                  const color = cal?.color ?? "var(--accent)";
                  const widthPct = 100 / columnCount;
                  const canDrag = !!cal?.writable && !!onMoveEvent;
                  return (
                    <div
                      key={event.id}
                      onClick={() => !isDragging && onSelectEvent(event)}
                      onMouseDown={(ev) => {
                        if (!canDrag || ev.button !== 0) return;
                        ev.preventDefault();
                        setDrag({ eventId: event.id, startY: ev.clientY, originStart: start, originEnd: end, deltaMinutes: 0 });
                      }}
                      className={`event-block hoverable${isDragging ? " dragging" : ""}`}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: `${column * widthPct}%`,
                        width: `calc(${widthPct}% - 3px)`,
                        background: tint(color.startsWith("#") ? color : "#0a84ff", 0.22),
                        borderLeft: `3px solid ${color}`,
                        borderRadius: 4,
                        padding: "2px 5px",
                        overflow: "hidden",
                        cursor: canDrag ? "grab" : "pointer",
                        fontSize: 10.5,
                        fontWeight: 600,
                        userSelect: "none",
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
