import React, { useEffect, useState } from "react";

import { AISettings, adminClearAISettings, adminGetAISettings, adminSaveAISettings } from "../../api/admin";

export default function AiSettings() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [primary, setPrimary] = useState("");
  const [fallback, setFallback] = useState("");
  const [emergency, setEmergency] = useState("");
  const [strategy, setStrategy] = useState("");
  const [timeout, setTimeout] = useState("");

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
        ...(apiKey ? { openrouter_api_key: apiKey } : {}),
        ...(primary ? { primary_model: primary } : {}),
        ...(fallback ? { fallback_model: fallback } : {}),
        ...(emergency ? { emergency_model: emergency } : {}),
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
    if (!confirm("Reset AI settings to shipped defaults and remove the stored OpenRouter key?")) return;
    setSaving(true);
    try {
      setSettings(await adminClearAISettings());
      setSaved(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>;

  const keyConfigured = settings?.openrouter_key_configured ?? false;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>AI / LiteLLM</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        The built-in copilot routes every model request through a LiteLLM proxy (BRD §20.2), so switching providers
        never touches product logic — ChatGPT/Claude via MCP bypass this entirely and call the same internal tool
        layer directly.
      </p>

      {saved && (
        <div style={{ fontSize: 12, borderRadius: 8, padding: 12, marginBottom: 20, background: "var(--warning)", color: "#1a1200" }}>
          Saved. Restart the litellm service to apply: <code>docker compose restart litellm</code>
        </div>
      )}
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>OpenRouter API key</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 4,
              padding: "2px 6px",
              background: keyConfigured ? "var(--success)" : "var(--bg-app)",
              color: keyConfigured ? "#062611" : "var(--text-tertiary)",
            }}
          >
            {keyConfigured ? "CONFIGURED" : "NOT CONFIGURED"}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 8 }}>
          From openrouter.ai → Keys. Stored encrypted, never displayed back — blank keeps the stored value.
          {!keyConfigured && " Without a key (or OPENROUTER_API_KEY env), model calls fail."}
        </div>
        <input
          placeholder={keyConfigured ? "New key (blank keeps stored key)" : "sk-or-v1-…"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          autoComplete="new-password"
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
        />
      </div>

      <div style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Model routing</div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 8 }}>
          Blank fields keep their current value. Effective values are shown below.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={labelStyle}>
            Primary
            <input placeholder={settings?.primary_model} value={primary} onChange={(e) => setPrimary(e.target.value)} autoComplete="off" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Fallback
            <input placeholder={settings?.fallback_model} value={fallback} onChange={(e) => setFallback(e.target.value)} autoComplete="off" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Emergency fallback
            <input placeholder={settings?.emergency_model} value={emergency} onChange={(e) => setEmergency(e.target.value)} autoComplete="off" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Routing strategy
            <input
              placeholder={settings?.routing_strategy}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              autoComplete="off"
              list="routing-strategies"
              style={inputStyle}
            />
            <datalist id="routing-strategies">
              <option value="simple-shuffle" />
              <option value="latency-based-routing" />
              <option value="least-busy" />
              <option value="usage-based-routing" />
            </datalist>
          </label>
          <label style={labelStyle}>
            Timeout (seconds, 5–300)
            <input
              placeholder={String(settings?.timeout_seconds ?? 30)}
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              style={{ ...inputStyle, maxWidth: 120 }}
            />
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save AI settings"}
        </button>
        <button onClick={handleClear} disabled={saving} className="btn-danger">
          Reset to defaults
        </button>
      </div>

      <div style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 4 }}>
          EFFECTIVE CONFIG {settings && <SourceBadges sources={settings.sources} />}
        </div>
        <Row label="Primary model" value={settings?.primary_model ?? "…"} />
        <Row label="Fallback model" value={settings?.fallback_model ?? "…"} />
        <Row label="Emergency fallback" value={settings?.emergency_model ?? "…"} />
        <Row label="Routing strategy" value={settings?.routing_strategy ?? "…"} />
        <Row label="Timeout" value={`${settings?.timeout_seconds ?? "…"}s`} />
        <Row label="LiteLLM endpoint" value="http://localhost:4000 (docker-internal: litellm:4000)" last />
      </div>

      <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 12 }}>
        Cost limits and per-user quotas (BRD §20.4) aren't wired up yet.
      </p>
    </div>
  );
}

function SourceBadges({ sources }: { sources: Record<string, string> }) {
  const fromDb = Object.values(sources).filter((s) => s === "db").length;
  return (
    <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-tertiary)" }}>
      ({fromDb === 0 ? "all shipped defaults" : `${fromDb} field${fromDb === 1 ? "" : "s"} from UI`})
    </span>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: last ? "none" : "1px solid var(--border-subtle)", fontSize: 13 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <code style={{ fontSize: 12 }}>{value}</code>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 12,
  color: "var(--text-secondary)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--bg-app)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "7px 10px",
  fontSize: 12,
  flex: 1,
  colorScheme: "dark",
};

const btnStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 6,
  color: "#fff",
  padding: "7px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
