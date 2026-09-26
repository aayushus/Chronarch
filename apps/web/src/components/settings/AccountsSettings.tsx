import React, { useEffect, useState } from "react";
import { friendlyError } from "../../api/client";
import { adminSyncAccount, importIcsEvent, listCalendars, previewIcs, updateCalendar } from "../../api/calendar";
import EmptyState from "../EmptyState";
import { SectionHeader } from "../ui";
import Icon from "../Icon";

import {
  AdminAccount,
  OAuthProviderConfig,
  adminAddIcsSubscription,
  adminClearOAuthConfig,
  adminConnectCaldav,
  adminDisconnectAccount,
  adminEnsureWebhooks,
  adminGetGoogleConnectUrl,
  adminGetMicrosoftConnectUrl,
  adminGetOAuthRedirectUris,
  adminListAccounts,
  adminListOAuthConfigs,
  adminSaveOAuthConfig,
  adminTestCaldav,
} from "../../api/admin";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  missing_code_or_state: "Provider didn't return the expected response — try again.",
  invalid_state: "That connect link expired or was already used — try again.",
  unauthorized: "Your admin session expired — sign in again and retry.",
  connect_failed: "Couldn't finish connecting that account. Verify the redirect URI and that the Calendar API is enabled, then try again.",
};

type WizardProvider = "google" | "microsoft" | "caldav" | "ics" | null;

/** True when the user arrived here mid-onboarding (OAuth round-trip) and
 * hasn't finished setup — the success banner offers a resume link. */
function resumingOnboarding(): boolean {
  try {
    return (
      localStorage.getItem("chronarch_onboarding_step") !== null &&
      localStorage.getItem("chronarch_onboarded") !== "1"
    );
  } catch {
    return false;
  }
}

export default function AccountsSettings() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [oauth, setOauth] = useState<Record<string, OAuthProviderConfig>>({});
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthSaving, setOauthSaving] = useState<string | null>(null);

  // Wizard Modal state
  const [wizardOpen, setWizardOpen] = useState(false);

  function load() {
    adminListAccounts()
      .then(setAccounts)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
    adminListOAuthConfigs()
      .then((list) => setOauth(Object.fromEntries(list.map((c) => [c.provider, c]))))
      .catch((e) => setOauthError(String(e)));
  }

  useEffect(load, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("accounts_connected");
    const errParam = params.get("accounts_error");
    if (connected) {
      const label = connected === "microsoft" ? "Microsoft 365" : connected === "google" ? "Google Calendar" : connected;
      setBanner({ kind: "success", text: `${label} connected successfully. Calendars are now available in Chronarch.` });
      // The OAuth round-trip can return while the initial account list load is
      // still in flight. Refresh explicitly so the new account appears in the
      // Connected Accounts section immediately.
      adminListAccounts().then(setAccounts).catch((e) => setError(friendlyError(e)));
    } else if (errParam) {
      setBanner({ kind: "error", text: ERROR_MESSAGES[errParam] ?? `The provider sign-in did not complete (${errParam}). No account was connected.` });
    }
    if (connected || errParam) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleSaveOAuth(
    provider: string,
    body: { client_id?: string; client_secret?: string; tenant_id?: string | null }
  ) {
    setOauthSaving(provider);
    setOauthError(null);
    try {
      const updated = await adminSaveOAuthConfig(provider, body);
      setOauth((prev) => ({ ...prev, [provider]: updated }));
      setBanner({ kind: "success", text: `Saved ${provider} provider credentials.` });
      return updated;
    } catch (e) {
      setOauthError(String(e));
      throw e;
    } finally {
      setOauthSaving(null);
    }
  }

  async function handleClearOAuth(provider: string) {
    if (
      !confirm(
        `Clear stored ${provider} OAuth credentials? Existing connected accounts keep working until their tokens expire, but new connects will fail.`
      )
    )
      return;
    setOauthSaving(provider);
    try {
      const updated = await adminClearOAuthConfig(provider);
      setOauth((prev) => ({ ...prev, [provider]: updated }));
      setBanner({ kind: "success", text: `Cleared ${provider} credentials.` });
    } catch (e) {
      setOauthError(String(e));
    } finally {
      setOauthSaving(null);
    }
  }

  async function handleDisconnect(a: AdminAccount) {
    if (
      !confirm(
        `Disconnect ${a.provider_account_email}? This removes its ${a.calendar_count} calendar(s) and cached events.`
      )
    )
      return;
    try {
      await adminDisconnectAccount(a.id);
      setAccounts((prev) => prev.filter((x) => x.id !== a.id));
      setBanner({ kind: "success", text: `Disconnected ${a.provider_account_email}.` });
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [pushingAccountId, setPushingAccountId] = useState<string | null>(null);

  async function handleSyncAccount(a: AdminAccount) {
    setSyncingAccountId(a.id);
    try {
      const res = await adminSyncAccount(a.id);
      setAccounts((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, last_synced_at: res.last_synced_at, sync_status: "active" } : x))
      );
      setBanner({
        kind: "success",
        text: `Reconciliation sync completed for ${a.provider_account_email}.`,
      });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSyncingAccountId(null);
    }
  }

  async function handleEnablePush(a: AdminAccount) {
    setPushingAccountId(a.id);
    try {
      const res = await adminEnsureWebhooks(a.id);
      if (res.skipped) {
        setBanner({ kind: "error", text: `Push not available: ${res.skipped} Polling continues.` });
      } else {
        setAccounts((prev) =>
          prev.map((x) => (x.id === a.id ? { ...x, push_status: "active" } : x))
        );
        setBanner({
          kind: "success",
          text: `Push notifications armed for ${a.provider_account_email} (ensured ${res.ensured}, renewed ${res.replaced}).`,
        });
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPushingAccountId(null);
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-md)" }}>Loading accounts…</div>;

  return (
    <div>
      {/* Header section */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <SectionHeader
            title="Accounts"
            description="Connected Google, Microsoft, CalDAV, and ICS calendars. Synchronizes multi-organization schedules, backfilling the last 90 days and the next 365 days of events."
          />
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="btn-primary hoverable"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            fontSize: "var(--text-md)",
            fontWeight: 600,
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span style={{ fontSize: "var(--text-lg)", lineHeight: 1 }}>+</span>
          <span>Add Account</span>
        </button>
      </div>

      {banner && (
        <div
          style={{
            fontSize: "var(--text-md)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 20,
            background: banner.kind === "success" ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 69, 58, 0.15)",
            border: `1px solid ${banner.kind === "success" ? "var(--success)" : "var(--danger)"}`,
            color: banner.kind === "success" ? "var(--success)" : "var(--danger)",
            fontWeight: 500,
          }}
        >
          {banner.text}
          {banner.kind === "success" && resumingOnboarding() && (
            <>
              {" "}
              <a href="/start" style={{ color: "inherit", fontWeight: 700 }}>
                Continue setup →
              </a>
            </>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: "var(--danger)", fontSize: "var(--text-md)", marginBottom: 16 }}>{error}</div>
      )}

      {/* Connected Accounts List */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: "var(--text-md)", fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Connected Accounts</span>
          <span
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              background: "var(--bg-raised)",
              padding: "1px 7px",
              borderRadius: "var(--radius-lg)",
              color: "var(--text-secondary)",
            }}
          >
            {accounts.length}
          </span>
        </div>

        {accounts.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No accounts connected yet"
            body="Connect your Google, Microsoft, CalDAV, or external ICS calendar to begin syncing events."
            actionLabel="Connect First Account"
            onAction={() => setWizardOpen(true)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {accounts.map((a) => {
              const isGoogle = a.provider === "google";
              const isMicrosoft = a.provider === "microsoft";
              const isCaldav = a.provider === "caldav";

              return (
                <div
                  key={a.id}
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: "14px 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <ProviderLogo provider={a.provider} />
                    <div>
                      <div style={{ fontSize: "var(--text-md)", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{a.provider_account_email}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", color: a.sync_status === "error" ? "var(--danger)" : "var(--success)", fontWeight: 700 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.sync_status === "error" ? "var(--danger)" : "var(--success)" }} />
                          {a.sync_status === "error" ? "Needs attention" : "Connected"}
                        </span>
                        <span
                          style={{
                            fontSize: "var(--text-xs)",
                            textTransform: "uppercase",
                            padding: "2px 6px",
                            borderRadius: "var(--radius-sm)",
                            background: isGoogle
                              ? "rgba(10, 132, 255, 0.18)"
                              : isMicrosoft
                              ? "rgba(48, 209, 88, 0.18)"
                              : "rgba(255, 159, 10, 0.18)",
                            color: isGoogle
                              ? "var(--accent)"
                              : isMicrosoft
                              ? "var(--success)"
                              : "var(--warning)",
                            fontWeight: 700,
                          }}
                        >
                          {a.provider}
                        </span>
                      </div>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 3 }}>
                        Owner: {a.owner_email} · {a.calendar_count} calendar{a.calendar_count === 1 ? "" : "s"} · sync:{" "}
                        <span
                          style={{
                            color:
                              a.sync_status === "error"
                                ? "var(--danger)"
                                : a.sync_status === "ok" || a.sync_status === "active"
                                ? "var(--success)"
                                : "var(--warning)",
                            fontWeight: 600,
                          }}
                        >
                          {a.sync_status}
                        </span>
                        {(isGoogle || isMicrosoft) && (
                          <>
                            {" "}· push:{" "}
                            <span
                              style={{
                                color:
                                  a.push_status === "active"
                                    ? "var(--success)"
                                    : a.push_status === "error"
                                    ? "var(--danger)"
                                    : "var(--text-tertiary)",
                                fontWeight: 600,
                              }}
                              title={
                                a.push_status === "active"
                                  ? "Provider push notifications armed; polling remains the backstop"
                                  : "Polling covers this account (push needs a public https APP_BASE_URL)"
                              }
                            >
                              {a.push_status ?? "off"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {a.provider === "ics" && (
                      <select className="input-standard select"
                        defaultValue="60"
                        onChange={async (e) => {
                          const mins = parseInt(e.target.value, 10);
                          try {
                            const cals = await listCalendars();
                            const sub = cals.find((c) => c.account_id === a.id);
                            if (sub) {
                              await updateCalendar(sub.id, { ics_sync_interval_minutes: mins });
                              setBanner({ kind: "success", text: `Updated ${a.provider_account_email} sync frequency to ${mins} minutes.` });
                            }
                          } catch (err) {
                            setError(friendlyError(err));
                          }
                        }}

                        title="Auto-refresh frequency for this subscription feed"
                      >
                        <option value="15">Sync every 15m</option>
                        <option value="30">Sync every 30m</option>
                        <option value="60">Sync every 1h</option>
                        <option value="360">Sync every 6h</option>
                        <option value="1440">Sync every 24h</option>
                      </select>
                    )}
                    {(isGoogle || isMicrosoft) && a.push_status !== "active" && (
                      <button
                        onClick={() => handleEnablePush(a)}
                        disabled={pushingAccountId === a.id}
                        className="hoverable"
                        title="Arm provider push notifications (needs public https APP_BASE_URL; polling covers otherwise)"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          background: "var(--bg-app)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--text-primary)",
                          padding: "6px 12px",
                          fontSize: "var(--text-sm)",
                          cursor: pushingAccountId === a.id ? "wait" : "pointer",
                        }}
                      >
                        <span>{pushingAccountId === a.id ? "Arming…" : "Enable push"}</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleSyncAccount(a)}
                      disabled={syncingAccountId === a.id}
                      className="hoverable"
                      title="Run manual reconciliation sync with provider"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "var(--bg-app)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        padding: "6px 12px",
                        fontSize: "var(--text-sm)",
                        cursor: syncingAccountId === a.id ? "wait" : "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          transform: syncingAccountId === a.id ? "rotate(360deg)" : "none",
                          transition: syncingAccountId === a.id ? "transform 1s linear infinite" : "none",
                          fontSize: "var(--text-sm)",
                        }}
                      >
                        ↻
                      </span>
                      <span>{syncingAccountId === a.id ? "Syncing…" : "Sync Now"}</span>
                    </button>
                    <button
                      onClick={() => handleDisconnect(a)}
                      className="btn-danger hoverable"
                      style={{ padding: "6px 12px", fontSize: "var(--text-sm)" }}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Account Connection Wizard Modal */}
      {wizardOpen && (
        <ConnectAccountWizardModal
          oauth={oauth}
          onClose={() => setWizardOpen(false)}
          onSaveOAuth={handleSaveOAuth}
          onAccountAdded={() => {
            load();
            setWizardOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Wizard Modal Component
// ----------------------------------------------------------------------------

function ConnectAccountWizardModal({
  oauth,
  onClose,
  onSaveOAuth,
  onAccountAdded,
}: {
  oauth: Record<string, OAuthProviderConfig>;
  onClose: () => void;
  onSaveOAuth: (
    provider: string,
    body: { client_id?: string; client_secret?: string; tenant_id?: string | null }
  ) => Promise<OAuthProviderConfig>;
  onAccountAdded: () => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<WizardProvider>(null);
  const [googleReview, setGoogleReview] = useState(false);
  const [editMicrosoftConfig, setEditMicrosoftConfig] = useState(false);
  const [setupHelpOpen, setSetupHelpOpen] = useState(false);

  // Form states for OAuth configuration
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [redirectUris, setRedirectUris] = useState<{ google: string; microsoft: string } | null>(null);

  useEffect(() => { void adminGetOAuthRedirectUris().then(setRedirectUris).catch(() => {}); }, []);

  // Form states for ICS subscription
  const [icsName, setIcsName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [icsSaving, setIcsSaving] = useState(false);
  const [icsError, setIcsError] = useState<string | null>(null);

  // Form states for CalDAV account (BR-CAL-003)
  const [caldavUrl, setCaldavUrl] = useState("");
  const [caldavUsername, setCaldavUsername] = useState("");
  const [caldavPassword, setCaldavPassword] = useState("");
  const [caldavLabel, setCaldavLabel] = useState("");
  const [caldavSaving, setCaldavSaving] = useState(false);
  const [caldavTesting, setCaldavTesting] = useState(false);
  const [caldavError, setCaldavError] = useState<string | null>(null);
  const [caldavTestOk, setCaldavTestOk] = useState<string | null>(null);

  const googleRedirectUri = redirectUris?.google ?? `${window.location.origin}/api/v1/admin/accounts/google/callback`;
  const microsoftRedirectUri = redirectUris?.microsoft ?? `${window.location.origin}/api/v1/admin/accounts/microsoft/callback`;

  const isGoogleConfigured = !!oauth.google && (oauth.google.client_id_configured || oauth.google.client_secret_configured);
  const isMicrosoftConfigured = !!oauth.microsoft && (oauth.microsoft.client_id_configured || oauth.microsoft.client_secret_configured);

  function handleCopyUri(uri: string) {
    navigator.clipboard.writeText(uri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2200);
  }

  async function handleGoogleDirectConnect() {
    setConnecting(true);
    setConfigError(null);
    try {
      const url = await adminGetGoogleConnectUrl();
      window.location.href = url;
    } catch (e) {
      setConfigError(String(e));
      setConnecting(false);
    }
  }

  function selectProvider(provider: WizardProvider) {
    setSelectedProvider(provider);
    setGoogleReview(false);
    setEditMicrosoftConfig(false);
    setConfigError(null);
    setSetupHelpOpen(false);
  }

  async function handleMicrosoftDirectConnect() {
    setConnecting(true);
    setConfigError(null);
    try {
      const url = await adminGetMicrosoftConnectUrl();
      window.location.href = url;
    } catch (e) {
      setConfigError(String(e));
      setConnecting(false);
    }
  }

  async function handleSaveAndConnectGoogle() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setConfigError("Please enter both Google Client ID and Client Secret.");
      return;
    }
    setSavingConfig(true);
    setConfigError(null);
    try {
      await onSaveOAuth("google", { client_id: clientId.trim(), client_secret: clientSecret.trim() });
      setConnecting(true);
      const url = await adminGetGoogleConnectUrl();
      window.location.href = url;
    } catch (e) {
      setConfigError(String(e));
      setSavingConfig(false);
      setConnecting(false);
    }
  }

  async function handleSaveAndConnectMicrosoft() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setConfigError("Please enter both Microsoft Client ID and Client Secret.");
      return;
    }
    setSavingConfig(true);
    setConfigError(null);
    try {
      await onSaveOAuth("microsoft", {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        tenant_id: tenantId.trim() || null,
      });
      setConnecting(true);
      const url = await adminGetMicrosoftConnectUrl();
      window.location.href = url;
    } catch (e) {
      setConfigError(String(e));
      setSavingConfig(false);
      setConnecting(false);
    }
  }

  async function handleSaveIcsSubscription() {
    if (!icsName.trim() || !icsUrl.trim()) {
      setIcsError("Please enter both calendar name and ICS feed URL.");
      return;
    }
    setIcsSaving(true);
    setIcsError(null);
    try {
      await adminAddIcsSubscription({ name: icsName.trim(), url: icsUrl.trim() });
      onAccountAdded();
    } catch (e) {
      setIcsError(String(e));
      setIcsSaving(false);
    }
  }

  async function handleTestCaldav() {
    if (!caldavUrl.trim() || !caldavUsername.trim() || !caldavPassword) {
      setCaldavError("Please enter server URL, username, and password.");
      return;
    }
    setCaldavTesting(true);
    setCaldavError(null);
    setCaldavTestOk(null);
    try {
      const res = await adminTestCaldav({
        server_url: caldavUrl.trim(),
        username: caldavUsername.trim(),
        password: caldavPassword,
      });
      setCaldavTestOk(`Connection OK — found ${res.calendars_found} calendar(s).`);
    } catch (e) {
      setCaldavError(String(e));
    } finally {
      setCaldavTesting(false);
    }
  }

  async function handleConnectCaldav() {
    if (!caldavUrl.trim() || !caldavUsername.trim() || !caldavPassword) {
      setCaldavError("Please enter server URL, username, and password.");
      return;
    }
    setCaldavSaving(true);
    setCaldavError(null);
    try {
      await adminConnectCaldav({
        server_url: caldavUrl.trim(),
        username: caldavUsername.trim(),
        password: caldavPassword,
        email_label: caldavLabel.trim() || undefined,
      });
      onAccountAdded();
    } catch (e) {
      setCaldavError(String(e));
      setCaldavSaving(false);
    }
  }

  return (
    <div className="modal-backdrop-solid" onClick={onClose}>
      <div
        className="modal-card-solid"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 680, maxWidth: "94vw", padding: 28 }}
      >
        {/* Modal Top Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {selectedProvider && (
              <button
                onClick={() => {
                  setSelectedProvider(null);
                  setGoogleReview(false);
                  setConfigError(null);
                }}
                className="hoverable"
                style={{
                  background: "var(--bg-raised)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-secondary)",
                  padding: "4px 8px",
                  fontSize: "var(--text-sm)",
                  cursor: "pointer",
                }}
              >
                ← Back
              </button>
            )}
            <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700, margin: 0 }}>
              {selectedProvider === "google"
                ? "Connect Google Calendar"
                : selectedProvider === "microsoft"
                ? "Connect Microsoft 365"
                : selectedProvider === "caldav"
                ? "Connect CalDAV Account"
                : selectedProvider === "ics"
                ? "Subscribe to ICS Calendar"
                : "Add an Account"}
            </h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {(selectedProvider === "google" || selectedProvider === "microsoft") && (
              <button
                onClick={() => setSetupHelpOpen((open) => !open)}
                className="hoverable"
                aria-label="How to get setup credentials"
                aria-expanded={setupHelpOpen}
                title="How to get setup credentials"
                style={{
                  background: setupHelpOpen ? "var(--accent-soft)" : "var(--bg-raised)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  color: setupHelpOpen ? "var(--accent)" : "var(--text-secondary)",
                  fontSize: "var(--text-lg)",
                  lineHeight: 1,
                  cursor: "pointer",
                  width: 30,
                  height: 30,
                }}
              >
                <Icon name="sparkles" size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              className="hoverable"
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-tertiary)",
                fontSize: "var(--text-xl)",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>

        {setupHelpOpen && (selectedProvider === "google" || selectedProvider === "microsoft") && (
          <SetupHelpPanel provider={selectedProvider} />
        )}

        {/* STEP 1: Select Provider */}
        {!selectedProvider && (
          <div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Choose the type of calendar account you want to connect to Chronarch.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Google option */}
              <button
                onClick={() => selectProvider("google")}
                className="hoverable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "14px 18px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius-md)",
                      background: "rgba(10, 132, 255, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "var(--text-lg)",
                      fontWeight: 700,
                      color: "var(--accent)",
                    }}
                  >
                    <ProviderLogo provider="google" />
                  </div>
                  <div>
                    <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Google Calendar</div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                      Personal Gmail or Google Workspace accounts
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                      background: isGoogleConfigured ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 159, 10, 0.15)",
                      color: isGoogleConfigured ? "var(--success)" : "var(--warning)",
                    }}
                  >
                    {isGoogleConfigured ? "READY TO CONNECT" : "SETUP NEEDED"}
                  </span>
                  <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-md)" }}>→</span>
                </div>
              </button>

              {/* Microsoft option */}
              <button
                onClick={() => selectProvider("microsoft")}
                className="hoverable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "14px 18px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius-md)",
                      background: "rgba(48, 209, 88, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "var(--text-lg)",
                    }}
                  >
                    <ProviderLogo provider="microsoft" />
                  </div>
                  <div>
                    <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Microsoft 365 / Outlook</div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                      Office 365, Exchange, or live.com accounts
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                      background: isMicrosoftConfigured ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 159, 10, 0.15)",
                      color: isMicrosoftConfigured ? "var(--success)" : "var(--warning)",
                    }}
                  >
                    {isMicrosoftConfigured ? "READY TO CONNECT" : "SETUP NEEDED"}
                  </span>
                  <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-md)" }}>→</span>
                </div>
              </button>

              {/* CalDAV option */}
              <button
                onClick={() => selectProvider("caldav")}
                className="hoverable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "14px 18px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius-md)",
                      background: "rgba(94, 92, 230, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "var(--text-lg)",
                    }}
                  >
                    <Icon name="calendar" size={19} />
                  </div>
                  <div>
                    <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>CalDAV Account</div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                      iCloud, Fastmail, Nextcloud, or any standard CalDAV server
                    </div>
                  </div>
                </div>
                <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-md)" }}>→</span>
              </button>

              {/* ICS Feed option */}
              <button
                onClick={() => selectProvider("ics")}
                className="hoverable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "14px 18px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius-md)",
                      background: "rgba(255, 159, 10, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "var(--text-lg)",
                    }}
                  >
                    <Icon name="folder" size={19} />
                  </div>
                  <div>
                    <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>iCalendar / ICS Subscription</div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                      Public or private HTTP / HTTPS / webcal feeds (read-only)
                    </div>
                  </div>
                </div>
                <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-md)" }}>→</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Google Flow */}
        {selectedProvider === "google" && (
          <div>
            {configError && (
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--danger)",
                  background: "rgba(255, 69, 58, 0.1)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 16,
                }}
              >
                {configError}
              </div>
            )}

            {googleReview && isGoogleConfigured ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "rgba(10, 132, 255, 0.12)", display: "grid", placeItems: "center", fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--accent)" }}>G</div>
                  <div><div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Ready to connect Google</div><div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Review what Chronarch will access before you continue.</div></div>
                </div>
                <div style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 14 }}>Google will ask you to choose an account and approve access. You’ll return to Chronarch when setup is complete.</div>
                <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}><Icon name="check" size={13} strokeWidth={2.5} style={{ color: "var(--success)", flexShrink: 0 }} /><div><div style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>Read your calendar availability</div><div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Find conflicts and suggest open meeting times.</div></div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}><Icon name="check" size={13} strokeWidth={2.5} style={{ color: "var(--success)", flexShrink: 0 }} /><div><div style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>Sync calendar events</div><div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Show your calendars and event details in Chronarch.</div></div></div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setGoogleReview(false)} className="btn-secondary hoverable">Back</button><button onClick={handleGoogleDirectConnect} disabled={connecting} className="btn-primary hoverable">{connecting ? "Redirecting to Google…" : "Continue to Google →"}</button></div>
              </div>
            ) : isGoogleConfigured ? (
              /* Already configured -> 1-click connect */
              <div>
                <div
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: 18,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>OAuth Credentials Active</span>
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 700,
                        background: "rgba(48, 209, 88, 0.15)",
                        color: "var(--success)",
                        padding: "2px 6px",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      CONFIGURED
                    </span>
                  </div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                    Your Google OAuth application credentials are ready. Clicking continue will securely redirect you to Google to select your account and grant calendar permissions.
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={onClose} className="btn-secondary hoverable">
                    Cancel
                  </button>
                  <button
                    onClick={() => setGoogleReview(true)}
                    disabled={connecting}
                    className="btn-primary hoverable"
                    style={{ padding: "8px 20px" }}
                  >
                    Review access
                  </button>
                </div>
              </div>
            ) : (
              /* Needs setup -> Guided 3-step wizard */
              <div>
                <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
                  To connect Google Calendar to your self-hosted Chronarch instance, set up an OAuth Client in the Google Cloud Console.
                </p>

                {/* Step 1: Redirect URI */}
                <div
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: 14,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    Step 1: Copy your Authorized Redirect URI
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 8 }}>
                    In Google Cloud Console under Credentials → Web application → Authorized redirect URIs:
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      readOnly
                      value={googleRedirectUri}
                      className="input-standard"
                      style={{ flex: 1, fontSize: "var(--text-sm)", background: "var(--bg-app)", color: "var(--accent)" }}
                    />
                    <button
                      onClick={() => handleCopyUri(googleRedirectUri)}
                      className="btn-secondary hoverable"
                      style={{ fontSize: "var(--text-sm)", padding: "6px 10px", whiteSpace: "nowrap" }}
                    >
                      {copiedUri ? "Copied" : "Copy URI"}
                    </button>
                  </div>
                </div>

                {/* Step 2: Google Console helper */}
                <div
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: 14,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    Step 2: Create Credentials in Google Cloud
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    1. Ensure <strong>Google Calendar API</strong> is enabled.<br />
                    2. Go to <strong>Credentials</strong> → <strong>Create Credentials</strong> → <strong>OAuth client ID</strong>.<br />
                    3. Application Type: <strong>Web application</strong>. Paste the Redirect URI from Step 1 above.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "var(--text-sm)", color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
                    >
                      Open Google Cloud Console Credentials ↗
                    </a>
                  </div>
                </div>

                {/* Step 3: Enter credentials */}
                <div
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: 14,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>
                    Step 3: Enter your Client ID & Secret
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Client ID <FieldHelp text="Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs. Copy the Client ID from your Web application credential." />
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 123456789-abcdef.apps.googleusercontent.com"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: "var(--text-sm)" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Client Secret <FieldHelp text="Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs. Open your Web application credential and copy the Client secret." />
                      </label>
                      <input
                        type="password"
                        placeholder="e.g. GOCSPX-xxxxxxxxxxxxxxxx"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: "var(--text-sm)" }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={onClose} className="btn-secondary hoverable">
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAndConnectGoogle}
                    disabled={savingConfig || connecting}
                    className="btn-primary hoverable"
                    style={{ padding: "8px 20px" }}
                  >
                    {savingConfig ? "Saving Credentials…" : connecting ? "Redirecting…" : "Save & Connect Google Account"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Microsoft Flow */}
        {selectedProvider === "microsoft" && (
          <div>
            {configError && (
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--danger)",
                  background: "rgba(255, 69, 58, 0.1)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 16,
                }}
              >
                {configError}
              </div>
            )}

            {isMicrosoftConfigured && !editMicrosoftConfig ? (
              <div>
                <div
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: 18,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Microsoft OAuth Configured</span>
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 700,
                        background: "rgba(48, 209, 88, 0.15)",
                        color: "var(--success)",
                        padding: "2px 6px",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      CONFIGURED
                    </span>
                  </div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                    Your Microsoft Azure client credentials are ready. Clicking continue will securely redirect you to Microsoft Graph to authorize calendar access.
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={onClose} className="btn-secondary hoverable">
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setEditMicrosoftConfig(true);
                      setClientId("");
                      setClientSecret("");
                      setTenantId(oauth.microsoft?.tenant_id || "common");
                      setConfigError(null);
                    }}
                    className="btn-secondary hoverable"
                  >
                    Edit credentials
                  </button>
                  <button
                    onClick={handleMicrosoftDirectConnect}
                    disabled={connecting}
                    className="btn-primary hoverable"
                    style={{ padding: "8px 20px" }}
                  >
                    {connecting ? "Redirecting to Microsoft…" : "Authorize & Connect with Microsoft"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
                  Set up an App Registration in Azure Portal to connect Microsoft 365 or Outlook accounts.
                </p>

                {/* Step 1: Redirect URI */}
                <div
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: 14,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    Step 1: Copy your Redirect URI
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 8 }}>
                    In Azure Portal under App registrations → Authentication → Add a platform (Web):
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      readOnly
                      value={microsoftRedirectUri}
                      className="input-standard"
                      style={{ flex: 1, fontSize: "var(--text-sm)", background: "var(--bg-app)", color: "var(--accent)" }}
                    />
                    <button
                      onClick={() => handleCopyUri(microsoftRedirectUri)}
                      className="btn-secondary hoverable"
                      style={{ fontSize: "var(--text-sm)", padding: "6px 10px", whiteSpace: "nowrap" }}
                    >
                      {copiedUri ? "Copied" : "Copy URI"}
                    </button>
                  </div>
                </div>

                {/* Step 2: Credentials */}
                <div
                  style={{
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    padding: 14,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>
                    {editMicrosoftConfig ? "Update Microsoft credentials" : "Step 2: Enter Application (Client) ID & Secret"}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Application (Client) ID <FieldHelp text="Azure Portal → Microsoft Entra ID → App registrations → your app → Overview. Copy the Application (client) ID." />
                      </label>
                      <input
                        type="text"
                        placeholder="Azure Application Client ID (UUID)"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: "var(--text-sm)" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Client Secret Value <FieldHelp text="Azure Portal → App registrations → your app → Certificates & secrets → Client secrets. Copy the Secret Value immediately after creating it; the Secret ID will not work." />
                      </label>
                      <input
                        type="password"
                        placeholder="Client Secret string from Certificates & secrets"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: "var(--text-sm)" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Tenant ID (optional, defaults to common) <FieldHelp text="Azure Portal → Microsoft Entra ID → Overview. Use the Directory (tenant) ID for a single organization, or leave this as common for multi-tenant sign-in." />
                      </label>
                      <input
                        type="text"
                        placeholder="common (or specific organization Tenant ID)"
                        value={tenantId}
                        onChange={(e) => setTenantId(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: "var(--text-sm)" }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={onClose} className="btn-secondary hoverable">
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAndConnectMicrosoft}
                    disabled={savingConfig || connecting}
                    className="btn-primary hoverable"
                    style={{ padding: "8px 20px" }}
                  >
                    {savingConfig ? "Saving Credentials…" : connecting ? "Redirecting…" : editMicrosoftConfig ? "Save & Reconnect Microsoft" : "Save & Connect Microsoft"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: CalDAV Flow */}
        {selectedProvider === "caldav" && (
          <div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Connect a standard CalDAV account with its server URL, username, and password (BR-CAL-003).
              Calendars are discovered automatically and synced like Google/Microsoft accounts.
            </p>

            {caldavError && (
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--danger)",
                  background: "rgba(255, 69, 58, 0.1)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 16,
                }}
              >
                {caldavError}
              </div>
            )}
            {caldavTestOk && (
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--success)",
                  background: "rgba(48, 209, 88, 0.1)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 16,
                }}
              >
                {caldavTestOk}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>
                  CalDAV Server URL
                </label>
                <input
                  type="url"
                  placeholder="https://caldav.example.com/remote.php/dav"
                  value={caldavUrl}
                  onChange={(e) => setCaldavUrl(e.target.value)}
                  className="input-standard"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>
                  Username
                </label>
                <input
                  type="text"
                  placeholder="you@example.com"
                  value={caldavUsername}
                  onChange={(e) => setCaldavUsername(e.target.value)}
                  className="input-standard"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>
                  Password (stored encrypted)
                </label>
                <input
                  type="password"
                  placeholder="App-specific password recommended"
                  value={caldavPassword}
                  onChange={(e) => setCaldavPassword(e.target.value)}
                  className="input-standard"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>
                  Display Label (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Fastmail"
                  value={caldavLabel}
                  onChange={(e) => setCaldavLabel(e.target.value)}
                  className="input-standard"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={onClose} className="btn-secondary hoverable">
                Cancel
              </button>
              <button
                onClick={handleTestCaldav}
                disabled={caldavTesting || caldavSaving}
                className="btn-secondary hoverable"
                style={{ padding: "8px 20px" }}
              >
                {caldavTesting ? "Testing…" : "Test Connection"}
              </button>
              <button
                onClick={handleConnectCaldav}
                disabled={caldavSaving}
                className="btn-primary hoverable"
                style={{ padding: "8px 20px" }}
              >
                {caldavSaving ? "Connecting…" : "Connect CalDAV"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: ICS Subscription & Local Upload Flow */}
        {selectedProvider === "ics" && (
          <div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Subscribe to an external iCalendar feed via URL or upload a local .ics meeting file.
            </p>

            {icsError && (
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--danger)",
                  background: "rgba(255, 69, 58, 0.1)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 16,
                }}
              >
                {icsError}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
              {/* ICS Feed URL Subscription */}
              <div style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 14 }}>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 700, marginBottom: 10 }}>Option A: Subscribe to Feed URL</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    type="text"
                    placeholder="Calendar Name (e.g. Team Feed)"
                    value={icsName}
                    onChange={(e) => setIcsName(e.target.value)}
                    className="input-standard"
                    style={{ width: "100%", fontSize: "var(--text-sm)" }}
                  />
                  <input
                    type="url"
                    placeholder="https://example.com/calendar.ics"
                    value={icsUrl}
                    onChange={(e) => setIcsUrl(e.target.value)}
                    className="input-standard"
                    style={{ width: "100%", fontSize: "var(--text-sm)" }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={handleSaveIcsSubscription}
                      disabled={icsSaving || !icsUrl.trim()}
                      className="btn-primary hoverable"
                      style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
                    >
                      {icsSaving ? "Subscribing…" : "Subscribe to Feed"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Local .ics File Upload */}
              <div style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 14 }}>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 700, marginBottom: 4 }}>Option B: Upload Local .ics File</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 10 }}>
                  Select an iCalendar (.ics) file from your computer to import events.
                </div>
                <label className="btn-secondary hoverable" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: "var(--text-sm)", cursor: "pointer" }}>
                  <span>Choose .ics File</span>
                  <input
                    type="file"
                    accept=".ics"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setIcsSaving(true);
                      setIcsError(null);
                      try {
                        const text = await file.text();
                        const parsed = await previewIcs(text);
                        if (parsed.events.length === 0) {
                          setIcsError("No valid events found in file.");
                          setIcsSaving(false);
                          return;
                        }
                        const cals = await listCalendars();
                        const writableCals = cals.filter((c) => c.can_create || c.writable);
                        if (writableCals.length === 0) {
                          setIcsError("Importing events from a local .ics file requires a connected writable calendar (e.g. Google Calendar or Microsoft 365). Connect an account first, or use 'Option A: Subscribe to Feed URL' for external read-only feeds.");
                          setIcsSaving(false);
                          return;
                        }
                        const target = writableCals[0];
                        for (const ev of parsed.events) {
                          await importIcsEvent({
                            calendar_id: target.id,
                            title: ev.title,
                            start: ev.start,
                            end: ev.end,
                            timezone: ev.timezone,
                            description: ev.description,
                            location: ev.location,
                            all_day: ev.all_day,
                          });
                        }
                        onAccountAdded();
                      } catch (err) {
                        setIcsError(String(err));
                        setIcsSaving(false);
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={onClose} className="btn-secondary hoverable">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Advanced Provider Credential Row Card
// ----------------------------------------------------------------------------

function ProviderCredentialCard({
  provider,
  title,
  hint,
  config,
  showTenant,
  saving,
  onSave,
  onClear,
}: {
  provider: string;
  title: string;
  hint: string;
  config: OAuthProviderConfig | undefined;
  showTenant: boolean;
  saving: boolean;
  onSave: (body: { client_id?: string; client_secret?: string; tenant_id?: string | null }) => void;
  onClear: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");

  const configured = !!config && (config.client_id_configured || config.client_secret_configured);

  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>{title}</span>
        <span
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 700,
            letterSpacing: 0.5,
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            background: configured ? "rgba(48, 209, 88, 0.15)" : "var(--wash-faint)",
            color: configured ? "var(--success)" : "var(--text-tertiary)",
          }}
        >
          {configured ? "CONFIGURED" : "NOT CONFIGURED"}
        </span>
      </div>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", margin: "0 0 10px" }}>{hint}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          type="text"
          placeholder={config?.client_id_configured ? "Client ID (configured)" : "Client ID"}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="input-standard"
          style={{ flex: "1 1 200px" }}
        />
        <input
          type="password"
          placeholder={config?.client_secret_configured ? "Client Secret (configured)" : "Client Secret"}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          className="input-standard"
          style={{ flex: "1 1 200px" }}
        />
        {showTenant && (
          <input
            type="text"
            placeholder={config?.tenant_id ? `Tenant ID (${config.tenant_id})` : "Tenant ID (optional)"}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="input-standard"
            style={{ flex: "1 1 180px" }}
          />
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={() => {
            onSave({
              ...(clientId ? { client_id: clientId } : {}),
              ...(clientSecret ? { client_secret: clientSecret } : {}),
              ...(showTenant ? { tenant_id: tenantId || null } : {}),
            });
            setClientId("");
            setClientSecret("");
          }}
          disabled={saving}
          className="btn-primary hoverable"
          style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
        >
          {saving ? "Saving…" : `Save ${title} credentials`}
        </button>
        {configured && (
          <button
            onClick={onClear}
            disabled={saving}
            className="btn-danger hoverable"
            style={{ padding: "6px 14px", fontSize: "var(--text-sm)" }}
          >
            {saving ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProviderLogo({ provider }: { provider: string }) {
  if (provider === "google") {
    return (
      <div aria-label="Google" title="Google" style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--text-on-fill)", border: "1px solid var(--border-subtle)", display: "grid", placeItems: "center" }}>
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.26Z" />
          <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.75 9.75 0 0 0 12 21.6Z" />
          <path fill="#FBBC05" d="M6.53 13.68A5.86 5.86 0 0 1 6.22 12c0-.58.1-1.15.31-1.68V7.79H3.28A9.74 9.74 0 0 0 2.25 12c0 1.57.38 3.06 1.03 4.21l3.25-2.53Z" />
          <path fill="#EA4335" d="M12 6.29c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.84 3.38 14.63 2.4 12 2.4a9.75 9.75 0 0 0-8.72 5.39l3.25 2.53C7.3 8.01 9.46 6.29 12 6.29Z" />
        </svg>
      </div>
    );
  }
  if (provider === "microsoft") {
    return (
      <div aria-label="Microsoft" title="Microsoft" style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--text-on-fill)", border: "1px solid var(--border-subtle)", display: "grid", placeItems: "center" }}>
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <path fill="#f35325" d="M2 2h9.5v9.5H2z" /><path fill="#81bc06" d="M12.5 2H22v9.5h-9.5z" />
          <path fill="#05a6f0" d="M2 12.5h9.5V22H2z" /><path fill="#ffba08" d="M12.5 12.5H22V22h-9.5z" />
        </svg>
      </div>
    );
  }
  return <div style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "rgba(94, 92, 230, 0.15)", display: "grid", placeItems: "center", }}><Icon name={provider === "caldav" ? "calendar" : "folder"} size={19} /></div>;
}

function SetupHelpPanel({ provider }: { provider: "google" | "microsoft" }) {
  const google = provider === "google";
  return (
    <div
      role="region"
      aria-label={`${google ? "Google" : "Microsoft"} setup instructions`}
      style={{
        background: "var(--accent-soft)",
        border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border-subtle))",
        borderRadius: "var(--radius-md)",
        padding: "14px 16px",
        marginBottom: 18,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: "var(--text-md)", fontWeight: 750 }}>How to get your {google ? "Google" : "Microsoft"} credentials</div>
        <a
          href={google ? "https://console.cloud.google.com/apis/credentials" : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", fontSize: "var(--text-sm)", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          Open {google ? "Google Cloud" : "Microsoft Entra"} ↗
        </a>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {(google
          ? [
              ["1", "Open Google Cloud Console", "Select or create a project, then enable Google Calendar API."],
              ["2", "Create a Web OAuth client", "Go to APIs & Services → Credentials → Create Credentials → OAuth client ID. Choose Web application."],
              ["3", "Add the redirect URI", "Copy the URI shown in Step 1 below and add it under Authorized redirect URIs."],
              ["4", "Copy both values", "Open the new credential and copy Client ID and Client secret into Step 3 below."],
            ]
          : [
              ["1", "Open Microsoft Entra admin center", "Go to App registrations → New registration. Give the app a name and choose the account type your organization needs."],
              ["2", "Add the redirect URI", "Open Authentication → Add a platform → Web. Copy the URI shown in Step 1 below into Redirect URI."],
              ["3", "Copy the Application (client) ID", "Find it on the app Overview page and paste it into the first field below."],
              ["4", "Create and copy a secret", "Open Certificates & secrets → New client secret. Copy the Secret Value immediately; it is shown only once. Do not use Secret ID."],
            ]).map(([number, title, description]) => (
          <div key={number} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 8, alignItems: "start" }}>
            <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "var(--text-on-fill)", fontSize: "var(--text-xs)", fontWeight: 800 }}>{number}</span>
            <div>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>{title}</div>
              <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.4 }}>{description}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", lineHeight: 1.4, marginTop: 10, paddingTop: 9, borderTop: "1px solid color-mix(in srgb, var(--accent) 18%, transparent)" }}>
        Keep this window open while you follow the steps. Nothing is saved until you select Save &amp; Connect.
      </div>
    </div>
  );
}

function FieldHelp({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 15,
        height: 15,
        border: "1px solid var(--text-tertiary)",
        borderRadius: "50%",
        color: "var(--text-tertiary)",
        fontSize: "var(--text-xs)",
        fontWeight: 800,
        cursor: "help",
        userSelect: "none",
      }}
    >
      ?
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-app)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  padding: "7px 10px",
  fontSize: "var(--text-sm)",
  colorScheme: "dark",
};

const btnStyle: React.CSSProperties = {
  border: "none",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-on-fill)",
  background: "var(--accent)",
  padding: "7px 12px",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  cursor: "pointer",
};
