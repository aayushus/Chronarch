import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch, friendlyError } from "../api/client";
import { useAuth } from "../api/auth";
import {
  adminAddIcsSubscription,
  adminCreateUser,
  adminGetGoogleConnectUrl,
  adminGetMicrosoftConnectUrl,
  adminListAccounts,
  adminListOAuthConfigs,
  adminSaveOAuthConfig,
} from "../api/admin";
import { listCalendars, previewIcs, importIcsEvent } from "../api/calendar";
import Icon from "../components/Icon";
import {
  ONBOARD_DONE_KEY,
  ONBOARD_STEP_KEY,
  STEPS,
  canProceed,
  clearFlag,
  providerStatus,
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

  // Connect step states
  const [oauthConfigs, setOauthConfigs] = useState<OAuthStatus[] | null>(null);

  // Google OAuth Credentials
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [savingGoogle, setSavingGoogle] = useState(false);

  // Microsoft OAuth Credentials
  const [msClientId, setMsClientId] = useState("");
  const [msClientSecret, setMsClientSecret] = useState("");
  const [msTenantId, setMsTenantId] = useState("");
  const [savingMs, setSavingMs] = useState(false);

  const [connecting, setConnecting] = useState<"google" | "microsoft" | null>(null);

  // ICS Subscription & File Upload states
  const [icsFeedUrl, setIcsFeedUrl] = useState("");
  const [icsFeedName, setIcsFeedName] = useState("");
  const [addingFeed, setAddingFeed] = useState(false);
  const [feedSuccess, setFeedSuccess] = useState<string | null>(null);

  const [uploadingIcs, setUploadingIcs] = useState(false);
  const [icsUploadSuccess, setIcsUploadSuccess] = useState<string | null>(null);

  // Preferences & AI Copilot Step
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [timezone, setTimezone] = useState(user?.home_timezone || browserZone());
  const [whStart, setWhStart] = useState("09:00");
  const [whEnd, setWhEnd] = useState("17:00");
  const [workingDays, setWorkingDays] = useState("1,2,3,4,5");
  const [meetingBuffer, setMeetingBuffer] = useState<number>(0);
  const [copilotAutoOpen, setCopilotAutoOpen] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Executive Assistant (EA) Invite Step
  const [eaName, setEaName] = useState("");
  const [eaEmail, setEaEmail] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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
    function onFocus() {
      if (document.visibilityState === "visible") void refreshAccounts();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    if (user && !displayName) setDisplayName(user.display_name ?? "");
    if (user?.home_timezone) setTimezone(user.home_timezone);
  }, [user?.email]);

  function finish() {
    writeFlag(ONBOARD_DONE_KEY);
    clearFlag(ONBOARD_STEP_KEY);
    window.location.href = "/";
  }

  async function connectOAuth(provider: "google" | "microsoft") {
    if (connecting) return;
    setConnecting(provider);
    setError(null);
    try {
      try {
        localStorage.setItem(ONBOARD_STEP_KEY, String(stepIndex("connect")));
      } catch {
        /* private mode */
      }
      const url = provider === "google" ? await adminGetGoogleConnectUrl() : await adminGetMicrosoftConnectUrl();
      window.location.href = url;
    } catch (e) {
      setError(friendlyError(e));
      setConnecting(null);
    }
  }

  async function saveAndConnectGoogle(e: React.FormEvent) {
    e.preventDefault();
    if (savingGoogle || connecting) return;
    setSavingGoogle(true);
    setError(null);
    try {
      await adminSaveOAuthConfig("google", {
        client_id: googleClientId.trim() || undefined,
        client_secret: googleClientSecret.trim() || undefined,
      });
      await connectOAuth("google");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSavingGoogle(false);
    }
  }

  async function saveAndConnectMicrosoft(e: React.FormEvent) {
    e.preventDefault();
    if (savingMs || connecting) return;
    setSavingMs(true);
    setError(null);
    try {
      await adminSaveOAuthConfig("microsoft", {
        client_id: msClientId.trim() || undefined,
        client_secret: msClientSecret.trim() || undefined,
        tenant_id: msTenantId.trim() || null,
      });
      await connectOAuth("microsoft");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSavingMs(false);
    }
  }

  async function handleAddIcsFeed(e: React.FormEvent) {
    e.preventDefault();
    if (!icsFeedUrl.trim() || addingFeed) return;
    setAddingFeed(true);
    setError(null);
    setFeedSuccess(null);
    try {
      const res = await adminAddIcsSubscription({
        name: icsFeedName.trim() || "Subscribed Feed",
        url: icsFeedUrl.trim(),
      });
      setFeedSuccess(`Subscribed calendar "${res.name}" successfully!`);
      setIcsFeedUrl("");
      setIcsFeedName("");
      await refreshAccounts();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setAddingFeed(false);
    }
  }

  async function handleIcsFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIcs(true);
    setError(null);
    setIcsUploadSuccess(null);
    try {
      const text = await file.text();
      const parsed = await previewIcs(text);
      if (parsed.events.length === 0) {
        setError("No valid events found in the uploaded .ics file.");
        setUploadingIcs(false);
        return;
      }
      const userCals = await listCalendars();
      const writableCals = userCals.filter((c) => c.can_create || c.writable);
      if (writableCals.length === 0) {
        setError("Importing events from a local .ics file requires a connected writable calendar (e.g. Google Calendar or Microsoft 365). Connect an account above first, or use 'Option A: Subscribe to Feed URL' for external read-only feeds.");
        setUploadingIcs(false);
        return;
      }
      const targetCal = writableCals[0];
      for (const ev of parsed.events) {
        await importIcsEvent({
          calendar_id: targetCal.id,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          timezone: ev.timezone,
          description: ev.description,
          location: ev.location,
          all_day: ev.all_day,
        });
      }
      setIcsUploadSuccess(`Imported ${parsed.events.length} event(s) into "${targetCal.name}".`);
      await refreshAccounts();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setUploadingIcs(false);
    }
  }

  async function savePreferences(next: OnboardStep) {
    setSavingProfile(true);
    setError(null);
    try {
      await apiFetch("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName.trim() || undefined,
          home_timezone: timezone,
          working_hours_start: whStart,
          working_hours_end: whEnd,
          working_days: workingDays,
          meeting_buffer_minutes: meetingBuffer,
        }),
      });
      try {
        localStorage.setItem("chronarch_copilot_auto_open", copilotAutoOpen ? "1" : "0");
      } catch {
        /* private mode */
      }
      setStep(next);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSavingProfile(false);
    }
  }

  async function inviteEA() {
    const email = eaEmail.trim().toLowerCase();
    if (!email.includes("@") || inviting) return;
    setInviting(true);
    setError(null);
    try {
      const pwd = tempPassword();
      await adminCreateUser({
        email,
        display_name: eaName.trim() || email.split("@")[0],
        password: pwd,
        role: "delegate",
      });
      const link = `${window.location.origin}/login?invited_email=${encodeURIComponent(email)}&temp_pass=${encodeURIComponent(pwd)}`;
      setInviteToken(link);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setInviting(false);
    }
  }

  if (user && user.role !== "admin") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 8 }}>Nothing to set up</div>
          <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
            Your calendars are shared with you — head straight in.
          </p>
          <Link to="/" className="btn-primary hoverable" style={{ textDecoration: "none" }}>Open calendar</Link>
        </div>
      </div>
    );
  }

  const idx = stepIndex(step);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", justifyContent: "center", padding: "48px 20px" }}>
      <div style={{ width: 640, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((s, i) => (
              <span key={s} style={{ width: 32, height: 4, borderRadius: "var(--radius-pill)", background: i <= idx ? "var(--accent)" : "var(--border)" }} />
            ))}
          </div>
          <button onClick={finish} style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: "var(--text-sm)", cursor: "pointer" }}>
            Skip setup
          </button>
        </div>

        <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 32 }}>
          {step === "welcome" && (
            <>
              <div style={{ fontSize: "var(--text-md)", color: "var(--text-tertiary)", marginBottom: 6 }}>Welcome to Chronarch</div>
              <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 800, margin: "0 0 10px", letterSpacing: "-0.02em" }}>
                Unified Calendar & AI Copilot Platform
              </h1>
              <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 24px" }}>
                Set up your connected calendars, provider OAuth keys, work schedule, AI copilot preferences, and assistant access in a few easy steps.
              </p>
              <button onClick={() => setStep("connect")} className="btn-primary hoverable" style={{ padding: "10px 24px", fontSize: "var(--text-md)", fontWeight: 600 }}>
                Get Started →
              </button>
            </>
          )}

          {step === "connect" && (
            <>
              <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>Connect your calendars</h1>
              <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5 }}>
                Provide your provider OAuth credentials or import ICS feeds directly below.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
                {/* Google Provider Card */}
                <div style={{ background: "var(--wash-deep, rgba(0,0,0,0.03))", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", background: "rgba(10, 132, 255, 0.12)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon name="google" size={18} />
                      </span>
                      <div>
                        <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>Google Workspace / Gmail</div>
                        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                          {providerStatus(oauthConfigs, "google") === "saved" ? "OAuth Credentials Saved" : "Provide Console Client ID & Secret below"}
                        </div>
                      </div>
                    </div>
                    {providerStatus(oauthConfigs, "google") === "saved" && (
                      <button
                        onClick={() => void connectOAuth("google")}
                        disabled={connecting !== null}
                        className="btn-primary hoverable"
                        style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
                      >
                        {connecting === "google" ? "Connecting…" : "Connect Google Account"}
                      </button>
                    )}
                  </div>

                  <OAuthGuideHelper provider="google" />

                  <form onSubmit={saveAndConnectGoogle} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                    <input
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                      placeholder="Google Client ID (...apps.googleusercontent.com)"
                      className="input-standard"
                      style={{ width: "100%", fontSize: "var(--text-sm)" }}
                    />
                    <input
                      type="password"
                      value={googleClientSecret}
                      onChange={(e) => setGoogleClientSecret(e.target.value)}
                      placeholder="Google Client Secret"
                      className="input-standard"
                      style={{ width: "100%", fontSize: "var(--text-sm)" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                      <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ fontSize: "var(--text-sm)", color: "var(--accent)" }}>
                        Open Google Cloud Console ↗
                      </a>
                      <button
                        type="submit"
                        disabled={savingGoogle || connecting !== null}
                        className="btn-primary hoverable"
                        style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
                      >
                        {savingGoogle ? "Saving Keys…" : "Save Keys & Connect"}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Microsoft Provider Card */}
                <div style={{ background: "var(--wash-deep, rgba(0,0,0,0.03))", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", background: "rgba(48, 209, 88, 0.12)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon name="microsoft" size={18} />
                      </span>
                      <div>
                        <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>Microsoft 365 / Outlook</div>
                        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                          {providerStatus(oauthConfigs, "microsoft") === "saved" ? "OAuth Credentials Saved" : "Provide Entra ID Client ID & Secret below"}
                        </div>
                      </div>
                    </div>
                    {providerStatus(oauthConfigs, "microsoft") === "saved" && (
                      <button
                        onClick={() => void connectOAuth("microsoft")}
                        disabled={connecting !== null}
                        className="btn-primary hoverable"
                        style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
                      >
                        {connecting === "microsoft" ? "Connecting…" : "Connect Microsoft Account"}
                      </button>
                    )}
                  </div>

                  <OAuthGuideHelper provider="microsoft" />

                  <form onSubmit={saveAndConnectMicrosoft} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                    <input
                      value={msClientId}
                      onChange={(e) => setMsClientId(e.target.value)}
                      placeholder="Microsoft Application (client) ID"
                      className="input-standard"
                      style={{ width: "100%", fontSize: "var(--text-sm)" }}
                    />
                    <input
                      type="password"
                      value={msClientSecret}
                      onChange={(e) => setMsClientSecret(e.target.value)}
                      placeholder="Microsoft Client Secret Value"
                      className="input-standard"
                      style={{ width: "100%", fontSize: "var(--text-sm)" }}
                    />
                    <input
                      value={msTenantId}
                      onChange={(e) => setMsTenantId(e.target.value)}
                      placeholder="Directory (tenant) ID (default: common)"
                      className="input-standard"
                      style={{ width: "100%", fontSize: "var(--text-sm)" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                      <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer" style={{ fontSize: "var(--text-sm)", color: "var(--accent)" }}>
                        Open Microsoft Entra ID Portal ↗
                      </a>
                      <button
                        type="submit"
                        disabled={savingMs || connecting !== null}
                        className="btn-primary hoverable"
                        style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
                      >
                        {savingMs ? "Saving Keys…" : "Save Keys & Connect"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* ICS Feed Subscription & Local File Upload */}
              <div style={{ background: "var(--wash-deep, rgba(0,0,0,0.03))", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="calendar" size={16} />
                  <span>ICS Feed Subscription & Local File Import</span>
                </div>

                <form onSubmit={handleAddIcsFeed} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>Subscribe to ICS Feed URL</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={icsFeedName}
                      onChange={(e) => setIcsFeedName(e.target.value)}
                      placeholder="Feed Name"
                      className="input-standard"
                      style={{ flex: "1 1 140px", fontSize: "var(--text-sm)" }}
                    />
                    <input
                      value={icsFeedUrl}
                      onChange={(e) => setIcsFeedUrl(e.target.value)}
                      placeholder="https://example.com/calendar.ics"
                      className="input-standard"
                      style={{ flex: "2 1 200px", fontSize: "var(--text-sm)" }}
                    />
                    <button
                      type="submit"
                      disabled={addingFeed || !icsFeedUrl.trim()}
                      className="btn-secondary hoverable"
                      style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
                    >
                      {addingFeed ? "Subscribing…" : "Subscribe"}
                    </button>
                  </div>
                  {feedSuccess && <div style={{ fontSize: "var(--text-sm)", color: "var(--success)" }}><Icon name="check" size={13} style={{ flexShrink: 0 }} /> {feedSuccess}</div>}
                </form>

                <div style={{ borderTop: "1px dashed var(--border-subtle)", paddingTop: 12 }}>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                    Upload local .ics file
                  </div>
                  <label className="btn-secondary hoverable" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: "var(--text-sm)", cursor: "pointer" }}>
                    <Icon name="upload" size={14} />
                    <span>{uploadingIcs ? "Importing .ics…" : "Choose .ics File"}</span>
                    <input type="file" accept=".ics" onChange={handleIcsFileUpload} style={{ display: "none" }} disabled={uploadingIcs} />
                  </label>
                  {icsUploadSuccess && <div style={{ fontSize: "var(--text-sm)", color: "var(--success)", marginTop: 6 }}><Icon name="check" size={13} style={{ flexShrink: 0 }} /> {icsUploadSuccess}</div>}
                </div>
              </div>

              <div style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", marginBottom: 12 }}>
                {checking ? (
                  "Checking connected accounts…"
                ) : accountCount > 0 ? (
                  <span style={{ color: "var(--success)", fontWeight: 700 }}><Icon name="check" size={13} style={{ flexShrink: 0 }} /> {accountCount} account(s) connected</span>
                ) : (
                  "No accounts connected yet — you can continue and manage accounts anytime in Settings."
                )}
              </div>

              {error && <div style={{ fontSize: "var(--text-sm)", color: "var(--danger)", marginBottom: 12 }}>{error}</div>}

              <WizardFooter back={() => setStep("welcome")} next={() => setStep("preferences")} nextLabel="Continue" canNext />
            </>
          )}

          {step === "preferences" && (
            <>
              <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>Personalization & AI Copilot</h1>
              <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5 }}>
                Configure your timezone, work schedule, buffer rules, and copilot settings.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
                <div>
                  <label htmlFor="ob-name" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Display Name</label>
                  <input
                    id="ob-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="input-standard"
                    style={{ width: "100%", fontSize: "var(--text-md)" }}
                  />
                </div>

                <div>
                  <label htmlFor="ob-tz" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Home Timezone</label>
                  <select className="input-standard select"
                    id="ob-tz"
                    value={TIMEZONES.includes(timezone) ? timezone : "UTC"}
                    onChange={(e) => setTimezone(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {TIMEZONES.map((z) => (
                      <option key={z} value={z}>{z}{z === browserZone() ? " (browser auto-detected)" : ""}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="ob-wh1" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Work Starts</label>
                    <input className="input-standard input-native" id="ob-wh1" type="time" value={whStart} onChange={(e) => setWhStart(e.target.value)}  style={{ width: "100%", fontSize: "var(--text-md)" }} />
                  </div>
                  <div>
                    <label htmlFor="ob-wh2" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Work Ends</label>
                    <input className="input-standard input-native" id="ob-wh2" type="time" value={whEnd} onChange={(e) => setWhEnd(e.target.value)}  style={{ width: "100%", fontSize: "var(--text-md)" }} />
                  </div>
                </div>

                <div>
                  <label htmlFor="ob-wd" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Working Days</label>
                  <select className="input-standard select"
                    id="ob-wd"
                    value={workingDays}
                    onChange={(e) => setWorkingDays(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="1,2,3,4,5">Monday – Friday (Standard Work Week)</option>
                    <option value="0,1,2,3,4,5,6">Everyday (Sun – Sat)</option>
                    <option value="0,1,2,3,4">Sunday – Thursday</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="ob-buffer" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Meeting Buffer Time</label>
                  <select className="input-standard select"
                    id="ob-buffer"
                    value={meetingBuffer}
                    onChange={(e) => setMeetingBuffer(Number(e.target.value))}
                    style={{ width: "100%" }}
                  >
                    <option value={0}>No buffer (0 min)</option>
                    <option value={5}>5 minutes buffer</option>
                    <option value={10}>10 minutes buffer</option>
                    <option value={15}>15 minutes buffer</option>
                  </select>
                </div>

                <div style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
                    <input className="checkbox"
                      type="checkbox"
                      checked={copilotAutoOpen}
                      onChange={(e) => setCopilotAutoOpen(e.target.checked)}
                    />
                    <div>
                      <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>Auto-open AI Copilot Drawer</div>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                        Keep the contextual AI assistant ready alongside your calendar view.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {error && <div style={{ fontSize: "var(--text-sm)", color: "var(--danger)", marginBottom: 12 }}>{error}</div>}

              <WizardFooter
                back={() => setStep("connect")}
                next={() => void savePreferences("share")}
                nextLabel={savingProfile ? "Saving…" : "Continue"}
                canNext={!savingProfile}
              />
            </>
          )}

          {step === "share" && (
            <>
              <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>Executive Delegation</h1>
              <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5 }}>
                Invite an Executive Assistant (EA) or delegate manager to handle scheduling on your behalf.
              </p>

              <div style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16, marginBottom: 24 }}>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 7 }}>
                  <Icon name="users" size={15} /> Invite Assistant / Delegate
                </div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 14 }}>
                  Creates a delegate account and generates a shareable invitation link.
                </div>

                {inviteToken ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--success)", fontWeight: 700 }}>
                      <Icon name="check" size={13} style={{ flexShrink: 0 }} /> Invitation Link Generated!
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        readOnly
                        value={inviteToken}
                        className="input-standard"
                        style={{ flex: 1, fontSize: "var(--text-sm)", background: "var(--bg-raised)" }}
                      />
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(inviteToken);
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                        className="btn-primary hoverable"
                        style={{ padding: "8px 14px", fontSize: "var(--text-sm)" }}
                      >
                        {copiedLink ? "Copied!" : "Copy Invite Link"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      value={eaName}
                      onChange={(e) => setEaName(e.target.value)}
                      placeholder="Assistant Name"
                      className="input-standard"
                      style={{ flex: "1 1 140px", fontSize: "var(--text-md)" }}
                    />
                    <input
                      value={eaEmail}
                      onChange={(e) => setEaEmail(e.target.value)}
                      placeholder="assistant@company.com"
                      className="input-standard"
                      style={{ flex: "2 1 180px", fontSize: "var(--text-md)" }}
                    />
                    <button
                      onClick={() => void inviteEA()}
                      disabled={inviting || !eaEmail.includes("@")}
                      className="btn-primary hoverable"
                      style={{ padding: "8px 16px", fontSize: "var(--text-md)" }}
                    >
                      {inviting ? "Creating Link…" : "Generate Invite"}
                    </button>
                  </div>
                )}
                {error && <div style={{ fontSize: "var(--text-sm)", color: "var(--danger)", marginTop: 10 }}>{error}</div>}
              </div>

              <WizardFooter back={() => setStep("preferences")} next={() => setStep("done")} nextLabel="Continue" canNext />
            </>
          )}

          {step === "done" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(48, 209, 88, 0.14)", color: "var(--success)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Icon name="check" size={22} />
              </div>
              <div style={{ fontSize: "var(--text-xl)", fontWeight: 800, marginBottom: 8 }}>
                You're all set{displayName.trim() ? `, ${displayName.trim().split(" ")[0]}` : ""}!
              </div>
              <div style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 auto 24px", maxWidth: 420, lineHeight: 1.6 }}>
                Your preferences and calendar settings are active. Press <kbd style={{ background: "var(--bg-app)", padding: "2px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>⌘K</kbd> anywhere to access quick commands or open the AI copilot drawer.
              </div>
              <button onClick={finish} className="btn-primary hoverable" style={{ padding: "11px 32px", fontSize: "var(--text-md)", fontWeight: 600 }}>
                Open Calendar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WizardFooter({
  back,
  next,
  nextLabel,
  canNext,
}: {
  back: () => void;
  next: () => void;
  nextLabel: string;
  canNext: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
      <button onClick={back} className="btn-secondary hoverable" style={{ padding: "8px 18px", fontSize: "var(--text-md)" }}>
        Back
      </button>
      <button onClick={next} disabled={!canNext} className="btn-primary hoverable" style={{ padding: "8px 24px", fontSize: "var(--text-md)" }}>
        {nextLabel}
      </button>
    </div>
  );
}

function OAuthGuideHelper({ provider }: { provider: "google" | "microsoft" }) {
  const [open, setOpen] = useState(false);
  const [copiedOrigin, setCopiedOrigin] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const origin = window.location.origin;
  const redirectUri = `${origin}/api/v1/admin/accounts/${provider}/callback`;

  function copyText(val: string, type: "origin" | "redirect") {
    void navigator.clipboard.writeText(val);
    if (type === "origin") {
      setCopiedOrigin(true);
      setTimeout(() => setCopiedOrigin(false), 2000);
    } else {
      setCopiedRedirect(true);
      setTimeout(() => setCopiedRedirect(false), 2000);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          color: "var(--accent)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          cursor: "pointer",
          padding: "4px 0",
          display: "flex",
          alignItems: "center",
          gap: 4
        }}
      >
        <Icon name="chevronRight" size={12} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform var(--transition-fast)", flexShrink: 0 }} />
        <span>{open ? "Hide Console Setup Instructions" : "How to set up OAuth keys & Redirect URIs"}</span>
      </button>

      {open && (
        <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 12, marginTop: 6, fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55 }}>
          {provider === "google" ? (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 6 }}>
                Open <strong>console.cloud.google.com</strong> → APIs & Services → Library → enable <strong>Google Calendar API</strong>.
              </li>
              <li style={{ marginBottom: 6 }}>
                Credentials → Create Credentials → <strong>OAuth client ID</strong> → Application Type <strong>Web application</strong>.
              </li>
              <li style={{ marginBottom: 6 }}>
                <strong>Authorized JavaScript origins</strong>:
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <code style={{ background: "var(--bg-app)", padding: "2px 6px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)" }}>{origin}</code>
                  <button type="button" onClick={() => copyText(origin, "origin")} className="hoverable" style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: "var(--text-sm)", cursor: "pointer" }}>
                    {copiedOrigin ? "Copied!" : "Copy Origin"}
                  </button>
                </div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--warning)", marginTop: 2 }}>
                  <span style={{ display: "inline-flex", verticalAlign: "-2px", marginRight: 4 }}>
                    <Icon name="alert-triangle" size={13} />
                  </span>Do NOT add a trailing slash <code>/</code> here — Google Cloud Console rejects origins containing paths or trailing slashes!
                </div>
              </li>
              <li style={{ marginBottom: 6 }}>
                <strong>Authorized redirect URIs</strong>:
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <code style={{ background: "var(--bg-app)", padding: "2px 6px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)" }}>{redirectUri}</code>
                  <button type="button" onClick={() => copyText(redirectUri, "redirect")} className="hoverable" style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: "var(--text-sm)", cursor: "pointer" }}>
                    {copiedRedirect ? "Copied!" : "Copy Redirect URI"}
                  </button>
                </div>
              </li>
              <li>Copy the <strong>Client ID</strong> and <strong>Client secret</strong> and paste them below.</li>
            </ol>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 6 }}>
                Open <strong>entra.microsoft.com</strong> → App Registrations → <strong>New registration</strong>.
              </li>
              <li style={{ marginBottom: 6 }}>
                Under Redirect URI select platform <strong>Web</strong> and add:
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <code style={{ background: "var(--bg-app)", padding: "2px 6px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)" }}>{redirectUri}</code>
                  <button type="button" onClick={() => copyText(redirectUri, "redirect")} className="hoverable" style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: "var(--text-sm)", cursor: "pointer" }}>
                    {copiedRedirect ? "Copied!" : "Copy Redirect URI"}
                  </button>
                </div>
              </li>
              <li style={{ marginBottom: 6 }}>
                API permissions → Add → Microsoft Graph → Delegated → check <strong>Calendars.ReadWrite</strong> and <strong>offline_access</strong>.
              </li>
              <li>Copy the <strong>Application (client) ID</strong> and secret <strong>Value</strong> and paste below.</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
