import React, { useEffect, useState } from "react";

import { friendlyError } from "../../api/client";
import EmptyState from "../EmptyState";
import Icon, { IconName } from "../Icon";
import { useToast } from "../Toast";

import {
  AdminCalendar,
  AdminUser,
  Delegation,
  DelegationGrant,
  GrantFields,
  adminCreateDelegation,
  adminDeleteDelegation,
  adminListCalendars,
  adminListDelegations,
  adminListUsers,
  adminRemoveGrant,
  adminSetDelegationActive,
  adminUpsertGrant,
} from "../../api/admin";

interface GrantFieldDef {
  key: keyof GrantFields;
  label: string;
  desc: string;
}

const GRANT_GROUPS: { title: string; fields: GrantFieldDef[] }[] = [
  {
    title: "Visibility",
    fields: [
      { key: "can_view_availability", label: "Free/busy", desc: "Busy times without titles or details" },
      { key: "can_view_titles", label: "Event titles", desc: "Subjects and meeting names" },
      { key: "can_view_full_details", label: "Full details", desc: "Descriptions, locations, attendees, conference links" },
    ],
  },
  {
    title: "Scheduling",
    fields: [
      { key: "can_create", label: "Create events", desc: "Schedule directly on the calendar" },
      { key: "can_edit", label: "Edit events", desc: "Change descriptions and details" },
      { key: "can_reschedule", label: "Reschedule", desc: "Move dates and times" },
      { key: "can_delete", label: "Delete events", desc: "Cancel and remove events" },
    ],
  },
  {
    title: "Collaboration",
    fields: [
      { key: "can_manage_attendees", label: "Attendees", desc: "Add or remove invite participants" },
      { key: "can_respond_to_invitations", label: "RSVP", desc: "Accept, decline, or tentatively accept for the owner" },
      { key: "can_import_ics", label: "ICS import", desc: "Upload iCalendar files into the calendar" },
      { key: "can_move_between_calendars", label: "Move across calendars", desc: "Shift events between owner calendars" },
    ],
  },
];

const PRESETS: { id: string; name: string; desc: string; fields: Partial<GrantFields> }[] = [
  {
    id: "read_only",
    name: "View Only",
    desc: "Free/busy plus titles, nothing editable",
    fields: { can_view_availability: true, can_view_titles: true },
  },
  {
    id: "scheduler",
    name: "Scheduler",
    desc: "Everything except deleting and moving across calendars",
    fields: {
      can_view_availability: true, can_view_titles: true, can_view_full_details: true,
      can_create: true, can_edit: true, can_reschedule: true,
      can_manage_attendees: true, can_respond_to_invitations: true, can_import_ics: true,
    },
  },
  {
    id: "full_manager",
    name: "Full Access",
    desc: "Every permission including deletion",
    fields: {
      can_view_availability: true, can_view_titles: true, can_view_full_details: true,
      can_create: true, can_edit: true, can_reschedule: true, can_delete: true,
      can_manage_attendees: true, can_respond_to_invitations: true,
      can_import_ics: true, can_move_between_calendars: true,
    },
  },
];

/** Grants start from View Only; presets and toggles build up from there. */
const BASE_GRANT: GrantFields = {
  can_view_availability: true,
  can_view_titles: true,
  can_view_full_details: false,
  can_create: false,
  can_edit: false,
  can_reschedule: false,
  can_delete: false,
  can_manage_attendees: false,
  can_respond_to_invitations: false,
  can_import_ics: false,
  can_move_between_calendars: false,
};

function initials(email: string): string {
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const parts = name.split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? email[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function Avatar({ email, tint }: { email: string; tint: "accent" | "violet" }) {
  const bg = tint === "accent" ? "rgba(10, 132, 255, 0.14)" : "rgba(175, 82, 222, 0.14)";
  const fg = tint === "accent" ? "var(--accent)" : "#bf5af2";
  return (
    <span
      aria-hidden
      style={{
        width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
        background: bg, color: fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
      }}
    >
      {initials(email)}
    </span>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 10, whiteSpace: "nowrap",
        background: active ? "rgba(48, 209, 88, 0.14)" : "var(--bg-app)",
        color: active ? "var(--success)" : "var(--text-tertiary)",
        border: `1px solid ${active ? "rgba(48, 209, 88, 0.35)" : "var(--border-subtle)"}`,
      }}
    >
      {active ? "Active" : "Disabled"}
    </span>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="hoverable"
      style={{
        width: 34, height: 20, borderRadius: 10, border: "none", cursor: "pointer", padding: 2,
        background: checked ? "var(--success)" : "var(--border)",
        display: "inline-flex", alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        flexShrink: 0,
      }}
    >
      <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff" }} />
    </button>
  );
}

export default function DelegatesSettings() {
  const { toast } = useToast();
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [calendars, setCalendars] = useState<AdminCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    Promise.all([adminListDelegations(), adminListUsers(), adminListCalendars()])
      .then(([d, u, c]) => {
        setDelegations(d);
        setUsers(u);
        setCalendars(c);
        setExpandedId((prev) => (prev === null && d.length > 0 ? d[0].id : prev));
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const activeCount = delegations.filter((d) => d.active).length;
  const grantedCount = delegations.reduce((n, d) => n + d.grants.length, 0);

  async function toggleActive(d: Delegation) {
    setDelegations((prev) => prev.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x)));
    try {
      await adminSetDelegationActive(d.id, !d.active);
      toast(d.active ? `Paused sharing with ${d.delegate_email}.` : `Resumed sharing with ${d.delegate_email}.`);
    } catch (e) {
      setError(friendlyError(e));
      load();
    }
  }

  async function handleDeleteDelegation(d: Delegation) {
    // Destroys the grant configuration itself — re-creating starts from
    // scratch, so this one keeps an explicit confirmation.
    if (!confirm(`Stop sharing with ${d.delegate_email}? All calendar grants in this pairing will be removed.`)) return;
    try {
      await adminDeleteDelegation(d.id);
      setDelegations((prev) => prev.filter((x) => x.id !== d.id));
      toast(`Stopped sharing with ${d.delegate_email}.`, {
        actionLabel: "Undo",
        onAction: async () => {
          try {
            const owners = users.filter((u) => u.role === "admin");
            const assistants = users.filter((u) => u.role === "delegate");
            const owner = owners.find((u) => u.email === d.owner_email);
            const assistant = assistants.find((u) => u.email === d.delegate_email);
            if (owner && assistant) {
              await adminCreateDelegation(owner.id, assistant.id);
              load();
            }
          } catch {
            /* workers best effort; the pairing stays deleted */
          }
        },
      });
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function toggleGrantCalendar(delegation: Delegation, calendar: AdminCalendar, granted: boolean) {
    try {
      const updated = granted
        ? await adminUpsertGrant(delegation.id, calendar.id, BASE_GRANT)
        : await adminRemoveGrant(delegation.id, calendar.id);
      setDelegations((prev) => prev.map((x) => (x.id === delegation.id ? updated : x)));
      if (granted) toast(`${calendar.name} shared — tune permissions below.`);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function applyPreset(delegation: Delegation, calendarId: string, presetFields: Partial<GrantFields>) {
    try {
      const updated = await adminUpsertGrant(delegation.id, calendarId, { ...BASE_GRANT, ...presetFields });
      setDelegations((prev) => prev.map((x) => (x.id === delegation.id ? updated : x)));
      toast("Permission preset applied.");
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function updateGrantField(delegation: Delegation, grant: DelegationGrant, field: keyof GrantFields) {
    const previous = delegations;
    setDelegations((prev) =>
      prev.map((x) =>
        x.id === delegation.id
          ? { ...x, grants: x.grants.map((g) => (g.calendar_id === grant.calendar_id ? { ...g, [field]: !g[field] } : g)) }
          : x
      )
    );
    try {
      const updated = await adminUpsertGrant(delegation.id, grant.calendar_id, { ...grant, [field]: !grant[field] });
      setDelegations((prev) => prev.map((x) => (x.id === delegation.id ? updated : x)));
    } catch (e) {
      setError(friendlyError(e));
      setDelegations(previous);
    }
  }

  if (loading) {
    return <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>Loading pairings…</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Delegates</h2>
            <span
              style={{
                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
                background: "rgba(10, 132, 255, 0.12)", color: "var(--primary)",
                border: "1px solid rgba(10, 132, 255, 0.25)",
              }}
            >
              {delegations.length} {delegations.length === 1 ? "Pairing" : "Pairings"}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
            Pair an executive with an assistant, then grant access calendar by calendar.
            An assistant only ever sees what a grant allows.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary hoverable"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-sm)" }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          <span>Add Pairing</span>
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 13, borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 20, background: "rgba(255, 69, 58, 0.15)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <SummaryCard icon="users" tint="rgba(10, 132, 255, 0.15)" color="var(--accent)" label="Pairings" value={delegations.length} />
        <SummaryCard icon="check" tint="rgba(48, 209, 88, 0.15)" color="var(--success)" label="Active" value={activeCount} />
        <SummaryCard icon="calendar" tint="rgba(175, 82, 222, 0.15)" color="#bf5af2" label="Calendars granted" value={grantedCount} />
      </div>

      {delegations.length === 0 ? (
        <EmptyState
          icon="users"
          title="No pairings yet"
          body="Pair an executive with an assistant to grant scheduling authority over specific calendars."
          actionLabel="Create First Pairing"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {delegations.map((d) => {
            const expanded = expandedId === d.id;
            const grantByCalendar = new Map(d.grants.map((g) => [g.calendar_id, g]));
            return (
              <section
                key={d.id}
                style={{ background: "var(--bg-raised)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", overflow: "hidden" }}
              >
                <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <button
                    onClick={() => setExpandedId(expanded ? null : d.id)}
                    className="hoverable"
                    aria-expanded={expanded}
                    style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left", color: "var(--text-primary)" }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center" }}>
                      <Avatar email={d.owner_email} tint="accent" />
                      <span style={{ margin: "0 -7px", zIndex: 1, width: 22, height: 22, borderRadius: "50%", background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}>
                        <Icon name="chevronRight" size={11} />
                      </span>
                      <Avatar email={d.delegate_email} tint="violet" />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.owner_email} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>· assisted by {d.delegate_email}</span>
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, display: "block" }}>
                        {d.grants.length} calendar{d.grants.length === 1 ? "" : "s"} granted
                      </span>
                    </span>
                  </button>

                  <StatusPill active={d.active} />
                  <Switch checked={d.active} onChange={() => toggleActive(d)} label={d.active ? `Pause sharing with ${d.delegate_email}` : `Resume sharing with ${d.delegate_email}`} />
                  <button
                    onClick={() => handleDeleteDelegation(d)}
                    className="hoverable"
                    aria-label={`Stop sharing with ${d.delegate_email}`}
                    title="Stop sharing"
                    style={{ background: "none", border: "none", borderRadius: 6, color: "var(--text-tertiary)", cursor: "pointer", padding: 6, display: "inline-flex" }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded ? null : d.id)}
                    className="hoverable"
                    aria-expanded={expanded}
                    aria-label={expanded ? "Hide permissions" : "Show permissions"}
                    style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 6, display: "inline-flex" }}
                  >
                    <span style={{ display: "inline-flex", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>
                      <Icon name="chevronRight" size={15} />
                    </span>
                  </button>
                </div>

                {expanded && (
                  <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {calendars.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>
                        No calendars to share yet. Connect one under Accounts first.
                      </p>
                    ) : (
                      calendars.map((cal) => {
                        const grant = grantByCalendar.get(cal.id);
                        return (
                          <div
                            key={cal.id}
                            style={{ background: "var(--bg-app)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", padding: "12px 14px" }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ width: 10, height: 10, borderRadius: "50%", background: cal.color, flexShrink: 0 }} aria-hidden />
                              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {cal.name}
                              </span>
                              {cal.writable === false && (
                                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-tertiary)", background: "var(--bg-raised)", padding: "2px 7px", borderRadius: 4 }}>
                                  Read-only
                                </span>
                              )}
                              <Switch checked={!!grant} onChange={() => toggleGrantCalendar(d, cal, !grant)} label={`${grant ? "Remove" : "Share"} ${cal.name}`} />
                            </div>

                            {grant && (
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
                                <div style={{ display: "flex", gap: 6, marginBottom: 12 }} role="group" aria-label="Permission presets">
                                  {PRESETS.map((p) => (
                                    <button
                                      key={p.id}
                                      onClick={() => applyPreset(d, cal.id, p.fields)}
                                      className="hoverable"
                                      title={p.desc}
                                      style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
                                    >
                                      {p.name}
                                    </button>
                                  ))}
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
                                  {GRANT_GROUPS.map((group) => (
                                    <div key={group.title}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                                        {group.title}
                                      </div>
                                      {group.fields.map(({ key, label, desc }) => (
                                        <label
                                          key={key}
                                          title={desc}
                                          style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, cursor: "pointer", padding: "5px 6px", margin: "0 -6px", borderRadius: 6, background: grant[key] ? "rgba(10, 132, 255, 0.08)" : "transparent", color: grant[key] ? "var(--text-primary)" : "var(--text-secondary)" }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={grant[key]}
                                            onChange={() => updateGrantField(d, grant, key)}
                                            style={{ marginTop: 2, accentColor: "var(--accent)" }}
                                          />
                                          <span>
                                            <span style={{ display: "block", fontWeight: grant[key] ? 600 : 400 }}>{label}</span>
                                            <span style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>{desc}</span>
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreatePairingModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            toast("Pairing created — grant calendars below.");
            load();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ icon, tint, color, label, value }: { icon: IconName; tint: string; color: string; label: string; value: number }) {
  return (
    <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 36, height: 36, borderRadius: 8, background: tint, color, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name={icon} size={18} />
      </span>
      <span>
        <span style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
        <span style={{ display: "block", fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{value}</span>
      </span>
    </div>
  );
}

function CreatePairingModal({ users, onClose, onCreated }: { users: AdminUser[]; onClose: () => void; onCreated: () => void }) {
  const executives = users.filter((u) => u.role === "admin");
  const assistants = users.filter((u) => u.role === "delegate");
  const [executiveId, setExecutiveId] = useState(executives[0]?.id ?? "");
  const [assistantId, setAssistantId] = useState(assistants[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = executives.length > 0 && assistants.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminCreateDelegation(executiveId, assistantId);
      onCreated();
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mount-rise" onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "90vw", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>New pairing</h3>
          <button onClick={onClose} className="hoverable" aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: "2px 6px", display: "inline-flex" }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
          An assistant acts on an executive's calendars — but only through the grants you add next.
        </p>

        {!ready ? (
          <p style={{ fontSize: 12, color: "var(--warning)", background: "rgba(255, 159, 10, 0.12)", padding: "12px 14px", borderRadius: "var(--radius-sm)", margin: 0, lineHeight: 1.5 }}>
            Pairing needs at least one executive and one assistant account. Add them under Users first.
          </p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="pairing-executive" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Executive</label>
              <select id="pairing-executive" value={executiveId} onChange={(e) => setExecutiveId(e.target.value)} className="input-standard" style={{ width: "100%", fontSize: 13 }}>
                {executives.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pairing-assistant" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Assistant</label>
              <select id="pairing-assistant" value={assistantId} onChange={(e) => setAssistantId(e.target.value)} className="input-standard" style={{ width: "100%", fontSize: 13 }}>
                {assistants.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                ))}
              </select>
            </div>
            {error && (
              <div style={{ color: "var(--danger)", fontSize: 12, background: "rgba(255, 69, 58, 0.1)", padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
              <button type="button" onClick={onClose} className="btn-secondary hoverable">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary hoverable" style={{ padding: "8px 18px" }}>
                {saving ? "Creating…" : "Create pairing"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
