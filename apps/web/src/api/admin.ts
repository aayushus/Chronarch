import { apiFetch } from "./client";

export interface AdminCalendar {
  id: string;
  name: string;
  color: string;
  kind: string;
  account_id: string;
  account_label: string;
  provider: string;
  writable: boolean;
  visible: boolean;
  blocks_availability: boolean;
  is_default: boolean;
  ea_can_view: boolean;
  ea_can_edit: boolean;
  ai_can_read: boolean;
  ai_can_write: boolean;
  privacy_mask: boolean;
}

export type AdminCalendarUpdate = Partial<
  Pick<
    AdminCalendar,
    | "name"
    | "color"
    | "visible"
    | "blocks_availability"
    | "is_default"
    | "ea_can_view"
    | "ea_can_edit"
    | "ai_can_read"
    | "ai_can_write"
    | "privacy_mask"
  >
>;

export function adminListCalendars(): Promise<AdminCalendar[]> {
  return apiFetch<AdminCalendar[]>("/admin/calendars");
}

export function adminUpdateCalendar(id: string, patch: AdminCalendarUpdate): Promise<AdminCalendar> {
  return apiFetch<AdminCalendar>(`/admin/calendars/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
