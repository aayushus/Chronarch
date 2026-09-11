import React, { useEffect, useState } from "react";

import { AdminCalendar, adminListCalendars, adminUpdateCalendar } from "../../api/admin";

const TOGGLE_FIELDS: { key: keyof AdminCalendar; label: string; hint: string }[] = [
  { key: "visible", label: "Visible", hint: "Show in calendar UI" },
  { key: "blocks_availability", label: "Blocks Availability", hint: "Include in Free/Busy" },
  { key: "is_default", label: "Default Calendar", hint: "Default for event creation" },
  { key: "ea_can_view", label: "EA Can View", hint: "Delegated permission" },
  { key: "ea_can_edit", label: "EA Can Edit", hint: "Delegated permission" },
  { key: "ai_can_read", label: "AI Can Read", hint: "AI permission" },
  { key: "ai_can_write", label: "AI Can Write", hint: "AI permission" },
  { key: "privacy_mask", label: "Privacy Mask", hint: "Hide sensitive details" },
];

export default function CalendarsSettings() {
  const [calendars, setCalendars] = useState<AdminCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    adminListCalendars()
      .then(setCalendars)
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

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Calendars</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        Per-calendar settings (BRD §12) — these control what appears in the calendar UI, what counts toward
        availability, and what the EA and AI can see or do on each calendar.
      </p>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {[...groups.entries()].map(([accountId, group]) => (
        <div key={accountId} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)", marginBottom: 8 }}>
            {group.label} <span style={{ textTransform: "capitalize" }}>({group.provider})</span>
          </div>
          {group.calendars.map((cal) => (
            <div
              key={cal.id}
              style={{
                background: "var(--bg-raised)",
                borderRadius: 10,
                padding: 16,
                marginBottom: 10,
                opacity: savingId === cal.id ? 0.7 : 1,
                transition: "opacity 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="color"
                  value={cal.color}
                  onChange={(e) => handleColorChange(cal, e.target.value)}
                  style={{ width: 24, height: 24, border: "none", background: "none", cursor: "pointer", padding: 0 }}
                />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{cal.name}</span>
                <span
                  style={{
                    fontSize: 10,
                    color: cal.writable ? "var(--success)" : "var(--text-tertiary)",
                    border: `1px solid ${cal.writable ? "var(--success)" : "var(--border)"}`,
                    borderRadius: 4,
                    padding: "1px 6px",
                    marginLeft: "auto",
                  }}
                >
                  {cal.writable ? "Writable (source)" : "Read only (source)"}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {TOGGLE_FIELDS.map(({ key, label, hint }) => (
                  <label
                    key={String(key)}
                    className="hoverable"
                    style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, cursor: "pointer", padding: 6, borderRadius: 6 }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(cal[key])}
                      onChange={() => handleToggle(cal, key)}
                      style={{ marginTop: 2, accentColor: "var(--accent)" }}
                    />
                    <span>
                      <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{label}</div>
                      <div style={{ color: "var(--text-tertiary)" }}>{hint}</div>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {calendars.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
          No calendars connected yet. Connect a Google or Microsoft account to get started.
        </div>
      )}
    </div>
  );
}
