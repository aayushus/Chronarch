import React, { useEffect, useState } from "react";

import { AdminAccount, adminDisconnectAccount, adminGetGoogleConnectUrl, adminListAccounts } from "../../api/admin";

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

  function load() {
    adminListAccounts()
      .then(setAccounts)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
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

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button onClick={handleConnectGoogle} disabled={connecting} className="hoverable" style={{ ...btnStyle, opacity: connecting ? 0.6 : 1 }}>
          {connecting ? "Redirecting to Google…" : "+ Connect Google Account"}
        </button>
        <button disabled className="hoverable" style={{ ...btnStyle, background: "var(--bg-raised)", color: "var(--text-tertiary)", cursor: "not-allowed" }} title="Microsoft Graph connector not implemented yet">
          + Connect Microsoft Account (coming soon)
        </button>
      </div>

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
