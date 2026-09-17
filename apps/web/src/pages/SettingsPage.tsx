import React, { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../api/auth";
import Icon, { IconName } from "../components/Icon";
import AccountsSettings from "../components/settings/AccountsSettings";
import AccountSettings from "../components/settings/AccountSettings";
import BookingSettings from "../components/settings/BookingSettings";
import KioskSettings from "../components/settings/KioskSettings";
import AiSettings from "../components/settings/AiSettings";
import AuditLogSettings from "../components/settings/AuditLogSettings";
import CalendarsSettings from "../components/settings/CalendarsSettings";
import ContactsSettings from "../components/settings/ContactsSettings";
import DelegatesSettings from "../components/settings/DelegatesSettings";
import McpSettings from "../components/settings/McpSettings";
import RolesSettings from "../components/settings/RolesSettings";
import SystemSettings from "../components/settings/SystemSettings";
import UsersSettings from "../components/settings/UsersSettings";
import {
  NAV,
  NavItem,
  SettingsSection,
  groupSections,
} from "../components/settings/settingsNav";

const COMPONENTS: Record<SettingsSection, React.ComponentType> = {
  account: AccountSettings,
  calendars: CalendarsSettings,
  accounts: AccountsSettings,
  contacts: ContactsSettings,
  delegates: DelegatesSettings,
  booking: BookingSettings,
  kiosk: KioskSettings,
  users: UsersSettings,
  roles: RolesSettings,
  ai: AiSettings,
  mcp: McpSettings,
  audit: AuditLogSettings,
  system: SystemSettings,
};
function initialSection(): SettingsSection {
  const params = new URLSearchParams(window.location.search);
  if (params.has("accounts_connected") || params.has("accounts_error")) return "accounts";
  const requested = params.get("section");
  if (requested && NAV.some((n) => n.key === requested)) return requested as SettingsSection;
  return "calendars";
}

function visibleSections(user: ReturnType<typeof useAuth>["user"]): typeof NAV {
  if (!user) return [];
  if (user.role === "admin") return NAV;
  const perms = new Set(user.permissions ?? []);
  return NAV.filter((n) => {
    if (n.key === "account") return true; // personal section, always visible
    if (n.key === "contacts") return true; // invite-derived directory, readable by anyone signed in
    if (n.key === "roles") return false; // admin-only surface
    if (n.key === "mcp") return perms.has("mcp.view") || perms.has("mcp_keys.create_self");
    return perms.has(n.view);
  });
}

export default function SettingsPage() {
  const { logout, user } = useAuth();
  const items = visibleSections(user);
  const fallback = items[0]?.key ?? "calendars";
  const [section, setSection] = useState<SettingsSection>(() => {
    const initial = initialSection();
    return items.some((n) => n.key === initial) ? initial : fallback;
  });
  const current = items.find((n) => n.key === section) ?? items[0];
  if (!current) {
    return (
      <div style={{ padding: 48, color: "var(--text-secondary)", fontSize: 13 }}>
        No settings sections available for your role.
      </div>
    );
  }
  const CurrentComponent = COMPONENTS[current.key];

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}>
      <aside
        className="vibrancy"
        style={{
          width: 240,
          minWidth: 240,
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "14px 16px" }}>
          <Link
            to="/"
            className="hoverable"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--text-secondary)",
              textDecoration: "none",
              borderRadius: 6,
              padding: "4px 6px",
              marginLeft: -6,
            }}
          >
            <span style={{ display: "inline-flex" }}>
              <Icon name="chevronLeft" size={12} />
            </span>
            Back to Calendar
          </Link>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12 }}>Settings</div>
        </div>

        <nav style={{ flex: 1, padding: "4px 8px", overflowY: "auto" }}>
          {groupSections(items).map((group, gi) => (
            <div key={group.header ?? "pinned"} style={{ marginTop: gi === 0 ? 0 : 14 }}>
              {group.header && (
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "0 10px 5px" }}>
                  {group.header}
                </div>
              )}
              {group.items.map((item) => {
                const active = section === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setSection(item.key)}
                    className="hoverable"
                    aria-current={active ? "page" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      width: "100%",
                      textAlign: "left",
                      background: active ? "rgba(10, 132, 255, 0.14)" : "transparent",
                      border: "none",
                      borderRadius: 6,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      padding: "7px 10px",
                      cursor: "pointer",
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ display: "inline-flex", color: active ? "var(--accent)" : "var(--text-tertiary)" }}>
                      <Icon name={item.icon} size={14} />
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{user?.email}</span>
          <button
            onClick={logout}
            className="hoverable"
            style={{ background: "none", border: "none", borderRadius: 4, color: "var(--text-tertiary)", fontSize: 11, cursor: "pointer", padding: "3px 6px" }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: "36px 48px" }}>
        <div key={section} className="view-enter" style={{ maxWidth: 960, margin: "0 auto" }}>
          {section === "contacts" ? (
            <ContactsSettings
              onOpenAccounts={items.some((n) => n.key === "accounts") ? () => setSection("accounts") : undefined}
            />
          ) : (
            <CurrentComponent />
          )}
        </div>
      </main>
    </div>
  );
}
