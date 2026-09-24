import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { apiFetch, friendlyError } from "../api/client";
import { geocodeLocation, getDayWeather, wmoGlyph, wmoLabel, type DayWeather } from "../api/weather";
import { addDays, dayLabel, isAsleep, pickCountdowns, startOfWeekSunday, tint } from "../lib/kiosk";
import EventWeather from "../components/EventWeather";

interface KioskMeta {
  name: string;
  host_name: string;
  location_label: string;
  sleep_start: string;
  sleep_end: string;
}

interface KioskCalendar {
  id: string;
  name: string;
  color: string;
}

interface KioskEvent {
  id: string;
  title: string;
  masked: boolean;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  calendar_id: string;
  calendar_name: string;
  calendar_color: string;
}

type ViewMode = "week" | "agenda";
const VIEW_MODE_KEY = "chronarch:kiosk:viewMode";
const IDLE_RELOAD_MS = 60 * 60_000;

/* Skylight-style wall palette — tokens live in theme.css (`--wall-*`),
   always light like the hardware, independent of the app theme. */
const INK = "var(--wall-ink)";
const MUTED = "var(--wall-muted)";
const FAINT = "var(--wall-faint)";
const CARD = "var(--wall-card)";
const PAGE = "var(--wall-page)";

const POLL_MS = 60_000;
const WAKE_OVERRIDE_MS = 2 * 60_000;

function localKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtRange(e: KioskEvent): string {
  if (e.all_day) return "All day";
  return `${fmtTime(e.start)} – ${fmtTime(e.end)}`;
}

export default function KioskPage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<KioskMeta | null>(null);
  const [events, setEvents] = useState<KioskEvent[]>([]);
  const [calendars, setCalendars] = useState<KioskCalendar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [wakeUntil, setWakeUntil] = useState(0);
  const [headerWeather, setHeaderWeather] = useState<DayWeather | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === "agenda" ? "agenda" : "week";
    } catch {
      return "week";
    }
  });
  const [selectedEvent, setSelectedEvent] = useState<KioskEvent | null>(null);
  const [screensaver, setScreensaver] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    return hour < 6.75 || hour >= 19;
  });

  function setViewModeAndPersist(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Storage full/blocked — the toggle still works this session.
    }
  }

  // Recover from any long-running drift (stuck network state, memory
  // creep) the way kiosk-browser products do: reload after a stretch of
  // no touch input at all, not just on a timer while in active use.
  const idleReload = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function resetIdle() {
      if (idleReload.current) clearTimeout(idleReload.current);
      idleReload.current = setTimeout(() => window.location.reload(), IDLE_RELOAD_MS);
    }
    resetIdle();
    const events: (keyof WindowEventMap)[] = ["pointerdown", "touchstart", "keydown"];
    events.forEach((ev) => window.addEventListener(ev, resetIdle));
    return () => {
      if (idleReload.current) clearTimeout(idleReload.current);
      events.forEach((ev) => window.removeEventListener(ev, resetIdle));
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setScreensaver(false);
      clearTimeout(timer);
      timer = setTimeout(() => setScreensaver(true), 30_000);
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "touchstart", "keydown"];
    events.forEach((ev) => window.addEventListener(ev, wake));
    wake();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, wake));
    };
  }, []);

  const weekStart = useMemo(
    () => addDays(startOfWeekSunday(new Date()), weekOffset * 7),
    // Re-anchor when the day rolls over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekOffset, now.getDate()],
  );

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const startISO = new Date(
        weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(),
      ).toISOString();
      const params = new URLSearchParams({ days: "7", start: startISO });
      const [m, agenda] = await Promise.all([
        apiFetch<KioskMeta>(`/kiosk-display/${token}`),
        apiFetch<{ events: KioskEvent[]; calendars: KioskCalendar[] }>(
          `/kiosk-display/${token}/agenda?${params.toString()}`,
        ),
      ]);
      setMeta(m);
      setEvents(agenda.events);
      setCalendars(agenda.calendars ?? []);
      setLastLoadedAt(new Date());
      try {
        if (!localStorage.getItem(VIEW_MODE_KEY) && agenda.events.length > 24) setViewMode("agenda");
      } catch {
        if (agenda.events.length > 24) setViewMode("agenda");
      }
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [token, weekStart]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const clock = setInterval(() => setNow(new Date()), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  // Header weather for the display's configured location (fail-silent).
  useEffect(() => {
    let live = true;
    setHeaderWeather(null);
    if (!meta?.location_label) return;
    void (async () => {
      const geo = await geocodeLocation(meta.location_label);
      if (!geo || !live) return;
      const todayISO = new Date().toISOString().slice(0, 10);
      const day = await getDayWeather(geo.latitude, geo.longitude, todayISO);
      if (day && live) setHeaderWeather(day);
    })();
    return () => {
      live = false;
    };
  }, [meta?.location_label]);

  const asleep = useMemo(
    () => (meta ? isAsleep(now, meta.sleep_start, meta.sleep_end) && Date.now() > wakeUntil : false),
    [meta, now, wakeUntil],
  );

  const visibleEvents = useMemo(
    () => (hiddenIds.size === 0 ? events : events.filter((e) => !hiddenIds.has(e.calendar_id))),
    [events, hiddenIds],
  );
  const nextEvent = useMemo(
    () => visibleEvents
      .filter((event) => new Date(event.end).getTime() > now.getTime())
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null,
    [visibleEvents, now],
  );

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const byDay = useMemo(() => {
    const map = new Map<string, KioskEvent[]>();
    for (const e of visibleEvents) {
      const key = localKey(new Date(e.start));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const list of map.values()) list.sort((a, b) => +new Date(a.start) - +new Date(b.start));
    return map;
  }, [visibleEvents]);

  function toggleHidden(id: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error && !meta) {
    return (
      <div style={{ minHeight: "100vh", background: PAGE, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: INK, marginBottom: 8 }}>Display not paired</div>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 4 }}>{error}</div>
          <div style={{ fontSize: 13, color: FAINT }}>Ask your admin to pair this display again from Settings → Kiosk.</div>
        </div>
      </div>
    );
  }

  if (asleep) {
    return (
      <div
        onClick={() => setWakeUntil(Date.now() + WAKE_OVERRIDE_MS)}
        className={`kiosk-sleep kiosk-sleep-${headerWeather ? (headerWeather.code >= 95 ? "storm" : headerWeather.code >= 71 ? "snow" : headerWeather.code >= 51 ? "rain" : "clear") : "clear"}`}
        style={{ minHeight: "100vh", background: "#050608", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative", overflow: "hidden" }}
      >
        <div className="kiosk-sleep-atmosphere" aria-hidden="true" />
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: "clamp(72px, 10vw, 144px)", lineHeight: 1, fontWeight: 200, color: "rgba(245,245,247,.88)", letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums" }}>
            {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 18, color: "rgba(245,245,247,.52)", marginTop: 16 }}>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            {meta?.location_label ? ` · ${meta.location_label}` : ""}
          </div>
          {headerWeather && (
            <div style={{ fontSize: 17, color: "rgba(245,245,247,.62)", marginTop: 12 }}>
              <span style={{ fontSize: 25, marginRight: 8 }}>{wmoGlyph(headerWeather.code)}</span>
              {wmoLabel(headerWeather.code)} · {headerWeather.tempMax === null ? "–" : `${Math.round(headerWeather.tempMax)}°`}
              {headerWeather.precipProb !== null && headerWeather.precipProb >= 30 ? ` · ${Math.round(headerWeather.precipProb)}% rain` : ""}
            </div>
          )}
          {nextEvent && (
            <div style={{ marginTop: 34, fontSize: 16, color: "rgba(245,245,247,.7)" }}>
              <span style={{ color: "rgba(10,132,255,.95)", fontWeight: 700 }}>Next</span>
              {" · "}{nextEvent.masked ? "Busy" : nextEvent.title}
              {` · ${nextEvent.all_day ? "All day" : fmtTime(nextEvent.start)}`}
            </div>
          )}
          <div style={{ fontSize: 12, color: "rgba(245,245,247,.28)", marginTop: 42 }}>Tap anywhere to wake</div>
        </div>
      </div>
    );
  }

  if (screensaver) {
    return (
      <div className="kiosk-screensaver" onClick={() => setScreensaver(false)}>
        <div className="kiosk-screensaver-content">
          <div className="kiosk-name">{meta?.name || "Chronarch Kiosk"}</div>
          <div className="kiosk-screensaver-time">{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</div>
          {headerWeather && <div className="kiosk-screensaver-weather">{wmoGlyph(headerWeather.code)} {Math.round(headerWeather.tempMax ?? 0)}° · {wmoLabel(headerWeather.code)}</div>}
          {nextEvent && <div className="kiosk-screensaver-next">Up next · {nextEvent.masked ? "Busy" : nextEvent.title} · {nextEvent.all_day ? "All day" : fmtTime(nextEvent.start)}</div>}
          <div className="kiosk-screensaver-hint">Tap anywhere to wake</div>
        </div>
      </div>
    );
  }

  const countdowns = pickCountdowns(visibleEvents, now);
  const rangeLabel = `${weekDays[0].toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
  const denseWeek = visibleEvents.length > 24;
  const freshness = lastLoadedAt ? `Updated ${Math.max(0, Math.round((Date.now() - lastLoadedAt.getTime()) / 60000))}m ago` : "Updating…";

  return (
    <div className={`kiosk-live ${darkMode ? "kiosk-live-dark" : ""}`} style={{ height: "100vh", background: PAGE, color: INK, padding: "24px 28px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", maxWidth: 1200, width: "100%", margin: "0 auto", background: CARD, borderRadius: 10, padding: "20px 28px", boxShadow: "0 8px 30px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        {/* Header: date/time/weather left, controls right. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12, flexShrink: 0 }}>
          <div>
            <div className="kiosk-live-name">{meta?.name || "Chronarch Kiosk"}</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>
            {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            <span style={{ fontWeight: 400, color: MUTED, marginLeft: 10 }}>
              {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
            {headerWeather && (
              <span style={{ fontWeight: 400, color: MUTED, marginLeft: 10 }}>{wmoGlyph(headerWeather.code)} {headerWeather.tempMax === null ? "–" : `${Math.round(headerWeather.tempMax)}°`}</span>
            )}
            <span style={{ fontSize: 12, fontWeight: 500, color: FAINT, marginLeft: 10 }}>{freshness}</span>
            </div>
            <div className="kiosk-live-range">{rangeLabel}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <div style={{ display: "flex", border: "1px solid #e3e1da", borderRadius: 6, overflow: "hidden" }}>
              <button
                onClick={() => setViewModeAndPersist("week")}
                aria-pressed={viewMode === "week"}
                style={{ border: "none", background: viewMode === "week" ? INK : "#fff", color: viewMode === "week" ? "#fff" : INK, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Week
              </button>
              <button
                onClick={() => setViewModeAndPersist("agenda")}
                aria-pressed={viewMode === "agenda"}
                style={{ border: "none", background: viewMode === "agenda" ? INK : "#fff", color: viewMode === "agenda" ? "#fff" : INK, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Agenda
              </button>
            </div>
            <button onClick={() => setFilterOpen((v) => !v)} style={{ border: "1px solid #e3e1da", background: "#fff", borderRadius: 6, padding: "10px 16px", fontSize: 13, fontWeight: 600, color: INK, cursor: "pointer" }}>
              ⊘ Filter{hiddenIds.size > 0 ? ` (${calendars.length - hiddenIds.size}/${calendars.length})` : ""}
            </button>
            <button onClick={() => setWeekOffset((v) => v - 1)} aria-label="Previous week" style={{ border: "none", background: "transparent", fontSize: 20, color: MUTED, cursor: "pointer", padding: "10px 14px" }}>‹</button>
            <button onClick={() => setWeekOffset(0)} style={{ border: "none", background: "transparent", fontSize: 14, fontWeight: 700, color: INK, cursor: "pointer", padding: "10px 14px" }}>Today</button>
            <button onClick={() => setWeekOffset((v) => v + 1)} aria-label="Next week" style={{ border: "none", background: "transparent", fontSize: 20, color: MUTED, cursor: "pointer", padding: "10px 14px" }}>›</button>
            <button onClick={() => setScreensaver(true)} style={{ border: "1px solid #e3e1da", background: "#fff", borderRadius: 6, padding: "10px 12px", fontSize: 13, fontWeight: 600, color: INK, cursor: "pointer" }}>Screensaver</button>
            <button onClick={() => setDarkMode((v) => !v)} style={{ border: "1px solid #e3e1da", background: "#fff", borderRadius: 6, padding: "10px 12px", fontSize: 13, fontWeight: 600, color: INK, cursor: "pointer" }}>{darkMode ? "Light mode" : "Dark mode"}</button>
            {filterOpen && (
              <div style={{ position: "absolute", top: 36, right: 70, background: "#fff", border: "1px solid #e3e1da", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 8, zIndex: 10, minWidth: 200 }}>
                {calendars.map((c) => {
                  const hidden = hiddenIds.has(c.id);
                  return (
                    <button key={c.id} onClick={() => toggleHidden(c.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontSize: 13, color: hidden ? FAINT : INK }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: hidden ? "#d8d8dc" : c.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      <span style={{ color: hidden ? FAINT : MUTED }}>{hidden ? "hidden" : "shown"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="kiosk-focus-strip" aria-label="Current and next meeting">
          <div className="kiosk-focus-card"><span>Now · free</span><strong>No meeting in progress</strong><small>Open until {nextEvent ? fmtTime(nextEvent.start) : "later"}</small></div>
          <div className="kiosk-focus-card kiosk-focus-next"><span>Up next</span><strong>{nextEvent ? (nextEvent.masked ? "Busy" : nextEvent.title) : "Nothing scheduled"}</strong><small>{nextEvent ? fmtRange(nextEvent) : "Your calendar is clear"}</small></div>
        </div>

        {/* Countdowns. */}
        {countdowns.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 18, flexShrink: 0 }}>
            {countdowns.map((c) => (
              <div key={c.id} style={{ flex: 1, background: tint("#0a84ff", 0.1), border: "1px solid rgba(10, 132, 255, 0.25)", borderRadius: 10, padding: "10px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{c.days}d</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
              </div>
            ))}
          </div>
        )}

        {denseWeek && viewMode === "week" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#f3f7fc", border: "1px solid #d8e8fa", borderRadius: 10, padding: "9px 12px", marginBottom: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 12.5, color: MUTED }}>Busy week — Agenda view is easier to scan.</span>
            <button onClick={() => setViewModeAndPersist("agenda")} style={{ border: "none", borderRadius: 8, padding: "6px 10px", background: INK, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Switch to Agenda</button>
          </div>
        )}

        {viewMode === "week" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, flex: 1, minHeight: 0 }}>
            {weekDays.map((day) => {
              const items = byDay.get(localKey(day)) ?? [];
              const isToday = localKey(day) === localKey(now);
              return (
                <div key={localKey(day)} style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2, flexShrink: 0 }}>
                    {day.toLocaleDateString(undefined, { weekday: "short" })}{" "}
                    <span style={{ fontWeight: 400 }}>{day.getDate()}</span>
                    {isToday && (
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: "#ff453a", color: "#fff", fontSize: 12, fontWeight: 700, marginLeft: 6 }}>
                        {day.getDate()}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 8, flexShrink: 0 }}>
                    {items.length === 0 ? "No events" : `${items.length} event${items.length === 1 ? "" : "s"}`}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0, overflowY: "auto" }}>
                    {items.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setSelectedEvent(e)}
                        style={{ background: tint(e.calendar_color, 0.28), border: "none", borderRadius: 10, padding: "9px 11px", minWidth: 0, minHeight: 48, maxHeight: 78, overflow: "hidden", textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>{e.title}</div>
                        <div style={{ fontSize: 12.5, color: "#6b6b73", marginTop: 3, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {fmtRange(e)}
                            {!e.masked && e.location ? ` · ${e.location}` : ""}
                            {!e.masked && e.location ? <EventWeather location={e.location} start={e.start} color="#6b6b73" /> : null}
                          </span>
                          <span title={e.calendar_name} style={{ width: 20, height: 20, borderRadius: "50%", background: e.calendar_color, color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {(e.calendar_name || "?")[0]?.toUpperCase()}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1, minHeight: 0, overflowY: "auto" }}>
            {weekDays.map((day) => {
              const items = byDay.get(localKey(day)) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={localKey(day)}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: MUTED, marginBottom: 8 }}>{dayLabel(day, now)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {items.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setSelectedEvent(e)}
                        style={{ display: "flex", alignItems: "center", gap: 14, background: tint(e.calendar_color, 0.28), border: "none", borderRadius: 12, padding: "12px 16px", minHeight: 44, textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}
                      >
                        <span style={{ width: 22, height: 22, borderRadius: "50%", background: e.calendar_color, color: "#fff", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {(e.calendar_name || "?")[0]?.toUpperCase()}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>{e.title}</div>
                          <div style={{ fontSize: 13, color: "#6b6b73", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {fmtRange(e)}
                            {!e.masked && e.location ? ` · ${e.location}` : ""}
                            {!e.masked && e.location ? <EventWeather location={e.location} start={e.start} color="#6b6b73" /> : null}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {weekDays.every((day) => (byDay.get(localKey(day)) ?? []).length === 0) && (
              <div style={{ fontSize: 14, color: MUTED, textAlign: "center", padding: "24px 0" }}>Nothing on the calendar this week.</div>
            )}
          </div>
        )}
        <div style={{ fontSize: 13, color: FAINT, marginTop: 10, flexShrink: 0 }}>{rangeLabel}</div>
      </div>

      {selectedEvent && (
        <div
          onClick={() => setSelectedEvent(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 20 }}
        >
          <div onClick={(ev) => ev.stopPropagation()} style={{ background: CARD, borderRadius: 20, padding: "24px 28px", maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.3 }}>{selectedEvent.title}</div>
              <button onClick={() => setSelectedEvent(null)} aria-label="Close" style={{ border: "none", background: "#f2f1ec", borderRadius: "50%", width: 36, height: 36, fontSize: 16, color: INK, cursor: "pointer", flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ fontSize: 15, color: MUTED, marginTop: 10 }}>
              {selectedEvent.all_day ? "All day" : `${fmtTime(selectedEvent.start)} – ${fmtTime(selectedEvent.end)}`}
              {" · "}
              {new Date(selectedEvent.start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </div>
            {!selectedEvent.masked && selectedEvent.location && (
              <div style={{ fontSize: 14, color: INK, marginTop: 12 }}>📍 {selectedEvent.location}</div>
            )}
            {!selectedEvent.masked && selectedEvent.description && (
              <div style={{ fontSize: 14, color: INK, marginTop: 12, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{selectedEvent.description}</div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: selectedEvent.calendar_color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: MUTED }}>{selectedEvent.calendar_name}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
