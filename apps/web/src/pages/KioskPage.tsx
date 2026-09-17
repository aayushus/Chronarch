import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { apiFetch, friendlyError } from "../api/client";
import { geocodeLocation, getDayWeather, formatDayWeather } from "../api/weather";
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
  calendar_id: string;
  calendar_name: string;
  calendar_color: string;
}

interface QuickDraft {
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string | null;
}

/* Skylight-style light palette for the wall. */
const INK = "#2b2b2e";
const MUTED = "#8a8a93";
const FAINT = "#b9b9c0";
const CARD = "#ffffff";
const PAGE = "#eceae4";

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
  const [headerWeather, setHeaderWeather] = useState<string | null>(null);

  // Quick Add (lives here now — removed from the main calendar page).
  const [qaText, setQaText] = useState("");
  const [qaDateHint, setQaDateHint] = useState<Date | null>(null);
  const [qaParsing, setQaParsing] = useState(false);
  const [qaDraft, setQaDraft] = useState<QuickDraft | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaDone, setQaDone] = useState<string | null>(null);
  const qaInputRef = useRef<HTMLInputElement>(null);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
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
      if (day && live) setHeaderWeather(formatDayWeather(day));
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

  function addForDay(day: Date) {
    setQaDateHint(day);
    setQaDraft(null);
    setQaError(null);
    qaInputRef.current?.focus();
    qaInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function submitQuickAdd() {
    const text = qaText.trim();
    if (!token || !text || qaParsing) return;
    setQaParsing(true);
    setQaError(null);
    setQaDone(null);
    try {
      const dated = qaDateHint
        ? `${text} on ${qaDateHint.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`
        : text;
      const draft = await apiFetch<QuickDraft>(`/kiosk-display/${token}/quick-add/parse`, {
        method: "POST",
        body: JSON.stringify({ text: dated, timezone: browserTz }),
      });
      setQaDraft(draft);
    } catch (e) {
      setQaError(friendlyError(e));
    } finally {
      setQaParsing(false);
    }
  }

  async function confirmQuickAdd() {
    if (!token || !qaDraft) return;
    setQaParsing(true);
    setQaError(null);
    try {
      await apiFetch(`/kiosk-display/${token}/quick-add/create`, {
        method: "POST",
        body: JSON.stringify({ draft: qaDraft, timezone: browserTz }),
      });
      setQaDraft(null);
      setQaText("");
      setQaDateHint(null);
      setQaDone("Added to your calendar.");
      setTimeout(() => setQaDone(null), 3000);
      void load();
    } catch (e) {
      setQaError(friendlyError(e));
    } finally {
      setQaParsing(false);
    }
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
        style={{ minHeight: "100vh", background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <div style={{ fontSize: 64, fontWeight: 200, color: "#3a3a3c", letterSpacing: "-0.02em" }}>
          {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </div>
        <div style={{ fontSize: 12, color: "#2c2c2e", marginTop: 12 }}>tap to wake</div>
      </div>
    );
  }

  const countdowns = pickCountdowns(visibleEvents, now);
  const rangeLabel = `${weekDays[0].toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;

  return (
    <div style={{ minHeight: "100vh", background: PAGE, color: INK, padding: "28px 32px 120px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", background: CARD, borderRadius: 20, padding: "20px 28px 28px", boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}>
        {/* Header: date/time/weather left, controls right. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ fontSize: 19, fontWeight: 700 }}>
            {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            <span style={{ fontWeight: 400, color: MUTED, marginLeft: 10 }}>
              {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
            {headerWeather && (
              <span style={{ fontWeight: 400, color: MUTED, marginLeft: 10 }}>{headerWeather}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <button onClick={() => setFilterOpen((v) => !v)} style={{ border: "1px solid #e3e1da", background: "#fff", borderRadius: 16, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: INK, cursor: "pointer" }}>
              ⊘ Filter{hiddenIds.size > 0 ? ` (${calendars.length - hiddenIds.size}/${calendars.length})` : ""}
            </button>
            <button onClick={() => setWeekOffset((v) => v - 1)} aria-label="Previous week" style={{ border: "none", background: "transparent", fontSize: 18, color: MUTED, cursor: "pointer", padding: "4px 8px" }}>‹</button>
            <button onClick={() => setWeekOffset(0)} style={{ border: "none", background: "transparent", fontSize: 13, fontWeight: 700, color: INK, cursor: "pointer", padding: "4px 8px" }}>Today</button>
            <button onClick={() => setWeekOffset((v) => v + 1)} aria-label="Next week" style={{ border: "none", background: "transparent", fontSize: 18, color: MUTED, cursor: "pointer", padding: "4px 8px" }}>›</button>
            {filterOpen && (
              <div style={{ position: "absolute", top: 36, right: 70, background: "#fff", border: "1px solid #e3e1da", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 8, zIndex: 10, minWidth: 200 }}>
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

        {/* Per-calendar strips. */}
        {calendars.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {calendars.map((c) => {
              const todayCount = (byDay.get(localKey(new Date())) ?? []).filter((e) => e.calendar_id === c.id).length;
              const dimmed = hiddenIds.has(c.id);
              return (
                <button key={c.id} onClick={() => toggleHidden(c.id)} title={dimmed ? `Show ${c.name}` : `Hide ${c.name}`} style={{ border: "none", borderRadius: 14, padding: "5px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: dimmed ? "#eee" : tint(c.color, 0.22), color: dimmed ? FAINT : INK, opacity: dimmed ? 0.6 : 1 }}>
                  {c.name} · {todayCount}
                </button>
              );
            })}
          </div>
        )}

        {/* Countdowns. */}
        {countdowns.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            {countdowns.map((c) => (
              <div key={c.id} style={{ flex: 1, background: tint("#0a84ff", 0.1), border: "1px solid rgba(10, 132, 255, 0.25)", borderRadius: 10, padding: "10px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{c.days}d</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
              </div>
            ))}
          </div>
        )}

        {/* Week grid. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
          {weekDays.map((day) => {
            const items = byDay.get(localKey(day)) ?? [];
            const isToday = localKey(day) === localKey(now);
            return (
              <div key={localKey(day)} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 1 }}>
                  {day.toLocaleDateString(undefined, { weekday: "short" })}{" "}
                  <span style={{ fontWeight: 400 }}>{day.getDate()}</span>
                  {isToday && (
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", background: "#ff453a", color: "#fff", fontSize: 11, fontWeight: 700, marginLeft: 6 }}>
                      {day.getDate()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8 }}>
                  {items.length === 0 ? "No events" : `${items.length} event${items.length === 1 ? "" : "s"}`}
                  <button onClick={() => addForDay(day)} style={{ border: "none", background: "none", color: FAINT, fontSize: 11.5, cursor: "pointer", marginLeft: 8, padding: 0 }}>
                    + Add event
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map((e) => (
                    <div key={e.id} style={{ background: tint(e.calendar_color, 0.28), borderRadius: 10, padding: "9px 12px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{e.title}</div>
                      <div style={{ fontSize: 11.5, color: "#6b6b73", marginTop: 3, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {fmtRange(e)}
                          {!e.masked && e.location ? ` · ${e.location}` : ""}
                          {!e.masked && e.location ? <EventWeather location={e.location} start={e.start} color="#6b6b73" /> : null}
                        </span>
                        <span title={e.calendar_name} style={{ width: 18, height: 18, borderRadius: "50%", background: e.calendar_color, color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {(e.calendar_name || "?")[0]?.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: FAINT, marginTop: 14 }}>{rangeLabel}</div>
      </div>

      {/* Quick Add lives here now. */}
      <div style={{ maxWidth: 1200, margin: "16px auto 0", background: CARD, borderRadius: 20, padding: "16px 28px", boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={qaInputRef}
            value={qaText}
            onChange={(e) => setQaText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitQuickAdd();
              }
            }}
            placeholder={qaDateHint ? `Add for ${dayLabel(qaDateHint, now)}… e.g. Dentist at 3pm` : "Quick add: Lunch with John tomorrow at noon…"}
            aria-label="Quick add event"
            style={{ flex: 1, border: "1px solid #e3e1da", borderRadius: 12, padding: "10px 16px", fontSize: 14, color: INK, background: "#faf9f6", outline: "none" }}
          />
          <button
            onClick={() => void submitQuickAdd()}
            disabled={qaParsing || !qaText.trim()}
            style={{ border: "none", borderRadius: 12, padding: "10px 22px", fontSize: 14, fontWeight: 700, background: "#2b2b2e", color: "#fff", cursor: qaParsing || !qaText.trim() ? "default" : "pointer", opacity: qaParsing || !qaText.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}
          >
            {qaParsing ? "Parsing…" : "✨ Add"}
          </button>
        </div>
        {qaDateHint && !qaDraft && (
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
            Adding to {dayLabel(qaDateHint, now)} ·{" "}
            <button onClick={() => setQaDateHint(null)} style={{ border: "none", background: "none", color: MUTED, cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 12 }}>
              clear
            </button>
          </div>
        )}
        {qaError && <div style={{ fontSize: 13, color: "#c62828", marginTop: 10 }}>{qaError}</div>}
        {qaDone && <div style={{ fontSize: 13, color: "#2e7d32", marginTop: 10 }}>{qaDone}</div>}
        {qaDraft && (
          <div style={{ marginTop: 12, background: tint("#0a84ff", 0.1), border: "1px solid rgba(10, 132, 255, 0.3)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{qaDraft.title}</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                {new Date(qaDraft.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {qaDraft.location ? ` · ${qaDraft.location}` : ""} · default calendar
              </div>
            </div>
            <button onClick={() => setQaDraft(null)} style={{ border: "1px solid #e3e1da", background: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: INK }}>
              Cancel
            </button>
            <button onClick={() => void confirmQuickAdd()} disabled={qaParsing} style={{ border: "none", borderRadius: 10, padding: "8px 20px", fontSize: 13, fontWeight: 700, background: "#2b2b2e", color: "#fff", cursor: "pointer", opacity: qaParsing ? 0.5 : 1 }}>
              {qaParsing ? "Adding…" : "Confirm"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
