import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch } from "../api/client";
import { useAuth } from "../api/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupAllowed, setSignupAllowed] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ allowed: boolean }>("/auth/signup-status")
      .then((res) => setSignupAllowed(res.allowed))
      .catch(() => {
        /* server unreachable — login form still works */
      });
  }, []);

  function switchMode(next: "login" | "signup") {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await apiFetch("/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, display_name: name.trim(), password }),
        });
      }
      await login(email, password, rememberMe);
      // Fresh workspace? Land directly in the setup wizard instead of an
      // empty calendar. Delegates (403 here) and connected workspaces go home.
      try {
        const { adminListAccounts } = await import("../api/admin");
        const accounts = await adminListAccounts();
        let onboarded = false;
        try {
          onboarded = localStorage.getItem("chronarch_onboarded") === "1";
        } catch {
          /* private mode */
        }
        navigate(accounts.length === 0 && !onboarded ? "/start" : "/");
      } catch {
        navigate("/");
      }
    } catch (err) {
      // apiFetch throws "401 Unauthorized: …" for bad credentials — show a
      // clean message for that, and a distinct one for outages so users
      // don't retry a correct password against a down server.
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.startsWith("401")
          ? "Invalid email or password."
          : msg.startsWith("403")
          ? "Public signup is disabled on this server — ask your admin for an account."
          : msg.startsWith("409")
          ? "An account with that email already exists — sign in instead."
          : msg.startsWith("422")
          ? "Check the form — names can't be blank and passwords need 8+ characters."
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
            alignItems: "center",
            gap: 14,
            background:
              "linear-gradient(160deg, rgba(10,132,255,0.22), rgba(94,92,230,0.16) 45%, transparent 75%)",
            borderRight: "1px solid var(--border-subtle)",
          }}
        >
          <img src="/logo.svg" alt="" width={64} height={64} style={{ borderRadius: 16 }} />
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>Chronarch</div>
        </div>

        {/* Form panel */}
        <div style={{ flex: "1 1 54%", padding: "40px 36px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
            {mode === "signup"
              ? "Create an account to get started."
              : "Sign in with your account."}
          </div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mode === "signup" && (
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  placeholder="Your name"
                  className="input-standard"
                  style={{ marginTop: 6, width: "100%", fontSize: 14, padding: "10px 12px" }}
                />
              </label>
            )}
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
              {busy ? (mode === "signup" ? "Creating…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
          {signupAllowed && (
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 14, textAlign: "center" }}>
              {mode === "signup" ? (
                <>Have an account? <button onClick={() => switchMode("login")} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 }}>Sign in</button></>
              ) : (
                <>New here? <button onClick={() => switchMode("signup")} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 }}>Create an account</button></>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
