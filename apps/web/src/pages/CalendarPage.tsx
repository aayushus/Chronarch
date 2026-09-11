import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { CalendarSummary, EventSummary, createEvent, deleteEvent, listCalendars } from "../api/calendar";
import { useAuth } from "../api/auth";
import EventDetailPanel from "../components/EventDetailPanel";
import QuickCreateModal from "../components/QuickCreateModal";
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
  const { logout } = useAuth();
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("day");
  const [viewedDate, setViewedDate] = useState(new Date());
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [showCreate, setShowCreate] = useState(false);
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

  async function handleCreate(body: { calendar_id: string; title: string; start: string; end: string }) {
    try {
      await createEvent(body);
      setShowCreate(false);
      invalidateEventsCache();
      setEvents(await fetchEventsLazy(rangeStart, rangeEnd));
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

  const selectedCalendar = selectedEvent ? calendarById[selectedEvent.calendar_id] : undefined;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}>
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
        userDisplayName=""
        onLogout={logout}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          viewedDate={viewedDate}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onToday={() => setViewedDate(new Date())}
          onShift={shift}
          onCreateEvent={() => setShowCreate(true)}
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
        canDelete={!!selectedCalendar?.writable}
      />

      {showCreate && (
        <QuickCreateModal
          calendars={calendars}
          defaultDate={viewedDate}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
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
