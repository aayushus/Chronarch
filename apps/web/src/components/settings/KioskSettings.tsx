import React, { useEffect, useState } from "react";

import { friendlyError } from "../../api/client";
import { useAuth } from "../../api/auth";
import EmptyState from "../EmptyState";
import Icon from "../Icon";
import { useToast } from "../Toast";

import {
  KioskDisplay,
  kioskCreateDisplay,
  kioskDeleteDisplay,
  kioskListDisplays,
  kioskPairWithCode,
  kioskRotateDisplay,
  kioskUpdateDisplay,
} from "../../api/admin";

function formatSeen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "never";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function KioskSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [displays, setDisplays] = useState<KioskDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [sleepStart, setSleepStart] = useState("22:00");
  const [sleepEnd, setSleepEnd] = useState("07:00");
  const [creating, setCreating] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [copied, setCopied] = useState(false);

  const canManage = user?.role === "admin" || (user?.permissions ?? []).includes("kiosk.manage");

  function load() {
    kioskListDisplays()
      .then(setDisplays)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await kioskCreateDisplay({
        name: name.trim() || "Wall display",
        location_label: location.trim(),
        sleep_start: sleepStart,
        sleep_end: sleepEnd,
      });
      setDisplays((prev) => [...prev, created]);
      setName("");
      setLocation("");
      toast(`Paired “${created.name}” — open its link on the wall display.`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setCreating(false);
    }
  }

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    if (pairing || pairCode.replace(/\D/g, "").length !== 6) return;
    setPairing(true);
    setError(null);
    try {
      const created = await kioskPairWithCode(pairCode.replace(/\D/g, ""));
      setDisplays((prev) => [...prev, created]);
      setPairCode("");
      toast(`Paired “${created.name}”.`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPairing(false);
    }
  }

  async function toggleActive(d: KioskDisplay) {
    try {
      const updated = await kioskUpdateDisplay(d.id, { active: !d.active });
      setDisplays((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function rotate(d: KioskDisplay) {
    if (!confirm(`Issue a new link for “${d.name}”? The old wall URL stops working immediately.`)) return;
    try {
      const updated = await kioskRotateDisplay(d.id);
      setDisplays((prev) => prev.map((x) => (x.id === d.id ? { ...updated } : x)));
      toast("New link issued — update the wall display.");
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function remove(d: KioskDisplay) {
    if (!confirm(`Remove “${d.name}”? The wall display goes dark immediately.`)) return;
    try {
      await kioskDeleteDisplay(d.id);
      setDisplays((prev) => prev.filter((x) => x.id !== d.id));
      toast(`Removed “${d.name}”.`);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function copyLink(d: KioskDisplay) {
    void navigator.clipboard.writeText(`${window.location.origin}${d.url_path}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  if (loading) {
    return <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>Loading wall displays…</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Kiosk</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
          Read-only wall displays — no login needed. Private events always show as Busy. Revoke the link to decommission a screen.
        </p>
      </div>

      {error && (
        <div style={{ fontSize: 13, borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 20, background: "rgba(255, 69, 58, 0.15)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {displays.length === 0 ? (
        <EmptyState
          icon="monitor"
          title="No wall displays yet"
          body="Pair a tablet or TV for the hallway or kitchen — it shows your week with weather, no login required."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          {displays.map((d) => (
            <section key={d.id} style={{ background: "var(--bg-raised)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 34, height: 34, borderRadius: 8, background: d.active ? "rgba(10, 132, 255, 0.14)" : "var(--bg-app)", color: d.active ? "var(--accent)" : "var(--text-tertiary)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="monitor" size={17} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                  {!d.active && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "var(--bg-app)", color: "var(--text-tertiary)" }}>
                      Off
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  {d.url_path}{d.location_label ? ` · ${d.location_label}` : ""} · sleeps {d.sleep_start}–{d.sleep_end} · seen {formatSeen(d.last_seen_at)}
                </div>
              </div>
              <button onClick={() => copyLink(d)} className="hoverable" title="Copy wall display link" style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 6, color: "var(--text-primary)", padding: "6px 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                {copied ? "✓ Copied!" : "Copy link"}
              </button>
              {canManage && (
                <>
                  <button onClick={() => toggleActive(d)} className="hoverable" title={d.active ? "Take display dark" : "Bring display back"} style={{ background: d.active ? "rgba(48, 209, 88, 0.12)" : "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 6, color: d.active ? "var(--success)" : "var(--text-secondary)", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    {d.active ? "Live" : "Off"}
                  </button>
                  <button onClick={() => void rotate(d)} className="hoverable" title="Issue a new link" style={{ background: "none", border: "1px solid var(--border-subtle)", borderRadius: 6, color: "var(--text-secondary)", padding: "6px 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Rotate
                  </button>
                  <button onClick={() => void remove(d)} className="hoverable" aria-label={`Remove ${d.name}`} title="Remove display" style={{ background: "none", border: "none", borderRadius: 6, color: "var(--text-tertiary)", cursor: "pointer", padding: 6, display: "inline-flex" }}>
                    <Icon name="trash" size={15} />
                  </button>
                </>
              )}
            </section>
          ))}
        </div>
      )}

      {canManage && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
          <form onSubmit={handlePair} style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 18, display: "flex", flexDirection: "column", gap: 12, maxWidth: 340, flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Pair with code</div>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
              Open <code>/kiosk/pair</code> on the wall display and enter the 6-digit code it shows.
            </p>
            <input
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123 456"
              inputMode="numeric"
              aria-label="Pairing code"
              className="input-standard"
              style={{ width: "100%", fontSize: 18, letterSpacing: "0.2em", textAlign: "center" }}
            />
            <button type="submit" disabled={pairing || pairCode.length !== 6} className="btn-primary hoverable" style={{ padding: "8px 20px", alignSelf: "flex-start", opacity: pairing || pairCode.length !== 6 ? 0.5 : 1 }}>
              {pairing ? "Pairing…" : "Pair display"}
            </button>
          </form>
          <form onSubmit={handleCreate} style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 18, display: "flex", flexDirection: "column", gap: 12, maxWidth: 520, flex: 2, minWidth: 280 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Pair manually</div>
          <div>
            <label htmlFor="kiosk-name" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Name</label>
            <input id="kiosk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kitchen wall" className="input-standard" style={{ width: "100%", fontSize: 13 }} />
          </div>
          <div>
            <label htmlFor="kiosk-location" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Location <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>(for weather — city name)</span></label>
            <input id="kiosk-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Edmonton" className="input-standard" style={{ width: "100%", fontSize: 13 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="kiosk-sleep-start" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Screen sleeps at</label>
              <input id="kiosk-sleep-start" type="time" value={sleepStart} onChange={(e) => setSleepStart(e.target.value)} className="input-standard" style={{ width: "100%", fontSize: 13 }} />
            </div>
            <div>
              <label htmlFor="kiosk-sleep-end" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Wakes at</label>
              <input id="kiosk-sleep-end" type="time" value={sleepEnd} onChange={(e) => setSleepEnd(e.target.value)} className="input-standard" style={{ width: "100%", fontSize: 13 }} />
            </div>
          </div>
          <button type="submit" disabled={creating} className="btn-primary hoverable" style={{ padding: "8px 20px", alignSelf: "flex-start", opacity: creating ? 0.5 : 1 }}>
            {creating ? "Pairing…" : "Pair display"}
          </button>
          </form>
        </div>
      )}
    </div>
  );
}
