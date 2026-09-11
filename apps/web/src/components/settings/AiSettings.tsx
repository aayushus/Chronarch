import React from "react";

export default function AiSettings() {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>AI / LiteLLM</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        The built-in copilot routes every model request through a LiteLLM proxy (BRD §20.2), so switching providers
        never touches product logic — ChatGPT/Claude via MCP bypass this entirely and call the same internal tool
        layer directly.
      </p>

      <div style={{ background: "var(--warning)", color: "#1a1200", fontSize: 12, borderRadius: 8, padding: 12, marginBottom: 20 }}>
        This page is read-only for now — admin-editable model routing, cost limits, and per-user quotas (BRD §20.4)
        aren't wired up yet. Today's config lives in{" "}
        <code style={{ background: "rgba(0,0,0,0.15)", padding: "1px 4px", borderRadius: 3 }}>
          packages/litellm-config/config.yaml
        </code>{" "}
        and deployment env vars.
      </div>

      <div style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 16 }}>
        <Row label="Primary model" value="openrouter/meta-llama/llama-3.1-8b-instruct:free" />
        <Row label="Fallback model" value="openrouter/google/gemma-2-9b-it:free" />
        <Row label="Emergency fallback" value="openrouter/nousresearch/hermes-3-llama-3.1-405b:free" />
        <Row label="Routing strategy" value="simple-shuffle" />
        <Row label="Timeout" value="30s" />
        <Row label="LiteLLM endpoint" value="http://localhost:4000 (docker-internal: litellm:4000)" last />
      </div>
    </div>
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
