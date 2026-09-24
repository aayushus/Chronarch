import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { apiFetch } from "../api/client";
import { friendlyError } from "../api/client";

interface LinkMeta {
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  host_name: string;
  approval_required: boolean;
}

interface Slot {
  start: string;
  end: string;
}

async function getMeta(slug: string): Promise<LinkMeta> {
  return apiFetch<LinkMeta>(`/book/${slug}`);
}

async function getSlots(slug: string, from: Date, to: Date): Promise<Slot[]> {
  const params = new URLSearchParams({ date_from: from.toISOString(), date_to: to.toISOString() });
  const res = await apiFetch<{ slots: Slot[] }>(`/book/${slug}/slots?${params.toString()}`);
  return res.slots;
}

/** YYYY-MM-DD of an instant in a given IANA timezone. */
function tzDayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** YYYY-MM-DD of a calendar cell in a given timezone, matching how
 * MobileWeekView keys its own day cells (tzDayKey on the real instant) —
 * anchoring at local noon first and reformatting in `tz` rolled the date
 * whenever the viewer's local zone and the selected booking timezone
 * differed by more than 12h. */
function cellKey(d: Date, tz: string): string {
  return tzDayKey(d.toISOString(), tz);
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 42 Monday-first cells covering the cursor month. */
function monthCells(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(start.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function useIsMobile(breakpoint = 880): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(`(max-width: ${breakpoint}px)`).matches);
  useEffect(() => {
    const q = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setMobile(q.matches);
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, [breakpoint]);
  return mobile;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export default function BookPage() {
  const { slug } = useParams<{ slug: string }>();
  const [meta, setMeta] = useState<LinkMeta | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthCursor, setMonthCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [held, setHeld] = useState<{ token: string; start: string } | null>(null);
  const [holding, setHolding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [hour12, setHour12] = useState(true);
  const [done, setDone] = useState<{ status: string; start: string; booker_token: string } | null>(null);
  const isMobile = useIsMobile();

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const [tz, setTz] = useState(browserTz);

  const tzOptions = useMemo(() => {
    const base = [browserTz, "America/Edmonton", "America/Toronto", "America/Vancouver", "America/Chicago", "Europe/London", "Asia/Kolkata", "UTC"];
    return [...new Set(base)];
  }, [browserTz]);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    getMeta(slug)
      .then(setMeta)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [slug]);

  // Mobile week-list window.
  useEffect(() => {
    if (!slug || !isMobile) return;
    const from = new Date();
    from.setDate(from.getDate() + weekOffset * 7);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    getSlots(slug, from, to)
      .then((s) => {
        setSlots(s);
        setPickedDay(null);
      })
      .catch((e) => setError(friendlyError(e)));
  }, [slug, weekOffset, isMobile]);

  // Desktop month-grid window.
  const cells = useMemo(() => monthCells(monthCursor), [monthCursor]);
  useEffect(() => {
    if (!slug || isMobile) return;
    const from = new Date(cells[0].getFullYear(), cells[0].getMonth(), cells[0].getDate(), 0, 0, 0, 0);
    const to = new Date(cells[41].getFullYear(), cells[41].getMonth(), cells[41].getDate(), 23, 59, 59, 999);
    getSlots(slug, from, to)
      .then((s) => {
        setSlots(s);
        setPickedDay(null);
      })
      .catch((e) => setError(friendlyError(e)));
  }, [slug, isMobile, cells]);

  const byDay = useMemo(() => {
    const now = new Date();
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      if (new Date(s.start) <= now) continue;
      const key = tzDayKey(s.start, tz);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => +new Date(a.start) - +new Date(b.start));
    return map;
  }, [slots, tz]);

  // Auto-pick today if open, else the first open day.
  useEffect(() => {
    if (held || done) return;
    const today = tzDayKey(new Date().toISOString(), tz);
    if (pickedDay && (byDay.get(pickedDay)?.length ?? 0) > 0) return;
    if ((byDay.get(today)?.length ?? 0) > 0) {
      setPickedDay(today);
      return;
    }
    const first = [...byDay.keys()].sort()[0] ?? null;
    setPickedDay(first);
  }, [byDay, tz, held, done, pickedDay]);

  const pickedSlots = (pickedDay && byDay.get(pickedDay)) || [];

  async function pickSlot(slot: Slot) {
    if (!slug || holding) return;
    setHolding(true);
    setError(null);
    try {
      const res = await apiFetch<{ hold_token: string; slot_start: string }>(`/book/${slug}/hold`, {
        method: "POST",
        body: JSON.stringify({ slot_start: slot.start }),
      });
      setHeld({ token: res.hold_token, start: res.slot_start });
    } catch (e) {
      setError(friendlyError(e));
      refreshCurrentWindow();
    } finally {
      setHolding(false);
    }
  }

  function refreshCurrentWindow() {
    if (!slug) return;
    if (isMobile) {
      const from = new Date();
      from.setDate(from.getDate() + weekOffset * 7);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      getSlots(slug, from, to).then(setSlots).catch(() => {});
    } else {
      const from = new Date(cells[0].getFullYear(), cells[0].getMonth(), cells[0].getDate(), 0, 0, 0, 0);
      const to = new Date(cells[41].getFullYear(), cells[41].getMonth(), cells[41].getDate(), 23, 59, 59, 999);
      getSlots(slug, from, to).then(setSlots).catch(() => {});
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || !held || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await apiFetch<{ status: string; start: string; booker_token: string }>(`/book/${slug}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          hold_token: held.token,
          slot_start: held.start,
          name: name.trim(),
          email: email.trim(),
          note: note.trim() || null,
          booked_timezone: tz,
        }),
      });
      setDone(res);
    } catch (err) {
      setError(friendlyError(err));
      setHeld(null);
    } finally {
      setConfirming(false);
    }
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12, timeZone: tz });
  }

  function fmtDayLong(key: string): string {
    const list = byDay.get(key);
    const d = list?.[0] ? new Date(list[0].start) : new Date();
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: tz });
  }

  const weekDays = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const canGoPrevMonth = monthCursor > new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", justifyContent: "center", padding: isMobile ? "32px 16px" : "48px 20px" }}>
      <div style={{ width: isMobile ? 640 : 1020, maxWidth: "100%" }}>
        {loading ? (
          <div style={{ color: "var(--text-tertiary)", fontSize: 14, textAlign: "center", paddingTop: 60 }}>Loading…</div>
        ) : error && !meta ? (
          <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Link not found</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{error}</div>
          </div>
        ) : meta && (
          <>
            {isMobile ? (
              <MobileWeekView
                meta={meta}
                tz={tz}
                days={weekDays}
                byDay={byDay}
                pickedDay={pickedDay}
                setPickedDay={setPickedDay}
                weekOffset={weekOffset}
                setWeekOffset={setWeekOffset}
                holding={holding}
                pickSlot={pickSlot}
                fmtTime={fmtTime}
                error={error}
                held={held}
                setHeld={setHeld}
                name={name}
                setName={setName}
                email={email}
                setEmail={setEmail}
                note={note}
                setNote={setNote}
                confirming={confirming}
                confirm={confirm}
                done={done}
              />
            ) : (
              <DesktopMonthView
                meta={meta}
                tz={tz}
                setTz={setTz}
                tzOptions={tzOptions}
                cells={cells}
                monthCursor={monthCursor}
                setMonthCursor={setMonthCursor}
                canGoPrevMonth={canGoPrevMonth}
                byDay={byDay}
                pickedDay={pickedDay}
                setPickedDay={setPickedDay}
                pickedSlots={pickedSlots}
                hour12={hour12}
                setHour12={setHour12}
                holding={holding}
                pickSlot={pickSlot}
                fmtTime={fmtTime}
                fmtDayLong={fmtDayLong}
                error={error}
                held={held}
                setHeld={setHeld}
                name={name}
                setName={setName}
                email={email}
                setEmail={setEmail}
                note={note}
                setNote={setNote}
                confirming={confirming}
                confirm={confirm}
                done={done}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Mobile: week list (screenshot 1) ---------------- */

function MobileWeekView(props: {
  meta: LinkMeta; tz: string; days: Date[]; byDay: Map<string, Slot[]>;
  pickedDay: string | null; setPickedDay: (k: string | null) => void;
  weekOffset: number; setWeekOffset: (f: (v: number) => number) => void;
  holding: boolean; pickSlot: (s: Slot) => void; fmtTime: (iso: string) => string;
  error: string | null; held: { token: string; start: string } | null; setHeld: (h: null) => void;
  name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void;
  note: string; setNote: (v: string) => void; confirming: boolean; confirm: (e: React.FormEvent) => void;
  done: { status: string; start: string; booker_token: string } | null;
}) {
  const { meta, tz, days, byDay, pickedDay, setPickedDay, weekOffset, setWeekOffset } = props;
  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 4 }}>Book time with {meta.host_name}</div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em", color: "#f5f5f7" }}>{meta.title}</h1>
        {meta.description && <p style={{ fontSize: 15, color: "var(--text-secondary)", margin: "0 0 6px", lineHeight: 1.5 }}>{meta.description}</p>}
        <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          {meta.duration_minutes} minutes · {tz}
        </div>
      </div>

      {props.done ? (
        <DoneCard meta={meta} done={props.done} />
      ) : props.held ? (
        <BookForm {...props} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <button onClick={() => setWeekOffset((v) => Math.max(0, v - 1))} disabled={weekOffset === 0} className="hoverable" style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: "var(--control-radius)", color: weekOffset === 0 ? "var(--text-tertiary)" : "var(--text-primary)", padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: weekOffset === 0 ? "default" : "pointer" }}>← Prev</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f5f5f7" }}>
              {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {days[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
            <button onClick={() => setWeekOffset((v) => v + 1)} className="hoverable" style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: "var(--control-radius)", color: "var(--text-primary)", padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Next →</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {days.map((d) => {
              const key = tzDayKey(d.toISOString(), tz);
              const daySlots = byDay.get(key) ?? [];
              const isPicked = pickedDay === key;
              return (
                <div key={localKey(d)} style={{ background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", borderRadius: "var(--card-radius)", overflow: "hidden" }}>
                  <button onClick={() => setPickedDay(isPicked ? null : key)} className="hoverable" style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "15px 18px", cursor: "pointer", color: "#f5f5f7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>
                      {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: tz })}
                    </span>
                    <span style={{ fontSize: 13, color: "#636366" }}>
                      {daySlots.length === 0 ? "Nothing open" : `${daySlots.length} open`}
                    </span>
                  </button>
                  {isPicked && daySlots.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 18px 16px" }}>
                      {daySlots.map((s) => (
                        <button
                          key={s.start}
                          onClick={() => void props.pickSlot(s)}
                          disabled={props.holding}
                          className="hoverable"
                          style={{ border: "1px solid var(--accent)", background: "rgba(10, 132, 255, 0.1)", color: "#f5f5f7", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
                        >
                          {props.fmtTime(s.start)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {props.error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 12 }}>{props.error}</div>}
        </>
      )}
    </>
  );
}

/* ---------------- Desktop: 3-column month grid (screenshot 2) ---------------- */

function DesktopMonthView(props: {
  meta: LinkMeta; tz: string; setTz: (v: string) => void; tzOptions: string[];
  cells: Date[]; monthCursor: Date; setMonthCursor: (d: Date) => void; canGoPrevMonth: boolean;
  byDay: Map<string, Slot[]>; pickedDay: string | null; setPickedDay: (k: string | null) => void;
  pickedSlots: Slot[]; hour12: boolean; setHour12: (v: boolean) => void;
  holding: boolean; pickSlot: (s: Slot) => void; fmtTime: (iso: string) => string; fmtDayLong: (key: string) => string;
  error: string | null; held: { token: string; start: string } | null; setHeld: (h: null) => void;
  name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void;
  note: string; setNote: (v: string) => void; confirming: boolean; confirm: (e: React.FormEvent) => void;
  done: { status: string; start: string; booker_token: string } | null;
}) {
  const { meta, tz, setTz, tzOptions, cells, monthCursor, setMonthCursor, canGoPrevMonth, byDay, pickedDay, setPickedDay, pickedSlots } = props;
  const todayKey = tzDayKey(new Date().toISOString(), tz);
  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long" });
  const yearLabel = monthCursor.getFullYear();

  function shiftMonth(delta: number) {
    setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1));
  }

  // Derived from the pickedDay key itself, not from byDay's slot list — a
  // day with zero remaining slots (e.g. the last one was just taken by
  // another booker) must still show its own date, not silently fall back
  // to "today".
  const pickedLabel = pickedDay
    ? (() => {
        const [y, m, d] = pickedDay.split("-").map(Number);
        return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }).replace(",", "");
      })()
    : "";

  return (
    <div style={{ background: "#17171a", border: "1px solid #2c2c2e", borderRadius: 12, overflow: "hidden", display: "flex", alignItems: "stretch" }}>
      {/* Left: event info */}
      <div style={{ flex: "0 0 240px", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#3a3a3c", color: "#f5f5f7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
          {initials(meta.host_name)}
        </div>
        <div style={{ fontSize: 13, color: "#98989d" }}>{meta.host_name}</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#f5f5f7", lineHeight: 1.2 }}>{meta.title}</div>
        {meta.description && <div style={{ fontSize: 13, color: "#98989d", lineHeight: 1.5 }}>{meta.description}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#f5f5f7" }}>
          <span style={{ color: "#98989d" }}>◷</span> {meta.duration_minutes >= 60 ? `${meta.duration_minutes / 60}h` : `${meta.duration_minutes} mins`}
        </div>
        {meta.approval_required && (
          <div style={{ fontSize: 12, color: "#ff9f0a" }}>Needs host approval</div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#f5f5f7", marginTop: 4 }}>
          <span style={{ color: "#98989d" }}>🌐</span>
          <select value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Timezone" style={{ background: "transparent", border: "none", color: "#f5f5f7", fontSize: 13, cursor: "pointer", maxWidth: 170 }}>
            {tzOptions.map((z) => (
              <option key={z} value={z} style={{ color: "#000" }}>{z}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Middle: month calendar */}
      <div style={{ flex: "1.5", borderLeft: "1px solid #2c2c2e", padding: "24px 24px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#f5f5f7" }}>
            {monthLabel} <span style={{ fontWeight: 400, color: "#98989d" }}>{yearLabel}</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => canGoPrevMonth && shiftMonth(-1)} disabled={!canGoPrevMonth} aria-label="Previous month" className="hoverable" style={{ background: "none", border: "none", color: canGoPrevMonth ? "#98989d" : "#3a3a3c", fontSize: 18, cursor: canGoPrevMonth ? "pointer" : "default", padding: "4px 10px" }}>‹</button>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="hoverable" style={{ background: "none", border: "none", color: "#98989d", fontSize: 18, cursor: "pointer", padding: "4px 10px" }}>›</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 8 }}>
          {WEEKDAYS.map((w) => (
            <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "#f5f5f7", padding: "4px 0" }}>{w}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {cells.map((d) => {
            const key = cellKey(d, tz);
            const count = byDay.get(key)?.length ?? 0;
            const inMonth = d.getMonth() === monthCursor.getMonth();
            const isToday = key === todayKey;
            const isPicked = pickedDay === key;
            const isPast = d < new Date(new Date().setHours(0, 0, 0, 0));
            const clickable = count > 0 && !isPast;
            return (
              <button
                key={`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`}
                onClick={() => clickable && setPickedDay(isPicked ? null : key)}
                disabled={!clickable}
                className="hoverable"
                style={{
                  aspectRatio: "1",
                  borderRadius: 8,
                  border: "none",
                  background: isPicked ? "#f5f5f7" : count > 0 && inMonth ? "#2c2c2e" : inMonth ? "transparent" : "transparent",
                  opacity: inMonth ? 1 : 0.35,
                  color: isPicked ? "#111113" : "#f5f5f7",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: clickable ? "pointer" : "default",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <span>{d.getDate()}</span>
                {isToday && <span style={{ width: 4, height: 4, borderRadius: "50%", background: isPicked ? "#111113" : "#f5f5f7" }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: time slots */}
      <div style={{ flex: "0 0 250px", borderLeft: "1px solid #2c2c2e", padding: "24px 20px", display: "flex", flexDirection: "column", minHeight: 480, maxHeight: 620 }}>
        {props.done ? (
          <div style={{ textAlign: "center", paddingTop: 40 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(48, 209, 88, 0.14)", color: "var(--success)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f5f5f7", marginBottom: 6 }}>
              {props.done.status === "pending" ? "Request received" : "You're booked"}
            </div>
            <p style={{ fontSize: 13, color: "#98989d", margin: "0 0 4px" }}>
              {new Date(props.done.start).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz })}
            </p>
            <p style={{ fontSize: 13, color: "#98989d", margin: "0 0 16px" }}>
              {props.done.status === "pending" ? `${meta.host_name} confirms shortly.` : "Invite is on its way."}
            </p>
            <a href={`/book/cancel/${props.done.booker_token}`} style={{ fontSize: 13, color: "var(--danger)" }}>Cancel this booking</a>
          </div>
        ) : props.held ? (
          <div style={{ overflowY: "auto" }}>
            <BookForm {...props} compact />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f5f5f7" }}>{pickedLabel || "Pick a day"}</div>
              <div style={{ display: "flex", background: "#1e1e21", borderRadius: 8, padding: 2 }}>
                {(["12h", "24h"] as const).map((opt) => {
                  const active = (opt === "12h") === props.hour12;
                  return (
                    <button
                      key={opt}
                      onClick={() => props.setHour12(opt === "12h")}
                      className="hoverable"
                      style={{ border: "none", borderRadius: 6, background: active ? "#2c2c2e" : "transparent", color: active ? "#f5f5f7" : "#636366", fontSize: 12, fontWeight: 600, padding: "5px 10px", cursor: "pointer" }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", paddingRight: 2 }}>
              {pickedSlots.length === 0 ? (
                <div style={{ fontSize: 13, color: "#636366", textAlign: "center", paddingTop: 40 }}>
                  {pickedDay ? "Nothing open this day." : "Select an open day."}
                </div>
              ) : (
                pickedSlots.map((s) => (
                  <button
                    key={s.start}
                    onClick={() => void props.pickSlot(s)}
                    disabled={props.holding}
                    className="hoverable"
                    style={{ border: "1px solid #3a3a3c", background: "transparent", color: "#f5f5f7", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 500, cursor: "pointer", width: "100%" }}
                  >
                    {props.fmtTime(s.start)}
                  </button>
                ))
              )}
            </div>
            {props.error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 10 }}>{props.error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Shared: booking form + success ---------------- */

function BookForm(props: {
  meta: LinkMeta; held: { token: string; start: string } | null; setHeld: (h: null) => void;
  name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void;
  note: string; setNote: (v: string) => void; confirming: boolean; confirm: (e: React.FormEvent) => void;
  error: string | null; tz: string; compact?: boolean;
}) {
  const { meta, held } = props;
  if (!held) return null;
  return (
    <form onSubmit={props.confirm} style={{ background: props.compact ? "transparent" : "var(--bg-raised)", border: props.compact ? "none" : "1px solid var(--border-subtle)", borderRadius: 12, padding: props.compact ? 0 : 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#f5f5f7" }}>
        {new Date(held.start).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: props.tz })}
      </div>
      <div style={{ fontSize: 12, color: "#636366" }}>Held for you for the next few minutes.</div>
      <div>
        <label htmlFor="book-name" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#f5f5f7" }}>Your name</label>
        <input id="book-name" value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="e.g. Jane Rivera" autoFocus className="input-standard" style={{ width: "100%", fontSize: 13 }} />
      </div>
      <div>
        <label htmlFor="book-email" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#f5f5f7" }}>Email for the invite</label>
        <input id="book-email" type="email" value={props.email} onChange={(e) => props.setEmail(e.target.value)} placeholder="e.g. jane@acme.com" className="input-standard" style={{ width: "100%", fontSize: 13 }} />
      </div>
      <div>
        <label htmlFor="book-note" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#f5f5f7" }}>Note <span style={{ fontWeight: 400, color: "#636366" }}>(optional)</span></label>
        <input id="book-note" value={props.note} onChange={(e) => props.setNote(e.target.value)} placeholder="What should we talk about?" className="input-standard" style={{ width: "100%", fontSize: 13 }} />
      </div>
      {props.error && <div style={{ fontSize: 12, color: "var(--danger)" }}>{props.error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={() => props.setHeld(null)} className="btn-secondary hoverable" style={{ flex: 1 }}>
          Back
        </button>
        <button type="submit" disabled={props.confirming || !props.name.trim() || !props.email.trim()} className="btn-primary hoverable" style={{ flex: 2, opacity: props.confirming || !props.name.trim() || !props.email.trim() ? 0.5 : 1 }}>
          {props.confirming ? "Booking…" : meta.approval_required ? "Request booking" : "Confirm booking"}
        </button>
      </div>
    </form>
  );
}

function DoneCard({ meta, done }: { meta: LinkMeta; done: { status: string; start: string; booker_token: string } }) {
  return (
    <div style={{ background: "#1e1e21", borderRadius: 12, padding: 28, textAlign: "center" }}>
      <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(48, 209, 88, 0.14)", color: "var(--success)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 12 }}>✓</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#f5f5f7" }}>
        {done.status === "pending" ? "Request received" : "You're booked"}
      </div>
      <p style={{ fontSize: 13, color: "#98989d", margin: "0 0 4px" }}>
        {new Date(done.start).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </p>
      <p style={{ fontSize: 13, color: "#98989d", margin: "0 0 16px" }}>
        {done.status === "pending" ? `${meta.host_name} confirms shortly — the invite follows.` : "The calendar invite is on its way to your inbox."}
      </p>
      <a href={`/book/cancel/${done.booker_token}`} style={{ fontSize: 13, color: "var(--danger)" }}>
        Cancel this booking
      </a>
    </div>
  );
}
