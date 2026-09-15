import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../api/auth";
import { apiFetch, friendlyError } from "../../api/client";
import { useAppearance } from "../../appearance";

const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export default function AccountSettings() {
  const { user, logout } = useAuth();
  const { theme, density, setTheme, setDensity } = useAppearance();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [timezone, setTimezone] = useState(
    user?.home_timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
  );
  const [secondaryTz, setSecondaryTz] = useState(user?.secondary_timezone ?? "");
  const [workDays, setWorkDays] = useState(user?.working_days ?? "1,2,3,4,5");
  const [whStart, setWhStart] = useState((user?.working_hours_start ?? "09:00").slice(0, 5));
  const [whEnd, setWhEnd] = useState((user?.working_hours_end ?? "17:00").slice(0, 5));
  const [minNotice, setMinNotice] = useState(String(user?.min_meeting_notice_minutes ?? 0));
  const [bufferMin, setBufferMin] = useState(String(user?.meeting_buffer_minutes ?? 0));
  const [saving, setSaving] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleWorkDay(num: string) {
    const parts = workDays.split(",").filter(Boolean);
    const next = parts.includes(num) ? parts.filter((p) => p !== num) : [...parts, num];
    setWorkDays(next.sort((a, b) => Number(a) - Number(b)).join(","));
    setPrefsSaved(false);
  }

  async function handleSavePrefs() {
    setSavingPrefs(true);
    setError(null);
    setPrefsSaved(false);
    try {
      await apiFetch("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          secondary_timezone: secondaryTz,
          working_days: workDays || "1,2,3,4,5",
          working_hours_start: whStart,
          working_hours_end: whEnd,
          min_meeting_notice_minutes: Number(minNotice) || 0,
          meeting_buffer_minutes: Number(bufferMin) || 0,
        }),
      });
      setPrefsSaved(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ display_name: displayName.trim() || undefined, home_timezone: timezone }),
      });
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  function handleSignOut() {
    logout();
    navigate("/login");
  }

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Account</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
          Signed in as <strong style={{ color: "var(--text-primary)" }}>{user?.email}</strong>
          {user?.role === "admin" ? " · Administrator" : " · Delegate"}
        </p>
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {saved && (
        <div style={{ fontSize: 13, borderRadius: 8, padding: "10px 14px", marginBottom: 16, background: "rgba(48, 209, 88, 0.12)", border: "1px solid rgba(48, 209, 88, 0.3)" }}>
          Profile saved.
        </div>
      )}

      {/* Appearance */}
      <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Appearance</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
          Theme and density apply instantly and are remembered on this device.
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Theme
            </div>
            <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")} className="input-standard" style={{ width: "100%" }}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Density
            </div>
            <select value={density} onChange={(e) => setDensity(e.target.value as "comfortable" | "compact")} className="input-standard" style={{ width: "100%" }}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
        </div>
      </div>

      {/* Profile */}
      <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Profile</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
          Display name shows across the app; home timezone is the fallback the copilot and agents use when no zone is given.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Display name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input-standard"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Home timezone
            </label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="input-standard" style={{ width: "100%" }}>
              {!COMMON_TIMEZONES.includes(timezone) && <option value={timezone}>{timezone} (current)</option>}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Secondary timezone (optional)
            </label>
            <select
              value={secondaryTz}
              onChange={(e) => setSecondaryTz(e.target.value)}
              className="input-standard"
              style={{ width: "100%" }}
            >
              <option value="">None</option>
              {!COMMON_TIMEZONES.includes(secondaryTz) && secondaryTz && (
                <option value={secondaryTz}>{secondaryTz} (current)</option>
              )}
              {COMMON_TIMEZONES.filter((tz) => tz !== timezone).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button onClick={handleSaveProfile} disabled={saving} className="btn-primary hoverable" style={{ padding: "7px 16px", fontSize: 12, marginTop: 12 }}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>

      {/* Scheduling preferences */}
      <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Scheduling preferences</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
          Drives working-hours shading, free-slot search, and the copilot's sense of your day.
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Working days
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[
            ["1", "M"],
            ["2", "T"],
            ["3", "W"],
            ["4", "T"],
            ["5", "F"],
            ["6", "S"],
            ["7", "S"],
          ].map(([num, letter]) => {
            const on = workDays.split(",").includes(num);
            return (
              <button
                key={num}
                type="button"
                onClick={() => toggleWorkDay(num)}
                className="hoverable"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: on ? "var(--accent)" : "var(--bg-app)",
                  color: on ? "#fff" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {letter}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 140px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Day starts
            </label>
            <input type="time" value={whStart} onChange={(e) => setWhStart(e.target.value)} className="input-standard" style={{ width: "100%" }} />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Day ends
            </label>
            <input type="time" value={whEnd} onChange={(e) => setWhEnd(e.target.value)} className="input-standard" style={{ width: "100%" }} />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Min. notice (min)
            </label>
            <input
              type="number"
              min={0}
              max={10080}
              value={minNotice}
              onChange={(e) => setMinNotice(e.target.value)}
              className="input-standard"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Buffer (min)
            </label>
            <input
              type="number"
              min={0}
              max={480}
              value={bufferMin}
              onChange={(e) => setBufferMin(e.target.value)}
              className="input-standard"
              style={{ width: "100%" }}
            />
          </div>
        </div>
        <button onClick={handleSavePrefs} disabled={savingPrefs} className="btn-primary hoverable" style={{ padding: "7px 16px", fontSize: 12, marginTop: 12 }}>
          {savingPrefs ? "Saving…" : "Save preferences"}
        </button>
        {prefsSaved && (
          <span style={{ fontSize: 12, color: "var(--success)", marginLeft: 10 }}>Saved.</span>
        )}
      </div>

      {/* Sign out */}
      <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Session</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
          Sign out of this device. Other sessions stay active.
        </div>
        <button onClick={handleSignOut} className="btn-danger hoverable" style={{ padding: "7px 16px", fontSize: 12 }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
