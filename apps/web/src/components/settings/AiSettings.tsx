import React, { useEffect, useState } from "react";
import { friendlyError } from "../../api/client";
import { useAuth } from "../../api/auth";
import {
  AISettings,
  adminClearAISettings,
  adminGetAISettings,
  adminListProviderModels,
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
    name: "Free Multi-Provider Tier",
    desc: "Groq → Gemini → OpenRouter fallback chain (zero cost)",
    primary: "groq/openai/gpt-oss-20b",
    fallback: "gemini/gemini-2.5-flash",
    emergency: "openrouter/nvidia/nemotron-3.5-lightning:free",
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

const MODEL_CATALOG: Record<string, { id: string; label: string }[]> = {
  groq: [
    { id: "groq/openai/gpt-oss-20b", label: "GPT-OSS 20B (fast, 1K/day free)" },
    { id: "groq/openai/gpt-oss-120b", label: "GPT-OSS 120B (stronger, 1K/day free)" },
    { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { id: "groq/llama-3.1-8b-instant", label: "Llama 3.1 8B (fastest)" },
    { id: "groq/qwen/qwen3-32b", label: "Qwen3 32B" },
  ],
  gemini: [
    { id: "gemini/gemini-2.5-flash", label: "Gemini 2.5 Flash (~1.5K/day free)" },
    { id: "gemini/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    { id: "gemini/gemini-2.5-pro", label: "Gemini 2.5 Pro (tight free limits)" },
  ],
  openrouter: [
    { id: "openrouter/nvidia/nemotron-3.5-lightning:free", label: "Nemotron Lightning (free)" },
    { id: "openrouter/google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)" },
    { id: "openrouter/liquid/lfm-2.5-2.6b:free", label: "Liquid 2.5 (free)" },
  ],
};

const PROVIDERS = [
  { id: "groq", label: "Groq" },
  { id: "gemini", label: "Gemini" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "custom", label: "Custom…" },
];

/** Split a stored model id into provider + remainder for the dropdowns. */
function parseModelId(value: string): { provider: string; model: string } {
  const v = (value || "").trim();
  for (const p of ["groq", "gemini", "openrouter"]) {
    if (v === p || v.startsWith(p + "/")) return { provider: p, model: v };
  }
  return { provider: "custom", model: v };
}

function TierModelField({
  label,
  hint,
  effective,
  draft,
  onChange,
  liveCatalog,
}: {
  label: string;
  hint: string;
  effective: string | undefined;
  draft: string;
  onChange: (fullId: string) => void;
  liveCatalog: Record<string, { id: string; label: string }[]>;
}) {
  // What the field shows: unsaved draft wins, else the active value.
  const shown = draft || effective || "";
  const { provider, model } = parseModelId(shown);
  // Live provider catalog wins when fetched; curated fallback otherwise.
  const catalogFor = (p: string) =>
    liveCatalog[p]?.length ? liveCatalog[p] : MODEL_CATALOG[p] ?? [];
  const options = catalogFor(provider);
  const inList = options.some((o) => o.id === model);
  const customMode = provider === "custom" || (model !== "" && !inList);

  function pickProvider(next: string) {
    if (next === "custom") {
      onChange(shown.startsWith("custom/") ? shown : model || effective || "");
      return;
    }
    const first = catalogFor(next)[0]?.id;
    if (first) onChange(first);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
          {label}
        </label>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{hint}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={customMode ? "custom" : provider}
          onChange={(e) => pickProvider(e.target.value)}
          className="input-standard"
          style={{ flex: "0 0 150px", fontSize: 12 }}
          aria-label={`${label} provider`}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {customMode ? (
          <input
            placeholder="provider/model-id"
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            className="input-standard"
            style={{ flex: 1, fontSize: 12 }}
          />
        ) : (
          <select
            value={inList ? model : ""}
            onChange={(e) => onChange(e.target.value)}
            className="input-standard"
            style={{ flex: 1, fontSize: 12 }}
            aria-label={`${label} model`}
          >
            {!inList && <option value="">{model || effective}</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {!draft && effective && (
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
          Active: <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{effective}</code>
        </div>
      )}
    </div>
  );
}

export default function AiSettings() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || (user?.permissions ?? []).includes("ai.manage");
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form states — one key input per provider (free tiers are independent)
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [primary, setPrimary] = useState("");
  const [fallback, setFallback] = useState("");
  const [emergency, setEmergency] = useState("");
  const [strategy, setStrategy] = useState("");
  const [timeout, setTimeout] = useState("");

  // Advanced toggles
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Live provider catalogs (fetched with stored keys; curated fallback).
  const [liveCatalog, setLiveCatalog] = useState<Record<string, { id: string; label: string }[]>>({});
  const [liveNote, setLiveNote] = useState<string | null>(null);

  useEffect(() => {
    adminGetAISettings()
      .then(setSettings)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
    Promise.all(
      ["groq", "gemini", "openrouter"].map((p) =>
        adminListProviderModels(p)
          .then((r) => ({ p, models: r.models }))
          .catch(() => ({ p, models: [] as { id: string; label: string }[] }))
      )
    ).then((rows) => {
      const live: Record<string, { id: string; label: string }[]> = {};
      for (const row of rows) {
        if (row.models.length > 0) live[row.p] = row.models;
      }
      setLiveCatalog(live);
      const n = Object.keys(live).length;
      setLiveNote(n === 3 ? "Live model lists loaded from all 3 providers." : n === 0 ? null : `Live model lists loaded (${Object.keys(live).join(", ")}); rest use the curated fallback.`);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await adminSaveAISettings({
        ...(groqKey.trim() ? { groq_api_key: groqKey.trim() } : {}),
        ...(geminiKey.trim() ? { gemini_api_key: geminiKey.trim() } : {}),
        ...(apiKey.trim() ? { openrouter_api_key: apiKey.trim() } : {}),
        ...(primary.trim() ? { primary_model: primary.trim() } : {}),
        ...(fallback.trim() ? { fallback_model: fallback.trim() } : {}),
        ...(emergency.trim() ? { emergency_model: emergency.trim() } : {}),
        ...(strategy ? { routing_strategy: strategy } : {}),
        ...(timeout ? { timeout_seconds: Number(timeout) } : {}),
      });
      setSettings(updated);
      setGroqKey("");
      setGeminiKey("");
      setApiKey("");
      setPrimary("");
      setFallback("");
      setEmergency("");
      setStrategy("");
      setTimeout("");
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (
      !confirm(
        "Reset AI routing settings to defaults and remove all stored provider keys?"
      )
    )
      return;
    setSaving(true);
    try {
      setSettings(await adminClearAISettings());
      setSaved(false);
      setGroqKey("");
      setGeminiKey("");
      setApiKey("");
      setPrimary("");
      setFallback("");
      setEmergency("");
      setStrategy("");
      setTimeout("");
    } catch (e) {
      setError(friendlyError(e));
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

  const anyKeyConfigured =
    (settings?.openrouter_key_configured ?? false) ||
    (settings?.groq_key_configured ?? false) ||
    (settings?.gemini_key_configured ?? false);
  const keyCheckUnknown =
    saved &&
    (settings?.key_check === "unknown" ||
      (typeof settings?.key_check === "object" &&
        settings?.key_check !== null &&
        Object.values(settings.key_check).includes("unknown")));
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
              background: anyKeyConfigured ? "rgba(40, 200, 64, 0.15)" : "rgba(255, 159, 10, 0.15)",
              color: anyKeyConfigured ? "var(--success)" : "var(--warning)",
              border: `1px solid ${anyKeyConfigured ? "rgba(40, 200, 64, 0.3)" : "rgba(255, 159, 10, 0.3)"}`,
            }}
          >
            {anyKeyConfigured ? "AI Connected" : "API Key Required"}
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
          Configure intelligence models powering the in-app calendar copilot and smart scheduling assistance.
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
          <span>✓ Settings saved successfully. Applies automatically within a few seconds — no restart needed.</span>
          <button
            onClick={() => setSaved(false)}
            style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      {keyCheckUnknown && (
        <div
          style={{
            fontSize: 13,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
            background: "rgba(255, 159, 10, 0.12)",
            border: "1px solid rgba(255, 159, 10, 0.3)",
            color: "var(--warning)",
          }}
        >
          Saved, but OpenRouter couldn't be reached to verify the key (network issue?).
          If the copilot reports an error, double-check the key and save again.
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

      {/* Card 1: Provider API Keys (independent free tiers, fallback across them) */}
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
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            Provider API Keys
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            Stored securely with encryption. Add any — the copilot falls back across
            providers when one runs out. Groq and Gemini need no credit card.
          </div>
        </div>

        <ProviderKeyRow
          title="Groq"
          hint="Fast open-weights models · ~14k requests/day free · console.groq.com → API Keys · starts with gsk_"
          dashboardUrl="https://console.groq.com/keys"
          dashboardLabel="Groq Console ↗"
          placeholder="gsk_…"
          configured={settings?.groq_key_configured ?? false}
          value={groqKey}
          onChange={setGroqKey}
          show={showKeys}
          onToggleShow={() => setShowKeys(!showKeys)}
        />
        <ProviderKeyRow
          title="Gemini (Google AI Studio)"
          hint="Quality frontier model · ~1.5k requests/day free · aistudio.google.com → Get API Key"
          dashboardUrl="https://aistudio.google.com/apikey"
          dashboardLabel="Google AI Studio ↗"
          placeholder="AIza…"
          configured={settings?.gemini_key_configured ?? false}
          value={geminiKey}
          onChange={setGeminiKey}
          show={showKeys}
          onToggleShow={() => setShowKeys(!showKeys)}
        />
        <ProviderKeyRow
          title="OpenRouter"
          hint="Aggregator safety net · 50 requests/day free · openrouter.ai → Keys · starts with sk-or-v1-"
          dashboardUrl="https://openrouter.ai/keys"
          dashboardLabel="OpenRouter Dashboard ↗"
          placeholder="sk-or-v1-…"
          configured={settings?.openrouter_key_configured ?? false}
          value={apiKey}
          onChange={setApiKey}
          show={showKeys}
          onToggleShow={() => setShowKeys(!showKeys)}
          last
        />
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
            {liveNote && (
              <div style={{ fontSize: 11, color: "var(--success)", marginTop: 4 }}>
                ✓ {liveNote}
              </div>
            )}
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
          <TierModelField
            label="Primary Model"
            hint="First choice for all requests"
            effective={settings?.primary_model}
            draft={primary}
            onChange={setPrimary}
            liveCatalog={liveCatalog}
          />

          {/* Fallback Model */}
          <TierModelField
            label="Secondary Fallback Model"
            hint="Used on rate-limit or timeout"
            effective={settings?.fallback_model}
            draft={fallback}
            onChange={setFallback}
            liveCatalog={liveCatalog}
          />

          {/* Emergency Fallback */}
          <TierModelField
            label="Emergency Fallback Model"
            hint="High availability safety net"
            effective={settings?.emergency_model}
            draft={emergency}
            onChange={setEmergency}
            liveCatalog={liveCatalog}
          />
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
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={handleSave}
            disabled={saving || !canManage}
            title={canManage ? undefined : "Read-only — you have ai.view but not ai.manage"}
            className="btn-primary"
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
          >
            {saving ? "Saving…" : "Save Preferences"}
          </button>
          <button
            onClick={handleClear}
            disabled={saving || !canManage}
            className="btn-secondary"
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            Reset to Defaults
          </button>
          {!canManage && (
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              Read-only — ask an admin to change these.
            </span>
          )}
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

function ProviderKeyRow({
  title,
  hint,
  dashboardUrl,
  dashboardLabel,
  placeholder,
  configured,
  value,
  onChange,
  show,
  onToggleShow,
  last,
}: {
  title: string;
  hint: string;
  dashboardUrl: string;
  dashboardLabel: string;
  placeholder: string;
  configured: boolean;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  last?: boolean;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border-subtle)",
        paddingTop: 14,
        marginTop: 14,
        ...(last ? { marginBottom: 0 } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            padding: "2px 6px",
            borderRadius: 4,
            background: configured ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 255, 255, 0.08)",
            color: configured ? "var(--success)" : "var(--text-tertiary)",
          }}
        >
          {configured ? "CONFIGURED" : "NOT CONFIGURED"}
        </span>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "0 0 10px" }}>{hint}</p>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            type={show ? "text" : "password"}
            placeholder={configured ? "•••••••• (saved — enter new to replace)" : placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="new-password"
            className="input-standard"
            style={{ width: "100%", paddingRight: 48 }}
          />
          {value && (
            <button
              type="button"
              onClick={onToggleShow}
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
              {show ? "Hide" : "Show"}
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8 }}>
        Need a key? Generate one in{" "}
        <a href={dashboardUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", textDecoration: "none" }}>
          {dashboardLabel}
        </a>
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
