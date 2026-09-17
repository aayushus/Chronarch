/** Kiosk sleep-window + day-label rules (Skylight-style sleep mode). */

function parseHM(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((value || "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** True when `now` falls inside the sleep window (handles overnight wrap).
 * Degenerate windows (bad input, start == end) never sleep. */
export function isAsleep(now: Date, sleepStart: string, sleepEnd: string): boolean {
  const start = parseHM(sleepStart);
  const end = parseHM(sleepEnd);
  if (start === null || end === null || start === end) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function dayLabel(d: Date, today: Date): string {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((day.getTime() - base.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** First day (Sunday) of the week containing `d`, at midnight. */
export function startOfWeekSunday(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Pastel tint of a #rgb/#rrggbb color for Skylight-style event cards.
 * Falls back to neutral gray for garbage input. */
export function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  let r = 152, g = 152, b = 157;
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
/** Whole days from `now` until the event's calendar day. */
export function daysUntil(startISO: string, now: Date): number {
  const s = new Date(startISO);
  const day = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((day.getTime() - base.getTime()) / 86400000);
}

export interface CountdownCandidate {
  id: string;
  title: string;
  start: string;
  all_day: boolean;
  masked: boolean;
}

/** Hero countdowns: distant-future (≥2 days out), unmasked events first —
 * all-day events (vacations, launches, birthdays) lead. Max 3. */
export function pickCountdowns(events: CountdownCandidate[], now: Date, max = 3): { id: string; title: string; days: number }[] {
  return events
    .map((e) => ({ e, days: daysUntil(e.start, now) }))
    .filter(({ e, days }) => days >= 2 && !e.masked)
    .sort((a, b) => (Number(b.e.all_day) - Number(a.e.all_day)) || (a.days - b.days))
    .slice(0, max)
    .map(({ e, days }) => ({ id: e.id, title: e.title, days }));
}
