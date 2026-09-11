import React from "react";

export default function SecuritySettings() {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Security</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        How Chronarch protects provider credentials and secrets (BRD §29).
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Card title="OAuth token encryption" status="ok">
          Provider access/refresh tokens are encrypted at rest with envelope encryption (Fernet, keyed by{" "}
          <code>TOKEN_ENCRYPTION_KEY</code>) before ever touching the database.
        </Card>
        <Card title="Secret scrubbing in audit log" status="ok">
          The audit writer strips any field named like a secret (token, api_key, password, etc.) before persisting
          — defense in depth even if a caller forgets to omit it.
        </Card>
        <Card title="MCP credential storage" status="ok">
          MCP API keys are stored as SHA-256 hashes only; the raw key is shown once at creation and never
          retrievable again.
        </Card>
        <Card title="Provider credentials to MCP/copilot" status="ok">
          Neither the MCP server nor the built-in copilot can reach provider OAuth tokens — both only ever call the
          shared internal tool layer, gated by the same permission engine as every other client.
        </Card>
        <Card title="External secret manager support" status="planned">
          Production deployments pulling secrets from AWS/GCP KMS or age/sops instead of a local key isn't wired up
          yet — currently a single local <code>TOKEN_ENCRYPTION_KEY</code> env var.
        </Card>
        <Card title="Two-factor authentication" status="planned">
          Not implemented — login is email + password only for MVP.
        </Card>
      </div>
    </div>
  );
}

function Card({ title, status, children }: { title: string; status: "ok" | "planned"; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14, display: "flex", gap: 12 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: status === "ok" ? "var(--success)" : "var(--text-tertiary)",
          border: `1px solid ${status === "ok" ? "var(--success)" : "var(--border)"}`,
          borderRadius: 4,
          padding: "2px 6px",
          height: "fit-content",
          flexShrink: 0,
        }}
      >
        {status === "ok" ? "ACTIVE" : "PLANNED"}
      </span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{children}</div>
      </div>
    </div>
  );
}
