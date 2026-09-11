import React, { useEffect, useState } from "react";

import {
  AdminCalendar,
  AdminUser,
  Delegation,
  DelegationGrant,
  GrantFields,
  adminCreateDelegation,
  adminListCalendars,
  adminListDelegations,
  adminListUsers,
  adminRemoveGrant,
  adminSetDelegationActive,
  adminUpsertGrant,
} from "../../api/admin";

const GRANT_LABELS: { key: keyof GrantFields; label: string }[] = [
  { key: "can_view_availability", label: "View availability" },
  { key: "can_view_titles", label: "View titles" },
  { key: "can_view_full_details", label: "View full details" },
  { key: "can_create", label: "Create events" },
  { key: "can_edit", label: "Edit events" },
  { key: "can_reschedule", label: "Reschedule events" },
  { key: "can_delete", label: "Delete events" },
  { key: "can_manage_attendees", label: "Manage attendees" },
  { key: "can_respond_to_invitations", label: "Respond to invitations" },
  { key: "can_import_ics", label: "Import ICS" },
  { key: "can_move_between_calendars", label: "Move between calendars" },
];

const DEFAULT_GRANT: GrantFields = {
  can_view_availability: true,
  can_view_titles: false,
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    Promise.all([adminListDelegations(), adminListUsers(), adminListCalendars()])
      .then(([d, u, c]) => {
        setDelegations(d);
        setUsers(u);
        setCalendars(c);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleActive(d: Delegation) {
    setDelegations((prev) => prev.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x)));
    try {
      await adminSetDelegationActive(d.id, !d.active);
    } catch (e) {
      setError(String(e));
      load();
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

  async function updateGrantField(delegation: Delegation, grant: DelegationGrant, field: keyof GrantFields) {
    const next: GrantFields = { ...grant, [field]: !grant[field] };
    try {
      const updated = await adminUpsertGrant(delegation.id, grant.calendar_id, next);
      setDelegations((prev) => prev.map((x) => (x.id === delegation.id ? updated : x)));
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Delegates</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Executive ↔ Assistant pairings and their per-calendar permissions (BRD §14). Grants here are still
            capped by each calendar's source and admin authority — see Calendars.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="hoverable" style={btnStyle}>
          + Add Delegation
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {delegations.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No delegations configured yet.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {delegations.map((d) => {
          const expanded = expandedId === d.id;
          const grantByCalendar = new Map(d.grants.map((g) => [g.calendar_id, g]));
          return (
            <div key={d.id} style={{ background: "var(--bg-raised)", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setExpandedId(expanded ? null : d.id)}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {d.assistant_email} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>assists</span>{" "}
                    {d.executive_email}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {d.grants.length} calendar{d.grants.length === 1 ? "" : "s"} granted
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={d.active} onChange={() => toggleActive(d)} />
                  Active
                </label>
                <button onClick={() => setExpandedId(expanded ? null : d.id)} className="icon-btn" style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 4, borderRadius: 4 }}>
                  {expanded ? "▲" : "▼"}
                </button>
              </div>

              {expanded && (
                <div style={{ marginTop: 14, borderTop: "1px solid var(--border-subtle)", paddingTop: 14 }}>
                  {calendars.map((cal) => {
                    const grant = grantByCalendar.get(cal.id);
                    return (
                      <div key={cal.id} style={{ marginBottom: 10 }}>
                        <label className="hoverable" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", padding: 4, borderRadius: 6 }}>
                          <input
                            type="checkbox"
                            checked={!!grant}
                            onChange={(e) => toggleGrantCalendar(d, cal, e.target.checked)}
                          />
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: cal.color }} />
                          {cal.name}
                        </label>
                        {grant && (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 4, marginLeft: 26, marginTop: 4 }}>
                            {GRANT_LABELS.map(({ key, label }) => (
                              <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={grant[key]}
                                  onChange={() => updateGrantField(d, grant, key)}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showCreate && (
        <CreateDelegationModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
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
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await adminCreateDelegation(executiveId, assistantId);
      onCreated();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={{ background: "var(--bg-panel)", borderRadius: 10, padding: 20, width: 320, display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Add Delegation</div>
        {executives.length === 0 || assistants.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--warning)" }}>
            Need at least one Executive and one Assistant user — add them under Users first.
          </div>
        ) : (
          <>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Executive
              <select value={executiveId} onChange={(e) => setExecutiveId(e.target.value)} style={inputStyle}>
                {executives.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Assistant
              <select value={assistantId} onChange={(e) => setAssistantId(e.target.value)} style={inputStyle}>
                {assistants.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, flex: 1, background: "var(--bg-raised-hover)" }}>
            Cancel
          </button>
          <button type="submit" disabled={executives.length === 0 || assistants.length === 0} style={{ ...btnStyle, flex: 1, background: "var(--accent)" }}>
            Create
          </button>
        </div>
      </form>
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  marginTop: 4,
  colorScheme: "dark",
};
