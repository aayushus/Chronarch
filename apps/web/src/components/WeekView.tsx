import React, { useEffect, useRef, useState } from "react";

import { CalendarSummary, EventSummary } from "../api/calendar";
import { useAppearance } from "../appearance";
import { WEEKDAY_SHORT, formatHour, formatHourInZone, formatTimeRange, sameDay, startOfDay, startOfWeek } from "../lib/dates";
import { AllDayChip, isCancelledEvent } from "./EventCard";
import { contrastText } from "../lib/color";
import {
  SNAP_MINUTES,
  addDaysPreserveTime,
  atMinutes,
  dayOffsetFromX,
  minutesFromY,
  snap,
  snapDown,
  yFromMinutes,
} from "../lib/gridMath";
import { packOverlaps } from "../lib/layout";

const HOUR_HEIGHT = 44;
const START_HOUR = 0;
const END_HOUR = 24;
const GUTTER_WIDTH = 56;
// Below this, an event column's text is unreadable (title + time both
// clip to a couple of characters) — a busy day scrolls horizontally
// within its own column instead of squeezing every event past legibility.
const MIN_COLUMN_WIDTH = 70;

interface Props {
  weekAnchor: Date;
  events: EventSummary[];
  calendarById: Record<string, CalendarSummary>;
  onSelectEvent: (e: EventSummary) => void;
  onSelectDay: (d: Date) => void;
  onMoveEvent?: (eventId: string, newStart: Date, newEnd: Date, allDay?: boolean) => void;
  onCreateRange?: (start: Date, end: Date, allDay: boolean) => void;
  onEventMenu?: (e: React.MouseEvent, event: EventSummary) => void;
  onEmptyMenu?: (e: React.MouseEvent, at: Date) => void;
  /** Working-hours window [startHour, endHour] for background shading. */
  workingHours?: [number, number];
  /** Optional second time-zone scale in the hour gutter (BRD §27). */
  secondaryTimezone?: string | null;
}

type DragMode = "move" | "resize" | "lane-out";

interface DragState {
  eventId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  originDayIndex: number;
  originStart: Date;
  originEnd: Date;
  deltaDays: number;
  deltaMinutes: number;
  // lane-out only: resolved drop target, refreshed on mousemove
  targetDayIndex: number | null;
  targetMinutes: number | null;
}

interface CreateState {
  dayIndex: number;
  startMin: number;
  curMin: number;
}

function canWrite(cal: CalendarSummary | undefined): boolean {
  return !!(cal?.can_reschedule ?? cal?.writable);
}

function canCreate(cal: CalendarSummary[] | undefined): boolean {
  return (cal ?? []).some((c) => c.can_create ?? c.writable);
}

export default function WeekView({ weekAnchor, events, calendarById, onSelectEvent, onSelectDay, onMoveEvent, onCreateRange, onEventMenu, onEmptyMenu, workingHours = [9, 17], secondaryTimezone }: Props) {
  const { hourHeight } = useAppearance();
  const HOUR_H = hourHeight(HOUR_HEIGHT);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(weekAnchor);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  // Shared gutter: anchor on the week's first day (DST edges mid-week are
  // accepted imprecision for a glanceable second scale).
  const anchorDay = days[0] ?? weekAnchor;
  const secondaryLabels = hours.map((h) =>
    formatHourInZone(
      new Date(anchorDay.getFullYear(), anchorDay.getMonth(), anchorDay.getDate(), h),
      secondaryTimezone
    )
  );
  const weekAllDay = events.filter((e) => e.all_day && days.some((d) => sameDay(new Date(e.start), d)));

  function dayIndexOf(date: Date): number {
    const i = days.findIndex((d) => sameDay(d, date));
    return i === -1 ? 0 : i;
  }

  function resolveDrop(clientX: number, clientY: number): { dayIndex: number; minutes: number } | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const dayWidth = (rect.width - GUTTER_WIDTH) / 7;
    const dayIndex = Math.min(6, Math.max(0, Math.floor((clientX - rect.left - GUTTER_WIDTH) / dayWidth)));
    // Column tops all align with the grid top (equal-height columns).
    const colTop = rect.top;
    const minutes = snap(
      minutesFromY(clientY, colTop, HOUR_H, START_HOUR, END_HOUR)
    );
    return { dayIndex, minutes };
  }

  useEffect(() => {
    if (!drag && !creating) return;

    function handleMouseMove(e: MouseEvent) {
      if (creating) {
        const grid = gridRef.current;
        if (!grid) return;
        const rect = grid.getBoundingClientRect();
        // Column tops align with grid top; creating stays in its origin column.
        const mins = snap(minutesFromY(e.clientY, rect.top, HOUR_H, START_HOUR, END_HOUR));
        setCreating((prev) => (prev ? { ...prev, curMin: mins } : prev));
        return;
      }
      setDrag((prev) => {
        if (!prev) return prev;
        if (prev.mode === "resize") {
          return { ...prev, deltaMinutes: snap(((e.clientY - prev.startY) / HOUR_H) * 60) };
        }
        if (prev.mode === "lane-out") {
          const grid = gridRef.current;
          if (!grid) return { ...prev, targetDayIndex: null, targetMinutes: null };
          const rect = grid.getBoundingClientRect();
          const inside =
            e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
          if (!inside) return { ...prev, targetDayIndex: null, targetMinutes: null };
          const drop = resolveDrop(e.clientX, e.clientY);
          if (!drop) return { ...prev, targetDayIndex: null, targetMinutes: null };
          return { ...prev, targetDayIndex: drop.dayIndex, targetMinutes: drop.minutes };
        }
        const grid = gridRef.current;
        let deltaDays = 0;
        if (grid) {
          const rect = grid.getBoundingClientRect();
          deltaDays = dayOffsetFromX(e.clientX, rect.left, GUTTER_WIDTH, rect.width, 7, prev.originDayIndex);
        }
        return {
          ...prev,
          deltaDays,
          deltaMinutes: snap(((e.clientY - prev.startY) / HOUR_H) * 60),
        };
      });
    }

    function handleMouseUp(e: MouseEvent) {
      if (creating) {
        setCreating((prev) => {
          if (prev && onCreateRange) {
            const a = Math.min(prev.startMin, prev.curMin);
            const b = Math.max(prev.startMin, prev.curMin);
            if (b - a >= SNAP_MINUTES) {
              onCreateRange(atMinutes(days[prev.dayIndex], a), atMinutes(days[prev.dayIndex], b), false);
            } else {
              // Plain click: 1h event at the clicked slot.
              const s = snapDown(a);
              onCreateRange(atMinutes(days[prev.dayIndex], s), atMinutes(days[prev.dayIndex], s + 60), false);
            }
          }
          return null;
        });
        return;
      }
      setDrag((prev) => {
        if (prev && onMoveEvent) {
          if (prev.mode === "lane-out") {
            // Lane -> grid: drop time becomes a 1h timed event.
            if (prev.targetDayIndex !== null && prev.targetMinutes !== null) {
              const start = atMinutes(days[prev.targetDayIndex], prev.targetMinutes);
              const end = new Date(start.getTime() + 60 * 60000);
              onMoveEvent(prev.eventId, start, end, false);
            } else {
              const maybe = events.find((x) => x.id === prev.eventId);
              if (maybe) onSelectEvent(maybe);
            }
          } else if (prev.mode === "resize") {
            if (prev.deltaMinutes !== 0) {
              const newEnd = new Date(prev.originEnd.getTime() + prev.deltaMinutes * 60000);
              const minEnd = new Date(prev.originStart.getTime() + SNAP_MINUTES * 60000);
              onMoveEvent(prev.eventId, prev.originStart, newEnd < minEnd ? minEnd : newEnd);
            }
          } else if (prev.deltaDays !== 0 || prev.deltaMinutes !== 0) {
            const top = gridRef.current?.getBoundingClientRect().top;
            const shiftedDay = addDaysPreserveTime(prev.originStart, prev.deltaDays);
            if (top !== undefined && e.clientY < top) {
              // Grid -> lane: released above the grid top converts to all-day on that target day.
              const s = startOfDay(shiftedDay);
              const t = new Date(s);
              t.setDate(t.getDate() + 1);
              onMoveEvent(prev.eventId, s, t, true);
            } else {
              const duration = prev.originEnd.getTime() - prev.originStart.getTime();
              const newStart = new Date(shiftedDay.getTime() + prev.deltaMinutes * 60000);
              onMoveEvent(prev.eventId, newStart, new Date(newStart.getTime() + duration));
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

  function beginCreate(dayIndex: number, e: React.MouseEvent) {
    if (e.button !== 0 || !onCreateRange) return;
    if ((e.target as HTMLElement).closest(".event-block")) return;
    if (!canCreate(Object.values(calendarById))) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const mins = snap(minutesFromY(e.clientY, rect.top, HOUR_H, START_HOUR, END_HOUR));
    setCreating({ dayIndex, startMin: mins, curMin: mins });
  }

  const [whStart, whEnd] = workingHours;
  const now = new Date();
  const today = now;
  const todayIndex = days.findIndex((d) => sameDay(d, now));
  const nowOffset = ((now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / 60) * HOUR_H;

  return (
    <div className="cal-wash view-enter" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: `${GUTTER_WIDTH}px repeat(7, 1fr)`, borderBottom: "1px solid var(--border-subtle)" }}>
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

      {weekAllDay.length > 0 && (
        <div
          className="all-day-lane"
          style={{
            display: "grid",
            gridTemplateColumns: `${GUTTER_WIDTH}px repeat(7, 1fr)`,
            borderBottom: "1px solid var(--border-subtle)",
            padding: "4px 0",
            maxHeight: 88,
            overflowY: "auto",
          }}
          onMouseDown={(e) => {
            // Lane background click: new all-day event on that day.
            if ((e.target as HTMLElement).closest(".event-block") || !onCreateRange) return;
            const cell = (e.target as HTMLElement).closest("[data-lane-day]");
            const idx = cell ? Number((cell as HTMLElement).dataset.laneDay) : 0;
            const s = startOfDay(days[idx] ?? days[0]);
            const t = new Date(s);
            t.setDate(t.getDate() + 1);
            onCreateRange(s, t, true);
          }}
        >
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", padding: "4px 0 0 8px" }}>all-day</div>
          {days.map((day, di) => (
            <div key={day.toISOString()} data-lane-day={di} style={{ padding: "0 2px", minHeight: 20 }}>
                {weekAllDay
                  .filter((e) => sameDay(new Date(e.start), day))
                  .map((e) => {
                    const cal = calendarById[e.calendar_id];
                    const color = cal?.color ?? "var(--accent)";
                    const dragging = drag?.eventId === e.id;
                    return (
                      <div
                        key={e.id}
                        onMouseDown={(ev) => {
                          if (ev.button !== 0 || !canWrite(cal) || !onMoveEvent) return;
                          ev.preventDefault();
                          ev.stopPropagation();
                          setDrag({
                            eventId: e.id,
                            mode: "lane-out",
                            startX: ev.clientX,
                            startY: ev.clientY,
                            originDayIndex: di,
                            originStart: new Date(e.start),
                            originEnd: new Date(e.end),
                            deltaDays: 0,
                            deltaMinutes: 0,
                            targetDayIndex: null,
                            targetMinutes: null,
                          });
                        }}
                        style={{ marginBottom: 2, opacity: dragging ? 0.4 : 1, cursor: canWrite(cal) ? "grab" : "pointer" }}
                      >
                        <AllDayChip
                          color={color}
                          title={e.title}
                          cancelled={isCancelledEvent(e)}
                          onOpen={() => !dragging && onSelectEvent(e)}
                          onMenu={(mev) => onEventMenu?.(mev, e)}
                        />
                      </div>
                    );
                  })}
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: `${GUTTER_WIDTH}px repeat(7, 1fr)`, position: "relative" }}>
          <div style={{ position: "relative", height: hours.length * HOUR_H }}>
            {hours.map((h, i) => (
              <span
                key={h}
                className="tabular-nums"
                style={{
                  position: "absolute",
                  top: i * HOUR_H + HOUR_H / 2,
                  left: 8,
                  fontSize: 10,
                  lineHeight: 1.1,
                  transform: "translateY(-50%)",
                  color: "var(--text-tertiary)",
                }}
              >
                {formatHour(h)}
                {secondaryLabels[i] ? (
                  <span style={{ display: "block", fontSize: 8, opacity: 0.75 }}>{secondaryLabels[i]}</span>
                ) : null}
              </span>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const dayEvents = events.filter((e) => !e.all_day && sameDay(new Date(e.start), day));
            const laidOut = packOverlaps(
              dayEvents,
              (e) => new Date(e.start),
              (e) => new Date(e.end)
            );
            const maxColumns = laidOut.reduce((m, { columnCount }) => Math.max(m, columnCount), 1);
            const innerMinWidth = maxColumns * MIN_COLUMN_WIDTH;
            return (
              <div
                key={day.toISOString()}
                style={{ position: "relative", height: hours.length * HOUR_H, overflowX: "auto", overflowY: "hidden", borderLeft: "1px solid var(--border-subtle)" }}
              >
              <div
                onMouseDown={(e) => beginCreate(dayIndex, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!onEmptyMenu) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const mins = snap(minutesFromY(e.clientY, rect.top, HOUR_H, START_HOUR, END_HOUR));
                  onEmptyMenu(e, atMinutes(days[dayIndex], mins));
                }}
                style={{ position: "relative", height: "100%", minWidth: innerMinWidth }}
              >
                {Array.from({ length: hours.length * 2 }, (_, i) => (
                  <div key={i} style={{ position: "absolute", top: i * HOUR_H / 2, left: 0, right: 0, borderTop: i % 2 === 0 ? "1px solid var(--border-subtle)" : "1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent)" }} />
                ))}
                <div
                  className="offhours-shade"
                  style={{ position: "absolute", top: 0, left: 0, right: 0, height: Math.max(0, (whStart - START_HOUR) * HOUR_H) }}
                />
                <div
                  className="offhours-shade"
                  style={{ position: "absolute", top: (whEnd - START_HOUR) * HOUR_H, left: 0, right: 0, bottom: 0 }}
                />
                {todayIndex === dayIndex && nowOffset >= 0 && nowOffset <= hours.length * HOUR_H && (
                  <div style={{ position: "absolute", top: nowOffset, left: 0, right: 0, zIndex: 5, pointerEvents: "none" }}>
                    {dayIndex === 0 && (
                      <span
                        className="tabular-nums now-glow"
                        style={{ position: "absolute", left: -52, top: -9, background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 5px", whiteSpace: "nowrap" }}
                      >
                        {new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                    <div className="now-glow" style={{ height: 2, background: "var(--danger)" }} />
                  </div>
                )}
                {creating && creating.dayIndex === dayIndex && creating.curMin !== creating.startMin && (
                  <div
                    style={{
                      position: "absolute",
                      top: yFromMinutes(Math.min(creating.startMin, creating.curMin), HOUR_H, START_HOUR),
                      height: Math.max(10, (Math.abs(creating.curMin - creating.startMin) / 60) * HOUR_H),
                      left: 1,
                      right: 1,
                      background: "var(--accent)",
                      opacity: 0.35,
                      borderRadius: 4,
                      pointerEvents: "none",
                    }}
                  />
                )}
                {drag?.mode === "lane-out" &&
                  drag.targetDayIndex === dayIndex &&
                  drag.targetMinutes !== null &&
                  (() => {
                    const ghostStart = atMinutes(day, drag.targetMinutes!);
                    const ghostTop = ((ghostStart.getHours() * 60 + ghostStart.getMinutes() - START_HOUR * 60) / 60) * HOUR_H;
                    const laneEvent = weekAllDay.find((x) => x.id === drag.eventId);
                    return (
                      <div
                        style={{
                          position: "absolute",
                          top: ghostTop,
                          height: HOUR_H - 2,
                          left: 1,
                          right: 1,
                          background: "var(--accent)",
                          opacity: 0.35,
                          borderRadius: 4,
                          padding: "2px 5px",
                          fontSize: 10.5,
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
                  let dayShift = 0;
                  if (isDragging && drag) {
                    if (drag.mode === "move") {
                      const shifted = addDaysPreserveTime(drag.originStart, drag.deltaDays);
                      displayStart = new Date(shifted.getTime() + drag.deltaMinutes * 60000);
                      displayEnd = new Date(displayStart.getTime() + (drag.originEnd.getTime() - drag.originStart.getTime()));
                      dayShift = drag.deltaDays;
                    } else if (drag.mode === "resize") {
                      displayEnd = new Date(drag.originEnd.getTime() + drag.deltaMinutes * 60000);
                    }
                  }
                  const top = ((displayStart.getHours() * 60 + displayStart.getMinutes() - START_HOUR * 60) / 60) * HOUR_H;
                  const height = Math.max(16, ((displayEnd.getTime() - displayStart.getTime()) / 60000 / 60) * HOUR_H - 2);
                  const cal = calendarById[event.calendar_id];
                  const color = cal?.color ?? "var(--accent)";
                  const widthPct = 100 / columnCount;
                  const canDrag = canWrite(cal) && !!onMoveEvent;
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
                        if (!canDrag || ev.button !== 0) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        setDrag({
                          eventId: event.id,
                          mode: "move",
                          startX: ev.clientX,
                          startY: ev.clientY,
                          originDayIndex: dayIndexOf(start),
                          originStart: start,
                          originEnd: end,
                          deltaDays: 0,
                          deltaMinutes: 0,
                          targetDayIndex: null,
                          targetMinutes: null,
                        });
                      }}
                      className={`event-block hoverable${isDragging ? " dragging" : ""}`}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: `calc(${column * widthPct}% + ${dayShift * 100}%)`,
                        width: `calc(${widthPct}% - 3px)`,
                        background: isCancelledEvent(event) ? "repeating-linear-gradient(135deg, rgba(128,128,128,.18) 0 6px, rgba(128,128,128,.07) 6px 12px), var(--bg-raised)" : color,
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
                        borderRadius: 6,
                        padding: "4px 7px",
                        overflow: "hidden",
                        cursor: canDrag ? "grab" : "pointer",
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: isCancelledEvent(event) ? "var(--text-secondary)" : contrastText(color),
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        userSelect: "none",
                        opacity: isCancelledEvent(event) ? 0.82 : 1,
                        zIndex: isDragging ? 5 : undefined,
                      }}
                    >
                      <span
                        title={event.title}
                        style={{
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: height >= 56 ? 2 : 1,
                          overflow: "hidden",
                          whiteSpace: height < 56 ? "nowrap" : "normal",
                          textOverflow: "ellipsis",
                          lineHeight: 1.2,
                        }}
                      >
                        {isCancelledEvent(event) && <span style={{ fontSize: 9, letterSpacing: .5, color: "var(--text-tertiary)" }}>CANCELLED </span>}{event.title}
                      </span>
                      {height > 32 && (
                        <div className="tabular-nums" style={{ fontSize: 10, fontWeight: 500, color: contrastText(color) === "#ffffff" ? "rgba(255, 255, 255, 0.88)" : "rgba(0, 0, 0, 0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                          {formatTimeRange(displayStart, displayEnd)}
                        </div>
                      )}
                      {canDrag && (
                        <div
                          className="resize-handle"
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setDrag({
                              eventId: event.id,
                              mode: "resize",
                              startX: ev.clientX,
                              startY: ev.clientY,
                              originDayIndex: dayIndex,
                              originStart: start,
                              originEnd: end,
                              deltaDays: 0,
                              deltaMinutes: 0,
                              targetDayIndex: null,
                              targetMinutes: null,
                            });
                          }}
                          style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, cursor: "ns-resize" }}
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
      </div>
    </div>
  );
}
