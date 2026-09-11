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

      <div style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Provider credentials</div>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 12px" }}>
          OAuth client credentials for connecting accounts — stored encrypted, never displayed back.
          Leave a field blank to keep its stored value. Server env vars remain as fallback.
        </p>
        {oauthError && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{oauthError}</div>}
        <ProviderCredentialCard
          provider="google"
          title="Google"
          hint="Google Cloud Console → APIs & Services → Credentials → Web application OAuth client (enable the Google Calendar API). Redirect URI: this origin + /api/v1/admin/accounts/google/callback"
          config={oauth.google}
          showTenant={false}
          saving={oauthSaving === "google"}
          onSave={(body) => handleSaveOAuth("google", body)}
          onClear={() => handleClearOAuth("google")}
        />
        <ProviderCredentialCard
          provider="microsoft"
          title="Microsoft"
          hint="Azure portal → App registrations → Web client (enable Calendars.ReadWrite and User.Read permissions)."
          config={oauth.microsoft}
          showTenant
          saving={oauthSaving === "microsoft"}
          onSave={(body) => handleSaveOAuth("microsoft", body)}
          onClear={() => handleClearOAuth("microsoft")}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button onClick={handleConnectGoogle} disabled={connecting} className="hoverable" style={{ ...btnStyle, opacity: connecting ? 0.6 : 1 }}>
          {connecting ? "Redirecting…" : "+ Connect Google Account"}
        </button>
        <button onClick={handleConnectMicrosoft} disabled={connecting} className="hoverable" style={{ ...btnStyle, opacity: connecting ? 0.6 : 1 }}>
          {connecting ? "Redirecting…" : "+ Connect Microsoft Account"}
        </button>
        <button
          onClick={() => setShowIcsSubModal(true)}
          className="hoverable"
          style={{ ...btnStyle, background: "var(--bg-raised)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
        >
          + Subscribe to ICS Feed (BR-CAL-004)
        </button>
      </div>

      {showIcsSubModal && (
        <div className="modal-backdrop" onClick={() => setShowIcsSubModal(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 460, maxWidth: "90vw", padding: 24 }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Subscribe to ICS Calendar Feed</h3>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
              Add a public or private iCalendar feed via HTTP/HTTPS/webcal URL (BR-CAL-004). These calendars are synchronized periodically and treated as read-only.
            </p>
            {icsSubError && (
              <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{icsSubError}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Calendar Name</label>
                <input
                  type="text"
                  placeholder="e.g. US Holidays, Team Schedule"
                  value={icsSubName}
                  onChange={(e) => setIcsSubName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--border-subtle)",
                    background: "var(--bg-base)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>ICS Feed URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/calendar.ics or webcal://..."
                  value={icsSubUrl}
                  onChange={(e) => setIcsSubUrl(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--border-subtle)",
                    background: "var(--bg-base)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setShowIcsSubModal(false)}
                className="hoverable"
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                  background: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateIcsSub}
                disabled={icsSubSaving || !icsSubName.trim() || !icsSubUrl.trim()}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: icsSubSaving ? "not-allowed" : "pointer",
                }}
              >
                {icsSubSaving ? "Subscribing…" : "Subscribe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {accounts.length === 0 && <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No accounts connected.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {accounts.map((a) => (
          <div key={a.id} style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {a.provider_account_email} <span style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "capitalize" }}>({a.provider})</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                Owner: {a.owner_email} · {a.calendar_count} calendar{a.calendar_count === 1 ? "" : "s"} · sync:{" "}
                <span style={{ color: a.sync_status === "error" ? "var(--danger)" : a.sync_status === "ok" ? "var(--success)" : "var(--text-tertiary)" }}>
                  {a.sync_status}
                </span>
              </div>
            </div>
            <button onClick={() => handleDisconnect(a)} className="hoverable" style={{ background: "none", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
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
    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 4,
            padding: "2px 6px",
            background: configured ? "var(--success)" : "var(--bg-app)",
            color: configured ? "#062611" : "var(--text-tertiary)",
          }}
        >
          {configured ? "CONFIGURED" : "NOT CONFIGURED"}
        </span>
        {config && (
          <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
            ID {config.client_id_configured ? "✓" : "—"} · secret {config.client_secret_configured ? "✓" : "—"}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 8 }}>{hint}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          placeholder={config?.client_id_configured ? "Client ID (stored — blank keeps it)" : "Client ID"}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
          style={{ ...inputStyle, minWidth: 220, flex: 1 }}
        />
        <input
          placeholder={config?.client_secret_configured ? "Client secret (stored — blank keeps it)" : "Client secret"}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          type="password"
          autoComplete="new-password"
          style={{ ...inputStyle, minWidth: 220, flex: 1 }}
        />
        {showTenant && (
          <input
            placeholder="Tenant ID (optional)"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            autoComplete="off"
            style={{ ...inputStyle, minWidth: 160 }}
          />
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
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
          className="hoverable"
          style={{ ...btnStyle, background: "var(--accent)", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : `Save ${title} credentials`}
        </button>
        {configured && (
          <button
            onClick={onClear}
            disabled={saving}
            className="hoverable"
            style={{ ...btnStyle, background: "none", border: "1px solid var(--danger)", color: "var(--danger)" }}
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
