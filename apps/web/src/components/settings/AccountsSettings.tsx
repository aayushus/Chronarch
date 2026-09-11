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
  access_denied: "Google sign-in was cancelled.",
  missing_code_or_state: "Google didn't return the expected response — try again.",
  invalid_state: "That connect link expired or was already used — try again.",
  unauthorized: "Your admin session expired — sign in again and retry.",
  connect_failed: "Couldn't finish connecting that account. Check the server logs for details.",
};

export default function AccountsSettings() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [oauth, setOauth] = useState<Record<string, OAuthProviderConfig>>({});
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthSaving, setOauthSaving] = useState<string | null>(null);

  // ICS Subscription state (BR-CAL-004)
  const [showIcsSubModal, setShowIcsSubModal] = useState(false);
  const [icsSubName, setIcsSubName] = useState("");
  const [icsSubUrl, setIcsSubUrl] = useState("");
  const [icsSubSaving, setIcsSubSaving] = useState(false);
  const [icsSubError, setIcsSubError] = useState<string | null>(null);

  async function handleCreateIcsSub() {
    setIcsSubSaving(true);
    setIcsSubError(null);
    try {
      await adminAddIcsSubscription({ name: icsSubName.trim(), url: icsSubUrl.trim() });
      setBanner({ kind: "success", text: `Subscribed to ${icsSubName.trim()} ICS calendar feed.` });
      setShowIcsSubModal(false);
      setIcsSubName("");
      setIcsSubUrl("");
      load();
    } catch (e) {
      setIcsSubError(String(e));
    } finally {
      setIcsSubSaving(false);
    }
  }

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
      setBanner({ kind: "success", text: `Connected a ${connected} account.` });
    } else if (errParam) {
      setBanner({ kind: "error", text: ERROR_MESSAGES[errParam] ?? `Connection failed (${errParam}).` });
    }
    if (connected || errParam) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleConnectGoogle() {
    setConnecting(true);
    setError(null);
    try {
      const url = await adminGetGoogleConnectUrl();
      window.location.href = url;
    } catch (e) {
      setError(String(e));
      setConnecting(false);
    }
  }

  async function handleConnectMicrosoft() {
    setConnecting(true);
    setError(null);
    try {
      const url = await adminGetMicrosoftConnectUrl();
      window.location.href = url;
    } catch (e) {
      setError(String(e));
      setConnecting(false);
    }
  }


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
    } catch (e) {
      setOauthError(String(e));
    } finally {
      setOauthSaving(null);
    }
  }

  async function handleClearOAuth(provider: string) {
    if (!confirm(`Clear stored ${provider} OAuth credentials? Existing connected accounts keep working until their tokens expire, but new connects will fail.`)) return;
    setOauthSaving(provider);
    try {
      const updated = await adminClearOAuthConfig(provider);
      setOauth((prev) => ({ ...prev, [provider]: updated }));
    } catch (e) {
      setOauthError(String(e));
    } finally {
      setOauthSaving(null);
    }
  }

  async function handleDisconnect(a: AdminAccount) {
    if (!confirm(`Disconnect ${a.provider_account_email}? This removes its ${a.calendar_count} calendar(s) and cached events.`)) return;
    try {
      await adminDisconnectAccount(a.id);
      setAccounts((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Accounts</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        Connected Google and Microsoft accounts (BR-CAL-001/002). Connecting an account discovers its calendars and
        backfills the last 90 days / next 365 days of events.
      </p>

      {banner && (
        <div
          style={{
            fontSize: 12,
            borderRadius: 8,
            padding: 12,
            marginBottom: 20,
            background: banner.kind === "success" ? "var(--success)" : "var(--danger)",
            color: banner.kind === "success" ? "#062611" : "#2b0705",
          }}
        >
          {banner.text}
        </div>
      )}

      <div style={{ background: "var(--bg-raised)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", padding: 18, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Provider credentials</div>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 16px" }}>
          OAuth client credentials for connecting accounts — stored encrypted, never displayed back.
          Leave a field blank to keep its stored value. Server env vars remain as fallback.
        </p>
        {oauthError && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{oauthError}</div>}
        <ProviderCredentialCard
          provider="google"
          title="Google"
          hint="Google Cloud Console → APIs & Services → Credentials → Web application OAuth client (enable Google Calendar API). Redirect URI: this origin + /api/v1/admin/accounts/google/callback"
          config={oauth.google}
          showTenant={false}
          saving={oauthSaving === "google"}
          onSave={(body) => handleSaveOAuth("google", body)}
          onClear={() => handleClearOAuth("google")}
        />
        <ProviderCredentialCard
          provider="microsoft"
          title="Microsoft"
          hint="Azure portal → App registrations → Web client (enable Calendars.ReadWrite and User.Read permissions). Redirect URI: this origin + /api/v1/admin/accounts/microsoft/callback"
          config={oauth.microsoft}
          showTenant
          saving={oauthSaving === "microsoft"}
          onSave={(body) => handleSaveOAuth("microsoft", body)}
          onClear={() => handleClearOAuth("microsoft")}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
        <button onClick={handleConnectGoogle} disabled={connecting} className="btn-primary">
          {connecting ? "Redirecting…" : "+ Connect Google Account"}
        </button>
        <button onClick={handleConnectMicrosoft} disabled={connecting} className="btn-primary">
          {connecting ? "Redirecting…" : "+ Connect Microsoft Account"}
        </button>
        <button
          onClick={() => setShowIcsSubModal(true)}
          className="btn-secondary"
        >
          <span>📁</span>
          <span>+ Subscribe to ICS Feed</span>
        </button>
      </div>

      {showIcsSubModal && (
        <div className="modal-backdrop" onClick={() => setShowIcsSubModal(false)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 480, maxWidth: "90vw", padding: 24 }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>Subscribe to ICS Calendar Feed</h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Add a public or private iCalendar feed via HTTP/HTTPS/webcal URL (BR-CAL-004). These calendars are synchronized periodically and treated as read-only.
            </p>
            {icsSubError && (
              <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12, background: "rgba(255, 69, 58, 0.1)", padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>
                {icsSubError}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Calendar Name</label>
                <input
                  type="text"
                  placeholder="e.g. US Holidays, Team Schedule"
                  value={icsSubName}
                  onChange={(e) => setIcsSubName(e.target.value)}
                  className="input-standard"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>ICS Feed URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/calendar.ics or webcal://..."
                  value={icsSubUrl}
                  onChange={(e) => setIcsSubUrl(e.target.value)}
                  className="input-standard"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setShowIcsSubModal(false)}
                type="button"
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateIcsSub}
                disabled={icsSubSaving || !icsSubName.trim() || !icsSubUrl.trim()}
                type="button"
                className="btn-primary"
              >
                {icsSubSaving ? "Subscribing…" : "Subscribe"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Connected Accounts</div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {accounts.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-tertiary)", background: "var(--bg-raised)", padding: "20px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", textAlign: "center" }}>
          No accounts connected yet. Connect Google or Microsoft above.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {accounts.map((a) => (
          <div
            key={a.id}
            style={{
              background: "var(--bg-raised)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              padding: 16,
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <span>{a.provider_account_email}</span>
                <span
                  style={{
                    fontSize: 11,
                    textTransform: "capitalize",
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: a.provider === "google" ? "rgba(10, 132, 255, 0.15)" : a.provider === "microsoft" ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 255, 255, 0.1)",
                    color: a.provider === "google" ? "var(--accent)" : a.provider === "microsoft" ? "var(--success)" : "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  {a.provider}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
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
            <button
              onClick={() => handleDisconnect(a)}
              className="btn-danger"
              style={{ padding: "6px 12px", fontSize: 12 }}
            >
              Disconnect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

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
          className="btn-primary"
          style={{ padding: "6px 14px", fontSize: 12 }}
        >
          {saving ? "Saving…" : `Save ${title} credentials`}
        </button>
        {configured && (
          <button
            onClick={onClear}
            disabled={saving}
            className="btn-danger"
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
