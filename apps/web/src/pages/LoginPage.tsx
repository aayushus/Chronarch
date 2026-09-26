import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../api/auth";
import { apiFetch } from "../api/client";
import { adminListAccounts } from "../api/admin";
import Icon from "../components/Icon";

export default function LoginPage() {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invitedBanner, setInvitedBanner] = useState<string | null>(null);
  const [authView, setAuthView] = useState<"signin" | "signup" | "forgot" | "reset">("signin");
  const [allowSignups, setAllowSignups] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  React.useEffect(() => {
    // Check if public registration is enabled on this server
    apiFetch<{ allowed: boolean }>("/auth/signup-status")
      .then((res) => {
        if (res?.allowed) {
          setAllowSignups(true);
        }
      })
      .catch(() => {
        /* ignore */
      });


    try {
      const params = new URLSearchParams(window.location.search);
      const invEmail = params.get("invited_email");
      const tempPass = params.get("temp_pass");
      const rToken = params.get("reset_token");
      if (rToken) {
        setResetToken(rToken);
        setAuthView("reset");
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
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail || email }),
      });
      setForgotMsg("If an account exists for that email, a password reset link has been sent.");
    } catch {
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


  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!displayName.trim()) {
      setError("Please enter your display name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await signup(email, displayName.trim(), password);
      try {
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
        msg.startsWith("409")
          ? "A user with that email already exists."
          : msg.startsWith("403")
          ? "Public registration is disabled on this server."
          : msg.startsWith("422")
          ? "Please check that your email, name, and password (at least 8 chars) are valid."
          : "Couldn't reach the server. Check your connection and try again."
      );
      setBusy(false);
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
        className="mount-rise login-shell"
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
            <img src="/logo.svg" alt="Chronarch Logo" width={48} height={48} style={{ borderRadius: "var(--radius-xl)" }} />
            <div>
              <div style={{ fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "-0.02em" }}>Chronarch</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>Unified Calendar & Scheduling</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, margin: "32px 0" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ background: "rgba(10,132,255,0.15)", color: "var(--accent)", padding: 6, borderRadius: "var(--radius-md)" }}>
                <Icon name="calendar" size={16} />
              </div>
              <div>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>Unified Multi-Calendar View</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                  Connect Google Workspace, Microsoft 365, and ICS feeds in real time.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ background: "rgba(94,92,230,0.15)", color: "#5e5ce6", padding: 6, borderRadius: "var(--radius-md)" }}>
                <Icon name="shield" size={16} />
              </div>
              <div>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>Delegate Access & Privacy Controls</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                  Share scheduling permissions with assistants while protecting private event details.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ background: "rgba(48,209,88,0.15)", color: "var(--success)", padding: 6, borderRadius: "var(--radius-md)" }}>
                <Icon name="sparkles" size={16} />
              </div>
              <div>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>AI Scheduling Assistant</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                  Query availability and schedule meetings with your own preferred models or MCP tools.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right form panel */}
        <div style={{ flex: "1 1 52%", padding: "44px 36px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "var(--radius-xl)",
                background: "var(--accent)",
                color: "var(--text-on-fill)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-2xl)",
                fontWeight: 800,
                marginBottom: 12,
              }}
            >
              C
            </div>
            <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, margin: "0 0 6px 0" }}>
              {authView === "forgot"
                ? "Reset Password"
                : authView === "reset"
                ? "Set New Password"
                : authView === "signup"
                ? "Create Account"
                : "Sign in to Chronarch"}
            </h1>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-tertiary)", margin: 0 }}>
              {authView === "forgot"
                ? "Enter your account email to receive a password reset link"
                : authView === "reset"
                ? "Enter and confirm your new account password"
                : authView === "signup"
                ? "Create your account to get started"
                : "Unified calendar aggregation & scheduling"}
            </p>
          </div>

          {allowSignups && (authView === "signin" || authView === "signup") && (
            <div
              style={{
                display: "flex",
                background: "var(--bg-subtle, rgba(255,255,255,0.06))",
                borderRadius: "var(--radius-md, 8px)",
                padding: 3,
                marginBottom: 20,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAuthView("signin");
                }}
                style={{
                  flex: 1,
                  padding: "7px 12px",
                  fontSize: "var(--text-md)",
                  fontWeight: authView === "signin" ? 600 : 500,
                  border: "none",
                  borderRadius: "var(--radius-sm, 6px)",
                  background: authView === "signin" ? "var(--accent)" : "transparent",
                  color: authView === "signin" ? "var(--text-on-fill)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "background var(--transition-fast), color var(--transition-fast)",
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAuthView("signup");
                }}
                style={{
                  flex: 1,
                  padding: "7px 12px",
                  fontSize: "var(--text-md)",
                  fontWeight: authView === "signup" ? 600 : 500,
                  border: "none",
                  borderRadius: "var(--radius-sm, 6px)",
                  background: authView === "signup" ? "var(--accent)" : "transparent",
                  color: authView === "signup" ? "var(--text-on-fill)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "background var(--transition-fast), color var(--transition-fast)",
                }}
              >
                Create account
              </button>
            </div>
          )}

          {invitedBanner && (
            <div
              style={{
                background: "rgba(10, 132, 255, 0.1)",
                border: "1px solid rgba(10, 132, 255, 0.3)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                fontSize: "var(--text-sm)",
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
                fontSize: "var(--text-sm)",
                color: "var(--success)",
                marginBottom: 16,
              }}
            >
              {resetMsg}
            </div>
          )}

          {authView === "reset" ? (
            <form onSubmit={handleResetSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                New Password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  className="input-standard"
                  style={{ marginTop: 6, width: "100%", fontSize: "var(--text-md)", padding: "10px 12px" }}
                />
              </label>
              {resetError && <div style={{ color: "var(--danger)", fontSize: "var(--text-sm)" }}>{resetError}</div>}
              <button type="submit" className="btn-primary" disabled={resetBusy} style={{ padding: "11px 16px", fontSize: "var(--text-md)", fontWeight: 600 }}>
                {resetBusy ? "Updating…" : "Set New Password"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthView("signin");
                  setResetToken(null);
                }}
                className="btn-secondary"
                style={{ padding: "10px 16px", fontSize: "var(--text-md)" }}
              >
                Back to sign in
              </button>
            </form>
          ) : authView === "forgot" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {forgotMsg ? (
                <div
                  style={{
                    fontSize: "var(--text-md)",
                    color: "var(--success)",
                    background: "rgba(48, 209, 88, 0.1)",
                    border: "1px solid rgba(48, 209, 88, 0.3)",
                    padding: 12,
                    borderRadius: "var(--radius-sm)",
                    lineHeight: 1.5,
                  }}
                >
                  {forgotMsg}
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                    Account email
                    <input
                      type="email"
                      value={forgotEmail || email}
                      onChange={(e) => {
                        setForgotEmail(e.target.value);
                        if (!email) setEmail(e.target.value);
                      }}
                      required
                      placeholder="you@example.com"
                      className="input-standard"
                      style={{ marginTop: 6, width: "100%", fontSize: "var(--text-md)", padding: "10px 12px" }}
                    />
                  </label>
                  <button type="submit" className="btn-primary" disabled={forgotBusy} style={{ marginTop: 4, padding: "11px 16px", fontSize: "var(--text-md)", fontWeight: 600 }}>
                    {forgotBusy ? "Sending link…" : "Send Reset Link"}
                  </button>
                </form>
              )}
              <button
                type="button"
                onClick={() => {
                  setAuthView("signin");
                  setForgotMsg(null);
                }}
                className="btn-secondary"
                style={{ padding: "10px 16px", fontSize: "var(--text-md)" }}
              >
                Back to sign in
              </button>
            </div>
          ) : authView === "signup" ? (
            <form onSubmit={handleSignupSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                Full name
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  className="input-standard"
                  style={{ marginTop: 6, width: "100%", fontSize: "var(--text-md)", padding: "10px 12px" }}
                />
              </label>

              <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="you@example.com"
                  className="input-standard"
                  style={{ marginTop: 6, width: "100%", fontSize: "var(--text-md)", padding: "10px 12px" }}
                />
              </label>

              <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", position: "relative" }}>
                <span>Password (minimum 8 characters)</span>
                <div style={{ position: "relative", marginTop: 6 }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="input-standard"
                    style={{ width: "100%", fontSize: "var(--text-md)", padding: "10px 40px 10px 12px" }}
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

              <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                Confirm password
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="input-standard"
                  style={{ marginTop: 6, width: "100%", fontSize: "var(--text-md)", padding: "10px 12px" }}
                />
              </label>

              {error && (
                <div
                  role="alert"
                  style={{
                    color: "var(--danger)",
                    background: "rgba(255, 69, 58, 0.1)",
                    border: "1px solid rgba(255, 69, 58, 0.3)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "var(--text-sm)",
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

              <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 8, padding: "11px 16px", fontSize: "var(--text-md)", fontWeight: 600 }}>
                {busy ? "Creating account…" : "Create account"}
              </button>

              <div style={{ textAlign: "center", marginTop: 8, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setAuthView("signin");
                  }}
                  style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "var(--text-md)", fontWeight: 600, cursor: "pointer", padding: 0 }}
                >
                  Sign in
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="you@example.com"
                  className="input-standard"
                  style={{ marginTop: 6, width: "100%", fontSize: "var(--text-md)", padding: "10px 12px" }}
                />
              </label>
              <label style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Password</span>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(email);
                      setForgotMsg(null);
                      setAuthView("forgot");
                    }}
                    style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "var(--text-sm)", cursor: "pointer", padding: 0 }}
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
                    style={{ width: "100%", fontSize: "var(--text-md)", padding: "10px 40px 10px 12px" }}
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
                  fontSize: "var(--text-md)",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input className="checkbox"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
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
                    fontSize: "var(--text-sm)",
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

              <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 8, padding: "11px 16px", fontSize: "var(--text-md)", fontWeight: 600 }}>
                {busy ? "Signing in…" : "Sign in"}
              </button>

              {allowSignups && (
                <div style={{ textAlign: "center", marginTop: 8, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setAuthView("signup");
                    }}
                    style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "var(--text-md)", fontWeight: 600, cursor: "pointer", padding: 0 }}
                  >
                    Sign up
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
