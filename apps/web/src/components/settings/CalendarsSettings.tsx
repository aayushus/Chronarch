import React, { useEffect, useState } from "react";

import { AdminCalendar, adminListCalendars, adminUpdateCalendar } from "../../api/admin";

interface SettingItem {
  key: keyof AdminCalendar;
  label: string;
  desc: string;
}

const DISPLAY_SETTINGS: SettingItem[] = [
  { key: "visible", label: "Visible in UI", desc: "Display in sidebar and calendar views" },
  { key: "blocks_availability", label: "Blocks Availability", desc: "Events block executive free/busy slots" },
  { key: "is_default", label: "Default Calendar", desc: "Selected by default for new events" },
  { key: "privacy_mask", label: "Privacy Mask", desc: "Mask event details to external viewers" },
];

const ACCESS_SETTINGS: SettingItem[] = [
  { key: "ea_can_view", label: "EA Can View", desc: "Delegate assistants can view this calendar" },
  { key: "ea_can_edit", label: "EA Can Edit", desc: "Delegate assistants can schedule on this calendar" },
  { key: "ai_can_read", label: "AI Copilot Read", desc: "Built-in AI and MCP tools can read events" },
  { key: "ai_can_write", label: "AI Copilot Write", desc: "Built-in AI and MCP tools can create/edit" },
];

export default function CalendarsSettings() {
  const [calendars, setCalendars] = useState<AdminCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    adminListCalendars()
      .then((cals) => {
        setCalendars(cals);
        if (cals.length > 0) setExpandedId(cals[0].id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(cal: AdminCalendar, field: keyof AdminCalendar) {
    const nextValue = !cal[field];
    setCalendars((prev) => prev.map((c) => (c.id === cal.id ? { ...c, [field]: nextValue } : c)));
    setSavingId(cal.id);
    try {
      await adminUpdateCalendar(cal.id, { [field]: nextValue } as never);
    } catch (e) {
      setCalendars((prev) => prev.map((c) => (c.id === cal.id ? { ...c, [field]: !nextValue } : c)));
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function handleColorChange(cal: AdminCalendar, color: string) {
    setCalendars((prev) => prev.map((c) => (c.id === cal.id ? { ...c, color } : c)));
    try {
      await adminUpdateCalendar(cal.id, { color });
      setBanner({ kind: "success", text: `Updated color for ${cal.name}.` });
    } catch (e) {
      setError(String(e));
    }
  }

  const groups = new Map<string, { label: string; provider: string; calendars: AdminCalendar[] }>();
  for (const cal of calendars) {
    if (!groups.has(cal.account_id)) {
      groups.set(cal.account_id, { label: cal.account_label, provider: cal.provider, calendars: [] });
    }
    groups.get(cal.account_id)!.calendars.push(cal);
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading calendars…</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Calendars</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
          Visibility, availability participation, and delegation/AI access authority per calendar.
        </p>
      </div>

      {banner && (
        <div
          style={{
            fontSize: 13,
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 20,
            background: banner.kind === "success" ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 69, 58, 0.15)",
            border: `1px solid ${banner.kind === "success" ? "var(--success)" : "var(--danger)"}`,
            color: banner.kind === "success" ? "#30d158" : "#ff453a",
            fontWeight: 500,
          }}
        >
          {banner.text}
        </div>
      )}

      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {calendars.length === 0 ? (
        <div
          style={{
            background: "var(--bg-raised)",
            borderRadius: "var(--radius-md)",
            border: "1px dashed var(--border)",
            padding: "36px 20px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.8 }}>📅</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            No calendars found
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
            Connect a Google or Microsoft account or subscribe to an ICS feed under Accounts.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {[...groups.entries()].map(([accountId, group]) => {
            const isGoogle = group.provider === "google";
            const isMicrosoft = group.provider === "microsoft";

            return (
              <div key={accountId}>
                {/* Account Group Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>
                    {isGoogle ? "🇬" : isMicrosoft ? "🪟" : "📁"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                    {group.label}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: isGoogle
                        ? "rgba(10, 132, 255, 0.15)"
                        : isMicrosoft
                        ? "rgba(48, 209, 88, 0.15)"
                        : "rgba(255, 159, 10, 0.15)",
                      color: isGoogle
                        ? "var(--accent)"
                        : isMicrosoft
                        ? "var(--success)"
                        : "var(--warning)",
                      fontWeight: 700,
                    }}
                  >
                    {group.provider}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
                    {group.calendars.length} calendar{group.calendars.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Calendar Cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {group.calendars.map((cal) => {
                    const expanded = expandedId === cal.id;

                    return (
                      <div
                        key={cal.id}
                        style={{
                          background: "var(--bg-raised)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border-subtle)",
                          overflow: "hidden",
                          opacity: savingId === cal.id ? 0.75 : 1,
                          transition: "opacity var(--transition-fast)",
                        }}
                      >
                        {/* Summary Bar */}
                        <div
                          style={{
                            padding: "14px 18px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <div
                            onClick={() => setExpandedId(expanded ? null : cal.id)}
                            style={{ flex: 1, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                          >
                            <label
                              onClick={(e) => e.stopPropagation()}
                              title="Click to customize calendar color"
                              style={{ position: "relative", cursor: "pointer", display: "inline-flex" }}
                            >
                              <span
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: "50%",
                                  background: cal.color,
                                  border: "2px solid rgba(255,255,255,0.2)",
                                  display: "inline-block",
                                }}
                              />
                              <input
                                type="color"
                                value={cal.color}
                                onChange={(e) => handleColorChange(cal, e.target.value)}
                                style={{
                                  position: "absolute",
                                  opacity: 0,
                                  width: 0,
                                  height: 0,
                                  pointerEvents: "none",
                                }}
                              />
                            </label>

                            <div>
                              <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                                <span>{cal.name}</span>
                                {cal.is_default && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      color: "var(--accent)",
                                      background: "rgba(10, 132, 255, 0.12)",
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                    }}
                                  >
                                    DEFAULT
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2, display: "flex", gap: 10 }}>
                                <span>{cal.writable ? "Writable" : "Read-only"}</span>
                                <span>·</span>
                                <span style={{ color: cal.visible ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                                  {cal.visible ? "Visible in grid" : "Hidden in grid"}
                                </span>
                                <span>·</span>
                                <span style={{ color: cal.blocks_availability ? "var(--success)" : "var(--text-tertiary)" }}>
                                  {cal.blocks_availability ? "Blocks free/busy" : "Does not block"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {/* Primary Visibility quick toggle */}
                            <label
                              className="hoverable"
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: "pointer",
                                padding: "4px 8px",
                                borderRadius: "var(--radius-sm)",
                                background: cal.visible ? "rgba(10, 132, 255, 0.12)" : "rgba(255, 255, 255, 0.05)",
                                color: cal.visible ? "var(--accent)" : "var(--text-secondary)",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={cal.visible}
                                onChange={() => handleToggle(cal, "visible")}
                                style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
                              />
                              <span>Show in Grid</span>
                            </label>

                            <button
                              onClick={() => setExpandedId(expanded ? null : cal.id)}
                              className="hoverable"
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--text-tertiary)",
                                cursor: "pointer",
                                padding: "6px 8px",
                                fontSize: 12,
                                borderRadius: 4,
                              }}
                            >
                              {expanded ? "▲ Hide Settings" : "▼ Settings"}
                            </button>
                          </div>
                        </div>

                        {/* Expanded Clean Settings Sections */}
                        {expanded && (
                          <div
                            style={{
                              borderTop: "1px solid var(--border-subtle)",
                              background: "rgba(0, 0, 0, 0.12)",
                              padding: "16px 20px",
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                              gap: 20,
                            }}
                          >
                            {/* Display & Availability Column */}
                            <div>
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: "var(--text-tertiary)",
                                  textTransform: "uppercase",
                                  letterSpacing: 0.5,
                                  marginBottom: 10,
                                }}
                              >
                                Display & Scheduling
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {DISPLAY_SETTINGS.map(({ key, label, desc }) => (
                                  <label
                                    key={key}
                                    className="hoverable"
                                    style={{
                                      display: "flex",
                                      alignItems: "flex-start",
                                      gap: 10,
                                      padding: "6px 8px",
                                      borderRadius: "var(--radius-sm)",
                                      background: cal[key] ? "rgba(255, 255, 255, 0.04)" : "transparent",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(cal[key])}
                                      onChange={() => handleToggle(cal, key)}
                                      style={{ marginTop: 2, accentColor: "var(--accent)", width: 14, height: 14 }}
                                    />
                                    <div>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                                        {label}
                                      </div>
                                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>
                                        {desc}
                                      </div>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>

                            {/* Delegate & AI Access Column */}
                            <div>
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: "var(--text-tertiary)",
                                  textTransform: "uppercase",
                                  letterSpacing: 0.5,
                                  marginBottom: 10,
                                }}
                              >
                                Delegation & AI Permissions
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {ACCESS_SETTINGS.map(({ key, label, desc }) => (
                                  <label
                                    key={key}
                                    className="hoverable"
                                    style={{
                                      display: "flex",
                                      alignItems: "flex-start",
                                      gap: 10,
                                      padding: "6px 8px",
                                      borderRadius: "var(--radius-sm)",
                                      background: cal[key] ? "rgba(255, 255, 255, 0.04)" : "transparent",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(cal[key])}
                                      onChange={() => handleToggle(cal, key)}
                                      style={{ marginTop: 2, accentColor: "var(--accent)", width: 14, height: 14 }}
                                    />
                                    <div>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                                        {label}
                                      </div>
                                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>
                                        {desc}
                                      </div>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

