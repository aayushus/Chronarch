import React, { useEffect, useState } from "react";

import { friendlyError } from "../../api/client";
import { useAuth } from "../../api/auth";
import EmptyState from "../EmptyState";
import Icon from "../Icon";
import { Badge, ErrorBanner, SectionHeader } from "../ui";
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
  const pairUrl = `${window.location.origin}/kiosk/pair`;
  const [sleepEnd, setSleepEnd] = useState("07:00");
  const [screensaverTimeout, setScreensaverTimeout] = useState(30);
  const [creating, setCreating] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", location_label: "", sleep_start: "22:00", sleep_end: "07:00", screensaver_timeout_seconds: 30 });

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
        screensaver_timeout_seconds: screensaverTimeout,
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

  function beginEdit(d: KioskDisplay) {
    setEditingId(d.id);
    setEdit({ name: d.name, location_label: d.location_label, sleep_start: d.sleep_start, sleep_end: d.sleep_end, screensaver_timeout_seconds: d.screensaver_timeout_seconds ?? 30 });
  }

  async function saveEdit(d: KioskDisplay) {
    try {
      const updated = await kioskUpdateDisplay(d.id, edit);
      setDisplays((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
      setEditingId(null);
      toast("Kiosk settings updated");
    } catch (e) { setError(friendlyError(e)); }
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
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <SectionHeader
          title="Kiosk"
          description="Read-only wall displays — no login needed. Private events always show as Busy. Revoke the link to decommission a screen."
        />
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {displays.length === 0 ? (
        <div style={{ margin: "4px 0" }}>
          <EmptyState
            icon="monitor"
            title="No wall displays yet"
            body="Pair a tablet or TV for the hallway or kitchen — it shows your week with weather, no login required."
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {displays.map((d) => (
            <section
              key={d.id}
              style={{
                background: "var(--bg-raised)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border-subtle)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                position: "relative",
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "var(--radius-md)",
                  background: d.active ? "rgba(10, 132, 255, 0.14)" : "var(--bg-app)",
                  color: d.active ? "var(--accent)" : "var(--text-tertiary)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="monitor" size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                  {!d.active && <Badge tone="neutral">Off</Badge>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                  {d.url_path}{d.location_label ? ` · ${d.location_label}` : ""} · sleeps {d.sleep_start}–{d.sleep_end} · seen {formatSeen(d.last_seen_at)}
                </div>
              </div>
              {canManage && editingId === d.id && (
                <div style={{ position: "absolute", inset: 8, zIndex: 2, background: "var(--bg-raised)", display: "grid", gridTemplateColumns: "repeat(5, minmax(90px, 1fr)) auto", gap: 8, alignItems: "end", padding: 10, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
                  {(["name", "location_label", "sleep_start", "sleep_end"] as const).map((key) => <label key={key} style={{ fontSize: 11, color: "var(--text-secondary)" }}>{key.replace("_", " ")}<input className="input-standard" value={edit[key]} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} style={{ width: "100%", marginTop: 3, fontSize: 12 }} /></label>)}
                  <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>screensaver (sec)<input className="input-standard" type="number" min={10} max={3600} value={edit.screensaver_timeout_seconds} onChange={(e) => setEdit({ ...edit, screensaver_timeout_seconds: Number(e.target.value) })} style={{ width: "100%", marginTop: 3, fontSize: 12 }} /></label>
                  <div style={{ display: "flex", gap: 6 }}><button className="btn-primary" type="button" onClick={() => void saveEdit(d)}>Save</button><button className="btn-secondary" type="button" onClick={() => setEditingId(null)}>Cancel</button></div>
                </div>
              )}
              <button
                onClick={() => copyLink(d)}
                className="hoverable"
                title="Copy wall display link"
                style={{
                  background: "var(--bg-app)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-primary)",
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? "✓ Copied!" : "Copy link"}
              </button>
              {canManage && (
                <>
                  <button onClick={() => beginEdit(d)} className="btn-secondary hoverable" style={{ padding: "7px 14px", fontSize: 12, whiteSpace: "nowrap" }}>Edit</button>
                  <button
                    onClick={() => toggleActive(d)}
                    className="hoverable"
                    title={d.active ? "Take display dark" : "Bring display back"}
                    style={{
                      background: d.active ? "rgba(48, 209, 88, 0.12)" : "var(--bg-app)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      color: d.active ? "var(--success)" : "var(--text-secondary)",
                      padding: "7px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.active ? "Live" : "Off"}
                  </button>
                  <button
                    onClick={() => void rotate(d)}
                    className="hoverable"
                    title="Issue a new link"
                    style={{
                      background: "none",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-secondary)",
                      padding: "7px 14px",
                      fontSize: 12,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Rotate
                  </button>
                  <button
                    onClick={() => void remove(d)}
                    className="hoverable"
                    aria-label={`Remove ${d.name}`}
                    title="Remove display"
                    style={{
                      background: "none",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-tertiary)",
                      cursor: "pointer",
                      padding: 6,
                      display: "inline-flex",
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </>
              )}
            </section>
          ))}
        </div>
      )}

      {canManage && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
            alignItems: "stretch",
          }}
        >
          {/* Card 1: Pair with code */}
          <form
            onSubmit={handlePair}
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-lg)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Pair with code</div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 0", lineHeight: 1.5 }}>
                On the wall display, open this page and enter the 6-digit code shown there:
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <a
                  href={pairUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="input-standard"
                  style={{ flex: 1, minWidth: 0, padding: "9px 10px", fontSize: 12, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}
                  title={pairUrl}
                >
                  {pairUrl}
                </a>
                <button
                  type="button"
                  className="btn-secondary hoverable"
                  onClick={() => {
                    void navigator.clipboard?.writeText(pairUrl);
                    toast("Pairing page link copied");
                  }}
                  style={{ flexShrink: 0, padding: "9px 11px", fontSize: 12, fontWeight: 600 }}
                >
                  Copy link
                </button>
              </div>
              <a href={pairUrl} target="_blank" rel="noreferrer" className="btn-secondary hoverable" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start", marginTop: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                Open pairing page
                <span aria-hidden="true">↗</span>
              </a>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 90 }}>
              <input
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123 456"
                inputMode="numeric"
                aria-label="Pairing code"
                className="input-standard"
                style={{
                  width: "100%",
                  fontSize: 22,
                  letterSpacing: "0.22em",
                  textAlign: "center",
                  padding: "12px 16px",
                  fontWeight: 700,
                  borderRadius: "var(--radius-md)",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={pairing || pairCode.length !== 6}
              className="btn-primary hoverable"
              style={{
                padding: "9px 22px",
                alignSelf: "flex-start",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: "var(--radius-sm)",
                opacity: pairing || pairCode.length !== 6 ? 0.5 : 1,
              }}
            >
              {pairing ? "Pairing…" : "Pair display"}
            </button>
          </form>

          {/* Card 2: Pair manually */}
          <form
            onSubmit={handleCreate}
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-lg)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Pair manually</div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 0", lineHeight: 1.5 }}>
                Configure a display name and sleep schedule to generate a direct link.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label htmlFor="kiosk-name" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                  Name
                </label>
                <input
                  id="kiosk-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Kitchen wall"
                  className="input-standard"
                  style={{ width: "100%", fontSize: 13, padding: "8px 12px" }}
                />
              </div>

              <div>
                <label htmlFor="kiosk-location" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                  Location <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>(city name for weather)</span>
                </label>
                <input
                  id="kiosk-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Edmonton"
                  className="input-standard"
                  style={{ width: "100%", fontSize: 13, padding: "8px 12px" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label htmlFor="kiosk-sleep-start" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                    Screen sleeps at
                  </label>
                  <input
                    id="kiosk-sleep-start"
                    type="time"
                    value={sleepStart}
                    onChange={(e) => setSleepStart(e.target.value)}
                    className="input-standard"
                    style={{ width: "100%", fontSize: 13, padding: "8px 12px" }}
                  />
                </div>
                <div>
                  <label htmlFor="kiosk-sleep-end" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                    Wakes at
                  </label>
                  <input
                    id="kiosk-sleep-end"
                    type="time"
                    value={sleepEnd}
                    onChange={(e) => setSleepEnd(e.target.value)}
                    className="input-standard"
                    style={{ width: "100%", fontSize: 13, padding: "8px 12px" }}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="kiosk-screensaver-timeout" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                  Screensaver countdown <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>(seconds of inactivity)</span>
                </label>
                <input id="kiosk-screensaver-timeout" type="number" min={10} max={3600} step={10} value={screensaverTimeout} onChange={(e) => setScreensaverTimeout(Math.max(10, Math.min(3600, Number(e.target.value) || 30)))} className="input-standard" style={{ width: "100%", fontSize: 13, padding: "8px 12px" }} />
              </div>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="btn-primary hoverable"
              style={{
                padding: "9px 22px",
                alignSelf: "flex-start",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: "var(--radius-sm)",
                opacity: creating ? 0.5 : 1,
              }}
            >
              {creating ? "Pairing…" : "Pair display"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
