import React, { useEffect, useRef } from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { formatHour, formatTimeRange, sameDay } from "../lib/dates";
import { packOverlaps } from "../lib/layout";

const HOUR_HEIGHT = 56;
const START_HOUR = 6;
const END_HOUR = 22;

interface Props {
  day: Date;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  selectedEventId?: string;
}

export default function DayView({ day, events, calendarById, onSelectEvent, selectedEventId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {allDayEvents.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--border-subtle)", padding: "8px 16px 8px 64px" }}>
          {allDayEvents.map((e) => {
            const cal = calendarById[e.calendar_id];
            return (
              <div
                key={e.id}
                onClick={() => onSelectEvent(e)}
                style={{
                  background: cal?.color ?? "var(--accent)",
                  color: "#fff",
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
            const start = new Date(event.start);
            const end = new Date(event.end);
            const top = ((start.getHours() * 60 + start.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;
            const height = Math.max(20, ((end.getTime() - start.getTime()) / 60000 / 60) * HOUR_HEIGHT - 2);
            const cal = calendarById[event.calendar_id];
            const widthPct = 100 / columnCount;
            const isSelected = event.id === selectedEventId;

            return (
              <div
                key={event.id}
                onClick={() => onSelectEvent(event)}
                style={{
                  position: "absolute",
                  top,
                  height,
                  left: `calc(56px + ${column * widthPct}%)`,
                  width: `calc(${widthPct}% - 6px)`,
                  background: "var(--bg-raised)",
                  borderLeft: `3px solid ${cal?.color ?? "var(--accent)"}`,
                  borderRadius: 6,
                  padding: "4px 8px",
                  overflow: "hidden",
                  cursor: "pointer",
                  outline: isSelected ? `2px solid ${cal?.color ?? "var(--accent)"}` : "none",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {event.title}
                </div>
                {height > 32 && (
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{formatTimeRange(start, end)}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
