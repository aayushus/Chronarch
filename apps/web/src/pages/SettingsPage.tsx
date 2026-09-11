import React, { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../api/auth";
import AccountsSettings from "../components/settings/AccountsSettings";
import AiSettings from "../components/settings/AiSettings";
import AuditLogSettings from "../components/settings/AuditLogSettings";
import CalendarsSettings from "../components/settings/CalendarsSettings";
import DelegatesSettings from "../components/settings/DelegatesSettings";
import McpSettings from "../components/settings/McpSettings";
import SecuritySettings from "../components/settings/SecuritySettings";
import SystemSettings from "../components/settings/SystemSettings";
import UsersSettings from "../components/settings/UsersSettings";

type SettingsSection = "calendars" | "accounts" | "delegates" | "users" | "ai" | "mcp" | "security" | "audit" | "system";

const NAV: { key: SettingsSection; label: string; Component: React.ComponentType }[] = [
  { key: "calendars", label: "Calendars", Component: CalendarsSettings },
  { key: "accounts", label: "Accounts", Component: AccountsSettings },
  { key: "delegates", label: "Delegates", Component: DelegatesSettings },
  { key: "users", label: "Users", Component: UsersSettings },
  { key: "ai", label: "AI / LiteLLM", Component: AiSettings },
  { key: "mcp", label: "MCP", Component: McpSettings },
  { key: "security", label: "Security", Component: SecuritySettings },
  { key: "audit", label: "Audit Log", Component: AuditLogSettings },
  { key: "system", label: "System", Component: SystemSettings },
];

function initialSection(): SettingsSection {
  const params = new URLSearchParams(window.location.search);
  if (params.has("accounts_connected") || params.has("accounts_error")) return "accounts";
  return "calendars";
}

export default function SettingsPage() {
  const { logout, user } = useAuth();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const current = NAV.find((n) => n.key === section)!;
  const CurrentComponent = current.Component;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}>
      <aside
        className="vibrancy"
        style={{
          width: 220,
          minWidth: 220,
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
            ‹ Back to Calendar
          </Link>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12 }}>Settings</div>
        </div>

        <nav style={{ flex: 1, padding: "4px 8px" }}>
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setSection(item.key)}
              className="hoverable"
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                background: section === item.key ? "var(--bg-raised-hover)" : "transparent",
                border: "none",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 13,
                padding: "7px 10px",
                cursor: "pointer",
                marginBottom: 2,
              }}
            >
              {item.label}
            </button>
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

      <main style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
        <CurrentComponent />
      </main>
    </div>
  );
}
