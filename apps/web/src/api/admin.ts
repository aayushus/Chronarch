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
  is_admin: boolean;
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
  is_admin: boolean;
}): Promise<AdminUser> {
  return apiFetch<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(body) });
}

export function adminUpdateUser(
  id: string,
  patch: Partial<Pick<AdminUser, "display_name" | "role" | "is_admin" | "is_active">>
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
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
  executive_user_id: string;
  executive_email: string;
  assistant_user_id: string;
  assistant_email: string;
  active: boolean;
  grants: DelegationGrant[];
}

export function adminListDelegations(): Promise<Delegation[]> {
  return apiFetch<Delegation[]>("/admin/delegations");
}

export function adminCreateDelegation(executiveUserId: string, assistantUserId: string): Promise<Delegation> {
  return apiFetch<Delegation>("/admin/delegations", {
    method: "POST",
    body: JSON.stringify({ executive_user_id: executiveUserId, assistant_user_id: assistantUserId }),
  });
}

export function adminSetDelegationActive(id: string, active: boolean): Promise<Delegation> {
  return apiFetch<Delegation>(`/admin/delegations/${id}?active=${active}`, { method: "PATCH" });
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
}

export function adminListAccounts(): Promise<AdminAccount[]> {
  return apiFetch<AdminAccount[]>("/admin/accounts");
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
  primary_model: string;
  fallback_model: string;
  emergency_model: string;
  routing_strategy: string;
  timeout_seconds: number;
  sources: Record<string, string>;
  litellm_endpoint: string;
}

export function adminGetAISettings(): Promise<AISettings> {
  return apiFetch<AISettings>("/admin/ai/settings");
}

export function adminSaveAISettings(body: {
  openrouter_api_key?: string;
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
