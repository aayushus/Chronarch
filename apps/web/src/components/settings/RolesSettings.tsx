import React, { useEffect, useState } from "react";
import { friendlyError } from "../../api/client";
import {
  AdminUser,
  PermissionCatalog,
  RoleInfo,
  adminAddRoleMember,
  adminCreateRole,
  adminDeleteRole,
  adminGetPermissionCatalog,
  adminListRoles,
  adminListUsers,
  adminRemoveRoleMember,
  adminUpdateRole,
} from "../../api/admin";
import { SectionHeader } from "../ui";
import Icon from "../Icon";

export default function RolesSettings() {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftPerms, setDraftPerms] = useState<Set<string>>(new Set());
  const [draftDesc, setDraftDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [addUserId, setAddUserId] = useState("");

  function load() {
    setLoading(true);
    Promise.all([adminListRoles(), adminListUsers(), adminGetPermissionCatalog()])
      .then(([r, u, c]) => {
        setRoles(r);
        setUsers(u);
        setCatalog(c);
        if (!selectedId && r.length > 0) selectRole(r[0].id, r);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  function selectRole(id: string, list: RoleInfo[] = roles) {
    const role = list.find((r) => r.id === id);
    if (!role) return;
    setSelectedId(id);
    setDraftPerms(new Set(role.permissions));
    setDraftDesc(role.description);
    setBanner(null);
  }

  const selected = roles.find((r) => r.id === selectedId);

  function togglePerm(perm: string) {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  async function handleSavePerms() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminUpdateRole(selected.id, {
        description: draftDesc,
        permissions: [...draftPerms],
      });
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setBanner(`Saved “${updated.name}”. Applies on next login/token refresh.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected || selected.is_system) return;
    if (!confirm(`Delete role “${selected.name}”? Members lose its permissions.`)) return;
    setSaving(true);
    try {
      await adminDeleteRole(selected.id);
      const rest = roles.filter((r) => r.id !== selected.id);
      setRoles(rest);
      setSelectedId(rest[0]?.id ?? null);
      if (rest[0]) selectRole(rest[0].id, rest);
      setBanner(`Deleted “${selected.name}”.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember() {
    if (!selected || !addUserId) return;
    try {
      const updated = await adminAddRoleMember(selected.id, addUserId);
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setAddUserId("");
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!selected) return;
    try {
      await adminRemoveRoleMember(selected.id, userId);
      setRoles((prev) =>
        prev.map((r) =>
          r.id === selected.id ? { ...r, members: r.members.filter((m) => m.id !== userId) } : r
        )
      );
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  if (loading) return <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-md)" }}>Loading roles…</div>;

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <SectionHeader
          title="Roles"
          description="Custom permission bundles for delegates. Admins always have every permission; calendar sharing stays on the Delegates page, not here."
        />
      </div>

      {banner && (
        <div style={{ fontSize: "var(--text-md)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 16, background: "rgba(48, 209, 88, 0.12)", border: "1px solid rgba(48, 209, 88, 0.3)" }}>
          {banner}
        </div>
      )}
      {error && <div style={{ color: "var(--danger)", fontSize: "var(--text-md)", marginBottom: 16 }}>{error}</div>}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Role list */}
        <div style={{ flex: "0 0 240px", display: "flex", flexDirection: "column", gap: 8 }}>
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => selectRole(r.id)}
              className="hoverable"
              style={{
                textAlign: "left",
                background: r.id === selectedId ? "var(--bg-raised)" : "transparent",
                border: `1px solid ${r.id === selectedId ? "var(--accent)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-md)",
                padding: "10px 12px",
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>{r.name}</span>
                {r.is_system && (
                  <span style={{ fontSize: "var(--text-2xs)", fontWeight: 700, padding: "1px 5px", borderRadius: "var(--radius-sm)", background: "var(--wash-faint)", color: "var(--text-tertiary)" }}>
                    SYSTEM
                  </span>
                )}
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                {r.members.length} member{r.members.length === 1 ? "" : "s"} · {r.permissions.length} permissions
              </div>
            </button>
          ))}

          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              onClick={() => setWizardOpen(true)}
              className="btn-primary hoverable"
              style={{ width: "100%", padding: "8px 12px", fontSize: "var(--text-sm)", fontWeight: 600 }}
            >
              + New Role
            </button>
          </div>
        </div>

        {/* Editor */}
        {selected && (
          <div style={{ flex: "1 1 420px", background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xl)", padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>
                {selected.name}
                {selected.name === "admin" && (
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 400, color: "var(--text-tertiary)", marginLeft: 8 }}>
                    always has every permission
                  </span>
                )}
              </div>
              {!selected.is_system && (
                <button onClick={handleDelete} disabled={saving} className="btn-danger hoverable" style={{ padding: "5px 10px", fontSize: "var(--text-sm)" }}>
                  {saving ? "Deleting…" : "Delete role"}
                </button>
              )}
            </div>

            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", margin: "10px 0 4px" }}>
              Description
            </label>
            <input
              type="text"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              className="input-standard"
              style={{ width: "100%", fontSize: "var(--text-sm)" }}
            />

            <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", margin: "14px 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Permissions
            </div>
            {Object.entries(catalog).map(([group, items]) => (
              <div key={group} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: 4 }}>{group}</div>
                {items.map((item) => (
                  <label key={item.permission} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "var(--text-sm)", padding: "3px 0", cursor: "pointer" }}>
                    <input className="checkbox"
                      type="checkbox"
                      checked={draftPerms.has(item.permission)}
                      onChange={() => togglePerm(item.permission)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-primary)" }}>{item.permission}</span>
                      <span style={{ color: "var(--text-tertiary)" }}> — {item.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}

            <button onClick={handleSavePerms} disabled={saving} className="btn-primary hoverable" style={{ padding: "7px 16px", fontSize: "var(--text-sm)", marginTop: 4 }}>
              {saving ? "Saving…" : "Save role"}
            </button>

            <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", margin: "16px 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Members ({selected.members.length})
            </div>
            {selected.members.map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--text-sm)", padding: "4px 0" }}>
                <span>{m.email}</span>
                <button
                  onClick={() => handleRemoveMember(m.id)}
                  className="hoverable"
                  style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: "var(--text-sm)" }}
                >
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <select className="input-standard select" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}  style={{ flex: 1}}>
                <option value="">Add member…</option>
                {users
                  .filter((u) => !selected.members.some((m) => m.id === u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.role})
                    </option>
                  ))}
              </select>
              <button onClick={handleAddMember} disabled={!addUserId} className="btn-secondary hoverable" style={{ padding: "6px 12px", fontSize: "var(--text-sm)" }}>
                Add
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <select className="input-standard select" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}  style={{ flex: 1}}>
                <option value="">Add member…</option>
                {users
                  .filter((u) => !selected.members.some((m) => m.id === u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.role})
                    </option>
                  ))}
              </select>
              <button onClick={handleAddMember} disabled={!addUserId} className="btn-secondary hoverable" style={{ padding: "6px 12px", fontSize: "var(--text-sm)" }}>
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {wizardOpen && (
        <NewRoleWizard
          roles={roles}
          users={users}
          catalog={catalog}
          onClose={() => setWizardOpen(false)}
          onCreated={(created) => {
            setRoles((prev) => [...prev, created]);
            selectRole(created.id, [...roles, created]);
            setBanner(`Created role “${created.name}”.`);
            setWizardOpen(false);
          }}
        />
      )}
    </div>
  );
}

const WIZARD_STEPS = ["Details", "Permissions", "Members", "Review"];

function NewRoleWizard({
  roles,
  users,
  catalog,
  onClose,
  onCreated,
}: {
  roles: RoleInfo[];
  users: AdminUser[];
  catalog: PermissionCatalog;
  onClose: () => void;
  onCreated: (role: RoleInfo) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = name.trim().toLowerCase().replace(/\s+/g, "_");

  function pickClone(id: string) {
    setCloneFrom(id);
    if (!id) {
      setPerms(new Set());
      return;
    }
    const src = roles.find((r) => r.id === id);
    setPerms(new Set(src?.permissions ?? []));
  }

  function togglePerm(perm: string) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  function toggleMember(id: string) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canNext =
    step === 0 ? normalized.length > 0 && !roles.some((r) => r.name === normalized) : true;

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const created = await adminCreateRole({ name: normalized, description: description.trim(), permissions: [...perms] });
      for (const userId of memberIds) {
        await adminAddRoleMember(created.id, userId);
      }
      const refreshed = { ...created, members: users.filter((u) => memberIds.has(u.id)).map((u) => ({ id: u.id, email: u.email })) };
      onCreated(refreshed);
    } catch (e) {
      setError(friendlyError(e));
      setSaving(false);
    }
  }

  const chosenMembers = users.filter((u) => memberIds.has(u.id));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 600, maxWidth: "94vw", padding: 28, maxHeight: "88vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="hoverable"
                style={{ background: "var(--bg-raised)", border: "none", borderRadius: "var(--radius-sm)", color: "var(--text-secondary)", padding: "4px 8px", fontSize: "var(--text-sm)", cursor: "pointer" }}
              >
                ← Back
              </button>
            )}
            <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700, margin: 0 }}>New Role</h3>
          </div>
          <button
            onClick={onClose}
            className="hoverable"
            style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: "var(--text-xl)", cursor: "pointer", padding: "2px 6px" }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        {/* Progress */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {WIZARD_STEPS.map((label, i) => (
            <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div
                style={{
                  height: 3,
                  borderRadius: "var(--radius-pill)",
                  background: i < step ? "var(--success)" : i === step ? "var(--accent)" : "var(--border-subtle)",
                }}
              />
              <div style={{ fontSize: "var(--text-xs)", fontWeight: i === step ? 700 : 400, color: i === step ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                {i + 1}. {label}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--danger)", background: "rgba(255, 69, 58, 0.1)", padding: "10px 12px", borderRadius: "var(--radius-md)", marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* STEP 1: Details */}
        {step === 0 && (
          <div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Name the role. Optionally start from an existing role's permissions.
            </p>
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Role name</label>
            <input
              type="text"
              placeholder="e.g. Support agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="input-standard"
              style={{ width: "100%", marginBottom: 4 }}
            />
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", marginBottom: 14 }}>
              Saved as <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{normalized || "…"}</code>
              {roles.some((r) => r.name === normalized) && normalized && (
                <span style={{ color: "var(--danger)" }}> — that name is taken</span>
              )}
            </div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Description (optional)</label>
            <input
              type="text"
              placeholder="What is this role for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-standard"
              style={{ width: "100%", marginBottom: 14 }}
            />
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 6 }}>Start from (optional)</label>
            <select className="input-standard select" value={cloneFrom} onChange={(e) => pickClone(e.target.value)}  style={{ width: "100%" }}>
              <option value="">Blank — pick permissions next</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  Copy {r.name} ({r.permissions.length} permissions)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* STEP 2: Permissions */}
        {step === 1 && (
          <div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 12px" }}>
              {perms.size} permission{perms.size === 1 ? "" : "s"} selected. Reads let members see a section; writes let them change it.
            </p>
            {Object.entries(catalog).map(([group, items]) => (
              <div key={group} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: 4 }}>{group}</div>
                {items.map((item) => (
                  <label key={item.permission} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "var(--text-sm)", padding: "3px 0", cursor: "pointer" }}>
                    <input className="checkbox" type="checkbox" checked={perms.has(item.permission)} onChange={() => togglePerm(item.permission)} style={{ marginTop: 2 }} />
                    <span>
                      <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-primary)" }}>{item.permission}</span>
                      <span style={{ color: "var(--text-tertiary)" }}> — {item.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* STEP 3: Members */}
        {step === 2 && (
          <div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 12px" }}>
              Who gets this role? You can also assign members later.
            </p>
            {users.map((u) => (
              <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "var(--text-md)", padding: "7px 10px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", marginBottom: 6, cursor: "pointer" }}>
                <input className="checkbox" type="checkbox" checked={memberIds.has(u.id)} onChange={() => toggleMember(u.id)} />
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{u.display_name || u.email}</span>
                  <span style={{ color: "var(--text-tertiary)", marginLeft: 8, fontSize: "var(--text-sm)" }}>{u.email} · {u.role}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {/* STEP 4: Review */}
        {step === 3 && (
          <div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 12px" }}>
              Confirm before creating.
            </p>
            <div style={{ background: "var(--bg-app)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 14, fontSize: "var(--text-md)" }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: "var(--text-tertiary)" }}>Name: </span>
                <code style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>{normalized}</code>
              </div>
              {description.trim() && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "var(--text-tertiary)" }}>About: </span>{description.trim()}
                </div>
              )}
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: "var(--text-tertiary)" }}>Permissions ({perms.size}): </span>
                {perms.size === 0 ? "none — read-only role" : [...perms].sort().join(", ")}
              </div>
              <div>
                <span style={{ color: "var(--text-tertiary)" }}>Members ({chosenMembers.length}): </span>
                {chosenMembers.length === 0 ? "none yet" : chosenMembers.map((u) => u.email).join(", ")}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="btn-secondary hoverable">
            Cancel
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canNext} className="btn-primary hoverable" style={{ padding: "8px 20px" }}>
              Continue →
            </button>
          ) : (
            <button onClick={handleCreate} disabled={saving || !canNext} className="btn-primary hoverable" style={{ padding: "8px 20px" }}>
              {saving ? "Creating…" : "Create role"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
