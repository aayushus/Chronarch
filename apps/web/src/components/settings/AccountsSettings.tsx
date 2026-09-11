import React, { useEffect, useState } from "react";

import { AdminAccount, adminDisconnectAccount, adminListAccounts } from "../../api/admin";

export default function AccountsSettings() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    adminListAccounts()
      .then(setAccounts)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

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
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
        Connected Google and Microsoft accounts (BR-CAL-001/002).
      </p>
      <p style={{ fontSize: 12, color: "var(--warning)", marginBottom: 20 }}>
        Real OAuth connect flows aren't wired up yet — this lists whatever accounts exist (currently seeded demo
        data) and lets you disconnect them. Connecting a live Google/Microsoft account is the next build phase.
      </p>

      <button disabled className="hoverable" style={{ ...btnStyle, opacity: 0.5, cursor: "not-allowed", marginBottom: 20 }} title="OAuth connector not implemented yet">
        + Connect Account (coming soon)
      </button>

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
                Owner: {a.owner_email} · {a.calendar_count} calendar{a.calendar_count === 1 ? "" : "s"} · sync: {a.sync_status}
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
};
