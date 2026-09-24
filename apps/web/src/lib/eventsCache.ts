import { EventSummary, listEvents } from "../api/calendar";

/**
 * Lazy-loading cache for event ranges: a range already fetched (Day/Week/
 * Month navigation revisiting a date, or switching views back and forth)
 * is served from memory instead of re-hitting the API, and concurrent
 * requests for the same range share one in-flight promise instead of
 * firing duplicate fetches.
 */
const cache = new Map<string, Promise<EventSummary[]>>();
let cacheUserKey: string | null = null;

function keyFor(start: Date, end: Date): string {
  // Performance 3B: Bucket keys by Year-Month-Day range boundary to allow view switching reuse
  const s = `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
  const e = `${end.getFullYear()}-${end.getMonth() + 1}-${end.getDate()}`;
  return `${s}_${e}`;
}

export function fetchEventsLazy(start: Date, end: Date, userKey?: string | null): Promise<EventSummary[]> {
  if (userKey !== undefined && userKey !== cacheUserKey) {
    cache.clear();
    cacheUserKey = userKey ?? null;
  }
  const key = `${cacheUserKey ?? "anonymous"}:${keyFor(start, end)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = listEvents(start, end).catch((err) => {
    cache.delete(key); // don't cache failures
    throw err;
  });
  cache.set(key, promise);
  return promise;
}

/** Call after any mutation (create/move/delete) — ranges may now be stale. */
export function invalidateEventsCache(): void {
  cache.clear();
}
