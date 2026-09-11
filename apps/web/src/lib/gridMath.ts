/** Shared time-grid math for Day/Week views (BRD §9.3-9.7).
 *
 * Both views snap to 15-minute increments and convert pointer Y into
 * minutes-since-midnight. WeekView additionally converts pointer X into a
 * day offset for cross-day drags. Keeping the math in one place so the two
 * views snap and clamp identically.
 */

export const SNAP_MINUTES = 15;

export function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export function snapDown(minutes: number): number {
  return Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Minutes-since-midnight for a clientY inside a grid column. */
export function minutesFromY(
  clientY: number,
  columnTop: number,
  hourHeight: number,
  startHour: number,
  endHour: number,
): number {
  const raw = startHour * 60 + ((clientY - columnTop) / hourHeight) * 60;
  return clamp(raw, startHour * 60, endHour * 60);
}

/** Y offset (px, from column top) for minutes-since-midnight. */
export function yFromMinutes(minutes: number, hourHeight: number, startHour: number): number {
  return ((minutes - startHour * 60) / 60) * hourHeight;
}

/** Whole-day offset for a clientX inside the week grid. */
export function dayOffsetFromX(
  clientX: number,
  gridLeft: number,
  gutterWidth: number,
  gridWidth: number,
  dayCount: number,
  originDayIndex: number,
): number {
  const dayWidth = (gridWidth - gutterWidth) / dayCount;
  if (dayWidth <= 0) return 0;
  const index = clamp(Math.floor((clientX - gridLeft - gutterWidth) / dayWidth), 0, dayCount - 1);
  return index - originDayIndex;
}

/** Minutes-since-midnight for a Date (local wall clock). */
export function minutesOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/** New Date on the same local day as `day` at `minutes` past midnight. */
export function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, minutes, 0, 0);
  return d;
}

/** Shift a date by whole days, preserving wall-clock time. */
export function addDaysPreserveTime(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
