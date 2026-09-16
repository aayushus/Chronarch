import React, { useEffect, useState } from "react";

import { friendlyError } from "../../api/client";
import { useAuth } from "../../api/auth";
import EmptyState from "../EmptyState";
import Icon from "../Icon";
import { useToast } from "../Toast";

import {
  AdminCalendar,
  BookingEntry,
  BookingLink,
  adminApproveBooking,
  adminCancelBooking,
  adminCheckSlug,
  adminCreateBookingLink,
  adminDeclineBooking,
  adminDeleteBookingLink,
  adminListBookingLinks,
  adminListCalendars,
  adminListBookings,
  adminUpdateBookingLink,
} from "../../api/admin";

const DURATIONS = [15, 30, 45, 60];

function StatusPill({ status }: { status: BookingEntry["status"] }) {
  const styles: Record<BookingEntry["status"], { bg: string; fg: string; label: string }> = {
    pending: { bg: "rgba(255, 159, 10, 0.14)", fg: "var(--warning)", label: "Needs approval" },
    confirmed: { bg: "rgba(48, 209, 88, 0.14)", fg: "var(--success)", label: "Confirmed" },
    cancelled: { bg: "var(--bg-app)", fg: "var(--text-tertiary)", label: "Cancelled" },
    declined: { bg: "var(--bg-app)", fg: "var(--text-tertiary)", label: "Declined" },
  };
  const style = styles[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 10, whiteSpace: "nowrap", background: style.bg, color: style.fg }}>
      {style.label}
    </span>
  );
}

export default function BookingSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [calendars, setCalendars] = useState<AdminCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Record<string, BookingEntry[]>>({});
  const [copied, setCopied] = useState(false);

  const canManage = user?.role === "admin" || (user?.permissions ?? []).includes("booking.manage");

  function load() {
    Promise.all([adminListBookingLinks(), adminListCalendars()])
      .then(([l, c]) => {
        setLinks(l);
        setCalendars(c);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleActive(link: BookingLink) {
    try {
      const updated = await adminUpdateBookingLink(link.id, { active: !link.active });
      setLinks((prev) => prev.map((x) => (x.id === link.id ? updated : x)));
      toast(updated.active ? `“${link.title}” is live.` : `Paused “${link.title}”.`);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function handleDelete(link: BookingLink) {
    const upcoming = link.booking_counts?.upcoming ?? 0;
    const pending = link.booking_counts?.pending ?? 0;
    if (!confirm(`Delete “${link.title}”?${upcoming + pending > 0 ? ` ${upcoming + pending} upcoming booking(s) will be cancelled.` : ""} The link stops working immediately.`)) return;
    try {
      await adminDeleteBookingLink(link.id);
      setLinks((prev) => prev.filter((x) => x.id !== link.id));
      toast(`Deleted “${link.title}”.`);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function expand(link: BookingLink) {
    if (expandedId === link.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(link.id);
    try {
      const res = await adminListBookings(link.id);
      setBookings((prev) => ({ ...prev, [link.id]: res.bookings }));
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function bookingAction(linkId: string, id: string, action: "approve" | "decline" | "cancel") {
    try {
      const updated = action === "approve" ? await adminApproveBooking(id)
        : action === "decline" ? await adminDeclineBooking(id)
        : await adminCancelBooking(id);
      setBookings((prev) => ({ ...prev, [linkId]: (prev[linkId] ?? []).map((b) => (b.id === id ? updated : b)) }));
      load();
      toast(action === "approve" ? "Booking confirmed — invite sent." : action === "decline" ? "Booking declined." : "Booking cancelled.");
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function copyLink(slug: string) {
    void navigator.clipboard.writeText(`${window.location.origin}/book/${slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  if (loading) {
    return <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>Loading booking links…</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Booking</h2>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12, background: "rgba(10, 132, 255, 0.12)", color: "var(--primary)", border: "1px solid rgba(10, 132, 255, 0.25)" }}>
              {links.length} {links.length === 1 ? "Link" : "Links"}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
            Public links anyone can book from — no account needed. Bookings land on your calendar with an invite sent.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowWizard(true)}
            className="btn-primary hoverable"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-sm)" }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
            <span>New Link</span>
          </button>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 13, borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 20, background: "rgba(255, 69, 58, 0.15)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {links.length === 0 ? (
        <EmptyState
          icon="link"
          title="No booking links yet"
          body="Create a link for intros, interviews, or office hours — share it and let people pick a time that suits you both."
          actionLabel={canManage ? "Create First Link" : undefined}
          onAction={canManage ? () => setShowWizard(true) : undefined}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {links.map((link) => {
            const expanded = expandedId === link.id;
            const rows = bookings[link.id] ?? [];
            const pending = link.booking_counts?.pending ?? 0;
            return (
              <section key={link.id} style={{ background: "var(--bg-raised)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 8, background: link.active ? "rgba(10, 132, 255, 0.14)" : "var(--bg-app)", color: link.active ? "var(--accent)" : "var(--text-tertiary)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name="link" size={17} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.title}</span>
                      {!link.active && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "var(--bg-app)", color: "var(--text-tertiary)" }}>
                          Paused
                        </span>
                      )}
                      {pending > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "rgba(255, 159, 10, 0.14)", color: "var(--warning)" }}>
                          {pending} to review
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      /book/{link.slug} · {link.duration_minutes} min{link.approval_required ? " · approves each booking" : ""}
                    </div>
                  </div>
                  <button onClick={() => copyLink(link.slug)} className="hoverable" title="Copy public link" style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 6, color: "var(--text-primary)", padding: "6px 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                    {copied ? "✓ Copied!" : "Copy link"}
                  </button>
                  {canManage && (
                    <>
                      <button onClick={() => toggleActive(link)} className="hoverable" aria-label={link.active ? `Pause ${link.title}` : `Resume ${link.title}`} title={link.active ? "Pause link" : "Resume link"} style={{ background: link.active ? "rgba(48, 209, 88, 0.12)" : "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 6, color: link.active ? "var(--success)" : "var(--text-secondary)", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {link.active ? "Live" : "Paused"}
                      </button>
                      <button onClick={() => handleDelete(link)} className="hoverable" aria-label={`Delete ${link.title}`} title="Delete link" style={{ background: "none", border: "none", borderRadius: 6, color: "var(--text-tertiary)", cursor: "pointer", padding: 6, display: "inline-flex" }}>
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  )}
                  <button onClick={() => expand(link)} className="hoverable" aria-expanded={expanded} aria-label={expanded ? "Hide bookings" : "Show bookings"} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 6, display: "inline-flex" }}>
                    <span style={{ display: "inline-flex", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>
                      <Icon name="chevronRight" size={15} />
                    </span>
                  </button>
                </div>

                {expanded && (
                  <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "14px 18px" }}>
                    {rows.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>No bookings on this link yet.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {rows.map((b) => (
                          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }}>{b.booker_name} <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>{b.booker_email}</span></div>
                              <div style={{ color: "var(--text-secondary)", marginTop: 1 }}>
                                {new Date(b.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                {b.note ? ` · “${b.note}”` : ""}
                              </div>
                            </div>
                            <StatusPill status={b.status} />
                            {canManage && b.status === "pending" && (
                              <>
                                <button onClick={() => bookingAction(link.id, b.id, "approve")} className="btn-primary hoverable" style={{ padding: "5px 12px", fontSize: 12 }}>Confirm</button>
                                <button onClick={() => bookingAction(link.id, b.id, "decline")} className="btn-secondary hoverable" style={{ padding: "5px 12px", fontSize: 12 }}>Decline</button>
                              </>
                            )}
                            {canManage && (b.status === "pending" || b.status === "confirmed") && (
                              <button onClick={() => bookingAction(link.id, b.id, "cancel")} className="hoverable" title="Cancel booking" style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 4, display: "inline-flex" }}>
                                <Icon name="x" size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {showWizard && (
        <LinkWizard
          calendars={calendars}
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            toast("Booking link is live — copy it and share.");
            load();
          }}
        />
      )}
    </div>
  );
}

const STEP_LABELS = ["Basics", "Calendar", "Rules", "Share"];

function LinkWizard({ calendars, onClose, onCreated }: { calendars: AdminCalendar[]; onClose: () => void; onCreated: (link: BookingLink) => void }) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [slugState, setSlugState] = useState<{ checking: boolean; ok: boolean | null; reason?: string }>({ checking: false, ok: null });
  const [duration, setDuration] = useState(30);
  const [customDuration, setCustomDuration] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [notice, setNotice] = useState(1440);
  const [bufferBefore, setBufferBefore] = useState(0);
  const [bufferAfter, setBufferAfter] = useState(0);
  const [ahead, setAhead] = useState(30);
  const [approval, setApproval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<BookingLink | null>(null);
  const [copied, setCopied] = useState(false);

  const writable = calendars.filter((c) => c.writable);

  useEffect(() => {
    const value = slug.trim().toLowerCase();
    if (value.length < 3) {
      setSlugState({ checking: false, ok: null });
      return;
    }
    setSlugState({ checking: true, ok: null });
    const t = setTimeout(async () => {
      try {
        const res = await adminCheckSlug(value);
        setSlugState({ checking: false, ok: res.available, reason: res.reason });
      } catch {
        setSlugState({ checking: false, ok: null });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slug]);

  function stepValid(): boolean {
    if (step === 0) return title.trim().length > 0 && slugState.ok === true && duration >= 5;
    if (step === 1) return calendarId.length > 0;
    return true;
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const link = await adminCreateBookingLink({
        title: title.trim(),
        description: description.trim() || null,
        slug: slug.trim().toLowerCase(),
        duration_minutes: duration,
        calendar_id: calendarId,
        buffer_before_minutes: bufferBefore,
        buffer_after_minutes: bufferAfter,
        min_notice_minutes: notice,
        max_days_ahead: ahead,
        approval_required: approval,
      });
      setCreated(link);
      setStep(3);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  function copyCreated() {
    if (!created) return;
    void navigator.clipboard.writeText(`${window.location.origin}/book/${created.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mount-rise" onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "94vw", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>New booking link</h3>
          <button onClick={onClose} className="hoverable" aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: "2px 6px", display: "inline-flex" }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {STEP_LABELS.map((label, i) => (
            <span key={label} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: i === step ? 700 : 500, color: i === step ? "var(--accent)" : "var(--text-tertiary)", borderBottom: `2px solid ${i === step ? "var(--accent)" : i < step ? "var(--success)" : "var(--border-subtle)"}`, paddingBottom: 6 }}>
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="link-title" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Title</label>
              <input id="link-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Intro call" autoFocus className="input-standard" style={{ width: "100%", fontSize: 13 }} />
            </div>
            <div>
              <label htmlFor="link-desc" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Description <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>(shown to bookers)</span></label>
              <input id="link-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 30 minutes to talk through your project" className="input-standard" style={{ width: "100%", fontSize: 13 }} />
            </div>
            <div>
              <label htmlFor="link-slug" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Link address</label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>/book/</span>
                <input id="link-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-intro" className="input-standard" style={{ flex: 1, fontSize: 13 }} />
              </div>
              <div style={{ fontSize: 11.5, marginTop: 5, minHeight: 16, color: slugState.ok ? "var(--success)" : slugState.reason ? "var(--danger)" : "var(--text-tertiary)" }}>
                {slugState.checking ? "Checking…" : slugState.ok ? "Available." : (slugState.reason ?? "Lowercase letters, numbers, hyphens.")}
              </div>
            </div>
            <div>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Duration</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DURATIONS.map((d) => (
                  <button key={d} onClick={() => { setDuration(d); setCustomDuration(""); }} className="hoverable" style={{ border: `1px solid ${duration === d && !customDuration ? "var(--accent)" : "var(--border-subtle)"}`, background: duration === d && !customDuration ? "rgba(10, 132, 255, 0.12)" : "transparent", color: "var(--text-primary)", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}>
                    {d} min
                  </button>
                ))}
                <input value={customDuration} onChange={(e) => { setCustomDuration(e.target.value); const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setDuration(n); }} placeholder="Custom" inputMode="numeric" aria-label="Custom duration in minutes" className="input-standard" style={{ width: 90, fontSize: 12.5 }} />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px", lineHeight: 1.5 }}>
              Bookings land on this calendar with the booker invited.
            </p>
            {writable.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--warning)" }}>No writable calendars available.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {writable.map((c) => (
                  <button key={c.id} onClick={() => setCalendarId(c.id)} className="hoverable" style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: calendarId === c.id ? "rgba(10, 132, 255, 0.1)" : "var(--bg-raised)", border: `1px solid ${calendarId === c.id ? "var(--accent)" : "var(--border-subtle)"}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", color: "var(--text-primary)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{c.account_label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <NumberField label="Notice needed (hours)" value={Math.round(notice / 60)} onChange={(v) => setNotice(Math.max(0, v * 60))} hint="Bookers can't grab sooner" />
              <NumberField label="Bookable ahead (days)" value={ahead} onChange={(v) => setAhead(Math.max(1, Math.min(90, v)))} hint="How far out" />
              <NumberField label="Buffer before (min)" value={bufferBefore} onChange={(v) => setBufferBefore(Math.max(0, v))} hint="Quiet time first" />
              <NumberField label="Buffer after (min)" value={bufferAfter} onChange={(v) => setBufferAfter(Math.max(0, v))} hint="Quiet time after" />
            </div>
            <div>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>When someone books</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => setApproval(false)} className="hoverable" style={{ textAlign: "left", background: !approval ? "rgba(10, 132, 255, 0.1)" : "var(--bg-raised)", border: `1px solid ${!approval ? "var(--accent)" : "var(--border-subtle)"}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", color: "var(--text-primary)" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Confirm instantly</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>The event and invite go out right away</span>
                </button>
                <button onClick={() => setApproval(true)} className="hoverable" style={{ textAlign: "left", background: approval ? "rgba(10, 132, 255, 0.1)" : "var(--bg-raised)", border: `1px solid ${approval ? "var(--accent)" : "var(--border-subtle)"}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", color: "var(--text-primary)" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Approve each booking</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>Requests wait here until you confirm them</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(48, 209, 88, 0.14)", color: "var(--success)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <Icon name="check" size={20} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>“{created?.title}” is live</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Share this link anywhere — no account needed to book.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <code style={{ fontSize: 13, background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "8px 14px" }}>
                /book/{created?.slug}
              </code>
              <button onClick={copyCreated} className="btn-primary hoverable" style={{ padding: "8px 16px", fontSize: 13 }}>
                {copied ? "✓ Copied!" : "Copy link"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12, background: "rgba(255, 69, 58, 0.1)", padding: "8px 12px", borderRadius: "var(--radius-sm)", marginTop: 14 }}>
            {error}
          </div>
        )}

        {step < 3 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
            <button onClick={() => (step === 0 ? onClose() : setStep(step - 1))} className="btn-secondary hoverable">
              {step === 0 ? "Cancel" : "Back"}
            </button>
            {step < 2 ? (
              <button onClick={() => setStep(step + 1)} disabled={!stepValid()} className="btn-primary hoverable" style={{ padding: "8px 20px", opacity: stepValid() ? 1 : 0.5 }}>
                Continue
              </button>
            ) : (
              <button onClick={() => void handleCreate()} disabled={!stepValid() || saving} className="btn-primary hoverable" style={{ padding: "8px 20px", opacity: stepValid() && !saving ? 1 : 0.5 }}>
                {saving ? "Creating…" : "Create link"}
              </button>
            )}
          </div>
        )}
        {step === 3 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button onClick={() => created && onCreated(created)} className="btn-primary hoverable" style={{ padding: "8px 20px" }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</label>
      <input type="number" min={0} value={value} onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)} className="input-standard" style={{ width: "100%", fontSize: 13 }} />
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3 }}>{hint}</div>
    </div>
  );
}
