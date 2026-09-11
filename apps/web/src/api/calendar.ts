import { apiFetch } from "./client";

export interface CalendarSummary {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  writable: boolean;
  blocks_availability: boolean;
  kind: string;
}

export interface EventSummary {
  id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
}

export function listCalendars(): Promise<CalendarSummary[]> {
  return apiFetch<CalendarSummary[]>("/calendars");
}

export function listEvents(windowStart: Date, windowEnd: Date): Promise<EventSummary[]> {
  const params = new URLSearchParams({
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
  });
  return apiFetch<EventSummary[]>(`/events?${params.toString()}`);
}

export function createEvent(body: {
  calendar_id: string;
  title: string;
  start: string;
  end: string;
}): Promise<EventSummary> {
  return apiFetch<EventSummary>("/events", { method: "POST", body: JSON.stringify(body) });
}

export function moveEvent(eventId: string, start: string, end: string): Promise<EventSummary> {
  return apiFetch<EventSummary>(`/events/${eventId}/move`, {
    method: "PATCH",
    body: JSON.stringify({ start, end }),
  });
}

export function deleteEvent(eventId: string): Promise<void> {
  return apiFetch<void>(`/events/${eventId}`, { method: "DELETE" });
}
