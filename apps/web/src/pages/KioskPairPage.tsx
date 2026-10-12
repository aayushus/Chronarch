import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, friendlyError } from "../api/client";

/** Unpaired wall display: shows a short code, polls until an admin approves
 * it in Settings → Kiosk, then hands off to the live display URL. */
export default function KioskPairPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    if (requesting) return;
    setRequesting(true);
    setError(null);
    try {
      const res = await apiFetch<{ pairing_id: string; code: string }>("/kiosk-display/pair-code", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "Wall display", location_label: "" }),
      });
      setCode(res.code);
      setPairingId(res.pairing_id);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setRequesting(false);
    }
  }

  useEffect(() => {
    if (!pairingId) return;
    const poll = setInterval(async () => {
      try {
        const res = await apiFetch<{ status: string; token?: string }>(
          `/kiosk-display/pair-status/${pairingId}`,
        );
        if (res.status === "approved" && res.token) {
          clearInterval(poll);
          navigate(`/kiosk/${res.token}`, { replace: true });
        }
      } catch {
        // Expired pairing: stop polling and show the error state.
        clearInterval(poll);
        setError("That code expired — reload this page for a fresh one.");
        setCode(null);
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [pairingId, navigate]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--wall-page)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 480, background: "var(--wall-card)", borderRadius: 20, padding: "36px 48px", boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 13, color: "var(--wall-muted)", marginBottom: 12 }}>Pair this display</div>
        {error && !code ? (
          <div style={{ fontSize: 15, color: "var(--danger)" }}>{error}</div>
        ) : !code ? (
          <>
            <div style={{ fontSize: 13, color: "var(--wall-muted)", marginBottom: 12 }}>
              Name this display, then enter the code in Settings → Kiosk.
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kitchen wall"
              aria-label="Display name"
              style={{ background: "var(--wall-well)", border: "1px solid var(--wall-line)", borderRadius: 8, color: "var(--wall-ink)", padding: "10px 16px", fontSize: 14, width: 260, textAlign: "center", marginBottom: 12, outline: "none" }}
            />
            <div>
              <button onClick={() => void requestCode()} disabled={requesting} className="btn-primary hoverable" style={{ padding: "10px 28px", fontSize: 14 }}>
                {requesting ? "Getting code…" : "Get pairing code"}
              </button>
            </div>
            {error && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 10 }}>{error}</div>}
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--wall-muted)", marginBottom: 8 }}>
              Enter this code in Settings → Kiosk → Pair with code{name.trim() ? ` for “${name.trim()}”` : ""}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, margin: "16px 0" }}>
              <div
                style={{
                  fontSize: 60,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  color: "var(--wall-ink)",
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {code.slice(0, 3)} {code.slice(3)}
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="hoverable"
                title="Copy pairing code"
                style={{
                  background: copied ? "rgba(48, 209, 88, 0.15)" : "var(--wall-well)",
                  border: `1px solid ${copied ? "var(--success)" : "var(--wall-line)"}`,
                  color: copied ? "var(--success)" : "var(--wall-ink)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.15s ease",
                }}
              >
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div style={{ fontSize: 13, color: "var(--wall-faint)", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <span className="kiosk-pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--wall-muted)", display: "inline-block", opacity: 0.7 }} />
              <span>Waiting for approval…</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
