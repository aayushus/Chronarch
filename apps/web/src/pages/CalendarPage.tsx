import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { friendlyError } from "../api/client";

import {
  CalendarSummary,
  ConflictInfo,
  EventSummary,
  QuickAddDraft,
  createEvent,
  deleteEvent,
  getConflicts,
  getEvent,
  listCalendars,
  moveEvent,
  quickAddCreate,
  quickAddParse,
  updateEvent,
} from "../api/calendar";
import { useNavigate } from "react-router-dom";

import { canSeeSettings, useAuth, workingHoursOf } from "../api/auth";
import ConflictConfirmModal from "../components/ConflictConfirmModal";
import EventContextMenu from "../components/EventContextMenu";
import Palette, { PaletteAction } from "../components/Palette";
import CopilotDrawer from "../components/CopilotDrawer";
import EventDetailPanel from "../components/EventDetailPanel";
import IcsImportModal from "../components/IcsImportModal";
import QuickCreateModal, { CreateDraft } from "../components/QuickCreateModal";
import QuickAddModal from "../components/QuickAddModal";
import Sidebar from "../components/Sidebar";
import { useToast } from "../components/Toast";
import TopBar, { CalendarViewMode } from "../components/TopBar";
import { addDays, startOfDay, startOfMonth, startOfWeek } from "../lib/dates";
import { fetchEventsLazy, invalidateEventsCache } from "../lib/eventsCache";

// Each grid view is only needed once its mode is selected — lazy-load them
// so switching to Week/Month doesn't block on code the Day view never uses.
const DayView = lazy(() => import("../components/DayView"));
const WeekView = lazy(() => import("../components/WeekView"));
const MonthView = lazy(() => import("../components/MonthView"));
const YearView = lazy(() => import("../components/YearView"));
const AgendaView = lazy(() => import("../components/AgendaView"));

export default function CalendarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const workingHours = useMemo(() => workingHoursOf(user), [user]);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("day");
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
  const [quickAddText, setQuickAddText] = useState("");
  const [quickAddParsing, setQuickAddParsing] = useState(false);
  const [quickAddDraft, setQuickAddDraft] = useState<QuickAddDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [tzPrompt, setTzPrompt] = useState<{ browserTz: string; homeTz: string } | null>(null);
  const [tzSwitching, setTzSwitching] = useState(false);
  const [menu, setMenu] = useState<
    | { x: number; y: number; event: EventSummary }
    | { x: number; y: number; event: null; createAt: Date }
    | null
  >(null);
  const [moveTarget, setMoveTarget] = useState<EventSummary | null>(null);

  useEffect(() => {
    listCalendars().then(setCalendars).catch((e) => setError(friendlyError(e)));
    import("../api/calendar").then(({ getSyncStatus }) => {
      getSyncStatus()
        .then((s) => setLastSyncedAt(s.last_synced_at))
        .catch(() => {});
    });
  }, []);

  // Browser-vs-home timezone check (BRD §27): if this device is in a
  // different zone than the stored home zone, ask once whether to switch.
  // The answer is remembered per zone pair, so travel re-prompts but
  // dismissing never nags.
  useEffect(() => {
    if (!user) return;
    let browserTz = "UTC";
    try {
      browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      /* ignore */
    }
    const homeTz = user.home_timezone || "UTC";
    if (browserTz === homeTz) return;
    let dismissed = null;
    try {
      dismissed = localStorage.getItem("chronarch_tz_declined");
    } catch {
      /* private mode */
    }
    if (dismissed === `${browserTz}|${homeTz}`) return;
    setTzPrompt({ browserTz, homeTz });
  }, [user]);

  async function handleTimezoneSwitch() {
    if (!tzPrompt) return;
    setTzSwitching(true);
    try {
      const { apiFetch } = await import("../api/client");
      await apiFetch("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ home_timezone: tzPrompt.browserTz }),
      });
      window.location.reload();
    } catch (e) {
      setError(friendlyError(e));
      setTzSwitching(false);
    }
  }

  function handleTimezoneKeep() {
    if (!tzPrompt) return;
    try {
      localStorage.setItem("chronarch_tz_declined", `${tzPrompt.browserTz}|${tzPrompt.homeTz}`);
    } catch {
      /* private mode */
    }
    setTzPrompt(null);
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    try {
      const { triggerCalendarSync } = await import("../api/calendar");
      const res = await triggerCalendarSync();
      setLastSyncedAt(res.last_synced_at);
      invalidateEventsCache();
      const fresh = await fetchEventsLazy(rangeStart, rangeEnd);
      setEvents(fresh);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setIsSyncing(false);
    }
  }

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
    // month fetches a padded month; year fetches the whole year for density dots
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
  const visibleEvents = events.filter((e) => !hiddenCalendarIds.has(e.calendar_id));

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

  // Grid click/drag (BRD §9.6-9.7): open the quick-create modal prefilled
  // with the selected range instead of a blank form.
  function handleCreateRange(start: Date, end: Date, allDay: boolean) {
    setCreateDraft({ start, end, allDay });
  }

  async function commitCreate(body: CreateDraft) {
    await createEvent(body);
    setCreateDraft(null);
    invalidateEventsCache();
    setEvents(await fetchEventsLazy(rangeStart, rangeEnd));
  }

  async function handleCreate(body: CreateDraft) {
    // Conflict warning (BRD §25): check first, ask before committing.
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

  // Natural-language quick-add (BRD §32): parse free text, confirm the
  // draft in a modal, then commit with attendees via /quick-add/create.
  async function handleQuickAddSubmit() {
    const text = quickAddText.trim();
    if (!text || quickAddParsing) return;
    setQuickAddParsing(true);
    setError(null);
    try {
      setQuickAddDraft(await quickAddParse(text));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setQuickAddParsing(false);
    }
  }

  async function handleQuickAddConfirm(calendarId: string, draft: QuickAddDraft) {
    await quickAddCreate(calendarId, draft);
    setQuickAddDraft(null);
    setQuickAddText("");
    invalidateEventsCache();
    setEvents(await fetchEventsLazy(rangeStart, rangeEnd));
  }

  async function handleDelete(eventId: string) {
    const doomed = events.find((e) => e.id === eventId) ?? selectedEvent;
    try {
      await deleteEvent(eventId);
      invalidateEventsCache();
      setSelectedEvent(null);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      if (doomed) {
        // Undo re-creates the event from the stashed snapshot (design
        // philosophy: every destructive action is undoable).
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
              invalidateEventsCache();
              setEvents(await fetchEventsLazy(rangeStart, rangeEnd));
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

  const writableCalendars = useMemo(
    () => calendars.filter((c) => c.can_create ?? c.writable),
    [calendars]
  );

  function openEventMenu(e: React.MouseEvent, event: EventSummary) {
    setMoveTarget(null);
    setMenu({ x: e.clientX, y: e.clientY, event });
  }

  function openEmptyMenu(e: React.MouseEvent, at: Date) {
    setMoveTarget(null);
    setMenu({ x: e.clientX, y: e.clientY, event: null, createAt: at });
  }

  async function refreshEvents() {
    invalidateEventsCache();
    setEvents(await fetchEventsLazy(rangeStart, rangeEnd));
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

  async function handleMoveToCalendar(event: EventSummary, targetCalendarId: string) {
    if (targetCalendarId === event.calendar_id) return;
    try {
      await createEvent({
        calendar_id: targetCalendarId,
        title: event.title,
        start: event.start,
        end: event.end,
        all_day: event.all_day,
        description: event.description,
        location: event.location,
      });
      await deleteEvent(event.id);
      setSelectedEvent(null);
      await refreshEvents();
      toast(`Moved “${event.title}” to the new calendar.`);
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

  function handleCopyLink(event: EventSummary) {
    const url = `${window.location.origin}/?event=${event.id}`;
    try {
      navigator.clipboard.writeText(url);
      toast("Event link copied.");
    } catch {
      setError("Couldn't access the clipboard.");
    }
  }

  function pickMenuItem(id: string) {
    if (!menu) return;
    if (menu.event === null) {
      // Empty-slot menu.
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
      case "move":
        if (canWrite) setMoveTarget(event);
        break;
      case "private":
        if (canWrite) void handleTogglePrivate(event);
        break;
      case "copy":
        handleCopyLink(event);
        break;
      case "delete":
        if (canDelete) void handleDelete(event.id);
        break;
    }
    if (id !== "move") setMenu(null);
  }

  function menuItemsFor(event: EventSummary | null) {
    if (event === null) {
      return [{ id: "new", label: "New event here" }];
    }
    const cal = calendarById[event.calendar_id];
    const canWrite = !!(cal?.can_edit ?? cal?.can_reschedule ?? cal?.writable);
    const canDelete = !!(cal?.can_delete ?? cal?.writable);
    return [
      { id: "details", label: "View details" },
      { id: "duplicate", label: "Duplicate", disabled: !canWrite },
      { id: "move", label: "Move to calendar…", disabled: !canWrite || writableCalendars.length < 2 },
      {
        id: "private",
        label: event.visibility === "private" ? "Make public" : "Mark private",
        disabled: !canWrite,
      },
      { id: "copy", label: "Copy event link" },
      { id: "delete", label: "Delete", danger: true, disabled: !canDelete },
    ];
  }

  async function commitMove(eventId: string, newStart: Date, newEnd: Date, allDay?: boolean) {
    // Optimistic: reflect the drag immediately, roll back if the server
    // rejects it (permission denied) — the drag should feel instant.
    const previous = events;
    const prevSelected = selectedEvent;
    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? {
              ...e,
              start: newStart.toISOString(),
              end: newEnd.toISOString(),
              all_day: allDay ?? e.all_day,
            }
          : e
      )
    );
    if (selectedEvent?.id === eventId) {
      setSelectedEvent((prev) =>
        prev
          ? { ...prev, start: newStart.toISOString(), end: newEnd.toISOString(), all_day: allDay ?? prev.all_day }
          : prev
      );
    }
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
    // Conflict warning (BRD §25): check first (excluding the moved event so
    // a drag doesn't conflict with itself), ask before committing.
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

  async function confirmPending() {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending) return;
    try {
      if (pending.kind === "create") {
        await commitCreate(pending.body);
      } else {
        await commitMove(pending.eventId, pending.start, pending.end, pending.allDay);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function backFromPending() {
    // Return to editing: for creates, reopen the modal with the draft kept.
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
  }

  const [paletteOpen, setPaletteOpen] = useState(false);

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
      {
        id: "contacts",
        title: "Open Contacts",
        hint: "settings",
        icon: "addressBook",
        run: () => navigate("/settings?section=contacts"),
      },
      {
        id: "import-ics",
        title: "Import .ics file",
        hint: "import",
        icon: "upload",
        run: () => {
          setDroppedIcsContent(undefined);
          setShowIcsModal(true);
        },
      },
      ...(canSeeSettings(user)
        ? [{ id: "settings", title: "Open Settings", hint: "admin", icon: "settings" as const, run: () => navigate("/settings") }]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewedDate, user?.permissions, user?.role]
  );

  // Keyboard shortcuts (BRD §9.14): T/D/W/M jump views, arrows navigate,
  // N opens quick-create, Esc closes whatever's open. Ignored while typing
  // in a form field so they don't fight with normal text entry.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      const tag = (el as HTMLElement)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function handleKeyDown(e: KeyboardEvent) {
      // ⌘K toggles the palette from anywhere (design philosophy).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // Let the palette own Escape while it's open.
      if ((e.target as HTMLElement)?.closest?.(".palette-card")) return;
      // Escape must work even while a form field has focus (e.g. the quick-create
      // modal's title input) — every other shortcut stays suppressed while typing.
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
        case "n": {
          e.preventDefault();
          // Blank quick-create at the viewed date, 9:00–9:30 like before.
          const s = new Date(viewedDate);
          s.setHours(9, 0, 0, 0);
          setCreateDraft({ start: s, end: new Date(s.getTime() + 30 * 60000), allDay: false });
          break;
        }
        case "escape":
          setCreateDraft(null);
          setPendingConflict(null);
          setSelectedEvent(null);
          break;
        case "arrowleft":
          shift(-1);
          break;
        case "arrowright":
          shift(1);
          break;
        default:
          return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const selectedCalendar = selectedEvent ? calendarById[selectedEvent.calendar_id] : undefined;

  return (
    <div
      style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file.name.toLowerCase().endsWith(".ics") || file.type.includes("calendar")) {
            const reader = new FileReader();
            reader.onload = (evt) => {
              const text = evt.target?.result as string;
              setDroppedIcsContent(text);
              setShowIcsModal(true);
            };
            reader.readAsText(file);
          }
        }
      }}
    >
      <Sidebar
        calendars={calendars}
        hiddenCalendarIds={hiddenCalendarIds}
        onToggleCalendar={toggleCalendar}
        viewedDate={viewedDate}
        selectedDate={viewedDate}
        onSelectDate={(d) => {
          setViewedDate(d);
          if (viewMode !== "day" && viewMode !== "week") setViewMode("day");
        }}
        onMonthShift={(delta) => setViewedDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))}
        userDisplayName={user?.display_name ?? ""}
        canManageAccounts={(user?.permissions ?? []).includes("accounts.manage") || user?.role === "admin"}
        onOpenCopilot={() => setCopilotOpen(true)}
        onOpenIcsImport={() => {
          setDroppedIcsContent(undefined);
          setShowIcsModal(true);
        }}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <TopBar
          viewedDate={viewedDate}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onToday={() => setViewedDate(new Date())}
          onShift={shift}
          lastSyncedAt={lastSyncedAt}
          isSyncing={isSyncing}
          onSyncNow={handleSyncNow}
          onCreateEvent={() => {
            const s = new Date(viewedDate);
            s.setHours(9, 0, 0, 0);
            setCreateDraft({ start: s, end: new Date(s.getTime() + 30 * 60000), allDay: false });
          }}
        />

        <div style={{ height: 2, background: eventsLoading ? "var(--accent)" : "transparent", transition: "background 0.15s" }} />

        {/* Natural-language quick-add entry (BRD §32) */}
        <div style={{ display: "flex", gap: 8, padding: "8px 24px 0" }}>
          <input
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleQuickAddSubmit();
              }
            }}
            placeholder="Quick add: Lunch with John tomorrow at noon…"
            className="input-standard"
            style={{ flex: 1 }}
          />
          <button
            onClick={() => void handleQuickAddSubmit()}
            disabled={quickAddParsing || !quickAddText.trim()}
            className="btn-secondary hoverable"
            style={{ fontSize: 13, whiteSpace: "nowrap" }}
          >
            {quickAddParsing ? "Parsing…" : "✨ Quick Add"}
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12, padding: "6px 24px" }}>{error}</div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Suspense fallback={<ViewLoadingFallback />}>
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

      <EventDetailPanel
        event={selectedEvent}
        calendar={selectedCalendar}
        onClose={() => setSelectedEvent(null)}
        onDelete={handleDelete}
        canDelete={!!(selectedCalendar?.can_delete ?? selectedCalendar?.writable)}
      />

      {tzPrompt && (
        <div className="modal-backdrop" onClick={handleTimezoneKeep}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 440, maxWidth: "92vw", padding: 24 }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
              Timezone mismatch
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 6px", lineHeight: 1.5 }}>
              This browser is in{" "}
              <strong style={{ color: "var(--text-primary)" }}>{tzPrompt.browserTz}</strong>,
              but your calendar is set to{" "}
              <strong style={{ color: "var(--text-primary)" }}>{tzPrompt.homeTz}</strong>.
            </p>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5 }}>
              Switch to the browser timezone? The page reloads to re-render everything.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={handleTimezoneKeep} className="btn-secondary hoverable" disabled={tzSwitching}>
                Keep {tzPrompt.homeTz}
              </button>
              <button
                onClick={handleTimezoneSwitch}
                disabled={tzSwitching}
                className="btn-primary hoverable"
                style={{ padding: "8px 18px" }}
              >
                {tzSwitching ? "Switching…" : `Switch to ${tzPrompt.browserTz}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {menu && !moveTarget && (
        <EventContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu.event)}
          onPick={pickMenuItem}
          onClose={() => setMenu(null)}
        />
      )}

      {menu && moveTarget && (
        <EventContextMenu
          x={menu.x}
          y={menu.y}
          items={writableCalendars
            .filter((c) => c.id !== moveTarget.calendar_id)
            .map((c) => ({ id: c.id, label: `→ ${c.name}` }))}
          onPick={(id) => {
            setMenu(null);
            setMoveTarget(null);
            void handleMoveToCalendar(moveTarget, id);
          }}
          onClose={() => {
            setMenu(null);
            setMoveTarget(null);
          }}
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

      {quickAddDraft && (
        <QuickAddModal
          key={`${quickAddDraft.start}-${quickAddDraft.end}-${quickAddDraft.title}`}
          calendars={calendars}
          initialDraft={quickAddDraft}
          onClose={() => setQuickAddDraft(null)}
          onConfirm={handleQuickAddConfirm}
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
          onConfirm={confirmPending}
          onBack={backFromPending}
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
            invalidateEventsCache();
            fetchEventsLazy(rangeStart, rangeEnd).then(setEvents);
          }}
        />
      )}

      <CopilotDrawer
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        viewedDate={viewedDate}
        viewMode={viewMode}
        onRefreshEvents={() => {
          invalidateEventsCache();
          fetchEventsLazy(rangeStart, rangeEnd).then(setEvents);
        }}
      />

      <Palette open={paletteOpen} actions={paletteActions} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function ViewLoadingFallback() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-tertiary)", fontSize: 13 }}>
      Loading…
    </div>
  );
}

