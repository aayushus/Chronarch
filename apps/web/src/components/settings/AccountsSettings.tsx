import React, { useEffect, useState } from "react";

import {
  AdminAccount,
  OAuthProviderConfig,
  adminAddIcsSubscription,
  adminClearOAuthConfig,
  adminDisconnectAccount,
  adminGetGoogleConnectUrl,
  adminGetMicrosoftConnectUrl,
  adminListAccounts,
  adminListOAuthConfigs,
  adminSaveOAuthConfig,
} from "../../api/admin";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  missing_code_or_state: "Provider didn't return the expected response — try again.",
  invalid_state: "That connect link expired or was already used — try again.",
  unauthorized: "Your admin session expired — sign in again and retry.",
  connect_failed: "Couldn't finish connecting that account. Check the server logs for details.",
};

type WizardProvider = "google" | "microsoft" | "ics" | null;

export default function AccountsSettings() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [oauth, setOauth] = useState<Record<string, OAuthProviderConfig>>({});
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthSaving, setOauthSaving] = useState<string | null>(null);
  const [showAdvancedCredentials, setShowAdvancedCredentials] = useState(false);

  // Wizard Modal state
  const [wizardOpen, setWizardOpen] = useState(false);

  function load() {
    adminListAccounts()
      .then(setAccounts)
      .catch((e) => setError(String(e)))
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
      setBanner({ kind: "success", text: `Connected a ${connected} account successfully.` });
    } else if (errParam) {
      setBanner({ kind: "error", text: ERROR_MESSAGES[errParam] ?? `Connection failed (${errParam}).` });
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
      setError(String(e));
    }
  }

  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  async function handleSyncAccount(a: AdminAccount) {
    setSyncingAccountId(a.id);
    try {
      const { adminSyncAccount } = await import("../../api/calendar");
      const res = await adminSyncAccount(a.id);
      setAccounts((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, last_synced_at: res.last_synced_at, sync_status: "active" } : x))
      );
      setBanner({
        kind: "success",
        text: `Reconciliation sync completed for ${a.provider_account_email}.`,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncingAccountId(null);
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading accounts…</div>;

  return (
    <div>
      {/* Header section */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Accounts</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
            Connected Google, Microsoft, and ICS calendars (BR-CAL-001/002/004). Synchronizes multi-organization schedules and backfills up to 365 days of events.
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="btn-primary hoverable"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          <span>Add Account</span>
        </button>
      </div>

      {banner && (
        <div
          style={{
            fontSize: 13,
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 20,
            background: banner.kind === "success" ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 69, 58, 0.15)",
            border: `1px solid ${banner.kind === "success" ? "var(--success)" : "var(--danger)"}`,
            color: banner.kind === "success" ? "#30d158" : "#ff453a",
            fontWeight: 500,
          }}
        >
          {banner.text}
        </div>
      )}

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Connected Accounts List */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Connected Accounts</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: "var(--bg-raised)",
              padding: "1px 7px",
              borderRadius: 10,
              color: "var(--text-secondary)",
            }}
          >
            {accounts.length}
          </span>
        </div>

        {accounts.length === 0 ? (
          <div
            style={{
              background: "var(--bg-raised)",
              borderRadius: "var(--radius-md)",
              border: "1px dashed var(--border)",
              padding: "36px 20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.8 }}>📅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
              No accounts connected yet
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
              Connect your Google, Microsoft, or external ICS calendar to begin syncing events.
            </div>
            <button
              onClick={() => setWizardOpen(true)}
              className="btn-primary hoverable"
              style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600 }}
            >
              + Connect First Account
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {accounts.map((a) => {
              const isGoogle = a.provider === "google";
              const isMicrosoft = a.provider === "microsoft";

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
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: isGoogle
                          ? "rgba(10, 132, 255, 0.12)"
                          : isMicrosoft
                          ? "rgba(48, 209, 88, 0.12)"
                          : "rgba(255, 159, 10, 0.12)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                      }}
                    >
                      {isGoogle ? "🇬" : isMicrosoft ? "🪟" : "📁"}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{a.provider_account_email}</span>
                        <span
                          style={{
                            fontSize: 10.5,
                            textTransform: "uppercase",
                            padding: "2px 6px",
                            borderRadius: 4,
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
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
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
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                        borderRadius: 6,
                        color: "var(--text-primary)",
                        padding: "6px 12px",
                        fontSize: 12,
                        cursor: syncingAccountId === a.id ? "wait" : "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          transform: syncingAccountId === a.id ? "rotate(360deg)" : "none",
                          transition: syncingAccountId === a.id ? "transform 1s linear infinite" : "none",
                          fontSize: 12,
                        }}
                      >
                        ↻
                      </span>
                      <span>{syncingAccountId === a.id ? "Syncing…" : "Sync Now"}</span>
                    </button>
                    <button
                      onClick={() => handleDisconnect(a)}
                      className="btn-danger hoverable"
                      style={{ padding: "6px 12px", fontSize: 12 }}
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

      {/* Advanced Provider Configuration Accordion */}
      <div
        style={{
          background: "var(--bg-raised)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => setShowAdvancedCredentials((prev) => !prev)}
          className="hoverable"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "transparent",
            border: "none",
            padding: "14px 18px",
            color: "var(--text-primary)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>OAuth Provider Credentials (Advanced)</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
              Manage or clear custom Google Cloud & Microsoft Azure OAuth client credentials stored in database.
            </div>
          </div>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            {showAdvancedCredentials ? "▲ Hide" : "▼ Show"}
          </span>
        </button>

        {showAdvancedCredentials && (
          <div style={{ borderTop: "1px solid var(--border-subtle)", padding: 18 }}>
            {oauthError && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{oauthError}</div>}
            <ProviderCredentialCard
              provider="google"
              title="Google Calendar OAuth"
              hint="Google Cloud Console → APIs & Services → Credentials → Web application OAuth client"
              config={oauth.google}
              showTenant={false}
              saving={oauthSaving === "google"}
              onSave={(body) => handleSaveOAuth("google", body)}
              onClear={() => handleClearOAuth("google")}
            />
            <ProviderCredentialCard
              provider="microsoft"
              title="Microsoft 365 / Graph OAuth"
              hint="Azure portal → App registrations → Web client (Calendars.ReadWrite and User.Read permissions)"
              config={oauth.microsoft}
              showTenant
              saving={oauthSaving === "microsoft"}
              onSave={(body) => handleSaveOAuth("microsoft", body)}
              onClear={() => handleClearOAuth("microsoft")}
            />
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

  // Form states for OAuth configuration
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  // Form states for ICS subscription
  const [icsName, setIcsName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [icsSaving, setIcsSaving] = useState(false);
  const [icsError, setIcsError] = useState<string | null>(null);

  const origin = window.location.origin;
  const googleRedirectUri = `${origin}/api/v1/admin/accounts/google/callback`;
  const microsoftRedirectUri = `${origin}/api/v1/admin/accounts/microsoft/callback`;

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: "94vw", padding: 28 }}
      >
        {/* Modal Top Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {selectedProvider && (
              <button
                onClick={() => {
                  setSelectedProvider(null);
                  setConfigError(null);
                }}
                className="hoverable"
                style={{
                  background: "var(--bg-raised)",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--text-secondary)",
                  padding: "4px 8px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ← Back
              </button>
            )}
            <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
              {selectedProvider === "google"
                ? "Connect Google Calendar"
                : selectedProvider === "microsoft"
                ? "Connect Microsoft 365"
                : selectedProvider === "ics"
                ? "Subscribe to ICS Calendar"
                : "Add an Account"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="hoverable"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              fontSize: 20,
              cursor: "pointer",
              padding: "2px 6px",
            }}
          >
            ✕
          </button>
        </div>

        {/* STEP 1: Select Provider */}
        {!selectedProvider && (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Choose the type of calendar account you want to connect to Chronarch.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Google option */}
              <button
                onClick={() => setSelectedProvider("google")}
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
                      borderRadius: 8,
                      background: "rgba(10, 132, 255, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    🇬
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Google Calendar</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Personal Gmail or Google Workspace accounts
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: isGoogleConfigured ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 159, 10, 0.15)",
                      color: isGoogleConfigured ? "var(--success)" : "var(--warning)",
                    }}
                  >
                    {isGoogleConfigured ? "READY" : "SETUP NEEDED"}
                  </span>
                  <span style={{ color: "var(--text-tertiary)", fontSize: 14 }}>→</span>
                </div>
              </button>

              {/* Microsoft option */}
              <button
                onClick={() => setSelectedProvider("microsoft")}
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
                      borderRadius: 8,
                      background: "rgba(48, 209, 88, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    🪟
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Microsoft 365 / Outlook</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Office 365, Exchange, or live.com accounts
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: isMicrosoftConfigured ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 159, 10, 0.15)",
                      color: isMicrosoftConfigured ? "var(--success)" : "var(--warning)",
                    }}
                  >
                    {isMicrosoftConfigured ? "READY" : "SETUP NEEDED"}
                  </span>
                  <span style={{ color: "var(--text-tertiary)", fontSize: 14 }}>→</span>
                </div>
              </button>

              {/* ICS Feed option */}
              <button
                onClick={() => setSelectedProvider("ics")}
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
                      borderRadius: 8,
                      background: "rgba(255, 159, 10, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    📁
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>iCalendar / ICS Subscription</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Public or private HTTP / HTTPS / webcal feeds (read-only)
                    </div>
                  </div>
                </div>
                <span style={{ color: "var(--text-tertiary)", fontSize: 14 }}>→</span>
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
                  fontSize: 12,
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

            {isGoogleConfigured ? (
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
                    <span style={{ fontSize: 14, fontWeight: 600 }}>OAuth Credentials Active</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: "rgba(48, 209, 88, 0.15)",
                        color: "var(--success)",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      CONFIGURED
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                    Your Google OAuth application credentials are ready. Clicking continue will securely redirect you to Google to select your account and grant calendar permissions.
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={onClose} className="btn-secondary hoverable">
                    Cancel
                  </button>
                  <button
                    onClick={handleGoogleDirectConnect}
                    disabled={connecting}
                    className="btn-primary hoverable"
                    style={{ padding: "8px 20px" }}
                  >
                    {connecting ? "Redirecting to Google…" : "Authorize & Connect with Google →"}
                  </button>
                </div>
              </div>
            ) : (
              /* Needs setup -> Guided 3-step wizard */
              <div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    Step 1: Copy your Authorized Redirect URI
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                    In Google Cloud Console under Credentials → Web application → Authorized redirect URIs:
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      readOnly
                      value={googleRedirectUri}
                      className="input-standard"
                      style={{ flex: 1, fontSize: 11, background: "var(--bg-app)", color: "var(--accent)" }}
                    />
                    <button
                      onClick={() => handleCopyUri(googleRedirectUri)}
                      className="btn-secondary hoverable"
                      style={{ fontSize: 11, padding: "6px 10px", whiteSpace: "nowrap" }}
                    >
                      {copiedUri ? "✓ Copied!" : "Copy URI"}
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    Step 2: Create Credentials in Google Cloud
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    1. Ensure <strong>Google Calendar API</strong> is enabled.<br />
                    2. Go to <strong>Credentials</strong> → <strong>Create Credentials</strong> → <strong>OAuth client ID</strong>.<br />
                    3. Application Type: <strong>Web application</strong>. Paste the Redirect URI from Step 1 above.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>
                    Step 3: Enter your Client ID & Secret
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Client ID
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 123456789-abcdef.apps.googleusercontent.com"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Client Secret
                      </label>
                      <input
                        type="password"
                        placeholder="e.g. GOCSPX-xxxxxxxxxxxxxxxx"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: 12 }}
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
                    {savingConfig ? "Saving Credentials…" : connecting ? "Redirecting…" : "Save & Connect Google Account →"}
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
                  fontSize: 12,
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

            {isMicrosoftConfigured ? (
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
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Microsoft OAuth Configured</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: "rgba(48, 209, 88, 0.15)",
                        color: "var(--success)",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      CONFIGURED
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                    Your Microsoft Azure client credentials are ready. Clicking continue will securely redirect you to Microsoft Graph to authorize calendar access.
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={onClose} className="btn-secondary hoverable">
                    Cancel
                  </button>
                  <button
                    onClick={handleMicrosoftDirectConnect}
                    disabled={connecting}
                    className="btn-primary hoverable"
                    style={{ padding: "8px 20px" }}
                  >
                    {connecting ? "Redirecting to Microsoft…" : "Authorize & Connect with Microsoft →"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    Step 1: Copy your Redirect URI
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                    In Azure Portal under App registrations → Authentication → Add a platform (Web):
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      readOnly
                      value={microsoftRedirectUri}
                      className="input-standard"
                      style={{ flex: 1, fontSize: 11, background: "var(--bg-app)", color: "var(--accent)" }}
                    />
                    <button
                      onClick={() => handleCopyUri(microsoftRedirectUri)}
                      className="btn-secondary hoverable"
                      style={{ fontSize: 11, padding: "6px 10px", whiteSpace: "nowrap" }}
                    >
                      {copiedUri ? "✓ Copied!" : "Copy URI"}
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>
                    Step 2: Enter Application (Client) ID & Secret
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Application (Client) ID
                      </label>
                      <input
                        type="text"
                        placeholder="Azure Application Client ID (UUID)"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Client Secret Value
                      </label>
                      <input
                        type="password"
                        placeholder="Client Secret string from Certificates & secrets"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Tenant ID (optional, defaults to common)
                      </label>
                      <input
                        type="text"
                        placeholder="common (or specific organization Tenant ID)"
                        value={tenantId}
                        onChange={(e) => setTenantId(e.target.value)}
                        className="input-standard"
                        style={{ width: "100%", fontSize: 12 }}
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
                    {savingConfig ? "Saving Credentials…" : connecting ? "Redirecting…" : "Save & Connect Microsoft →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: ICS Subscription Flow */}
        {selectedProvider === "ics" && (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Subscribe to an external iCalendar feed via HTTP, HTTPS, or webcal URL (BR-CAL-004). Events are periodically synchronized and read-only.
            </p>

            {icsError && (
              <div
                style={{
                  fontSize: 12,
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

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  Calendar Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. US Holidays, Team Schedule"
                  value={icsName}
                  onChange={(e) => setIcsName(e.target.value)}
                  className="input-standard"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  ICS Feed URL
                </label>
                <input
                  type="url"
                  placeholder="https://example.com/calendar.ics or webcal://..."
                  value={icsUrl}
                  onChange={(e) => setIcsUrl(e.target.value)}
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
                onClick={handleSaveIcsSubscription}
                disabled={icsSaving}
                className="btn-primary hoverable"
                style={{ padding: "8px 20px" }}
              >
                {icsSaving ? "Subscribing…" : "Subscribe to Calendar"}
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
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            padding: "2px 6px",
            borderRadius: 4,
            background: configured ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 255, 255, 0.08)",
            color: configured ? "var(--success)" : "var(--text-tertiary)",
          }}
        >
          {configured ? "CONFIGURED" : "NOT CONFIGURED"}
        </span>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "0 0 10px" }}>{hint}</p>
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
          style={{ padding: "6px 14px", fontSize: 12 }}
        >
          {saving ? "Saving…" : `Save ${title} credentials`}
        </button>
        {configured && (
          <button
            onClick={onClear}
            disabled={saving}
            className="btn-danger hoverable"
            style={{ padding: "6px 14px", fontSize: 12 }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-app)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "7px 10px",
  fontSize: 12,
  colorScheme: "dark",
};

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
