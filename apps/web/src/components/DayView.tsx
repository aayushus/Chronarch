import React, { useEffect, useRef, useState } from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { formatHour, formatTimeRange, sameDay } from "../lib/dates";
import { contrastText, tint } from "../lib/color";
import { packOverlaps } from "../lib/layout";

const HOUR_HEIGHT = 56;
const START_HOUR = 6;
const END_HOUR = 22;
const SNAP_MINUTES = 15;

interface Props {
  day: Date;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  selectedEventId?: string;
  onMoveEvent?: (eventId: string, newStart: Date, newEnd: Date) => void;
}

interface DragState {
  eventId: string;
  mode: "move" | "resize";
  startY: number;
  originStart: Date;
  originEnd: Date;
  deltaMinutes: number;
}

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export default function DayView({ day, events, calendarById, onSelectEvent, selectedEventId, onMoveEvent }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dayEvents = events.filter((e) => !e.all_day && sameDay(new Date(e.start), day));
  const allDayEvents = events.filter((e) => e.all_day && sameDay(new Date(e.start), day));

  const laidOut = packOverlaps(
    dayEvents,
    (e) => new Date(e.start),
    (e) => new Date(e.end)
  );

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const now = new Date();
  const showNowLine = sameDay(now, day);
  const nowOffset = ((now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, nowOffset - 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.toDateString()]);

  useEffect(() => {
    if (!drag) return;

    function handleMouseMove(e: MouseEvent) {
      setDrag((prev) => {
        if (!prev) return prev;
        const deltaPx = e.clientY - prev.startY;
        const rawMinutes = (deltaPx / HOUR_HEIGHT) * 60;
        return { ...prev, deltaMinutes: snap(rawMinutes) };
      });
    }

    function handleMouseUp() {
      setDrag((prev) => {
        if (prev && prev.deltaMinutes !== 0 && onMoveEvent) {
          let newStart = new Date(prev.originStart);
          let newEnd = new Date(prev.originEnd);
          if (prev.mode === "move") {
            newStart = new Date(prev.originStart.getTime() + prev.deltaMinutes * 60000);
            newEnd = new Date(prev.originEnd.getTime() + prev.deltaMinutes * 60000);
          } else {
            newEnd = new Date(prev.originEnd.getTime() + prev.deltaMinutes * 60000);
            if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
              newEnd = new Date(newStart.getTime() + SNAP_MINUTES * 60000);
            }
          }
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
      {allDayEvents.length > 0 && (
        <div className="all-day-lane" style={{ borderBottom: "1px solid var(--border-subtle)", padding: "8px 16px 8px 64px" }}>
          {allDayEvents.map((e) => {
            const cal = calendarById[e.calendar_id];
            const color = cal?.color ?? "var(--accent)";
            return (
              <div
                key={e.id}
                onClick={() => onSelectEvent(e)}
                className="event-block hoverable"
                style={{
                  background: color,
                  color: contrastText(color.startsWith("#") ? color : "#0a84ff"),
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 4,
                  cursor: "pointer",
                }}
              >
                {e.title}
              </div>
            );
          })}
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        <div style={{ position: "relative", height: hours.length * HOUR_HEIGHT }}>
          {hours.map((h, i) => (
            <div
              key={h}
              style={{
                position: "absolute",
                top: i * HOUR_HEIGHT,
                left: 0,
                right: 0,
                height: HOUR_HEIGHT,
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <span
                className="tabular-nums"
                style={{
                  position: "absolute",
                  top: -7,
                  left: 8,
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  background: "var(--bg-app)",
                  paddingRight: 6,
                }}
              >
                {formatHour(h)}
              </span>
            </div>
          ))}

          {showNowLine && nowOffset >= 0 && nowOffset <= hours.length * HOUR_HEIGHT && (
            <div style={{ position: "absolute", top: nowOffset, left: 56, right: 0, zIndex: 5 }}>
              <div style={{ position: "relative" }}>
                <span
                  className="tabular-nums"
                  style={{
                    position: "absolute",
                    left: -56,
                    top: -9,
                    background: "var(--danger)",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 4,
                    padding: "2px 4px",
                  }}
                >
                  {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
                <div style={{ height: 1, background: "var(--danger)" }} />
              </div>
            </div>
          )}

          {laidOut.map(({ event, column, columnCount }) => {
            const isDragging = drag?.eventId === event.id;
            const start = new Date(event.start);
            const end = new Date(event.end);
            let displayStart = start;
            let displayEnd = end;
            if (isDragging && drag) {
              if (drag.mode === "move") {
                displayStart = new Date(drag.originStart.getTime() + drag.deltaMinutes * 60000);
                displayEnd = new Date(drag.originEnd.getTime() + drag.deltaMinutes * 60000);
              } else {
                displayEnd = new Date(drag.originEnd.getTime() + drag.deltaMinutes * 60000);
              }
            }
            const top = ((displayStart.getHours() * 60 + displayStart.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;
            const height = Math.max(20, ((displayEnd.getTime() - displayStart.getTime()) / 60000 / 60) * HOUR_HEIGHT - 2);
            const cal = calendarById[event.calendar_id];
            const color = cal?.color ?? "var(--accent)";
            const widthPct = 100 / columnCount;
            const isSelected = event.id === selectedEventId;
            const canDrag = !!cal?.writable && !!onMoveEvent;

            return (
              <div
                key={event.id}
                onClick={() => !isDragging && onSelectEvent(event)}
                onMouseDown={(ev) => {
                  if (!canDrag || ev.button !== 0) return;
                  ev.preventDefault();
                  setDrag({ eventId: event.id, mode: "move", startY: ev.clientY, originStart: start, originEnd: end, deltaMinutes: 0 });
                }}
                className={`event-block hoverable${isDragging ? " dragging" : ""}`}
                style={{
                  position: "absolute",
                  top,
                  height,
                  left: `calc(56px + ${column * widthPct}%)`,
                  width: `calc(${widthPct}% - 6px)`,
                  background: tint(color.startsWith("#") ? color : "#0a84ff", 0.22),
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 6,
                  padding: "4px 8px",
                  overflow: "hidden",
                  cursor: canDrag ? "grab" : "pointer",
                  outline: isSelected ? `2px solid ${color}` : "none",
                  userSelect: "none",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {event.title}
                </div>
                {height > 32 && (
                  <div className="tabular-nums" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {formatTimeRange(displayStart, displayEnd)}
                  </div>
                )}
                {canDrag && (
                  <div
                    className="resize-handle"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      setDrag({ eventId: event.id, mode: "resize", startY: ev.clientY, originStart: start, originEnd: end, deltaMinutes: 0 });
                    }}
                    style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
