import { apiFetch, getToken } from "./client";
import { browserTimezone, localISO } from "../lib/dates";

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
  visibility?: string;
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
  description?: string | null;
  location?: string | null;
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

// --- Natural-language quick-add (BRD §32) ---

export interface QuickAddAttendee {
  name: string;
  email: string | null;
  ambiguous?: { email: string; display_name: string | null }[] | null;
}

export interface QuickAddDraft {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  attendees: QuickAddAttendee[];
}

export function quickAddParse(text: string): Promise<QuickAddDraft> {
  return apiFetch<QuickAddDraft>("/quick-add/parse", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function quickAddCreate(calendarId: string, draft: QuickAddDraft): Promise<EventSummary> {
  return apiFetch<EventSummary>("/quick-add/create", {
    method: "POST",
    body: JSON.stringify({ calendar_id: calendarId, draft }),
  });
}

// --- Contact directory (invite-extracted, BRD §32) ---

export interface ContactEntry {
  id: string;
  email: string;
  display_name: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  event_count: number;
  last_seen_at: string;
}

export function searchContacts(q: string): Promise<{ contacts: ContactEntry[] }> {
  return apiFetch<{ contacts: ContactEntry[] }>(`/contacts/search?q=${encodeURIComponent(q)}`);
}

export function createContact(body: {
  email: string;
  display_name?: string | null;
  phone?: string | null;
  company?: string | null;
  job_title?: string | null;
}): Promise<ContactEntry> {
  return apiFetch<ContactEntry>("/contacts", { method: "POST", body: JSON.stringify(body) });
}

export function updateContact(
  id: string,
  body: Partial<Pick<ContactEntry, "display_name" | "email" | "phone" | "company" | "job_title">>
): Promise<ContactEntry> {
  return apiFetch<ContactEntry>(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteContact(id: string): Promise<void> {
  return apiFetch<void>(`/contacts/${id}`, { method: "DELETE" });
}

export function restoreContact(id: string): Promise<ContactEntry> {
  return apiFetch<ContactEntry>(`/contacts/${id}/restore`, { method: "POST" });
}

export function getEvent(eventId: string): Promise<EventSummary> {
  return apiFetch<EventSummary>(`/events/${eventId}`);
}

export function updateEvent(
  eventId: string,
  patch: Partial<Pick<EventSummary, "title" | "description" | "location" | "all_day">> & {
    start?: string;
    end?: string;
    timezone?: string;
    visibility?: string;
  }
): Promise<EventSummary> {
  return apiFetch<EventSummary>(`/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
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
  /** Visible reasoning trace (tool activity). Local-only, never sent. */
  trace?: { text: string; summary?: string }[];
}

export function copilotChat(
  messages: CopilotMessage[],
  opts?: { userTime?: string; viewedDate?: string; viewMode?: string }
): Promise<{ message: CopilotMessage }> {
  return apiFetch<{ message: CopilotMessage }>("/copilot/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
      user_time: opts?.userTime || localISO(),
      viewed_date: opts?.viewedDate,
      view_mode: opts?.viewMode,
      user_timezone: browserTimezone(),
    }),
  });
}

export type CopilotStreamEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; text: string }
  | { type: "result"; name: string; summary: string }
  | { type: "token"; text: string }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

/** POST to the SSE chat endpoint, invoking onEvent for each server event. */
export async function copilotChatStream(
  messages: CopilotMessage[],
  opts: { userTime?: string; viewedDate?: string; viewMode?: string } | undefined,
  onEvent: (e: CopilotStreamEvent) => void
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = getToken();  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Timezone", browserTimezone());

  const res = await fetch("/api/v1/copilot/chat/stream", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
      user_time: opts?.userTime || localISO(),
      viewed_date: opts?.viewedDate,
      view_mode: opts?.viewMode,
      user_timezone: browserTimezone(),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (!res.body) throw new Error("Streaming is not supported in this browser.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingEvent = "message";

  const dispatch = (rawEvent: string, rawData: string) => {
    if (!rawData) return;
    try {
      const data = JSON.parse(rawData);
      if (["status", "tool", "result", "token", "done", "error"].includes(rawEvent)) {
        onEvent({ type: rawEvent, ...data } as CopilotStreamEvent);
      }
    } catch {
      /* partial frame — ignore */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      pendingEvent = "message";
      let payload = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) pendingEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) payload += line.slice(5).trim();
      }
      dispatch(pendingEvent, payload);
    }
  }
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
