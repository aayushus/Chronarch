import React, { useEffect, useState } from "react";
import {
  AISettings,
  adminClearAISettings,
  adminGetAISettings,
  adminSaveAISettings,
} from "../../api/admin";

interface ModelPreset {
  id: string;
  name: string;
  desc: string;
  primary: string;
  fallback: string;
  emergency: string;
}

const PRESETS: ModelPreset[] = [
  {
    id: "free-tier",
    name: "Free Open-Source Tier",
    desc: "Default community models via OpenRouter (zero cost)",
    primary: "openrouter/meta-llama/llama-3.1-8b-instruct:free",
    fallback: "openrouter/google/gemma-2-9b-it:free",
    emergency: "openrouter/nousresearch/hermes-3-llama-3.1-405b:free",
  },
  {
    id: "high-perf",
    name: "High Performance",
    desc: "State of the art reasoning with fast fallbacks",
    primary: "openrouter/anthropic/claude-3.5-sonnet",
    fallback: "openrouter/openai/gpt-4o-mini",
    emergency: "openrouter/meta-llama/llama-3.1-70b-instruct",
  },
  {
    id: "balanced",
    name: "Balanced & Cost-Efficient",
    desc: "Optimized for latency, speed, and low operational cost",
    primary: "openrouter/openai/gpt-4o-mini",
    fallback: "openrouter/meta-llama/llama-3.1-8b-instruct",
    emergency: "openrouter/google/gemma-2-9b-it",
  },
];

export default function AiSettings() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form states
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [primary, setPrimary] = useState("");
  const [fallback, setFallback] = useState("");
  const [emergency, setEmergency] = useState("");
  const [strategy, setStrategy] = useState("");
  const [timeout, setTimeout] = useState("");

  // Advanced toggles
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    adminGetAISettings()
      .then(setSettings)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await adminSaveAISettings({
        ...(apiKey.trim() ? { openrouter_api_key: apiKey.trim() } : {}),
        ...(primary.trim() ? { primary_model: primary.trim() } : {}),
        ...(fallback.trim() ? { fallback_model: fallback.trim() } : {}),
        ...(emergency.trim() ? { emergency_model: emergency.trim() } : {}),
        ...(strategy ? { routing_strategy: strategy } : {}),
        ...(timeout ? { timeout_seconds: Number(timeout) } : {}),
      });
      setSettings(updated);
      setApiKey("");
      setPrimary("");
      setFallback("");
      setEmergency("");
      setStrategy("");
      setTimeout("");
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (
      !confirm(
        "Reset AI routing settings to defaults and remove stored OpenRouter key?"
      )
    )
      return;
    setSaving(true);
    try {
      setSettings(await adminClearAISettings());
      setSaved(false);
      setApiKey("");
      setPrimary("");
      setFallback("");
      setEmergency("");
      setStrategy("");
      setTimeout("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function applyPreset(preset: ModelPreset) {
    setPrimary(preset.primary);
    setFallback(preset.fallback);
    setEmergency(preset.emergency);
  }

  if (loading) {
    return (
      <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>
        Loading AI preferences…
      </div>
    );
  }

  const keyConfigured = settings?.openrouter_key_configured ?? false;
  const dbFieldsCount = settings
    ? Object.values(settings.sources).filter((s) => s === "db").length
    : 0;

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            AI & Copilot
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 12,
              background: keyConfigured ? "rgba(40, 200, 64, 0.15)" : "rgba(255, 159, 10, 0.15)",
              color: keyConfigured ? "var(--success)" : "var(--warning)",
              border: `1px solid ${keyConfigured ? "rgba(40, 200, 64, 0.3)" : "rgba(255, 159, 10, 0.3)"}`,
            }}
          >
            {keyConfigured ? "OpenRouter Connected" : "API Key Required"}
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
          Configure intelligence models powering the in-app calendar copilot and automated task scheduling.
          External AI assistants like Claude Desktop connect independently via MCP.
        </p>
      </div>

      {saved && (
        <div
          style={{
            fontSize: 13,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
            background: "rgba(40, 200, 64, 0.12)",
            border: "1px solid rgba(40, 200, 64, 0.3)",
            color: "var(--text-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>✓ Settings saved successfully. Changes take effect on next model invocation.</span>
          <button
            onClick={() => setSaved(false)}
            style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 13,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
            background: "rgba(255, 69, 58, 0.12)",
            border: "1px solid rgba(255, 69, 58, 0.3)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {/* Card 1: API Key */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              OpenRouter API Key
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              Stored securely with encryption. Used as gateway to access all configured models.
            </div>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 6,
              background: keyConfigured ? "rgba(40, 200, 64, 0.15)" : "var(--bg-app)",
              color: keyConfigured ? "var(--success)" : "var(--text-tertiary)",
              border: `1px solid ${keyConfigured ? "rgba(40, 200, 64, 0.25)" : "var(--border)"}`,
            }}
          >
            {keyConfigured ? "CONFIGURED" : "NOT CONFIGURED"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              placeholder={keyConfigured ? "•••••••••••••••••••••••••••••••• (Key saved — enter new to replace)" : "sk-or-v1-…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type={showApiKey ? "text" : "password"}
              autoComplete="new-password"
              style={{
                width: "100%",
                background: "var(--bg-app)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
                padding: "8px 48px 8px 12px",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
            {apiKey && (
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: 2,
                }}
              >
                {showApiKey ? "Hide" : "Show"}
              </button>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8 }}>
          Need a key? Generate one in{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--primary)", textDecoration: "none" }}
          >
            OpenRouter Dashboard ↗
          </a>
        </div>
      </div>

      {/* Card 2: Model Routing & Tiers */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              Model Tier Routing
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              Hierarchical fallback strategy ensures prompt responses even during provider outages.
            </div>
          </div>
        </div>

        {/* Quick Presets */}
        <div style={{ marginBottom: 18, background: "var(--bg-app)", padding: 12, borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Quick Configuration Presets
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="hoverable"
                style={{
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Primary Model */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                Primary Model
              </label>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>First choice for all requests</span>
            </div>
            <input
              placeholder={settings?.primary_model}
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              autoComplete="off"
              style={fieldInputStyle}
            />
          </div>

          {/* Fallback Model */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                Secondary Fallback Model
              </label>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Used on rate-limit or timeout</span>
            </div>
            <input
              placeholder={settings?.fallback_model}
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              autoComplete="off"
              style={fieldInputStyle}
            />
          </div>

          {/* Emergency Fallback */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                Emergency Fallback Model
              </label>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>High availability safety net</span>
            </div>
            <input
              placeholder={settings?.emergency_model}
              value={emergency}
              onChange={(e) => setEmergency(e.target.value)}
              autoComplete="off"
              style={fieldInputStyle}
            />
          </div>
        </div>

        {/* Collapsible Advanced Parameters */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>{showAdvanced ? "▾ Hide Advanced Parameters" : "▸ Show Advanced Parameters"}</span>
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                  Routing Strategy
                </label>
                <select
                  value={strategy || settings?.routing_strategy || "simple-shuffle"}
                  onChange={(e) => setStrategy(e.target.value)}
                  style={fieldInputStyle}
                >
                  <option value="simple-shuffle">Simple Shuffle (Round Robin)</option>
                  <option value="latency-based-routing">Latency Based Routing</option>
                  <option value="least-busy">Least Busy Connection</option>
                  <option value="usage-based-routing">Usage / Quota Based</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                  Request Timeout (Seconds)
                </label>
                <input
                  placeholder={String(settings?.timeout_seconds ?? 30)}
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                  type="number"
                  min={5}
                  max={300}
                  style={fieldInputStyle}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
          >
            {saving ? "Saving…" : "Save Preferences"}
          </button>
          <button
            onClick={handleClear}
            disabled={saving}
            className="btn-secondary"
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            Reset to Defaults
          </button>
        </div>

        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
          {dbFieldsCount === 0
            ? "Using default configuration"
            : `${dbFieldsCount} custom override${dbFieldsCount === 1 ? "" : "s"} active`}
        </span>
      </div>

      {/* Card 3: Effective Active Configuration (Clean Apple Card) */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Active Effective Configuration
          </div>
          <span
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--bg-app)",
              color: "var(--text-tertiary)",
            }}
          >
            {dbFieldsCount === 0 ? "shipped defaults" : "customized"}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <ConfigRow
            label="Primary Model"
            value={settings?.primary_model ?? "—"}
            source={settings?.sources?.primary_model}
          />
          <ConfigRow
            label="Secondary Fallback"
            value={settings?.fallback_model ?? "—"}
            source={settings?.sources?.fallback_model}
          />
          <ConfigRow
            label="Emergency Fallback"
            value={settings?.emergency_model ?? "—"}
            source={settings?.sources?.emergency_model}
          />
          <ConfigRow
            label="Routing Strategy"
            value={settings?.routing_strategy ?? "—"}
            source={settings?.sources?.routing_strategy}
          />
          <ConfigRow
            label="Request Timeout"
            value={`${settings?.timeout_seconds ?? 30}s`}
            source={settings?.sources?.timeout_seconds}
            last
          />
        </div>
      </div>
    </div>
  );
}

function ConfigRow({
  label,
  value,
  source,
  last,
}: {
  label: string;
  value: string;
  source?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: last ? "none" : "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
        {source === "db" && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 4px",
              borderRadius: 3,
              background: "rgba(10, 132, 255, 0.15)",
              color: "var(--primary)",
            }}
          >
            CUSTOM
          </span>
        )}
      </div>
      <code
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
          background: "var(--bg-app)",
          padding: "3px 8px",
          borderRadius: 6,
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {value}
      </code>
    </div>
  );
}

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-app)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  padding: "8px 12px",
  fontSize: 13,
  boxSizing: "border-box",
  colorScheme: "dark",
};
