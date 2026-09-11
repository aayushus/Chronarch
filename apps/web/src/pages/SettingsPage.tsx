import React, { useState } from "react";
import { Link } from "react-router-dom";

import CalendarsSettings from "../components/settings/CalendarsSettings";

type SettingsSection = "calendars" | "accounts" | "delegates" | "users" | "ai" | "mcp" | "security" | "audit" | "system";

const NAV: { key: SettingsSection; label: string; implemented: boolean }[] = [
  { key: "calendars", label: "Calendars", implemented: true },
  { key: "accounts", label: "Accounts", implemented: false },
  { key: "delegates", label: "Delegates", implemented: false },
  { key: "users", label: "Users", implemented: false },
  { key: "ai", label: "AI / LiteLLM", implemented: false },
  { key: "mcp", label: "MCP", implemented: false },
  { key: "security", label: "Security", implemented: false },
  { key: "audit", label: "Audit Log", implemented: false },
  { key: "system", label: "System", implemented: false },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>("calendars");
  const current = NAV.find((n) => n.key === section)!;

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
                justifyContent: "space-between",
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
              {!item.implemented && <span style={{ fontSize: 9, color: "var(--text-tertiary)" }}>soon</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
        <div style={{ maxWidth: 760 }}>
          {current.implemented ? (
            section === "calendars" && <CalendarsSettings />
          ) : (
            <ComingSoon label={current.label} />
          )}
        </div>
      </main>
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{label}</h2>
      <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
        {label} configuration isn't implemented yet — it's next up in the MVP build order.
      </p>
    </div>
  );
}
