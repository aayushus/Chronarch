import React, { useEffect, useState } from "react";

interface CheckResult {
  label: string;
  detail: string;
  url: string;
  status: "checking" | "ok" | "down";
  latencyMs: number | null;
}

function targetOrigin(port: number): string {
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

const CHECKS: { label: string; detail: string; url: string }[] = [
  { label: "API", detail: "liveness (/healthz)", url: `${targetOrigin(8000)}/healthz` },
  { label: "API", detail: "readiness incl. database (/readyz)", url: `${targetOrigin(8000)}/readyz` },
  { label: "MCP Server", detail: "liveness (/healthz)", url: `${targetOrigin(8001)}/healthz` },
  { label: "LiteLLM Proxy", detail: "liveness (/health/liveliness)", url: `${targetOrigin(4000)}/health/liveliness` },
];

export default function SystemSettings() {
  const [results, setResults] = useState<CheckResult[]>(CHECKS.map((c) => ({ ...c, status: "checking", latencyMs: null })));
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  async function runChecks() {
    setResults((prev) => prev.map((r) => ({ ...r, status: "checking" })));
    const updated = await Promise.all(
      CHECKS.map(async (check) => {
        const start = performance.now();
        try {
          const res = await fetch(check.url, { method: "GET" });
          const latencyMs = Math.round(performance.now() - start);
          return { ...check, status: res.ok ? "ok" : "down", latencyMs } as CheckResult;
        } catch {
          return { ...check, status: "down", latencyMs: null } as CheckResult;
        }
      })
    );
    setResults(updated);
    setLastChecked(new Date());
  }

  useEffect(() => {
    runChecks();
  }, []);

  const allOk = results.every((r) => r.status === "ok");
  const anyChecking = results.some((r) => r.status === "checking");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>System</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
            Live health status of each service, checked directly from your browser against its exposed port.
          </p>
        </div>
        <button onClick={runChecks} className="hoverable" style={btnStyle}>
          Refresh
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--bg-raised)",
          borderRadius: 10,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <StatusDot status={anyChecking ? "checking" : allOk ? "ok" : "down"} size={12} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {anyChecking ? "Checking…" : allOk ? "All systems operational" : "One or more services are unreachable"}
        </span>
        {lastChecked && (
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
            Last checked {lastChecked.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {results.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--bg-raised)",
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <StatusDot status={r.status} size={9} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.detail}</div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.url}</div>
            {r.latencyMs !== null && (
              <div className="tabular-nums" style={{ fontSize: 11, color: "var(--text-secondary)", width: 50, textAlign: "right" }}>
                {r.latencyMs}ms
              </div>
            )}
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        Redis, the worker, and the scheduler don't expose an HTTP health endpoint yet, so they aren't checked here —
        API readiness above covers database connectivity, which is the main dependency shared across services.
      </p>
    </div>
  );
}

function StatusDot({ status, size }: { status: "checking" | "ok" | "down"; size: number }) {
  const color = status === "ok" ? "var(--success)" : status === "down" ? "var(--danger)" : "var(--text-tertiary)";
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        boxShadow: status === "ok" ? `0 0 6px ${color}` : "none",
      }}
    />
  );
}

const btnStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 6,
  color: "#fff",
  background: "var(--accent)",
  padding: "7px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
