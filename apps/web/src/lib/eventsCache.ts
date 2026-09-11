import { EventSummary, listEvents } from "../api/calendar";

/**
 * Lazy-loading cache for event ranges: a range already fetched (Day/Week/
 * Month navigation revisiting a date, or switching views back and forth)
 * is served from memory instead of re-hitting the API, and concurrent
 * requests for the same range share one in-flight promise instead of
 * firing duplicate fetches.
 */
const cache = new Map<string, Promise<EventSummary[]>>();

function keyFor(start: Date, end: Date): string {
  return `${start.toISOString()}_${end.toISOString()}`;
}

export function fetchEventsLazy(start: Date, end: Date): Promise<EventSummary[]> {
  const key = keyFor(start, end);
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
