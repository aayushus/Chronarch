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

export function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function formatHour(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
export const MONTH_NAMES = [
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
