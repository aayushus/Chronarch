import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { apiFetch } from "../api/client";
import { friendlyError } from "../api/client";

interface LinkMeta {
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  host_name: string;
  approval_required: boolean;
}

interface Slot {
  start: string;
  end: string;
}

async function getMeta(slug: string): Promise<LinkMeta> {
  return apiFetch<LinkMeta>(`/book/${slug}`);
}

async function getSlots(slug: string, from: Date, to: Date): Promise<Slot[]> {
  const params = new URLSearchParams({ date_from: from.toISOString(), date_to: to.toISOString() });
  const res = await apiFetch<{ slots: Slot[] }>(`/book/${slug}/slots?${params.toString()}`);
  return res.slots;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function BookPage() {
  const { slug } = useParams<{ slug: string }>();
  const [meta, setMeta] = useState<LinkMeta | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [held, setHeld] = useState<{ token: string; start: string } | null>(null);
  const [holding, setHolding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ status: string; start: string; booker_token: string } | null>(null);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    getMeta(slug)
      .then(setMeta)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const from = new Date();
    from.setDate(from.getDate() + weekOffset * 7);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    getSlots(slug, from, to)
      .then(setSlots)
      .catch((e) => setError(friendlyError(e)));
  }, [slug, weekOffset]);

  const days = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = dayKey(new Date(s.start));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [slots]);

  async function pickSlot(slot: Slot) {
    if (!slug || holding) return;
    setHolding(true);
    setError(null);
    try {
      const res = await apiFetch<{ hold_token: string; slot_start: string }>(`/book/${slug}/hold`, {
        method: "POST",
        body: JSON.stringify({ slot_start: slot.start }),
      });
      setHeld({ token: res.hold_token, start: res.slot_start });
    } catch (e) {
      setError(friendlyError(e));
      if (slug) {
        const from = new Date();
        from.setHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setDate(to.getDate() + 7);
        getSlots(slug, from, to).then(setSlots).catch(() => {});
      }
    } finally {
      setHolding(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || !held || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await apiFetch<{ status: string; start: string; booker_token: string }>(`/book/${slug}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          hold_token: held.token,
          slot_start: held.start,
          name: name.trim(),
          email: email.trim(),
          note: note.trim() || null,
          booked_timezone: browserTz,
        }),
      });
      setDone(res);
    } catch (err) {
      setError(friendlyError(err));
      setHeld(null);
    } finally {
      setConfirming(false);
    }
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", justifyContent: "center", padding: "48px 20px" }}>
      <div style={{ width: 560, maxWidth: "100%" }}>
        {loading ? (
          <div style={{ color: "var(--text-tertiary)", fontSize: 14, textAlign: "center", paddingTop: 60 }}>Loading…</div>
        ) : error && !meta ? (
          <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Link not found</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{error}</div>
          </div>
        ) : meta && (
          <>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 4 }}>Book time with {meta.host_name}</div>
              <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.02em" }}>{meta.title}</h1>
              {meta.description && <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 6px", lineHeight: 1.5 }}>{meta.description}</p>}
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {meta.duration_minutes} minutes · {browserTz}
              </div>
            </div>

            {done ? (
              <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 28, textAlign: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(48, 209, 88, 0.14)", color: "var(--success)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                  {done.status === "pending" ? "Request received" : "You're booked"}
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 4px" }}>
                  {new Date(done.start).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
                  {done.status === "pending"
                    ? `${meta.host_name} confirms shortly — the invite follows.`
                    : "The calendar invite is on its way to your inbox."}
                </p>
                <a href={`/book/cancel/${done.booker_token}`} style={{ fontSize: 13, color: "var(--danger)" }}>
                  Cancel this booking
                </a>
              </div>
            ) : held ? (
              <form onSubmit={confirm} style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {new Date(held.start).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Held for you for the next few minutes.</div>
                <div>
                  <label htmlFor="book-name" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Your name</label>
                  <input id="book-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Rivera" autoFocus className="input-standard" style={{ width: "100%", fontSize: 13 }} />
                </div>
                <div>
                  <label htmlFor="book-email" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Email for the invite</label>
                  <input id="book-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. jane@acme.com" className="input-standard" style={{ width: "100%", fontSize: 13 }} />
                </div>
                <div>
                  <label htmlFor="book-note" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Note <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>(optional)</span></label>
                  <input id="book-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should we talk about?" className="input-standard" style={{ width: "100%", fontSize: 13 }} />
                </div>
                {error && <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>}
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => setHeld(null)} className="btn-secondary hoverable" style={{ flex: 1 }}>
                    Pick another time
                  </button>
                  <button type="submit" disabled={confirming || !name.trim() || !email.trim()} className="btn-primary hoverable" style={{ flex: 2, opacity: confirming || !name.trim() || !email.trim() ? 0.5 : 1 }}>
                    {confirming ? "Booking…" : meta.approval_required ? "Request booking" : "Confirm booking"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <button onClick={() => setWeekOffset((v) => Math.max(0, v - 1))} disabled={weekOffset === 0} className="btn-secondary hoverable" style={{ opacity: weekOffset === 0 ? 0.4 : 1 }}>← Prev</button>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {days[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <button onClick={() => setWeekOffset((v) => v + 1)} className="btn-secondary hoverable">Next →</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {days.map((d) => {
                    const key = dayKey(d);
                    const daySlots = (byDay.get(key) ?? []).filter((s) => new Date(s.start) > new Date());
                    const isPicked = pickedDay === key;
                    return (
                      <div key={key} style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
                        <button onClick={() => setPickedDay(isPicked ? null : key)} className="hoverable" style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 16px", cursor: "pointer", color: "var(--text-primary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                            {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                            {daySlots.length === 0 ? "Nothing open" : `${daySlots.length} open`}
                          </span>
                        </button>
                        {isPicked && daySlots.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 16px 14px" }}>
                            {daySlots.map((s) => (
                              <button
                                key={s.start}
                                onClick={() => void pickSlot(s)}
                                disabled={holding}
                                className="hoverable"
                                style={{ border: "1px solid var(--accent)", background: "rgba(10, 132, 255, 0.1)", color: "var(--text-primary)", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
                              >
                                {fmtTime(s.start)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 12 }}>{error}</div>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
