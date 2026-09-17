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

// --- Users ---

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  roles: string[];
  is_active: boolean;
}

export function adminListUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/admin/users");
}

export function adminCreateUser(body: {
  email: string;
  display_name: string;
  password: string;
  role: string;
  roles?: string[];
}): Promise<AdminUser> {
  return apiFetch<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(body) });
}

export function adminUpdateUser(
  id: string,
  patch: Partial<Pick<AdminUser, "display_name" | "role" | "is_active">> & { roles?: string[] }
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// --- Roles ---

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
  members: { id: string; email: string }[];
}

export interface PermissionCatalog {
  [group: string]: { permission: string; description: string }[];
}

export function adminListRoles(): Promise<RoleInfo[]> {
  return apiFetch<RoleInfo[]>("/admin/roles");
}

export function adminGetPermissionCatalog(): Promise<PermissionCatalog> {
  return apiFetch<PermissionCatalog>("/admin/roles/catalog");
}

export function adminCreateRole(body: { name: string; description?: string; permissions?: string[] }): Promise<RoleInfo> {
  return apiFetch<RoleInfo>("/admin/roles", { method: "POST", body: JSON.stringify(body) });
}

export function adminUpdateRole(
  id: string,
  patch: { description?: string; permissions?: string[] }
): Promise<RoleInfo> {
  return apiFetch<RoleInfo>(`/admin/roles/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function adminDeleteRole(id: string): Promise<void> {
  return apiFetch<void>(`/admin/roles/${id}`, { method: "DELETE" });
}

export function adminAddRoleMember(roleId: string, userId: string): Promise<RoleInfo> {
  return apiFetch<RoleInfo>(`/admin/roles/${roleId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function adminRemoveRoleMember(roleId: string, userId: string): Promise<void> {
  return apiFetch<void>(`/admin/roles/${roleId}/members/${userId}`, { method: "DELETE" });
}

// --- Delegations ---

export interface DelegationGrant {
  calendar_id: string;
  calendar_name: string;
  can_view_availability: boolean;
  can_view_titles: boolean;
  can_view_full_details: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_reschedule: boolean;
  can_delete: boolean;
  can_manage_attendees: boolean;
  can_respond_to_invitations: boolean;
  can_import_ics: boolean;
  can_move_between_calendars: boolean;
}

export interface Delegation {
  id: string;
  owner_user_id: string;
  owner_email: string;
  delegate_user_id: string;
  delegate_email: string;
  active: boolean;
  grants: DelegationGrant[];
}

export function adminListDelegations(): Promise<Delegation[]> {
  return apiFetch<Delegation[]>("/admin/delegations");
}

export function adminCreateDelegation(ownerUserId: string, delegateUserId: string): Promise<Delegation> {
  return apiFetch<Delegation>("/admin/delegations", {
    method: "POST",
    body: JSON.stringify({ owner_user_id: ownerUserId, delegate_user_id: delegateUserId }),
  });
}

export function adminSetDelegationActive(id: string, active: boolean): Promise<Delegation> {
  return apiFetch<Delegation>(`/admin/delegations/${id}?active=${active}`, { method: "PATCH" });
}

export function adminDeleteDelegation(id: string): Promise<void> {
  return apiFetch<void>(`/admin/delegations/${id}`, { method: "DELETE" });
}

export type GrantFields = Omit<DelegationGrant, "calendar_id" | "calendar_name">;

export function adminUpsertGrant(delegationId: string, calendarId: string, fields: GrantFields): Promise<Delegation> {
  return apiFetch<Delegation>(`/admin/delegations/${delegationId}/grants/${calendarId}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

export function adminRemoveGrant(delegationId: string, calendarId: string): Promise<Delegation> {
  return apiFetch<Delegation>(`/admin/delegations/${delegationId}/grants/${calendarId}`, { method: "DELETE" });
}

// --- MCP credentials ---

export interface MCPCredential {
  id: string;
  name: string;
  user_id: string;
  user_email: string;
  scopes: string[];
  revoked: boolean;
}

export function adminListMcpCredentials(): Promise<MCPCredential[]> {
  return apiFetch<MCPCredential[]>("/admin/mcp-credentials");
}

export function adminCreateMcpCredential(
  name: string,
  userId: string,
  scopes: string[]
): Promise<MCPCredential & { api_key: string }> {
  return apiFetch<MCPCredential & { api_key: string }>("/admin/mcp-credentials", {
    method: "POST",
    body: JSON.stringify({ name, user_id: userId, scopes }),
  });
}

export function adminRevokeMcpCredential(id: string): Promise<MCPCredential> {
  return apiFetch<MCPCredential>(`/admin/mcp-credentials/${id}`, { method: "DELETE" });
}

// --- Own MCP keys (delegates with mcp_keys.create_self) ---

export function myListMcpCredentials(): Promise<MCPCredential[]> {
  return apiFetch<MCPCredential[]>("/mcp-keys/self");
}

export function myCreateMcpCredential(
  name: string,
  scopes: string[]
): Promise<MCPCredential & { api_key: string }> {
  return apiFetch<MCPCredential & { api_key: string }>("/mcp-keys/self", {
    method: "POST",
    body: JSON.stringify({ name, scopes }),
  });
}

export function myRevokeMcpCredential(id: string): Promise<MCPCredential> {
  return apiFetch<MCPCredential>(`/mcp-keys/self/${id}`, { method: "DELETE" });
}

// --- Accounts ---

export interface AdminAccount {
  id: string;
  provider: string;
  provider_account_email: string;
  tenant_id: string | null;
  owner_user_id: string;
  owner_email: string;
  sync_status: string;
  last_synced_at: string | null;
  calendar_count: number;
  push_status?: string;
}

export function adminListAccounts(): Promise<AdminAccount[]> {
  return apiFetch<AdminAccount[]>("/admin/accounts");
}

export function adminEnsureWebhooks(id: string): Promise<{
  account_id: string;
  ensured: number;
  replaced: number;
  skipped: string;
}> {
  return apiFetch(`/admin/accounts/${id}/webhooks`, { method: "POST" });
}

export function adminDisconnectAccount(id: string): Promise<void> {
  return apiFetch<void>(`/admin/accounts/${id}`, { method: "DELETE" });
}

export async function adminGetGoogleConnectUrl(): Promise<string> {
  const res = await apiFetch<{ url: string }>("/admin/accounts/google/connect-url");
  return res.url;
}

export async function adminGetMicrosoftConnectUrl(): Promise<string> {
  const res = await apiFetch<{ url: string }>("/admin/accounts/microsoft/connect-url");
  return res.url;
}

export function adminAddIcsSubscription(body: { name: string; url: string; color?: string }): Promise<{
  calendar_id: string;
  name: string;
  sync_stats: Record<string, unknown>;
}> {
  return apiFetch<{ calendar_id: string; name: string; sync_stats: Record<string, unknown> }>(
    "/admin/accounts/ics-subscription",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function adminTestCaldav(body: { server_url: string; username: string; password: string }): Promise<{
  ok: boolean;
  calendars_found: number;
  names: string[];
}> {
  return apiFetch("/admin/accounts/caldav/test", { method: "POST", body: JSON.stringify(body) });
}

export function adminConnectCaldav(body: {
  server_url: string;
  username: string;
  password: string;
  email_label?: string;
}): Promise<{ account_id: string; email_label: string; sync_stats: Record<string, unknown> }> {
  return apiFetch("/admin/accounts/caldav/connect", { method: "POST", body: JSON.stringify(body) });
}



// --- OAuth provider credentials ---

export interface OAuthProviderConfig {
  provider: string;
  client_id_configured: boolean;
  client_secret_configured: boolean;
  tenant_id: string | null;
}

export function adminListOAuthConfigs(): Promise<OAuthProviderConfig[]> {
  return apiFetch<OAuthProviderConfig[]>("/admin/oauth");
}

export function adminSaveOAuthConfig(
  provider: string,
  body: { client_id?: string; client_secret?: string; tenant_id?: string | null }
): Promise<OAuthProviderConfig> {
  return apiFetch<OAuthProviderConfig>(`/admin/oauth/${provider}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function adminClearOAuthConfig(provider: string): Promise<OAuthProviderConfig> {
  return apiFetch<OAuthProviderConfig>(`/admin/oauth/${provider}`, { method: "DELETE" });
}

// --- AI / LiteLLM settings ---

export interface AISettings {
  openrouter_key_configured: boolean;
  groq_key_configured: boolean;
  gemini_key_configured: boolean;
  primary_model: string;
  fallback_model: string;
  emergency_model: string;
  routing_strategy: string;
  timeout_seconds: number;
  sources: Record<string, string>;
  litellm_endpoint: string;
  key_check: string | Record<string, string> | null;
}

export function adminGetAISettings(): Promise<AISettings> {
  return apiFetch<AISettings>("/admin/ai/settings");
}

export function adminSaveAISettings(body: {
  openrouter_api_key?: string;
  groq_api_key?: string;
  gemini_api_key?: string;
  primary_model?: string | null;
  fallback_model?: string | null;
  emergency_model?: string | null;
  routing_strategy?: string | null;
  timeout_seconds?: number;
}): Promise<AISettings> {
  return apiFetch<AISettings>("/admin/ai/settings", { method: "PUT", body: JSON.stringify(body) });
}

export function adminClearAISettings(): Promise<AISettings> {
  return apiFetch<AISettings>("/admin/ai/settings", { method: "DELETE" });
}

export interface ProviderModel {
  id: string;
  label: string;
}

export function adminListProviderModels(provider: string): Promise<{ provider: string; models: ProviderModel[] }> {
  return apiFetch<{ provider: string; models: ProviderModel[] }>(`/admin/ai/models/${provider}`);
}

// --- Audit log ---

export interface AuditEntry {
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_email: string | null;
  action: string;
  calendar_name: string | null;
  event_id: string | null;
  detail: Record<string, unknown>;
}

export function adminListAuditLog(limit = 100): Promise<AuditEntry[]> {
  return apiFetch<AuditEntry[]>(`/admin/audit-log?limit=${limit}`);
}

// --- Booking links (Cal.com-style public scheduling) ---

export interface BookingLink {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  calendar_id: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  approval_required: boolean;
  active: boolean;
  url_path: string;
  booking_counts: { pending?: number; upcoming?: number };
}

export interface BookingEntry {
  id: string;
  booker_name: string;
  booker_email: string;
  note: string | null;
  start: string;
  end: string;
  booked_timezone: string;
  status: "pending" | "confirmed" | "cancelled" | "declined";
  event_id: string | null;
  created_at: string;
}

export function adminListBookingLinks(): Promise<BookingLink[]> {
  return apiFetch<BookingLink[]>("/booking-links");
}

export function adminCheckSlug(slug: string): Promise<{ available: boolean; slug?: string; reason?: string }> {
  return apiFetch(`/booking-links/slug-available?slug=${encodeURIComponent(slug)}`);
}

export function adminCreateBookingLink(body: {
  title: string;
  description?: string | null;
  slug?: string | null;
  duration_minutes: number;
  calendar_id: string;
  buffer_before_minutes?: number;
  buffer_after_minutes?: number;
  min_notice_minutes?: number;
  max_days_ahead?: number;
  approval_required?: boolean;
}): Promise<BookingLink> {
  return apiFetch<BookingLink>("/booking-links", { method: "POST", body: JSON.stringify(body) });
}

export function adminUpdateBookingLink(id: string, body: Partial<BookingLink>): Promise<BookingLink> {
  return apiFetch<BookingLink>(`/booking-links/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function adminDeleteBookingLink(id: string): Promise<void> {
  return apiFetch<void>(`/booking-links/${id}`, { method: "DELETE" });
}

export function adminListBookings(linkId: string): Promise<{ link: BookingLink; bookings: BookingEntry[] }> {
  return apiFetch(`/booking-links/${linkId}/bookings`);
}

export function adminApproveBooking(id: string): Promise<BookingEntry> {
  return apiFetch<BookingEntry>(`/booking-links/bookings/${id}/approve`, { method: "POST" });
}

export function adminDeclineBooking(id: string): Promise<BookingEntry> {
  return apiFetch<BookingEntry>(`/booking-links/bookings/${id}/decline`, { method: "POST" });
}

export function adminCancelBooking(id: string): Promise<BookingEntry> {
  return apiFetch<BookingEntry>(`/booking-links/bookings/${id}/cancel`, { method: "POST" });
}

// --- Kiosk wall displays ---

export interface KioskDisplay {
  id: string;
  name: string;
  location_label: string;
  sleep_start: string;
  sleep_end: string;
  active: boolean;
  url_path: string;
  last_seen_at: string | null;
  created_at: string;
  token?: string;
}

export function kioskListDisplays(): Promise<KioskDisplay[]> {
  return apiFetch<KioskDisplay[]>("/kiosk");
}

export function kioskCreateDisplay(body: {
  name: string;
  location_label?: string;
  sleep_start?: string;
  sleep_end?: string;
}): Promise<KioskDisplay> {
  return apiFetch<KioskDisplay>("/kiosk", { method: "POST", body: JSON.stringify(body) });
}

export function kioskUpdateDisplay(id: string, body: Partial<KioskDisplay>): Promise<KioskDisplay> {
  return apiFetch<KioskDisplay>(`/kiosk/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function kioskRotateDisplay(id: string): Promise<KioskDisplay> {
  return apiFetch<KioskDisplay>(`/kiosk/${id}/rotate`, { method: "POST" });
}

export function kioskPairWithCode(code: string): Promise<KioskDisplay> {
  return apiFetch<KioskDisplay>("/kiosk/pair", { method: "POST", body: JSON.stringify({ code }) });
}

export function kioskDeleteDisplay(id: string): Promise<void> {
  return apiFetch<void>(`/kiosk/${id}`, { method: "DELETE" });
}
