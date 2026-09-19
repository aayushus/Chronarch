import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../api/auth";
import Icon from "../components/Icon";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invitedBanner, setInvitedBanner] = useState<string | null>(null);
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const invEmail = params.get("invited_email");
      const tempPass = params.get("temp_pass");
      const rToken = params.get("reset_token");
      if (rToken) {
        setResetToken(rToken);
      }
      if (invEmail) {
        setEmail(invEmail);
        if (tempPass) {
          setPassword(tempPass);
        }
        setInvitedBanner(`Welcome! You've been invited as an Executive Assistant (${invEmail}). Sign in to access delegated calendars.`);
      }
    } catch {
      /* ignore search parse errors */
    }
  }, []);

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotBusy(true);
    try {
      const { apiFetch } = await import("../api/client");
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail }),
      });
      setForgotMsg("If an account exists for that email, a password reset link has been sent.");
    } catch (err) {
      setForgotMsg("If an account exists for that email, a password reset link has been sent.");
    } finally {
      setForgotBusy(false);
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resetToken) return;
    setResetBusy(true);
    setResetError(null);
    try {
      const { apiFetch } = await import("../api/client");
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: resetToken, new_password: newPassword }),
      });
      setResetMsg("Password reset successfully! You can now log in.");
      setResetToken(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setResetError(msg || "Failed to reset password. Token may be expired.");
    } finally {
      setResetBusy(false);
    }
  }


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await login(email, password, rememberMe);
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
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.startsWith("401")
          ? "Invalid email or password."
          : msg.startsWith("403")
          ? "Access denied — ask your administrator for assistance."
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
          width: 880,
          maxWidth: "94vw",
          margin: "auto",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          boxShadow: "var(--shadow-pop)",
          background: "var(--bg-panel)",
          minHeight: 520,
        }}
      >
        {/* Brand panel */}
        <div
          style={{
            flex: "1 1 48%",
            padding: "44px 36px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background:
              "linear-gradient(160deg, rgba(10,132,255,0.18), rgba(94,92,230,0.14) 45%, rgba(0,0,0,0.2) 100%)",
            borderRight: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.svg" alt="Chronarch Logo" width={48} height={48} style={{ borderRadius: 12 }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Chronarch</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Executive Scheduling & Calendar Aggregation</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, margin: "32px 0" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ background: "rgba(10,132,255,0.15)", color: "var(--accent)", padding: 6, borderRadius: 8 }}>
                <Icon name="calendar" size={16} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Unified Multi-Calendar View</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  Aggregate Google Workspace, Microsoft 365, and ICS feeds in real time.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ background: "rgba(94,92,230,0.15)", color: "#5e5ce6", padding: 6, borderRadius: 8 }}>
                <Icon name="shield" size={16} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Granular EA Privacy Matrix</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  Delegate operational access to executive assistants with strict source-of-truth protection.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ background: "rgba(48,209,88,0.15)", color: "#30d158", padding: 6, borderRadius: 8 }}>
                <Icon name="sparkles" size={16} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>AI Scheduling Copilot</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  Embedded LLM drawer & external MCP server integration for intelligent planning.
                </div>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            Self-hosted & Enterprise Privacy Protected
          </div>
        </div>

        {/* Right form panel */}
        <div style={{ flex: "1 1 52%", padding: "44px 36px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>

            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "var(--accent)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 800,
                marginBottom: 12,
              }}
            >
              C
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px 0" }}>Sign in to Chronarch</h1>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>Executive calendar governance & scheduling</p>
          </div>

          {invitedBanner && (
            <div
              style={{
                background: "rgba(10, 132, 255, 0.1)",
                border: "1px solid rgba(10, 132, 255, 0.3)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                fontSize: 12.5,
                color: "var(--accent)",
                marginBottom: 16,
              }}
            >
              {invitedBanner}
            </div>
          )}

          {resetMsg && (
            <div
              style={{
                background: "rgba(48, 209, 88, 0.1)",
                border: "1px solid rgba(48, 209, 88, 0.3)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                fontSize: 12.5,
                color: "var(--success)",
                marginBottom: 16,
              }}
            >
              {resetMsg}
            </div>
          )}

          {resetToken ? (
            <form onSubmit={handleResetSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Reset Your Password</h3>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                New Password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  className="input-standard"
                  style={{ marginTop: 6, width: "100%", fontSize: 14, padding: "10px 12px" }}
                />
              </label>
              {resetError && <div style={{ color: "var(--danger)", fontSize: 12 }}>{resetError}</div>}
              <button type="submit" className="btn-primary" disabled={resetBusy} style={{ padding: "11px 16px", fontSize: 14, fontWeight: 600 }}>
                {resetBusy ? "Updating…" : "Set New Password"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                Email address
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
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Password</span>
                  <button
                    type="button"
                    onClick={() => setForgotModalOpen(true)}
                    style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: 0 }}
                  >
                    Forgot?
                  </button>
                </div>
                <div style={{ position: "relative", marginTop: 6 }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="input-standard"
                    style={{ width: "100%", fontSize: 14, padding: "10px 40px 10px 12px" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "var(--text-tertiary)",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Icon name={showPassword ? "eye-off" : "eye"} size={16} />
                  </button>
                </div>
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
                    padding: "10px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Icon name="alert-triangle" size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 8, padding: "11px 16px", fontSize: 14, fontWeight: 600 }}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}
        </div>
      </div>

      {forgotModalOpen && (
        <div className="cal-modal-wash" onClick={() => setForgotModalOpen(false)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, padding: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px 0" }}>Forgot Password</h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px 0" }}>
              Enter your account email address and we'll send a link to reset your password.
            </p>
            {forgotMsg ? (
              <div style={{ fontSize: 13, color: "var(--success)", background: "rgba(48, 209, 88, 0.1)", padding: 12, borderRadius: 6, marginBottom: 16 }}>
                {forgotMsg}
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="input-standard"
                  style={{ width: "100%", fontSize: 14, padding: "10px 12px" }}
                />
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setForgotModalOpen(false)} className="btn-secondary" style={{ padding: "8px 14px", fontSize: 13 }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={forgotBusy} style={{ padding: "8px 14px", fontSize: 13 }}>
                    {forgotBusy ? "Sending…" : "Send Reset Link"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
