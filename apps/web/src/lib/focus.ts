/** Beta command-center helpers (pure, tested). */

/** "Good morning/afternoon/evening" from a 0–23 hour. */
export function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export interface BetaEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
}

export interface DayStats {
  count: number;
  meetingMinutes: number;
  /** Free minutes inside 9:00–17:00 after timed meetings. */
  freeMinutes: number;
  upNext: { id: string; title: string; start: string } | null;
}

/** Today's pulse for the focus rail. `now` injectable for tests. */
export function dayStats(events: BetaEvent[], day: Date, now: Date = new Date()): DayStats {
  const sameDay = (d: Date) =>
    d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
  const timed = events
    .map((e) => ({ e, s: new Date(e.start), en: new Date(e.end) }))
    .filter(({ e, s }) => !e.all_day && sameDay(s) && !isNaN(s.getTime()) && !/^\s*(?:canceled|cancelled)\s*:/i.test(e.title))
    .sort((a, b) => +a.s - +b.s);

  let meetingMinutes = 0;
  for (const { s, en } of timed) {
    meetingMinutes += Math.max(0, (en.getTime() - s.getTime()) / 60000);
  }
  // Clip timed meetings into the 9–17 work window for free-time math.
  const workStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
  const workEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17);
  let busyInWork = 0;
  for (const { s, en } of timed) {
    const a = Math.max(s.getTime(), workStart.getTime());
    const b = Math.min(en.getTime(), workEnd.getTime());
    if (b > a) busyInWork += (b - a) / 60000;
  }
  const upNext = timed.find(({ en }) => en.getTime() > now.getTime()) ?? null;

  return {
    count: timed.length,
    meetingMinutes: Math.round(meetingMinutes),
    freeMinutes: Math.max(0, Math.round(480 - busyInWork)),
    upNext: upNext ? { id: upNext.e.id, title: upNext.e.title, start: upNext.e.start } : null,
  };
}

/** "2h 30m" / "45m" / "0m" for stat tiles. */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
