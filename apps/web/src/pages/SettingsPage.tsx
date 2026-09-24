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
  filterNav,
  groupSections,
} from "../components/settings/settingsNav";
import UserAvatar from "../components/UserAvatar";

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

  // Keep section valid and in sync when user/permissions load
  React.useEffect(() => {
    const initial = initialSection();
    if (items.some((n) => n.key === initial)) {
      if (section !== initial) setSection(initial);
    } else if (items.length > 0 && !items.some((n) => n.key === section)) {
      setSection(items[0].key);
    }
  }, [items]);

  const current = items.find((n) => n.key === section) ?? items[0];
  if (!current) {
    return (
      <div style={{ padding: 48, color: "var(--text-secondary)", fontSize: 13 }}>
        No settings sections available for your role.
      </div>
    );
  }
  const CurrentComponent = COMPONENTS[current.key];
  const [filter, setFilter] = useState("");
  const filtered = filterNav(items, filter);
  const displayName = user?.display_name?.trim() || user?.email?.split("@")[0] || "?";

  function jumpToFirstMatch() {
    if (filtered.length > 0 && !filtered.some((n) => n.key === section)) {
      setSection(filtered[0].key);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-app)", overflow: "hidden" }}>
      {/* Beta-style command header */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <Link
          to="/"
          className="hoverable"
          title="Back to Calendar"
          style={{ display: "inline-flex", alignItems: "center", gap: 9, textDecoration: "none", flexShrink: 0, minWidth: 0 }}
        >
          <span style={{ display: "inline-flex", color: "var(--text-tertiary)" }}>
            <Icon name="chevronLeft" size={14} />
          </span>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
            Settings
          </span>
        </Link>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "7px 12px", width: "100%", maxWidth: 420 }}>
            <Icon name="search" size={14} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpToFirstMatch();
                if (e.key === "Escape") setFilter("");
              }}
              placeholder="Find a section…"
              aria-label="Find a settings section"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 13, minWidth: 0 }}
            />
            {filter && (
              <button onClick={() => setFilter("")} aria-label="Clear filter" style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 0, display: "inline-flex" }}>
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>
        <UserAvatar email={user?.email} name={displayName} size={32} />
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
      <aside
        className="vibrancy settings-rail"
        style={{
          width: 240,
          minWidth: 240,
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
          {groupSections(filtered).map((group, gi) => (
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

      <main className="settings-main" style={{ flex: 1, overflowY: "auto", padding: "32px 48px", minWidth: 0 }}>
        <div key={section} className="view-enter" style={{ maxWidth: 880, margin: "0 auto" }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: "32px 0", textAlign: "center" }}>
              No sections match “{filter}”.
            </div>
          ) : section === "contacts" ? (
            <ContactsSettings
              onOpenAccounts={items.some((n) => n.key === "accounts") ? () => setSection("accounts") : undefined}
            />
          ) : (
            <CurrentComponent />
          )}
        </div>
      </main>
      </div>
    </div>
  );
}
