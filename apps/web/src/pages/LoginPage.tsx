import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../api/auth";
import Icon from "../components/Icon";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await login(email, password, rememberMe);
      navigate("/");
    } catch (err) {
      // apiFetch throws "401 Unauthorized: …" for bad credentials — show a
      // clean message for that, and a distinct one for outages so users
      // don't retry a correct password against a down server.
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.startsWith("401")
          ? "Invalid email or password."
          : "Couldn't reach the server. Check your connection and try again."
      );
      setBusy(false);
    }
  }

  return (
    <div
      className="cal-wash"
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--bg-app)",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      <div
        className="mount-rise"
        style={{
          display: "flex",
          width: 860,
          maxWidth: "94vw",
          margin: "auto",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          boxShadow: "var(--shadow-pop)",
          background: "var(--bg-panel)",
          minHeight: 480,
        }}
      >
        {/* Brand panel */}
        <div
          style={{
            flex: "1 1 46%",
            padding: "40px 36px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 18,
            background:
              "linear-gradient(160deg, rgba(10,132,255,0.22), rgba(94,92,230,0.16) 45%, transparent 75%)",
            borderRight: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.svg" alt="" width={44} height={44} style={{ borderRadius: 11 }} />
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Chronarch</div>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: "var(--text-secondary)" }}>
            One calendar control plane for admins, delegates, and AI agents.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            {[
              { icon: "calendar" as const, text: "Every calendar, one week view" },
              { icon: "users" as const, text: "Delegate safely with scoped access" },
              { icon: "command" as const, text: "ChatGPT, Claude, and copilot ready" },
            ].map((row) => (
              <div key={row.text} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: "rgba(10, 132, 255, 0.14)",
                    color: "var(--accent)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={row.icon} size={14} />
                </span>
                <span>{row.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Form panel */}
        <div style={{ flex: "1 1 54%", padding: "40px 36px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Welcome back</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
            Sign in with your workspace account.
          </div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="you@example.com"
                className="input-standard"
                style={{ marginTop: 6, width: "100%", fontSize: 14, padding: "10px 12px" }}
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="input-standard"
                style={{ marginTop: 6, width: "100%", fontSize: 14, padding: "10px 12px" }}
              />
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-secondary)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
              />
              Remember me for 30 days
            </label>
            {error && (
              <div
                role="alert"
                style={{
                  color: "var(--danger)",
                  background: "rgba(255, 69, 58, 0.1)",
                  border: "1px solid rgba(255, 69, 58, 0.3)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 12.5,
                  padding: "8px 12px",
                }}
              >
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 6, padding: 11, fontSize: 14 }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 18, textAlign: "center" }}>
            Self-hosted and private — your calendars never leave this server.
          </div>
        </div>
      </div>
    </div>
  );
}
