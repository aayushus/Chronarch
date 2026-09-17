import type { IconName } from "../Icon";

export type SettingsSection =
  | "account" | "calendars" | "accounts" | "contacts" | "delegates"
  | "booking" | "kiosk" | "users" | "roles" | "ai" | "mcp" | "audit" | "system";

export type NavGroup = "Workspace" | "Sharing" | "Access" | "Intelligence" | "System";

export const GROUP_ORDER: NavGroup[] = ["Workspace", "Sharing", "Access", "Intelligence", "System"];

export interface NavItem {
  key: SettingsSection;
  label: string;
  icon: IconName;
  /** Permission needed ("" = always visible personal/directory sections). */
  view: string;
  /** Null = pinned personal row above the groups. */
  group: NavGroup | null;
}

/** Full nav (every section must sit in a group — enforced by tests). */
export const NAV: NavItem[] = [
  // Account is personal, not privileged: always visible (it also carries logout).
  { key: "account", label: "Account", icon: "user", view: "", group: null },
  { key: "calendars", label: "Calendars", icon: "calendar", view: "calendars.view", group: "Workspace" },
  { key: "accounts", label: "Accounts", icon: "external", view: "accounts.view", group: "Workspace" },
  // Contacts derive from synced invites — readable by anyone signed in.
  { key: "contacts", label: "Contacts", icon: "addressBook", view: "", group: "Workspace" },
  { key: "booking", label: "Booking", icon: "link", view: "booking.view", group: "Sharing" },
  { key: "kiosk", label: "Kiosk", icon: "monitor", view: "kiosk.view", group: "Sharing" },
  { key: "delegates", label: "Delegates", icon: "users", view: "delegations.view", group: "Sharing" },
  { key: "users", label: "Users", icon: "shield", view: "users.view", group: "Access" },
  { key: "roles", label: "Roles", icon: "key", view: "", group: "Access" },
  { key: "ai", label: "AI / Copilot", icon: "sparkles", view: "ai.view", group: "Intelligence" },
  { key: "mcp", label: "MCP", icon: "command", view: "mcp.view", group: "Intelligence" },
  { key: "audit", label: "Audit Log", icon: "clock", view: "audit.view", group: "System" },
  { key: "system", label: "System", icon: "settings", view: "system.view", group: "System" },
];

/** Group visible items for the sidebar: pinned rows first, then each
 * non-empty group in GROUP_ORDER. */
export function groupSections(items: NavItem[]): { header: NavGroup | null; items: NavItem[] }[] {
  const out: { header: NavGroup | null; items: NavItem[] }[] = [];
  const pinned = items.filter((n) => n.group === null);
  if (pinned.length > 0) out.push({ header: null, items: pinned });
  for (const group of GROUP_ORDER) {
    const rows = items.filter((n) => n.group === group);
    if (rows.length > 0) out.push({ header: group, items: rows });
  }
  return out;
}
