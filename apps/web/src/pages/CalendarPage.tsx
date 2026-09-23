import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { friendlyError } from "../api/client";

import {
  CalendarSummary,
  ConflictInfo,
  EventSummary,
  createEvent,
  deleteEvent,
  getConflicts,
  getEvent,
  listCalendars,
  moveEvent,
  triggerCalendarSync,
  updateEvent,
} from "../api/calendar";
import { canSeeSettings, useAuth, workingHoursOf } from "../api/auth";
import { useToast } from "../components/Toast";
import ConflictConfirmModal from "../components/ConflictConfirmModal";
import CopilotDrawer from "../components/CopilotDrawer";
import EventContextMenu from "../components/EventContextMenu";
import EventDetailPanel from "../components/EventDetailPanel";
import { avatarInitials } from "../components/EventCard";
import IcsImportModal from "../components/IcsImportModal";
import Icon from "../components/Icon";
import MiniMonth from "../components/MiniMonth";
import Palette, { PaletteAction } from "../components/Palette";
import QuickCreateModal, { CreateDraft } from "../components/QuickCreateModal";
import { addDays, startOfDay, startOfMonth, startOfWeek } from "../lib/dates";
import { dayStats, formatMinutes, greeting } from "../lib/focus";
import { pickCountdowns } from "../lib/kiosk";
import { fetchEventsLazy, invalidateEventsCache } from "../lib/eventsCache";
import { contrastText } from "../lib/color";

export type CalendarViewMode = "day" | "week" | "month" | "agenda" | "year";

const DayView = lazy(() => import("../components/DayView"));
const WeekView = lazy(() => import("../components/WeekView"));
const MonthView = lazy(() => import("../components/MonthView"));
const YearView = lazy(() => import("../components/YearView"));
const AgendaView = lazy(() => import("../components/AgendaView"));

function useWide(minWidth: number): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(`(min-width: ${minWidth}px)`).matches);
  useEffect(() => {
    const q = window.matchMedia(`(min-width: ${minWidth}px)`);
    const onChange = () => setWide(q.matches);
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, [minWidth]);
  return wide;
}

function formatDateRangeLabel(viewMode: CalendarViewMode, date: Date): string {
  if (viewMode === "day") {
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  if (viewMode === "week") {
    const s = startOfWeek(date);
    const e = addDays(s, 6);
    if (s.getFullYear() !== e.getFullYear()) {
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (s.getMonth() !== e.getMonth()) {
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${s.getFullYear()}`;
    }
    return `${s.toLocaleDateString(undefined, { month: "short" })} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
  }
  if (viewMode === "month") {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (viewMode === "agenda") {
    const s = startOfDay(date);
    const e = addDays(s, 13);
    return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return String(date.getFullYear());
}

/** Main calendar command center (promoted from /beta). */
export default function CalendarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const workingHours = useMemo(() => workingHoursOf(user), [user]);
  const showRails = useWide(1180);

  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [viewedDate, setViewedDate] = useState(new Date());
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [createDraft, setCreateDraft] = useState<
    { start: Date; end: Date; allDay: boolean; title?: string; calendarId?: string } | null
  >(null);
  const [pendingConflict, setPendingConflict] = useState<
    | { kind: "create"; body: CreateDraft; conflicts: ConflictInfo[] }
    | { kind: "move"; eventId: string; start: Date; end: Date; allDay?: boolean; conflicts: ConflictInfo[] }
    | null
  >(null);
  const [showIcsModal, setShowIcsModal] = useState(false);
  const [droppedIcsContent, setDroppedIcsContent] = useState<string | undefined>(undefined);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState<{ x: number; y: number; event: EventSummary | null; createAt?: Date } | null>(null);
  const [moveTarget, setMoveTarget] = useState<EventSummary | null>(null);
  const [todayRailOpen, setTodayRailOpen] = useState(() => {
    try {
      return localStorage.getItem("chronarch_today_rail") !== "0";
    } catch {
      return true;
    }
  });

  function toggleTodayRail() {
    setTodayRailOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("chronarch_today_rail", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    listCalendars().then(setCalendars).catch((e) => setError(friendlyError(e)));
  }, []);

  // Deep link (?event=<id>): open the shared event on load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    if (!eventId) return;
    getEvent(eventId)
      .then((e) => {
        setSelectedEvent(e);
        setViewedDate(new Date(e.start));
      })
      .catch(() => {
        /* stale/missing link — stay on the calendar */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (viewMode === "day") return [startOfDay(viewedDate), addDays(startOfDay(viewedDate), 1)];
    if (viewMode === "week") {
      const s = startOfWeek(viewedDate);
      return [s, addDays(s, 7)];
    }
    if (viewMode === "agenda") {
      const s = startOfDay(viewedDate);
      return [s, addDays(s, 14)];
    }
    if (viewMode === "year") {
      const s = new Date(viewedDate.getFullYear(), 0, 1);
      return [s, new Date(viewedDate.getFullYear() + 1, 0, 1)];
    }
    const s = startOfMonth(viewedDate);
    return [addDays(s, -7), addDays(s, 49)];
  }, [viewMode, viewedDate]);

  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    fetchEventsLazy(rangeStart, rangeEnd)
      .then((fresh) => {
        if (!cancelled) setEvents(fresh);
      })
      .catch((e) => {
        if (!cancelled) setError(friendlyError(e));
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeStart.getTime(), rangeEnd.getTime()]);

  const calendarById = useMemo(() => Object.fromEntries(calendars.map((c) => [c.id, c])), [calendars]);
  const calendarGroups = useMemo(() => {
    const groups = new Map<string, { label: string; calendars: CalendarSummary[] }>();
    for (const cal of calendars) {
      if (!groups.has(cal.account_id)) {
        groups.set(cal.account_id, { label: cal.account_label, calendars: [] });
      }
      groups.get(cal.account_id)!.calendars.push(cal);
    }
    return [...groups.entries()];
  }, [calendars]);
  const visibleEvents = events.filter((e) => !hiddenCalendarIds.has(e.calendar_id));
  const writableCalendars = useMemo(
    () => calendars.filter((c) => c.can_create ?? c.writable),
    [calendars]
  );

  function toggleCalendar(id: string) {
    setHiddenCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function shift(delta: number) {
    if (viewMode === "day") setViewedDate((d) => addDays(d, delta));
    else if (viewMode === "week") setViewedDate((d) => addDays(d, delta * 7));
    else if (viewMode === "month") setViewedDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
    else if (viewMode === "agenda") setViewedDate((d) => addDays(d, delta * 7));
    else setViewedDate((d) => new Date(d.getFullYear() + delta, d.getMonth(), 1));
  }

  async function refreshEvents() {
    invalidateEventsCache();
    setEvents(await fetchEventsLazy(rangeStart, rangeEnd));
  }

  function handleCreateRange(start: Date, end: Date, allDay: boolean) {
    setCreateDraft({ start, end, allDay });
  }

  async function commitCreate(body: CreateDraft) {
    await createEvent(body);
    setCreateDraft(null);
    await refreshEvents();
  }

  async function handleCreate(body: CreateDraft) {
    try {
      const conflicts = await getConflicts(new Date(body.start), new Date(body.end));
      if (conflicts.length > 0) {
        setPendingConflict({ kind: "create", body, conflicts });
        return;
      }
      await commitCreate(body);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function commitMove(eventId: string, newStart: Date, newEnd: Date, allDay?: boolean) {
    const previous = events;
    const prevSelected = selectedEvent;
    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? { ...e, start: newStart.toISOString(), end: newEnd.toISOString(), all_day: allDay ?? e.all_day }
          : e
      )
    );
    try {
      await moveEvent(eventId, newStart.toISOString(), newEnd.toISOString(), allDay);
      invalidateEventsCache();
    } catch (e) {
      setEvents(previous);
      setSelectedEvent(prevSelected);
      setError(friendlyError(e));
    }
  }

  async function handleMoveEvent(eventId: string, newStart: Date, newEnd: Date, allDay?: boolean) {
    try {
      const conflicts = await getConflicts(newStart, newEnd, eventId);
      if (conflicts.length > 0) {
        setPendingConflict({ kind: "move", eventId, start: newStart, end: newEnd, allDay, conflicts });
        return;
      }
      await commitMove(eventId, newStart, newEnd, allDay);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function handleDelete(eventId: string, scope = "series", instanceStart?: string) {
    const doomed = events.find((e) => e.id === eventId) ?? selectedEvent;
    try {
      await deleteEvent(eventId, scope, instanceStart);
      invalidateEventsCache();
      if (scope === "series") {
        setSelectedEvent(null);
        setEvents((prev) => prev.filter((e) => e.id !== eventId));
      } else {
        setEvents(await fetchEventsLazy(rangeStart, rangeEnd));
        try {
          setSelectedEvent(await getEvent(eventId));
        } catch {
          setSelectedEvent(null);
        }
      }
      if (doomed && scope === "series") {
        const snapshot = doomed;
        toast(`Deleted “${snapshot.title}”`, {
          actionLabel: "Undo",
          onAction: async () => {
            try {
              await createEvent({
                calendar_id: snapshot.calendar_id,
                title: snapshot.title,
                start: snapshot.start,
                end: snapshot.end,
                all_day: snapshot.all_day,
                description: snapshot.description,
                location: snapshot.location,
              });
              await refreshEvents();
            } catch (e) {
              setError(friendlyError(e));
            }
          },
        });
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function handleDuplicate(event: EventSummary) {
    try {
      const copy = await createEvent({
        calendar_id: event.calendar_id,
        title: `${event.title} (copy)`,
        start: event.start,
        end: event.end,
        all_day: event.all_day,
        description: event.description,
        location: event.location,
      });
      await refreshEvents();
      setSelectedEvent(copy);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function handleTogglePrivate(event: EventSummary) {
    const next = event.visibility === "private" ? "standard" : "private";
    try {
      const updated = await updateEvent(event.id, { visibility: next });
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      if (selectedEvent?.id === updated.id) setSelectedEvent(updated);
      toast(next === "private" ? `“${event.title}” is now private.` : `“${event.title}” is no longer private.`);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function openEventMenu(e: React.MouseEvent, event: EventSummary) {
    setMoveTarget(null);
    setMenu({ x: e.clientX, y: e.clientY, event });
  }

  function openEmptyMenu(e: React.MouseEvent, at: Date) {
    setMoveTarget(null);
    setMenu({ x: e.clientX, y: e.clientY, event: null, createAt: at });
  }

  function menuItemsFor(event: EventSummary | null) {
    if (event === null) return [{ id: "new", label: "New event here" }];
    const cal = calendarById[event.calendar_id];
    const canWrite = !!(cal?.can_edit ?? cal?.can_reschedule ?? cal?.writable);
    const canDelete = !!(cal?.can_delete ?? cal?.writable);
    return [
      { id: "details", label: "View details" },
      { id: "duplicate", label: "Duplicate", disabled: !canWrite },
      { id: "private", label: event.visibility === "private" ? "Make public" : "Mark private", disabled: !canWrite },
      { id: "delete", label: "Delete", danger: true, disabled: !canDelete },
    ];
  }

  function pickMenuItem(id: string) {
    if (!menu) return;
    if (menu.event === null) {
      if (id === "new" && menu.createAt) {
        const at = menu.createAt;
        setCreateDraft({ start: at, end: new Date(at.getTime() + 30 * 60000), allDay: false });
      }
      setMenu(null);
      return;
    }
    const event = menu.event;
    const cal = calendarById[event.calendar_id];
    const canWrite = !!(cal?.can_edit ?? cal?.can_reschedule ?? cal?.writable);
    const canDelete = !!(cal?.can_delete ?? cal?.writable);
    switch (id) {
      case "details":
        setSelectedEvent(event);
        break;
      case "duplicate":
        if (canWrite) void handleDuplicate(event);
        break;
      case "private":
        if (canWrite) void handleTogglePrivate(event);
        break;
      case "delete":
        if (canDelete) void handleDelete(event.id);
        break;
    }
    setMenu(null);
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    try {
      const res = await triggerCalendarSync();
      setLastSyncedAt(res.last_synced_at);
      await refreshEvents();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setIsSyncing(false);
    }
  }

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "new-event",
        title: "New event",
        hint: "quick-create",
        icon: "plus",
        run: () => {
          const s = new Date(viewedDate);
          s.setHours(9, 0, 0, 0);
          setCreateDraft({ start: s, end: new Date(s.getTime() + 30 * 60000), allDay: false });
        },
      },
      { id: "today", title: "Go to today", hint: "navigate", icon: "calendar", run: () => setViewedDate(new Date()) },
      { id: "view-day", title: "Switch to Day view", hint: "view", icon: "grid", run: () => setViewMode("day") },
      { id: "view-week", title: "Switch to Week view", hint: "view", icon: "grid", run: () => setViewMode("week") },
      { id: "view-month", title: "Switch to Month view", hint: "view", icon: "grid", run: () => setViewMode("month") },
      { id: "sync", title: "Sync all accounts now", hint: "sync", icon: "refresh", run: () => handleSyncNow() },
      { id: "copilot", title: "Ask Copilot", hint: "AI", icon: "sparkles", run: () => setCopilotOpen(true) },
      ...(canSeeSettings(user)
        ? [{ id: "settings", title: "Open Settings", hint: "admin", icon: "settings" as const, run: () => navigate("/settings") }]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewedDate, user?.permissions, user?.role]
  );

  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      const tag = (el as HTMLElement)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.target as HTMLElement)?.closest?.(".palette-card")) return;
      if (e.key !== "Escape" && isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "t":
          setViewedDate(new Date());
          break;
        case "d":
          setViewMode("day");
          break;
        case "w":
          setViewMode("week");
          break;
        case "m":
          setViewMode("month");
          break;
        case "a":
          setViewMode("agenda");
          break;
        case "y":
          setViewMode("year");
          break;
        case "arrowleft":
        case ",":
          shift(-1);
          break;
        case "arrowright":
        case ".":
          shift(1);
          break;
        case "n": {
          const s = new Date(viewedDate);
          s.setHours(9, 0, 0, 0);
          setCreateDraft({ start: s, end: new Date(s.getTime() + 30 * 60000), allDay: false });
          break;
        }
        case "escape":
          setMenu(null);
          setMoveTarget(null);
          setPaletteOpen(false);
          setSelectedEvent(null);
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedDate]);

  const stats = useMemo(() => dayStats(visibleEvents, new Date(), now), [visibleEvents, now]);
  const [nagDismissed, setNagDismissed] = useState(() => {
    try {
      return localStorage.getItem("chronarch_onboarded") === "1";
    } catch {
      return true;
    }
  });
  const showSetupNag = !nagDismissed && user?.role === "admin" && calendars.length === 0;

  function dismissNag() {
    try {
      localStorage.setItem("chronarch_onboarded", "1");
    } catch {
      /* private mode */
    }
    setNagDismissed(true);
  }
  const todayEvents = useMemo(() => {
    const t = new Date();
    return visibleEvents
      .filter((e) => {
        const s = new Date(e.start);
        return !e.all_day && s.getFullYear() === t.getFullYear() && s.getMonth() === t.getMonth() && s.getDate() === t.getDate();
      })
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
  }, [visibleEvents]);
  const countdowns = useMemo(() => pickCountdowns(visibleEvents, now), [visibleEvents, now]);
  const displayName = user?.display_name?.trim() || user?.email?.split("@")[0] || "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-app)", overflow: "hidden" }}>
      {/* Re-Authentication Alert Banner */}
      {calendars.some((c) => (c as any).sync_status === "needs_auth") && (
        <div
          style={{
            background: "rgba(255, 159, 10, 0.15)",
            borderBottom: "1px solid rgba(255, 159, 10, 0.4)",
            padding: "8px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 13,
            color: "var(--warning)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="alert-triangle" size={16} />
            <span>One or more connected calendar accounts require re-authentication. Sync is currently paused for those accounts.</span>
          </div>
          <Link
            to="/settings?section=accounts"
            className="btn-secondary"
            style={{ fontSize: 12, padding: "4px 10px", background: "var(--bg-card)", color: "var(--text-primary)" }}
          >
            Re-connect Account
          </Link>
        </div>
      )}

      {/* Command header */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            {greeting(now.getHours())}, {displayName.split(" ")[0]}
          </div>
          <div className="tabular-nums" style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>
        <button
          onClick={() => setPaletteOpen(true)}
          className="hoverable"
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--bg-raised)",
            border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "8px 14px",
            color: "var(--text-tertiary)", fontSize: 13, cursor: "pointer", minWidth: 0, maxWidth: 520, margin: "0 auto",
          }}
        >
          <Icon name="search" size={14} />
          <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Jump to anything — try "lunch Friday"
          </span>
          <kbd>⌘K</kbd>
        </button>
        <button onClick={() => {
          const s = new Date(viewedDate);
          s.setHours(9, 0, 0, 0);
          setCreateDraft({ start: s, end: new Date(s.getTime() + 30 * 60000), allDay: false });
        }} className="btn-primary hoverable" style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          <span>New Event</span>
        </button>
        <button
          onClick={handleSyncNow}
          disabled={isSyncing}
          className="hoverable"
          title="Sync now"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 10, color: "var(--text-secondary)", padding: "8px 10px", cursor: isSyncing ? "wait" : "pointer", flexShrink: 0, display: "inline-flex" }}
        >
          <Icon name="refresh" size={14} />
        </button>
        <Link
          to="/settings"
          title="Account & settings"
          style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", flexShrink: 0 }}
        >
          {avatarInitials(displayName)}
        </Link>
      </header>

      {/* Date navigation & View mode toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 24px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          background: "var(--bg-app)",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {/* Left: Date navigation controls & Range label */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setViewedDate(new Date())}
            className="btn-secondary hoverable"
            title="Go to Today (T)"
            style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600 }}
          >
            Today
          </button>
          <div style={{ display: "flex", gap: 2 }}>
            <button
              onClick={() => shift(-1)}
              className="btn-secondary hoverable"
              title="Previous period (Left Arrow or ,)"
              style={{ padding: "6px 10px", display: "inline-flex", alignItems: "center" }}
            >
              <Icon name="chevronLeft" size={15} />
            </button>
            <button
              onClick={() => shift(1)}
              className="btn-secondary hoverable"
              title="Next period (Right Arrow or .)"
              style={{ padding: "6px 10px", display: "inline-flex", alignItems: "center" }}
            >
              <Icon name="chevronRight" size={15} />
            </button>
          </div>

          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", marginLeft: 8, color: "var(--text-primary)" }}>
            {formatDateRangeLabel(viewMode, viewedDate)}
          </div>
        </div>

        {/* Right: Segmented view mode selector & meeting statistics */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "inline-flex", background: "var(--wash-deep)", borderRadius: 10, padding: 3, border: "1px solid var(--border-subtle)" }}>
            {(["day", "week", "month", "agenda", "year"] as CalendarViewMode[]).map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className="hoverable"
                  title={`Switch to ${mode} view (${mode.charAt(0).toUpperCase()})`}
                  style={{
                    border: "none",
                    background: active ? "var(--bg-raised)" : "transparent",
                    boxShadow: active ? "var(--shadow-lift)" : "none",
                    padding: "5px 14px",
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    borderRadius: 7,
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all var(--transition-fast)",
                  }}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}

                </button>
              );
            })}
          </div>

          <div className="tabular-nums" style={{ fontSize: 12, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
            {stats.count} meetings · {formatMinutes(stats.meetingMinutes)} booked
          </div>

          {showRails && (
            <button
              onClick={toggleTodayRail}
              className="btn-secondary hoverable"
              title={todayRailOpen ? "Collapse Today sidebar" : "Expand Today sidebar"}
              aria-label={todayRailOpen ? "Collapse Today sidebar" : "Expand Today sidebar"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: 600,
                color: todayRailOpen ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <Icon name="calendar" size={13} />
              <span>{todayRailOpen ? "Hide Today" : "Show Today"}</span>
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
        {/* Focus rail: fixed sections, only the calendar list scrolls. */}
        {showRails && (
          <aside style={{ width: 280, minWidth: 280, borderRight: "1px solid var(--border-subtle)", overflow: "hidden", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
            <div style={{ flexShrink: 0 }}>
              <MiniMonth
                viewedDate={viewedDate}
                selectedDate={viewedDate}
                onSelect={(d) => setViewedDate(d)}
                onMonthShift={(delta) => setViewedDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))}
              />
            </div>
            <section style={{ flexShrink: 0, background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 8 }}>
                Up next
              </div>
              {stats.upNext ? (
                <button
                  onClick={() => {
                    const found = visibleEvents.find((e) => e.id === stats.upNext!.id);
                    if (found) {
                      setSelectedEvent(found);
                      setViewedDate(new Date(found.start));
                    }
                  }}
                  className="hoverable"
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", width: "100%" }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {stats.upNext.title}
                  </div>
                  <div className="tabular-nums" style={{ fontSize: 12, color: "var(--accent)", marginTop: 2 }}>
                    {new Date(stats.upNext.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </div>
                </button>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Clear for the rest of the day.</div>
              )}
            </section>
            <section style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "0 4px 6px", flexShrink: 0 }}>
                Calendars
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {calendarGroups.map(([accountId, group]) => (
                  <div key={accountId} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "2px 8px 3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {group.label}
                    </div>
                    {group.calendars.map((cal) => (
                      <label key={cal.id} className="hoverable" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={!hiddenCalendarIds.has(cal.id)}
                          onChange={() => toggleCalendar(cal.id)}
                          style={{ accentColor: cal.color, width: 14, height: 14 }}
                        />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)", minWidth: 0 }}>
                          {cal.name}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        )}

        {/* Main canvas */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, padding: 16 }}>
          {showSetupNag && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(10, 132, 255, 0.1)", border: "1px solid rgba(10, 132, 255, 0.3)", borderRadius: 10, padding: "9px 14px", marginBottom: 12, fontSize: 13, flexShrink: 0 }}>
              <span style={{ flex: 1, minWidth: 0 }}>Welcome! Connect a calendar to bring this to life — takes about a minute.</span>
              <Link to="/start" className="btn-primary hoverable" style={{ textDecoration: "none", padding: "5px 14px", fontSize: 12, whiteSpace: "nowrap" }}>
                Finish setup
              </Link>
              <button onClick={dismissNag} aria-label="Dismiss setup nag" style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 2, display: "inline-flex" }}>
                <Icon name="x" size={13} />
              </button>
            </div>
          )}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <div style={{ height: 2, background: eventsLoading ? "var(--accent)" : "transparent", transition: "background 0.15s", flexShrink: 0 }} />
            {error && (
              <div style={{ color: "var(--danger)", fontSize: 12, padding: "6px 16px", flexShrink: 0 }}>{error}</div>
            )}
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <Suspense fallback={<div style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 13 }}>Loading view…</div>}>
                {viewMode === "day" && (
                  <DayView
                    day={viewedDate}
                    events={visibleEvents}
                    calendarById={calendarById}
                    onSelectEvent={setSelectedEvent}
                    selectedEventId={selectedEvent?.id}
                    onMoveEvent={handleMoveEvent}
                    onCreateRange={handleCreateRange}
                    onEventMenu={openEventMenu}
                    onEmptyMenu={openEmptyMenu}
                    workingHours={workingHours}
                    secondaryTimezone={user?.secondary_timezone ?? null}
                  />
                )}
                {viewMode === "week" && (
                  <WeekView
                    weekAnchor={viewedDate}
                    events={visibleEvents}
                    calendarById={calendarById}
                    onSelectEvent={setSelectedEvent}
                    onSelectDay={(d) => {
                      setViewedDate(d);
                      setViewMode("day");
                    }}
                    onMoveEvent={handleMoveEvent}
                    onCreateRange={handleCreateRange}
                    onEventMenu={openEventMenu}
                    onEmptyMenu={openEmptyMenu}
                    workingHours={workingHours}
                    secondaryTimezone={user?.secondary_timezone ?? null}
                  />
                )}
                {viewMode === "month" && (
                  <MonthView
                    monthAnchor={viewedDate}
                    events={visibleEvents}
                    calendarById={calendarById}
                    onSelectEvent={setSelectedEvent}
                    onSelectDay={(d) => {
                      setViewedDate(d);
                      setViewMode("day");
                    }}
                    onEventMenu={openEventMenu}
                    onEmptyMenu={openEmptyMenu}
                  />
                )}
                {viewMode === "agenda" && (
                  <AgendaView
                    days={Array.from({ length: 14 }, (_, i) => addDays(startOfDay(viewedDate), i))}
                    events={visibleEvents}
                    calendarById={calendarById}
                    onSelectEvent={setSelectedEvent}
                    onSelectDay={(d) => {
                      setViewedDate(d);
                      setViewMode("day");
                    }}
                  />
                )}
                {viewMode === "year" && (
                  <YearView
                    year={viewedDate.getFullYear()}
                    events={visibleEvents}
                    calendarById={calendarById}
                    selectedDate={viewedDate}
                    onSelectDay={(d) => {
                      setViewedDate(d);
                      setViewMode("day");
                    }}
                    onSelectMonth={(d) => {
                      setViewedDate(d);
                      setViewMode("month");
                    }}
                  />
                )}
              </Suspense>
            </div>
          </div>
        </main>

        {/* Today rail (Collapsible + Solid Pill Styling) */}
        {showRails && todayRailOpen && (
          <aside style={{ width: 300, minWidth: 300, borderLeft: "1px solid var(--border-subtle)", overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 16, background: "var(--bg-app)" }}>
            <section>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                  Today
                </div>
                <button
                  onClick={toggleTodayRail}
                  title="Collapse Today sidebar"
                  aria-label="Collapse Today sidebar"
                  className="hoverable"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-tertiary)",
                    cursor: "pointer",
                    padding: 3,
                    borderRadius: 4,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
              {todayEvents.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Nothing scheduled.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {todayEvents.map((e) => {
                    const cal = calendarById[e.calendar_id];
                    const color = cal?.color ?? "var(--accent)";
                    const textCol = contrastText(color);
                    return (
                      <button
                        key={e.id}
                        onClick={() => setSelectedEvent(e)}
                        className="hoverable"
                        style={{
                          textAlign: "left",
                          background: color,
                          border: "1px solid rgba(255, 255, 255, 0.15)",
                          borderRadius: 8,
                          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
                          padding: "8px 12px",
                          cursor: "pointer",
                          minWidth: 0,
                          transition: "transform 0.12s ease",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: textCol, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {e.title}
                        </div>
                        <div className="tabular-nums" style={{ fontSize: 11.5, fontWeight: 500, color: textCol === "#ffffff" ? "rgba(255, 255, 255, 0.88)" : "rgba(0, 0, 0, 0.7)", marginTop: 2 }}>
                          {new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
            {countdowns.length > 0 && (
              <section>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 8 }}>
                  Coming up
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {countdowns.map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "baseline", gap: 10, background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "8px 12px", minWidth: 0 }}>
                      <span className="tabular-nums" style={{ fontSize: 16, fontWeight: 800, color: "var(--accent)" }}>{c.days}d</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        )}

      {/* Floating copilot chat button, bottom-right. */}
      <button
        onClick={() => setCopilotOpen(true)}
        title="Ask Copilot"
        aria-label="Ask Copilot"
        className="hoverable"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "1px solid var(--border)",
          background: "var(--accent)",
          color: "#fff",
          boxShadow: "var(--shadow-pop)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 900,
        }}
      >
        <Icon name="sparkles" size={22} />
      </button>
      </div>

      <EventDetailPanel
        event={selectedEvent}
        calendar={selectedEvent ? calendarById[selectedEvent.calendar_id] : undefined}
        onClose={() => setSelectedEvent(null)}
        onDelete={handleDelete}
        canDelete={!!(selectedEvent && (calendarById[selectedEvent.calendar_id]?.can_delete ?? calendarById[selectedEvent.calendar_id]?.writable))}
        canEdit={!!(selectedEvent && (calendarById[selectedEvent.calendar_id]?.can_edit ?? calendarById[selectedEvent.calendar_id]?.writable))}
        onSaved={async (updated) => {
          setSelectedEvent(updated);
          await refreshEvents();
        }}
      />

      {menu && !moveTarget && (
        <EventContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu.event)}
          onPick={pickMenuItem}
          onClose={() => setMenu(null)}
        />
      )}

      {createDraft && (
        <QuickCreateModal
          key={`${createDraft.start.toISOString()}-${createDraft.end.toISOString()}-${createDraft.allDay}`}
          calendars={calendars}
          initialStart={createDraft.start}
          initialEnd={createDraft.end}
          initialAllDay={createDraft.allDay}
          initialTitle={createDraft.title}
          initialCalendarId={createDraft.calendarId}
          onClose={() => setCreateDraft(null)}
          onCreate={handleCreate}
        />
      )}

      {pendingConflict && (
        <ConflictConfirmModal
          title={pendingConflict.kind === "create" ? "Overlaps existing events" : "Move overlaps existing events"}
          summary={
            pendingConflict.kind === "create"
              ? `“${pendingConflict.body.title}” overlaps ${pendingConflict.conflicts.length} blocking event${pendingConflict.conflicts.length === 1 ? "" : "s"}.`
              : `This move overlaps ${pendingConflict.conflicts.length} blocking event${pendingConflict.conflicts.length === 1 ? "" : "s"}.`
          }
          conflicts={pendingConflict.conflicts}
          confirmLabel={pendingConflict.kind === "create" ? "Create anyway" : "Move anyway"}
          onConfirm={async () => {
            const pending = pendingConflict;
            setPendingConflict(null);
            if (!pending) return;
            try {
              if (pending.kind === "create") await commitCreate(pending.body);
              else await commitMove(pending.eventId, pending.start, pending.end, pending.allDay);
            } catch (e) {
              setError(friendlyError(e));
            }
          }}
          onBack={() => {
            const pending = pendingConflict;
            setPendingConflict(null);
            if (pending?.kind === "create") {
              setCreateDraft({
                start: new Date(pending.body.start),
                end: new Date(pending.body.end),
                allDay: pending.body.all_day,
                title: pending.body.title,
                calendarId: pending.body.calendar_id,
              });
            }
          }}
          onDiscard={() => setPendingConflict(null)}
        />
      )}

      {showIcsModal && (
        <IcsImportModal
          calendars={calendars}
          initialContent={droppedIcsContent}
          onClose={() => {
            setShowIcsModal(false);
            setDroppedIcsContent(undefined);
          }}
          onImported={() => {
            refreshEvents();
          }}
        />
      )}

      <CopilotDrawer
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        viewedDate={viewedDate}
        viewMode={viewMode}
        onRefreshEvents={() => {
          refreshEvents();
        }}
      />

      <Palette open={paletteOpen} actions={paletteActions} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
