import { apiFetch } from "./client";

export interface CalendarSummary {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  writable: boolean;
  blocks_availability: boolean;
  kind: string;
  account_id: string;
  account_label: string;
}

export interface Attendee {
  email: string;
  name?: string;
  response_status?: "accepted" | "declined" | "tentative" | "needs_action" | "organizer";
}

export interface EventSummary {
  id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  description?: string | null;
  organizer?: { name?: string; email?: string } | null;
  attendees: Attendee[];
  busy_status: string;
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
