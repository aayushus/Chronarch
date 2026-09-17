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
              <button onClick={() => void requestCode()} disabled={requesting} className="btn-primary hoverable" style={{ padding: "10px 28px", fontSize: 14, opacity: requesting ? 0.5 : 1 }}>
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
            <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: "0.12em", color: "var(--wall-ink)" }}>
              {code.slice(0, 3)} {code.slice(3)}
            </div>
            <div style={{ fontSize: 12, color: "var(--wall-faint)", marginTop: 12 }}>Waiting for approval…</div>
          </>
        )}
      </div>
    </div>
  );
}
