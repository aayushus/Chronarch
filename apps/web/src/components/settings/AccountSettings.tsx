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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  function segmented<T extends string>(options: { value: T; label: string }[], current: T, onPick: (v: T) => void) {
    return (
      <div style={{ display: "inline-flex", background: "var(--bg-app)", border: "1px solid var(--border)", borderRadius: 8, padding: 3, gap: 2 }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onPick(o.value)}
            className="hoverable"
            style={{
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: current === o.value ? "var(--bg-raised-hover)" : "transparent",
              color: current === o.value ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
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
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Theme
            </div>
            {segmented(
              [
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ],
              theme,
              setTheme
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Density
            </div>
            {segmented(
              [
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ],
              density,
              setDensity
            )}
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
        </div>
        <button onClick={handleSaveProfile} disabled={saving} className="btn-primary hoverable" style={{ padding: "7px 16px", fontSize: 12, marginTop: 12 }}>
          {saving ? "Saving…" : "Save profile"}
        </button>
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
