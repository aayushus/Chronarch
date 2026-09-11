import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";

import {
  CalendarSummary,
  ConflictInfo,
  EventSummary,
  createEvent,
  deleteEvent,
  getConflicts,
  listCalendars,
  moveEvent,
} from "../api/calendar";
import { useAuth } from "../api/auth";
import ConflictConfirmModal from "../components/ConflictConfirmModal";
import CopilotDrawer from "../components/CopilotDrawer";
import EventDetailPanel from "../components/EventDetailPanel";
import IcsImportModal from "../components/IcsImportModal";
import QuickCreateModal, { CreateDraft } from "../components/QuickCreateModal";
import Sidebar from "../components/Sidebar";
import TopBar, { CalendarViewMode } from "../components/TopBar";
import { addDays, startOfDay, startOfMonth, startOfWeek } from "../lib/dates";
import { fetchEventsLazy, invalidateEventsCache } from "../lib/eventsCache";

// Each grid view is only needed once its mode is selected — lazy-load them
// so switching to Week/Month doesn't block on code the Day view never uses.
const DayView = lazy(() => import("../components/DayView"));
const WeekView = lazy(() => import("../components/WeekView"));
const MonthView = lazy(() => import("../components/MonthView"));

export default function CalendarPage() {
  const { logout, user } = useAuth();
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
  const [error, setError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);


  useEffect(() => {
    listCalendars().then(setCalendars).catch((e) => setError(String(e)));
  }, []);

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (viewMode === "day") return [startOfDay(viewedDate), addDays(startOfDay(viewedDate), 1)];
    if (viewMode === "week") {
      const s = startOfWeek(viewedDate);
      return [s, addDays(s, 7)];
    }
    // month + year both fetch a month-sized window for MVP
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
        if (!cancelled) setError(String(e));
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
      setError(String(e));
    }
  }

  async function handleDelete(eventId: string) {
    try {
      await deleteEvent(eventId);
      invalidateEventsCache();
      setSelectedEvent(null);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (e) {
      setError(String(e));
    }
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
      setError(String(e));
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
      setError(String(e));
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
      setError(String(e));
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

  // Keyboard shortcuts (BRD §9.14): T/D/W/M jump views, arrows navigate,
  // N opens quick-create, Esc closes whatever's open. Ignored while typing
  // in a form field so they don't fight with normal text entry.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      const tag = (el as HTMLElement)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function handleKeyDown(e: KeyboardEvent) {
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
          const file = e.dataTransfer.files[0];
          if (file.name.endsWith(".ics") || file.type.includes("calendar")) {
            e.preventDefault();
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
        onLogout={logout}
        isAdmin={!!user?.is_admin}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          viewedDate={viewedDate}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onToday={() => setViewedDate(new Date())}
          onShift={shift}
          onCreateEvent={() => {
            const s = new Date(viewedDate);
            s.setHours(9, 0, 0, 0);
            setCreateDraft({ start: s, end: new Date(s.getTime() + 30 * 60000), allDay: false });
          }}
          onImportIcs={() => {
            setDroppedIcsContent(undefined);
            setShowIcsModal(true);
          }}
          onToggleCopilot={() => setCopilotOpen((prev) => !prev)}
        />

        <div style={{ height: 2, background: eventsLoading ? "var(--accent)" : "transparent", transition: "background 0.15s" }} />

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12, padding: "6px 24px" }}>{error}</div>
        )}

        <div style={{ flex: 1, minHeight: 0 }}>
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
              />
            )}
            {(viewMode === "month" || viewMode === "year") && (
              <MonthView
                monthAnchor={viewedDate}
                events={visibleEvents}
                calendarById={calendarById}
                onSelectEvent={setSelectedEvent}
                onSelectDay={(d) => {
                  setViewedDate(d);
                  setViewMode("day");
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
        onRefreshEvents={() => {
          invalidateEventsCache();
          fetchEventsLazy(rangeStart, rangeEnd).then(setEvents);
        }}
      />

      {!copilotOpen && (
        <button
          onClick={() => setCopilotOpen(true)}
          title="Ask Chronarch AI (BRD §20)"
          className="hoverable"
          style={{
            position: "fixed",
            bottom: 24,
            right: selectedEvent ? 324 : 24,
            zIndex: 40,
            background: "linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%)",
            color: "#fff",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: 24,
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(10, 132, 255, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3)",
            transition: "all 0.15s ease",
          }}
        >
          <span style={{ fontSize: 16 }}>✨</span>
          <span>Ask AI</span>
        </button>
      )}
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

