export function startOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function startOfWeek(d: Date): Date {
  const date = startOfDay(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday-start week
  date.setDate(date.getDate() + diff);
  return date;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

/** ISO week number (1..53) according to ISO-8601 standard. */
export function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function formatHour(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

/** Wall-clock hour of `instant` in another IANA zone ("2 PM"). Null when
 * the zone is missing, identical to local, or invalid — callers hide the
 * second scale instead of showing a duplicate or throwing. */
export function formatHourInZone(instant: Date, timeZone: string | null | undefined): string | null {
  if (!timeZone) return null;
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local && timeZone === local) return null;
    return instant.toLocaleTimeString(undefined, { hour: "numeric", timeZone });
  } catch {
    return null;
  }
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** Compact "10 – 11 AM" range for month-card meta lines (meridiem once).
 * Computed arithmetically (not via toLocaleTimeString) so unit tests are
 * locale-independent. */
export function monthTime(startISO: string, endISO: string): string {
  const parts = (d: Date) => {
    const mer = d.getHours() >= 12 ? "PM" : "AM";
    const h = d.getHours() % 12 || 12;
    const min = d.getMinutes() === 0 ? "" : `:${String(d.getMinutes()).padStart(2, "0")}`;
    return { label: `${h}${min}`, mer };
  };
  const a = parts(new Date(startISO));
  const b = parts(new Date(endISO));
  if (a.mer === b.mer) return `${a.label} – ${b.label} ${b.mer}`;
  return `${a.label} ${a.mer} – ${b.label} ${b.mer}`;
}

export const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

/** Monday-start mini-grid trimmed to whole weeks intersecting the month
 * (28–35 cells instead of a fixed 42) so rails never need to scroll. */
export function monthGridCells(year: number, month: number): Date[] {
  const monthStart = new Date(year, month, 1);
  const leadDays = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - leadDays);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const first = days.findIndex((d) => d.getMonth() === month);
  const lastIdx = days.length - 1 - [...days].reverse().findIndex((d) => d.getMonth() === month);
  return days.slice(Math.floor(first / 7) * 7, Math.ceil((lastIdx + 1) / 7) * 7);
}export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Browser IANA timezone, e.g. "America/Los_Angeles" — the source of truth
 * for every timezone the UI sends (X-Timezone header, copilot context). */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Local wall time with numeric offset ("2026-09-13T09:00:00-07:00") so the
 * server sees the user's clock, not a UTC instant it must convert back. */
export function localISO(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
