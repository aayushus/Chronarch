import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch, friendlyError } from "../api/client";
import { useAuth } from "../api/auth";
import {
  adminCreateUser,
  adminGetGoogleConnectUrl,
  adminGetMicrosoftConnectUrl,
  adminListAccounts,
  adminListOAuthConfigs,
  adminSaveOAuthConfig,
} from "../api/admin";
import Icon from "../components/Icon";
import { Badge } from "../components/ui";
import {
  ONBOARD_DONE_KEY,
  ONBOARD_STEP_KEY,
  STEPS,
  canProceed,
  clearFlag,
  providerStatus,
  readFlag,
  stepIndex,
  writeFlag,
  type OAuthStatus,
  type OnboardStep,
} from "../lib/onboarding";

const TIMEZONES = [
  "America/Edmonton", "America/Vancouver", "America/Toronto", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "America/New_York", "Europe/London",
  "Europe/Berlin", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function tempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** First-run wizard (/start): welcome → connect → you → share → done.
 * Skippable at every step; delegates never enter (nothing to connect). */
export default function StartPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardStep>(() => {
    try {
      return STEPS[stepIndex(localStorage.getItem(ONBOARD_STEP_KEY))] as OnboardStep;
    } catch {
      return "welcome";
    }
  });
  const [accountCount, setAccountCount] = useState(0);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Connect step: provider credential readiness (inline setup, no Settings trip).
  const [oauthConfigs, setOauthConfigs] = useState<OAuthStatus[] | null>(null);
  const [credsFor, setCredsFor] = useState<"google" | "microsoft" | null>(null);
  const [credId, setCredId] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const [credTenant, setCredTenant] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);

  // Step 3: profile.
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [timezone, setTimezone] = useState(user?.home_timezone || browserZone());
  const [whStart, setWhStart] = useState("09:00");
  const [whEnd, setWhEnd] = useState("17:00");
  const [saving, setSaving] = useState(false);

  // Step 4: EA invite.
  const [eaName, setEaName] = useState("");
  const [eaEmail, setEaEmail] = useState("");
  const [eaPassword, setEaPassword] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(ONBOARD_STEP_KEY, String(stepIndex(step)));
    } catch {
      /* private mode */
    }
  }, [step]);

  async function refreshAccounts() {
    setChecking(true);
    setError(null);
    try {
      const [accounts, oauth] = await Promise.all([
        adminListAccounts(),
        adminListOAuthConfigs().catch(() => null),
      ]);
      setAccountCount(accounts.length);
      setOauthConfigs(oauth);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refreshAccounts();
    // OAuth round-trips leave the tab: re-check whenever it regains focus
    // so newly connected accounts appear with no manual refresh button.
    function onFocus() {
      if (document.visibilityState === "visible") void refreshAccounts();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user && !displayName) setDisplayName(user.display_name ?? "");
    if (user?.home_timezone) setTimezone(user.home_timezone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  function finish() {
    writeFlag(ONBOARD_DONE_KEY);
    clearFlag(ONBOARD_STEP_KEY);
    window.location.href = "/";
  }

  function skipAll() {
    finish();
  }

  async function connectProvider(kind: "google" | "microsoft") {
    setError(null);
    try {
      // Full-page OAuth round-trip: persist the step, resume after the
      // callback lands back in Settings (see AccountsSettings banner).
      try {
        localStorage.setItem(ONBOARD_STEP_KEY, String(stepIndex("connect")));
      } catch {
        /* private mode */
      }
      const url = kind === "google" ? await adminGetGoogleConnectUrl() : await adminGetMicrosoftConnectUrl();
      window.location.href = url;
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function saveProfile(next: OnboardStep) {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName.trim() || undefined,
          home_timezone: timezone,
          working_hours_start: whStart,
          working_hours_end: whEnd,
        }),
      });
      setStep(next);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveCredentials(provider: "google" | "microsoft") {
    if (savingCreds) return;
    setSavingCreds(true);
    setError(null);
    try {
      const updated = await adminSaveOAuthConfig(provider, {
        client_id: credId.trim() || undefined,
        client_secret: credSecret.trim() || undefined,
        tenant_id: provider === "microsoft" ? credTenant.trim() || null : undefined,
      });
      setOauthConfigs((prev) => {
        const rest = (prev ?? []).filter((c) => c.provider !== provider);
        return [...rest, {
          provider,
          client_id_configured: updated.client_id_configured,
          client_secret_configured: updated.client_secret_configured,
        }];
      });
      setCredsFor(null);
      setCredId("");
      setCredSecret("");
      setCredTenant("");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSavingCreds(false);
    }
  }

  async function inviteEA() {
    const email = eaEmail.trim().toLowerCase();
    if (!email.includes("@") || inviting) return;
    setInviting(true);
    setError(null);
    try {
      const password = tempPassword();
      await adminCreateUser({
        email,
        display_name: eaName.trim() || email.split("@")[0],
        password,
        role: "delegate",
      });
      setEaPassword(password);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setInviting(false);
    }
  }

  function providerCard(provider: "google" | "microsoft", title: string) {
    const status = providerStatus(oauthConfigs, provider);
    const expanded = credsFor === provider;
    return (
      <div key={provider} style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name={provider} size={17} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{title}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 1 }}>
              {status === "ready" ? "Credentials saved — ready to connect" : status === "needs-keys" ? "Needs a Client ID & secret first" : "Checking…"}
            </span>
          </span>
          {status !== "unknown" && (
            <Badge tone={status === "ready" ? "success" : "warning"}>{status === "ready" ? "Ready" : "Setup"}</Badge>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => void connectProvider(provider)} disabled={status !== "ready"} className="btn-primary hoverable" style={{ flex: 1, padding: "8px 12px", fontSize: 13, opacity: status === "ready" ? 1 : 0.45 }}>
            Connect {provider === "google" ? "Google" : "Microsoft"}
          </button>
          {status === "needs-keys" && (
            <button onClick={() => { setCredsFor(expanded ? null : provider); setError(null); }} className="btn-secondary hoverable" style={{ padding: "8px 12px", fontSize: 13, whiteSpace: "nowrap" }}>
              {expanded ? "Hide" : "Add keys"}
            </button>
          )}
        </div>
        {expanded && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            <input value={credId} onChange={(e) => setCredId(e.target.value)} placeholder="Client ID" aria-label={`${title} client ID`} autoComplete="off" className="input-standard" style={{ width: "100%", fontSize: 12.5 }} />
            <input value={credSecret} onChange={(e) => setCredSecret(e.target.value)} placeholder="Client secret" aria-label={`${title} client secret`} autoComplete="off" type="password" className="input-standard" style={{ width: "100%", fontSize: 12.5 }} />
            {provider === "microsoft" && (
              <input value={credTenant} onChange={(e) => setCredTenant(e.target.value)} placeholder="Tenant ID (optional)" aria-label="Microsoft tenant ID" autoComplete="off" className="input-standard" style={{ width: "100%", fontSize: 12.5 }} />
            )}
            <button onClick={() => void saveCredentials(provider)} disabled={savingCreds || !credId.trim() || !credSecret.trim()} className="btn-secondary hoverable" style={{ alignSelf: "flex-start", padding: "6px 14px", fontSize: 12.5, opacity: savingCreds || !credId.trim() || !credSecret.trim() ? 0.5 : 1 }}>
              {savingCreds ? "Saving…" : "Save credentials"}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (user && user.role !== "admin") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Nothing to set up</div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
            Your calendars are shared with you — head straight in.
          </p>
          <Link to="/" className="btn-primary hoverable" style={{ textDecoration: "none" }}>Open calendar</Link>
        </div>
      </div>
    );
  }

  const idx = stepIndex(step);
  const state = { accountCount, displayName };
  const canNext = canProceed(step, state);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", justifyContent: "center", padding: "48px 20px" }}>
      <div style={{ width: 560, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((s, i) => (
              <span key={s} style={{ width: 28, height: 4, borderRadius: 2, background: i <= idx ? "var(--accent)" : "var(--border)" }} />
            ))}
          </div>
          <button onClick={skipAll} style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12, cursor: "pointer" }}>
            Skip setup
          </button>
        </div>

        <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 28 }}>
          {step === "welcome" && (
            <>
              <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 6 }}>Welcome to Chronarch</div>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 10px", letterSpacing: "-0.02em" }}>
                One calendar for every calendar.
              </h1>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 20px" }}>
                Four steps, starting with your first calendar connection.
              </p>
              <button onClick={() => setStep("connect")} className="btn-primary hoverable" style={{ padding: "10px 24px" }}>
                Begin →
              </button>
            </>
          )}

          {step === "connect" && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>Connect your calendars</h1>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
                Link as many as you like — work, personal, shared, even several accounts from the same
                provider. Each connection opens the provider and brings you back here; repeat for the next one.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {providerCard("google", "Google / Workspace")}
                {providerCard("microsoft", "Microsoft 365 / Outlook")}
                <Link to="/settings?section=accounts" className="btn-secondary hoverable" style={{ justifyContent: "flex-start", padding: "12px 16px", textDecoration: "none" }}>
                  <Icon name="calendar" size={15} />
                  CalDAV or ICS feed — advanced setup
                </Link>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-secondary)" }}>
                {checking ? (
                  "Checking connected accounts…"
                ) : accountCount > 0 ? (
                  <span><strong style={{ color: "var(--success)" }}>{accountCount} connected ✓</strong> — add another below, or continue.</span>
                ) : (
                  "None connected yet — pick a provider above."
                )}
              </div>
              {error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 10 }}>{error}</div>}
              <WizardFooter back={() => setStep("welcome")} next={() => setStep("you")} nextLabel="Continue" canNext />
            </>
          )}

          {step === "you" && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>About you</h1>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
                Used for booking pages, invites, and nailing timezones.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                <div>
                  <label htmlFor="ob-name" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Display name</label>
                  <input id="ob-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Aayush" autoFocus className="input-standard" style={{ width: "100%", fontSize: 13 }} />
                </div>
                <div>
                  <label htmlFor="ob-tz" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Home timezone</label>
                  <select id="ob-tz" value={TIMEZONES.includes(timezone) ? timezone : "UTC"} onChange={(e) => setTimezone(e.target.value)} className="input-standard" style={{ width: "100%", fontSize: 13 }}>
                    {TIMEZONES.map((z) => (
                      <option key={z} value={z}>{z}{z === browserZone() ? " (browser)" : ""}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="ob-wh1" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Work starts</label>
                    <input id="ob-wh1" type="time" value={whStart} onChange={(e) => setWhStart(e.target.value)} className="input-standard" style={{ width: "100%", fontSize: 13 }} />
                  </div>
                  <div>
                    <label htmlFor="ob-wh2" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Work ends</label>
                    <input id="ob-wh2" type="time" value={whEnd} onChange={(e) => setWhEnd(e.target.value)} className="input-standard" style={{ width: "100%", fontSize: 13 }} />
                  </div>
                </div>
              </div>
              {error && <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
              <WizardFooter back={() => setStep("connect")} next={() => void saveProfile("share")} nextLabel={saving ? "Saving…" : "Continue"} canNext={canNext && !saving} />
            </>
          )}

          {step === "share" && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>Share it (optional)</h1>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
                All optional — each opens full setup elsewhere. Or skip straight to done.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                <a href="/settings?section=booking" target="_blank" rel="noreferrer" className="hoverable" style={{ display: "block", background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "12px 16px", textDecoration: "none" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>📅 Booking link</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Let anyone book time — opens Booking setup in a new tab.</span>
                </a>
                <a href="/settings?section=kiosk" target="_blank" rel="noreferrer" className="hoverable" style={{ display: "block", background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "12px 16px", textDecoration: "none" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>🖥️ Wall display</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Pair a hallway tablet — opens Kiosk setup in a new tab.</span>
                </a>
                <div style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "12px 16px" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>🧑‍💼 Invite your assistant</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginTop: 2, marginBottom: 10 }}>
                    Creates a delegate login — share the password yourself. Grants come later on the Delegates page.
                  </span>
                  {eaPassword ? (
                    <div style={{ fontSize: 13 }}>
                      <span style={{ color: "var(--success)", fontWeight: 700 }}>Created ✓ </span>
                      <code style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "4px 10px", fontSize: 13 }}>{eaPassword}</code>
                      <button onClick={() => { void navigator.clipboard.writeText(eaPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="hoverable" style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer", marginLeft: 8 }}>
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input value={eaName} onChange={(e) => setEaName(e.target.value)} placeholder="Name" aria-label="Assistant name" className="input-standard" style={{ flex: "1 1 120px", fontSize: 12.5 }} />
                      <input value={eaEmail} onChange={(e) => setEaEmail(e.target.value)} placeholder="assistant@co.com" aria-label="Assistant email" className="input-standard" style={{ flex: "2 1 160px", fontSize: 12.5 }} />
                      <button onClick={() => void inviteEA()} disabled={inviting || !eaEmail.includes("@")} className="btn-secondary hoverable" style={{ padding: "6px 14px", fontSize: 12.5, opacity: inviting || !eaEmail.includes("@") ? 0.5 : 1 }}>
                        {inviting ? "Creating…" : "Invite"}
                      </button>
                    </div>
                  )}
                  {error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{error}</div>}
                </div>
              </div>
              <WizardFooter back={() => setStep("you")} next={() => setStep("done")} nextLabel="Continue" canNext />
            </>
          )}

          {step === "done" && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(48, 209, 88, 0.14)", color: "var(--success)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                <Icon name="check" size={20} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>You're set{displayName.trim() ? `, ${displayName.trim().split(" ")[0]}` : ""}</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 auto 18px", maxWidth: 400, lineHeight: 1.6 }}>
                {accountCount > 0 ? `${accountCount} calendar account${accountCount === 1 ? "" : "s"} connected. ` : ""}
                Three things to try: press <kbd>⌘K</kbd> anywhere, drag an event to reschedule it, and ask Copilot for “30 minutes tomorrow”.
              </div>
              <button onClick={finish} className="btn-primary hoverable" style={{ padding: "10px 28px" }}>
                Open calendar
              </button>
              {!readFlag(ONBOARD_DONE_KEY) && (
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => navigate("/settings")} style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12, cursor: "pointer" }}>
                    Tweak settings first
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WizardFooter({ back, next, nextLabel, canNext, nextHint }: {
  back: () => void; next: () => void; nextLabel: string; canNext: boolean; nextHint?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <button onClick={back} className="btn-secondary hoverable">Back</button>
        <button onClick={next} disabled={!canNext} className="btn-primary hoverable" style={{ padding: "8px 20px", opacity: canNext ? 1 : 0.5 }}>
          {nextLabel}
        </button>
      </div>
      {nextHint && !canNext && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>{nextHint}</div>}
    </div>
  );
}
