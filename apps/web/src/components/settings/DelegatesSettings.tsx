import React, { useEffect, useState } from "react";

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

interface GrantCategory {
  title: string;
  fields: { key: keyof GrantFields; label: string; desc: string }[];
}

const GRANT_CATEGORIES: GrantCategory[] = [
  {
    title: "Visibility",
    fields: [
      { key: "can_view_availability", label: "View availability (free/busy)", desc: "See when busy without titles or details" },
      { key: "can_view_titles", label: "View event titles", desc: "Read event subjects and meetings" },
      { key: "can_view_full_details", label: "View full details", desc: "Read descriptions, locations, attendees, and conference links" },
    ],
  },
  {
    title: "Scheduling & Editing",
    fields: [
      { key: "can_create", label: "Create new events", desc: "Schedule meetings directly on calendar" },
      { key: "can_edit", label: "Edit events", desc: "Modify descriptions and meeting parameters" },
      { key: "can_reschedule", label: "Reschedule / move", desc: "Change dates and times" },
      { key: "can_delete", label: "Delete / cancel events", desc: "Remove events from calendar" },
    ],
  },
  {
    title: "Collaboration & Advanced",
    fields: [
      { key: "can_manage_attendees", label: "Manage attendees", desc: "Add or remove participants from invites" },
      { key: "can_respond_to_invitations", label: "Respond to invitations", desc: "Accept, decline, or mark tentative for executive" },
      { key: "can_import_ics", label: "Import ICS", desc: "Upload and import iCalendar files" },
      { key: "can_move_between_calendars", label: "Move across calendars", desc: "Shift events between executive calendars" },
    ],
  },
];

const PRESETS: { id: string; name: string; desc: string; fields: Partial<GrantFields> }[] = [
  {
    id: "read_only",
    name: "View Only",
    desc: "Can view availability & event titles",
    fields: {
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
    },
  },
  {
    id: "scheduler",
    name: "Scheduler",
    desc: "Can create, reschedule, and manage attendees",
    fields: {
      can_view_availability: true,
      can_view_titles: true,
      can_view_full_details: true,
      can_create: true,
      can_edit: true,
      can_reschedule: true,
      can_delete: false,
      can_manage_attendees: true,
      can_respond_to_invitations: true,
      can_import_ics: true,
      can_move_between_calendars: false,
    },
  },
  {
    id: "full_manager",
    name: "Full Management",
    desc: "Complete scheduling, editing, and deletion authority",
    fields: {
      can_view_availability: true,
      can_view_titles: true,
      can_view_full_details: true,
      can_create: true,
      can_edit: true,
      can_reschedule: true,
      can_delete: true,
      can_manage_attendees: true,
      can_respond_to_invitations: true,
      can_import_ics: true,
      can_move_between_calendars: true,
    },
  },
];

const DEFAULT_GRANT: GrantFields = {
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

export default function DelegatesSettings() {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [calendars, setCalendars] = useState<AdminCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    Promise.all([adminListDelegations(), adminListUsers(), adminListCalendars()])
      .then(([d, u, c]) => {
        setDelegations(d);
        setUsers(u);
        setCalendars(c);
        if (d.length > 0 && !expandedId) {
          setExpandedId(d[0].id);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleActive(d: Delegation) {
    setDelegations((prev) => prev.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x)));
    try {
      await adminSetDelegationActive(d.id, !d.active);
      setBanner({ kind: "success", text: `Updated delegation status for ${d.assistant_email}.` });
    } catch (e) {
      setError(String(e));
      load();
    }
  }

  async function handleDeleteDelegation(d: Delegation) {
    if (!confirm(`Delete pairing between ${d.assistant_email} and ${d.executive_email}?`)) return;
    try {
      await adminDeleteDelegation(d.id);
      setDelegations((prev) => prev.filter((x) => x.id !== d.id));
      setBanner({ kind: "success", text: "Pairing deleted." });
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleGrantCalendar(delegation: Delegation, calendar: AdminCalendar, granted: boolean) {
    try {
      let updated: Delegation;
      if (granted) {
        updated = await adminUpsertGrant(delegation.id, calendar.id, DEFAULT_GRANT);
      } else {
        updated = await adminRemoveGrant(delegation.id, calendar.id);
      }
      setDelegations((prev) => prev.map((x) => (x.id === delegation.id ? updated : x)));
    } catch (e) {
      setError(String(e));
    }
  }

  async function applyPreset(delegation: Delegation, calendarId: string, presetFields: Partial<GrantFields>) {
    const next: GrantFields = { ...DEFAULT_GRANT, ...presetFields };
    try {
      const updated = await adminUpsertGrant(delegation.id, calendarId, next);
      setDelegations((prev) => prev.map((x) => (x.id === delegation.id ? updated : x)));
      setBanner({ kind: "success", text: "Applied permission preset." });
    } catch (e) {
      setError(String(e));
    }
  }

  async function updateGrantField(delegation: Delegation, grant: DelegationGrant, field: keyof GrantFields) {
    const next: GrantFields = { ...grant, [field]: !grant[field] };
    try {
      const updated = await adminUpsertGrant(delegation.id, grant.calendar_id, next);
      setDelegations((prev) => prev.map((x) => (x.id === delegation.id ? updated : x)));
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading delegations…</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Delegates</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
            Executive ↔ Assistant pairings and granular per-calendar permission grants. Grants are capped by each calendar's provider permissions.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary hoverable"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          <span>Add Pairing</span>
        </button>
      </div>

      {banner && (
        <div
          style={{
            fontSize: 13,
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 20,
            background: banner.kind === "success" ? "rgba(48, 209, 88, 0.15)" : "rgba(255, 69, 58, 0.15)",
            border: `1px solid ${banner.kind === "success" ? "var(--success)" : "var(--danger)"}`,
            color: banner.kind === "success" ? "#30d158" : "#ff453a",
            fontWeight: 500,
          }}
        >
          {banner.text}
        </div>
      )}

      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* Empty State */}
      {delegations.length === 0 ? (
        <div
          style={{
            background: "var(--bg-raised)",
            borderRadius: "var(--radius-md)",
            border: "1px dashed var(--border)",
            padding: "36px 20px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.8 }}>👥</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            No delegate pairings configured
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
            Pair an Executive with an Assistant to grant delegated scheduling authority over specific calendars.
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary hoverable"
            style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600 }}
          >
            + Create First Pairing
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {delegations.map((d) => {
            const expanded = expandedId === d.id;
            const grantByCalendar = new Map(d.grants.map((g) => [g.calendar_id, g]));

            return (
              <div
                key={d.id}
                style={{
                  background: "var(--bg-raised)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                  overflow: "hidden",
                }}
              >
                {/* Pairing Header Card */}
                <div
                  style={{
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <div
                    onClick={() => setExpandedId(expanded ? null : d.id)}
                    style={{ flex: 1, cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: d.active ? "rgba(10, 132, 255, 0.15)" : "rgba(255, 255, 255, 0.08)",
                        color: d.active ? "var(--accent)" : "var(--text-tertiary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                      }}
                    >
                      🤝
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{d.assistant_email}</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: "var(--text-tertiary)",
                            background: "var(--bg-app)",
                            padding: "2px 8px",
                            borderRadius: 10,
                          }}
                        >
                          assists
                        </span>
                        <span>{d.executive_email}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                        <span style={{ fontWeight: 600, color: d.grants.length > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                          {d.grants.length}
                        </span>{" "}
                        calendar{d.grants.length === 1 ? "" : "s"} granted · Status:{" "}
                        <span style={{ color: d.active ? "var(--success)" : "var(--text-tertiary)", fontWeight: 600 }}>
                          {d.active ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <label
                      className="hoverable"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: "6px 10px",
                        borderRadius: "var(--radius-sm)",
                        background: d.active ? "rgba(48, 209, 88, 0.12)" : "rgba(255, 255, 255, 0.06)",
                        color: d.active ? "var(--success)" : "var(--text-secondary)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={d.active}
                        onChange={() => toggleActive(d)}
                        style={{ accentColor: "var(--success)", width: 14, height: 14 }}
                      />
                      <span>Active</span>
                    </label>

                    <button
                      onClick={() => handleDeleteDelegation(d)}
                      className="btn-danger hoverable"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      title="Delete pairing"
                    >
                      Delete
                    </button>

                    <button
                      onClick={() => setExpandedId(expanded ? null : d.id)}
                      className="hoverable"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-tertiary)",
                        cursor: "pointer",
                        padding: "6px 8px",
                        fontSize: 12,
                        borderRadius: 4,
                      }}
                    >
                      {expanded ? "▲ Hide Permissions" : "▼ Configure Grants"}
                    </button>
                  </div>
                </div>

                {/* Expanded Calendar Permission Matrix */}
                {expanded && (
                  <div
                    style={{
                      borderTop: "1px solid var(--border-subtle)",
                      background: "rgba(0, 0, 0, 0.15)",
                      padding: "18px 20px",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "var(--text-primary)" }}>
                      Per-Calendar Delegated Authority
                    </div>

                    {calendars.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: 8 }}>
                        No calendars available to grant. Connect calendars in Accounts settings first.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {calendars.map((cal) => {
                          const grant = grantByCalendar.get(cal.id);
                          const isGranted = !!grant;

                          return (
                            <div
                              key={cal.id}
                              style={{
                                background: "var(--bg-app)",
                                borderRadius: "var(--radius-sm)",
                                border: `1px solid ${isGranted ? "var(--border)" : "var(--border-subtle)"}`,
                                padding: "12px 16px",
                              }}
                            >
                              {/* Calendar Toggle Row */}
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 12,
                                }}
                              >
                                <label
                                  className="hoverable"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    flex: 1,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isGranted}
                                    onChange={(e) => toggleGrantCalendar(d, cal, e.target.checked)}
                                    style={{ accentColor: cal.color, width: 15, height: 15 }}
                                  />
                                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: cal.color }} />
                                  <span>{cal.name}</span>
                                  {cal.writable === false && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "var(--text-tertiary)",
                                        background: "var(--bg-raised)",
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                      }}
                                    >
                                      read-only source
                                    </span>
                                  )}
                                </label>

                                {isGranted && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginRight: 4 }}>
                                      Quick Presets:
                                    </span>
                                    {PRESETS.map((p) => (
                                      <button
                                        key={p.id}
                                        onClick={() => applyPreset(d, cal.id, p.fields)}
                                        className="hoverable"
                                        title={p.desc}
                                        style={{
                                          background: "var(--bg-raised)",
                                          border: "1px solid var(--border-subtle)",
                                          color: "var(--text-secondary)",
                                          borderRadius: 4,
                                          padding: "3px 8px",
                                          fontSize: 11,
                                          fontWeight: 500,
                                          cursor: "pointer",
                                        }}
                                      >
                                        {p.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Fine-grained Granular Checkbox Matrix */}
                              {grant && (
                                <div
                                  style={{
                                    marginTop: 14,
                                    paddingTop: 12,
                                    borderTop: "1px solid var(--border-subtle)",
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                                    gap: 16,
                                  }}
                                >
                                  {GRANT_CATEGORIES.map((cat) => (
                                    <div key={cat.title}>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          color: "var(--text-tertiary)",
                                          textTransform: "uppercase",
                                          letterSpacing: 0.5,
                                          marginBottom: 8,
                                        }}
                                      >
                                        {cat.title}
                                      </div>
                                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        {cat.fields.map(({ key, label, desc }) => (
                                          <label
                                            key={key}
                                            className="hoverable"
                                            title={desc}
                                            style={{
                                              display: "flex",
                                              alignItems: "flex-start",
                                              gap: 8,
                                              fontSize: 12,
                                              cursor: "pointer",
                                              padding: "4px 6px",
                                              borderRadius: 4,
                                              background: grant[key] ? "rgba(10, 132, 255, 0.08)" : "transparent",
                                              color: grant[key] ? "var(--text-primary)" : "var(--text-secondary)",
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={grant[key]}
                                              onChange={() => updateGrantField(d, grant, key)}
                                              style={{ marginTop: 2, accentColor: "var(--accent)" }}
                                            />
                                            <div>
                                              <div style={{ fontWeight: grant[key] ? 600 : 400 }}>{label}</div>
                                              <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 1 }}>
                                                {desc}
                                              </div>
                                            </div>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Delegation Modal */}
      {showCreate && (
        <CreateDelegationModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setBanner({ kind: "success", text: "Pairing created." });
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateDelegationModal({
  users,
  onClose,
  onCreated,
}: {
  users: AdminUser[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const executives = users.filter((u) => u.role === "executive");
  const assistants = users.filter((u) => u.role === "assistant");
  const [executiveId, setExecutiveId] = useState(executives[0]?.id ?? "");
  const [assistantId, setAssistantId] = useState(assistants[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminCreateDelegation(executiveId, assistantId);
      onCreated();
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "90vw", padding: 26 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Add Delegate Pairing</h3>
          <button
            onClick={onClose}
            className="hoverable"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              fontSize: 20,
              cursor: "pointer",
              padding: "2px 6px",
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
          Authorize an Assistant to view, manage, and schedule events on behalf of an Executive.
        </p>

        {executives.length === 0 || assistants.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--warning)",
              background: "rgba(255, 159, 10, 0.12)",
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              marginBottom: 16,
              lineHeight: 1.4,
            }}
          >
            Pairing requires at least one <strong>Executive</strong> and one <strong>Assistant</strong> user account. Please add or assign these roles under <strong>Settings → Users</strong> first.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Executive (Calendar Owner)
              </label>
              <select
                value={executiveId}
                onChange={(e) => setExecutiveId(e.target.value)}
                className="input-standard"
                style={{ width: "100%", fontSize: 13 }}
              >
                {executives.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Assistant
              </label>
              <select
                value={assistantId}
                onChange={(e) => setAssistantId(e.target.value)}
                className="input-standard"
                style={{ width: "100%", fontSize: 13 }}
              >
                {assistants.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email})
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div
                style={{
                  color: "var(--danger)",
                  fontSize: 12,
                  background: "rgba(255, 69, 58, 0.1)",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <button type="button" onClick={onClose} className="btn-secondary hoverable">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || executives.length === 0 || assistants.length === 0}
                className="btn-primary hoverable"
                style={{ padding: "8px 18px" }}
              >
                {saving ? "Creating Pairing…" : "Create Pairing"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
