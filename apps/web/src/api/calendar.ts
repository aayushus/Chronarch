import { apiFetch } from "./client";

export interface CalendarSummary {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  writable: boolean;
  provider_writable?: boolean;
  can_create?: boolean;
  can_edit?: boolean;
  can_reschedule?: boolean;
  can_delete?: boolean;
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
  all_day?: boolean;
}): Promise<EventSummary> {
  return apiFetch<EventSummary>("/events", { method: "POST", body: JSON.stringify(body) });
}

export function moveEvent(
  eventId: string,
  start: string,
  end: string,
  allDay?: boolean,
): Promise<EventSummary> {
  return apiFetch<EventSummary>(`/events/${eventId}/move`, {
    method: "PATCH",
    body: JSON.stringify(allDay === undefined ? { start, end } : { start, end, all_day: allDay }),
  });
}

export interface ConflictInfo {
  event_id: string;
  calendar_id: string;
  calendar_name: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  redacted: boolean;
}

export function getConflicts(
  windowStart: Date,
  windowEnd: Date,
  excludeEventId?: string,
): Promise<ConflictInfo[]> {
  const params = new URLSearchParams({
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
  });
  if (excludeEventId) params.set("exclude_event_id", excludeEventId);
  return apiFetch<ConflictInfo[]>(`/events/conflicts?${params.toString()}`);
}

export function deleteEvent(eventId: string): Promise<void> {
  return apiFetch<void>(`/events/${eventId}`, { method: "DELETE" });
}

export interface IcsPreviewEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  timezone: string;
  location: string | null;
  description: string | null;
  organizer: { email: string; name: string | null } | null;
  attendees: Array<{ email: string; name: string | null; status: string }>;
  recurrence: string | null;
}

export function previewIcs(content: string): Promise<{ events: IcsPreviewEvent[]; count: number }> {
  return apiFetch<{ events: IcsPreviewEvent[]; count: number }>("/events/ics/preview", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function importIcsEvent(body: {
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  timezone?: string;
  description?: string | null;
  location?: string | null;
  all_day?: boolean;
}): Promise<EventSummary> {
  return apiFetch<EventSummary>("/events/ics/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface CopilotMessage {
  role: "user" | "assistant" | "system";
  content?: string | null;
}

export function copilotChat(
  messages: CopilotMessage[],
  opts?: { userTime?: string; viewedDate?: string; viewMode?: string }
): Promise<{ message: CopilotMessage }> {
  return apiFetch<{ message: CopilotMessage }>("/copilot/chat", {
    method: "POST",
    body: JSON.stringify({
      messages,
      user_time: opts?.userTime || new Date().toISOString(),
      viewed_date: opts?.viewedDate,
      view_mode: opts?.viewMode,
    }),
  });
}

export interface SyncStatusResult {
  account_count: number;
  last_synced_at: string | null;
  is_syncing: boolean;
  has_error: boolean;
}

export function getSyncStatus(): Promise<SyncStatusResult> {
  return apiFetch<SyncStatusResult>("/calendars/sync-status");
}

export interface SyncResult {
  synced: boolean;
  last_synced_at: string;
  events_synced: number;
  accounts_synced: number;
  errors: string[];
}

export function triggerCalendarSync(): Promise<SyncResult> {
  return apiFetch<SyncResult>("/calendars/sync", {
    method: "POST",
  });
}

export function adminSyncAccount(accountId: string): Promise<{ synced: boolean; account_id: string; last_synced_at: string; stats: any }> {
  return apiFetch(`/admin/accounts/${accountId}/sync`, {
    method: "POST",
  });
}
