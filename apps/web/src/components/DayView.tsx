import React, { useEffect, useRef, useState } from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { useAppearance } from "../appearance";
import { formatHour, formatTimeRange, sameDay, startOfDay } from "../lib/dates";
import { contrastText, tint } from "../lib/color";
import {
  SNAP_MINUTES,
  atMinutes,
  minutesFromY,
  snap,
  snapDown,
  yFromMinutes,
} from "../lib/gridMath";
import { packOverlaps } from "../lib/layout";

const HOUR_HEIGHT = 56;
const START_HOUR = 0;
const END_HOUR = 24;

interface Props {
  day: Date;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  selectedEventId?: string;
  onMoveEvent?: (eventId: string, newStart: Date, newEnd: Date, allDay?: boolean) => void;
  onCreateRange?: (start: Date, end: Date, allDay: boolean) => void;
  onEventMenu?: (e: React.MouseEvent, event: EventSummary) => void;
  onEmptyMenu?: (e: React.MouseEvent, at: Date) => void;
  /** Working-hours window [startHour, endHour] for background shading. */
  workingHours?: [number, number];
}

type DragMode = "move" | "resize" | "lane-out";

interface DragState {
  eventId: string;
  mode: DragMode;
  startY: number;
  originStart: Date;
  originEnd: Date;
  deltaMinutes: number;
  // lane-out only: resolved drop time, refreshed on mousemove
  targetMinutes: number | null;
}

interface CreateState {
  startMin: number;
  curMin: number;
}

function canWrite(cal: CalendarSummary | undefined): boolean {
  return !!(cal?.can_reschedule ?? cal?.writable);
}

export default function DayView({ day, events, calendarById, onSelectEvent, selectedEventId, onMoveEvent, onCreateRange, onEventMenu, onEmptyMenu, workingHours = [9, 17] }: Props) {
  const { hourHeight } = useAppearance();
  const HOUR_H = hourHeight(HOUR_HEIGHT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const dayEvents = events.filter((e) => !e.all_day && sameDay(new Date(e.start), day));
  const allDayEvents = events.filter((e) => e.all_day && sameDay(new Date(e.start), day));

  const laidOut = packOverlaps(
    dayEvents,
    (e) => new Date(e.start),
    (e) => new Date(e.end)
  );

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const now = new Date();
  const showNowLine = sameDay(now, day);
  const nowOffset = ((now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / 60) * HOUR_H;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, nowOffset - 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.toDateString()]);

  useEffect(() => {
    if (!drag && !creating) return;

    function gridTop(): number | null {
      const grid = gridRef.current;
      return grid ? grid.getBoundingClientRect().top : null;
    }

    function handleMouseMove(e: MouseEvent) {
      if (creating) {
        const top = gridTop();
        if (top === null) return;
        const mins = snap(minutesFromY(e.clientY, top, HOUR_H, START_HOUR, END_HOUR));
        setCreating((prev) => (prev ? { ...prev, curMin: mins } : prev));
        return;
      }
      setDrag((prev) => {
        if (!prev) return prev;
        if (prev.mode === "lane-out") {
          const grid = gridRef.current;
          if (!grid) return { ...prev, targetMinutes: null };
          const rect = grid.getBoundingClientRect();
          const inside =
            e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
          if (!inside) return { ...prev, targetMinutes: null };
          return { ...prev, targetMinutes: snap(minutesFromY(e.clientY, rect.top, HOUR_H, START_HOUR, END_HOUR)) };
        }
        const deltaPx = e.clientY - prev.startY;
        const rawMinutes = (deltaPx / HOUR_H) * 60;
        return { ...prev, deltaMinutes: snap(rawMinutes) };
      });
    }

    function handleMouseUp(e: MouseEvent) {
      if (creating) {
        setCreating((prev) => {
          if (prev && onCreateRange) {
            const a = Math.min(prev.startMin, prev.curMin);
            const b = Math.max(prev.startMin, prev.curMin);
            if (b - a >= SNAP_MINUTES) {
              onCreateRange(atMinutes(day, a), atMinutes(day, b), false);
            } else {
              const s = snapDown(a);
              onCreateRange(atMinutes(day, s), atMinutes(day, s + 60), false);
            }
          }
          return null;
        });
        return;
      }
      setDrag((prev) => {
        if (prev && onMoveEvent) {
          if (prev.mode === "lane-out") {
            // Lane -> grid: drop time becomes a 1h timed event. A null
            // target means the pointer never entered the grid: plain click.
            if (prev.targetMinutes !== null) {
              const start = atMinutes(day, prev.targetMinutes);
              onMoveEvent(prev.eventId, start, new Date(start.getTime() + 60 * 60000), false);
            } else {
              const maybe = dayEvents.concat(allDayEvents).find((x) => x.id === prev.eventId);
              if (maybe) onSelectEvent(maybe);
            }
          } else if (prev.mode === "resize") {
            if (prev.deltaMinutes !== 0) {
              const newEnd = new Date(prev.originEnd.getTime() + prev.deltaMinutes * 60000);
              const minEnd = new Date(prev.originStart.getTime() + SNAP_MINUTES * 60000);
              onMoveEvent(prev.eventId, prev.originStart, newEnd < minEnd ? minEnd : newEnd);
            }
          } else if (prev.deltaMinutes !== 0) {
            // Grid -> lane: released above the grid top converts to all-day.
            const top = gridRef.current?.getBoundingClientRect().top;
            if (top !== undefined && e.clientY < top) {
              const s = startOfDay(prev.originStart);
              const t = new Date(s);
              t.setDate(t.getDate() + 1);
              onMoveEvent(prev.eventId, s, t, true);
            } else {
              const newStart = new Date(prev.originStart.getTime() + prev.deltaMinutes * 60000);
              const newEnd = new Date(prev.originEnd.getTime() + prev.deltaMinutes * 60000);
              onMoveEvent(prev.eventId, newStart, newEnd);
            }
          }
        }
        return null;
      });
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrag(null);
        setCreating(null);
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, creating !== null, onMoveEvent, onCreateRange]);

  function beginCreate(e: React.MouseEvent) {
    if (e.button !== 0 || !onCreateRange) return;
    if ((e.target as HTMLElement).closest(".event-block")) return;
    if (!Object.values(calendarById).some((c) => c.can_create ?? c.writable)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const mins = snap(minutesFromY(e.clientY, rect.top, HOUR_H, START_HOUR, END_HOUR));
    setCreating({ startMin: mins, curMin: mins });
  }

  const [whStart, whEnd] = workingHours;
  const whTop = ((whStart - START_HOUR) / 1) * HOUR_H;
  const whBottom = ((whEnd - START_HOUR) / 1) * HOUR_H;

  return (
    <div className="cal-wash view-enter" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        className="all-day-lane"
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          padding: "6px 8px 6px 58px",
          minHeight: allDayEvents.length > 0 ? undefined : 12,
        }}
        onMouseDown={(e) => {
          // Lane background click: new all-day event. Items start a
          // lane-out drag instead (see below).
          if ((e.target as HTMLElement).closest(".event-block") || !onCreateRange) return;
          if (!Object.values(calendarById).some((c) => c.can_create ?? c.writable)) return;
          const s = startOfDay(day);
          const t = new Date(s);
          t.setDate(t.getDate() + 1);
          onCreateRange(s, t, true);
        }}
      >
        {allDayEvents.map((e) => {
          const cal = calendarById[e.calendar_id];
          const color = cal?.color ?? "var(--accent)";
          const dragging = drag?.eventId === e.id;
          return (
            <div
              key={e.id}
              onClick={() => !dragging && onSelectEvent(e)}
              onMouseDown={(ev) => {
                if (ev.button !== 0 || !canWrite(cal) || !onMoveEvent) return;
                ev.preventDefault();
                ev.stopPropagation();
                setDrag({
                  eventId: e.id,
                  mode: "lane-out",
                  startY: ev.clientY,
                  originStart: new Date(e.start),
                  originEnd: new Date(e.end),
                  deltaMinutes: 0,
                  targetMinutes: null,
                });
              }}
              className="event-block hoverable"
              style={{
                background: color,
                color: contrastText(color.startsWith("#") ? color : "#0a84ff"),
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                cursor: canWrite(cal) ? "grab" : "pointer",
                opacity: dragging ? 0.4 : 1,
                userSelect: "none",
              }}
            >
              {e.title}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        <div
          ref={gridRef}
          onMouseDown={beginCreate}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!onEmptyMenu || !gridRef.current) return;
            const rect = gridRef.current.getBoundingClientRect();
            const mins = snap(minutesFromY(e.clientY, rect.top, HOUR_H, START_HOUR, END_HOUR));
            onEmptyMenu(e, atMinutes(day, mins));
          }}
          style={{ position: "relative", height: hours.length * HOUR_H }}
        >
          <div className="offhours-shade" style={{ position: "absolute", top: 0, left: 0, right: 0, height: Math.max(0, whTop) }} />
          <div
            className="offhours-shade"
            style={{ position: "absolute", top: whBottom, left: 0, right: 0, bottom: 0 }}
          />
          {hours.map((h, i) => (
            <div
              key={h}
              style={{
                position: "absolute",
                top: i * HOUR_H,
                left: 0,
                right: 0,
                height: HOUR_H,
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

          {creating && creating.curMin !== creating.startMin && (
            <div
              style={{
                position: "absolute",
                top: yFromMinutes(Math.min(creating.startMin, creating.curMin), HOUR_H, START_HOUR),
                height: Math.max(10, (Math.abs(creating.curMin - creating.startMin) / 60) * HOUR_H),
                left: 58,
                right: 8,
                background: "var(--accent)",
                opacity: 0.35,
                borderRadius: 6,
                pointerEvents: "none",
              }}
            />
          )}

          {showNowLine && nowOffset >= 0 && nowOffset <= hours.length * HOUR_H && (
            <div style={{ position: "absolute", top: nowOffset, left: 56, right: 0, zIndex: 5 }}>
              <div style={{ position: "relative" }}>
                <span
                  className="tabular-nums now-glow"
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
                <div className="now-glow" style={{ height: 2, background: "var(--danger)" }} />
              </div>
            </div>
          )}

          {drag?.mode === "lane-out" && drag.targetMinutes !== null && (() => {
            const ghostStart = atMinutes(day, drag.targetMinutes!);
            const ghostTop = ((ghostStart.getHours() * 60 + ghostStart.getMinutes() - START_HOUR * 60) / 60) * HOUR_H;
            const laneEvent = allDayEvents.find((x) => x.id === drag.eventId);
            return (
              <div
                style={{
                  position: "absolute",
                  top: ghostTop,
                  height: HOUR_H - 2,
                  left: 58,
                  right: 8,
                  background: "var(--accent)",
                  opacity: 0.35,
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 12,
                  fontWeight: 600,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                {laneEvent?.title ?? ""}
              </div>
            );
          })()}
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
              } else if (drag.mode === "resize") {
                displayEnd = new Date(drag.originEnd.getTime() + drag.deltaMinutes * 60000);
              }
            }
            const top = ((displayStart.getHours() * 60 + displayStart.getMinutes() - START_HOUR * 60) / 60) * HOUR_H;
            const height = Math.max(20, ((displayEnd.getTime() - displayStart.getTime()) / 60000 / 60) * HOUR_H - 2);
            const cal = calendarById[event.calendar_id];
            const color = cal?.color ?? "var(--accent)";
            const widthPct = 100 / columnCount;
            const isSelected = event.id === selectedEventId;
            const draggable = canWrite(cal) && !!onMoveEvent;

            return (
              <div
                key={event.id}
                onClick={() => !isDragging && onSelectEvent(event)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  onEventMenu?.(ev, event);
                }}
                onMouseDown={(ev) => {
                  if (!draggable || ev.button !== 0) return;
                  ev.preventDefault();
                  ev.stopPropagation();
                  setDrag({ eventId: event.id, mode: "move", startY: ev.clientY, originStart: start, originEnd: end, deltaMinutes: 0, targetMinutes: null });
                }}
                className={`event-block hoverable${isDragging ? " dragging" : ""}`}
                style={{
                  position: "absolute",
                  top,
                  height,
                  left: `calc(58px + ${column * widthPct}%)`,
                  width: `calc(${widthPct}% - 10px)`,
                  background: `linear-gradient(180deg, ${tint(color.startsWith("#") ? color : "#0a84ff", 0.32)}, ${tint(color.startsWith("#") ? color : "#0a84ff", 0.15)})`,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 6,
                  padding: "4px 8px",
                  overflow: "hidden",
                  cursor: draggable ? "grab" : "pointer",
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
                {draggable && (
                  <div
                    className="resize-handle"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      setDrag({ eventId: event.id, mode: "resize", startY: ev.clientY, originStart: start, originEnd: end, deltaMinutes: 0, targetMinutes: null });
                    }}
                    style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, cursor: "ns-resize" }}
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
