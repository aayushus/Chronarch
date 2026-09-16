import React, { useEffect, useMemo, useState } from "react";

import { friendlyError } from "../../api/client";
import {
  ContactEntry,
  createContact,
  deleteContact,
  restoreContact,
  searchContacts,
  updateContact,
} from "../../api/calendar";
import EmptyState from "../EmptyState";
import Icon from "../Icon";
import { useToast } from "../Toast";

type Tab = "all" | "frequent" | "needs_name";

const FREQUENT_MIN_MEETINGS = 3;

function initials(email: string, name: string | null): string {
  const source = (name ?? email.split("@")[0]).replace(/[._-]+/g, " ").trim();
  const parts = source.split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? email[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function formatSeen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ContactsSettings({ onOpenAccounts }: { onOpenAccounts?: () => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactEntry | "new" | null>(null);

  async function runSearch(q: string) {
    setSearching(true);
    setError(null);
    try {
      const res = await searchContacts(q);
      setContacts(res.contacts);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }

  async function refresh() {
    try {
      setContacts((await searchContacts(query.trim())).contacts);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  useEffect(() => {
    void runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void runSearch(query.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const visible = useMemo(() => {
    if (tab === "frequent") return contacts.filter((c) => c.event_count >= FREQUENT_MIN_MEETINGS);
    if (tab === "needs_name") return contacts.filter((c) => !c.display_name);
    return contacts;
  }, [contacts, tab]);
  const needsNameCount = contacts.filter((c) => !c.display_name).length;

  async function handleDelete(c: ContactEntry) {
    setEditing(null);
    setContacts((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await deleteContact(c.id);
      toast(`Removed ${c.display_name ?? c.email} from contacts.`, {
        actionLabel: "Undo",
        onAction: async () => {
          try {
            await restoreContact(c.id);
            await refresh();
          } catch {
            /* stays deleted on failure */
          }
        },
      });
    } catch (e) {
      setError(friendlyError(e));
      await refresh();
    }
  }

  if (loading) {
    return <div style={{ padding: "32px 0", color: "var(--text-tertiary)", fontSize: 13 }}>Loading contacts…</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Contacts</h2>
            <span
              style={{
                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
                background: "rgba(10, 132, 255, 0.12)", color: "var(--primary)",
                border: "1px solid rgba(10, 132, 255, 0.25)",
              }}
            >
              {contacts.length} {contacts.length === 1 ? "Person" : "People"}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
            People from your invites, collected automatically as calendars sync — plus anyone you add by hand.
            Quick-add and the assistant resolve names against this list.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="btn-primary hoverable"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-sm)" }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          <span>Add Contact</span>
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 13, borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 20, background: "rgba(255, 69, 58, 0.15)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", display: "inline-flex" }}>
          <Icon name="search" size={14} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or company…"
          aria-label="Search contacts"
          className="input-standard"
          style={{ width: "100%", paddingLeft: 34 }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }} role="tablist" aria-label="Contact views">
        <TabButton active={tab === "all"} label={`All · ${contacts.length}`} onClick={() => setTab("all")} />
        <TabButton active={tab === "frequent"} label="Frequent" onClick={() => setTab("frequent")} />
        <TabButton
          active={tab === "needs_name"}
          label={`Needs name${needsNameCount > 0 ? ` · ${needsNameCount}` : ""}`}
          onClick={() => setTab("needs_name")}
        />
      </div>

      {visible.length === 0 && !searching ? (
        <EmptyState
          icon="addressBook"
          title={query.trim() ? "No matches" : tab === "frequent" ? "No frequent contacts yet" : tab === "needs_name" ? "Every contact has a name" : "No contacts yet"}
          body={
            query.trim()
              ? `Nobody matches “${query.trim()}”. Try an email address instead.`
              : tab === "all"
              ? "Contacts appear here once an account syncs — every invitee and organizer on your events is added automatically. Or add someone by hand."
              : tab === "frequent"
              ? `People you meet ${FREQUENT_MIN_MEETINGS} times or more land here.`
              : "Invite-only addresses without a name show up here for a quick fix."
          }
          actionLabel={tab === "all" && !query.trim() ? (onOpenAccounts ? "Go to Accounts" : "Add Contact") : undefined}
          onAction={
            tab === "all" && !query.trim()
              ? onOpenAccounts ?? (() => setEditing("new"))
              : undefined
          }
        />
      ) : (
        <div style={{ background: "var(--bg-raised)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", overflow: "hidden" }}>
          <div
            style={{
              display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1.6fr) minmax(0, 1fr) auto auto",
              gap: 12, padding: "10px 16px", alignItems: "center",
              borderBottom: "1px solid var(--border-subtle)",
              fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)",
              textTransform: "uppercase", letterSpacing: 0.5,
            }}
          >
            <span>Name</span>
            <span>Email</span>
            <span>Company</span>
            <span style={{ textAlign: "right" }}>Meetings</span>
            <span style={{ width: 28 }} />
          </div>
          {visible.map((c) => (
            <div
              key={c.id}
              onClick={() => setEditing(c)}
              className="hoverable"
              style={{
                display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1.6fr) minmax(0, 1fr) auto auto",
                gap: 12, padding: "10px 16px", alignItems: "center", cursor: "pointer",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{
                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(10, 132, 255, 0.14)", color: "var(--accent)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                  }}
                >
                  {initials(c.email, c.display_name)}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.display_name ?? <span style={{ color: "var(--warning)" }}>Unnamed</span>}
                </span>
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.email}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.job_title && c.company ? `${c.job_title}, ${c.company}` : c.company ?? c.job_title ?? "—"}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right", whiteSpace: "nowrap" }} title={c.last_seen_at ? `Last seen ${formatSeen(c.last_seen_at)}` : undefined}>
                {c.event_count}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(c);
                }}
                className="hoverable"
                aria-label={`Edit ${c.display_name ?? c.email}`}
                style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 6, display: "inline-flex", width: 28 }}
              >
                <Icon name="pencil" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {searching && (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 10 }}>Searching…</div>
      )}

      {editing && (
        <ContactEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
          onDeleted={handleDelete}
        />
      )}
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className="hoverable"
      style={{
        border: "1px solid var(--border-subtle)", borderRadius: 16, padding: "5px 14px",
        fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: "pointer",
        background: active ? "rgba(10, 132, 255, 0.14)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}
    </button>
  );
}

function ContactEditor({
  initial, onClose, onSaved, onDeleted,
}: {
  initial: ContactEntry | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (c: ContactEntry) => void;
}) {
  const [name, setName] = useState(initial?.display_name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.job_title ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = initial === null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("An email address is required — it's how invites resolve to this person.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        email: email.trim(),
        display_name: name.trim() || null,
        phone: phone.trim() || null,
        company: company.trim() || null,
        job_title: jobTitle.trim() || null,
      };
      if (isNew) {
        await createContact(body);
      } else {
        await updateContact(initial.id, body);
      }
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mount-rise" onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "92vw", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{isNew ? "New contact" : "Edit contact"}</h3>
          <button onClick={onClose} className="hoverable" aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: "2px 6px", display: "inline-flex" }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {!isNew && initial.event_count > 0 && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 14px" }}>
            Met {initial.event_count} time{initial.event_count === 1 ? "" : "s"}
            {initial.last_seen_at ? ` · last seen ${formatSeen(initial.last_seen_at)}` : ""} · names you set here stick
          </p>
        )}
        {isNew && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 14px" }}>
            Someone invites haven't seen yet — e.g. a new hire before the first meeting.
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Name" value={name} onChange={setName} placeholder="e.g. Sarah Lin" autoFocus />
          <Field label="Email" value={email} onChange={setEmail} placeholder="e.g. sarah@acme.com" type="email" />
          <Field label="Phone" value={phone} onChange={setPhone} placeholder="Optional" type="tel" />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1.2 }}>
              <Field label="Company" value={company} onChange={setCompany} placeholder="Optional" />
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Optional" />
            </div>
          </div>

          {error && (
            <div style={{ color: "var(--danger)", fontSize: 12, background: "rgba(255, 69, 58, 0.1)", padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: isNew ? "flex-end" : "space-between", gap: 10, marginTop: 4 }}>
            {!isNew && (
              <button
                type="button"
                onClick={() => onDeleted(initial)}
                className="hoverable"
                style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: "8px 4px", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="trash" size={14} />
                Remove
              </button>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={onClose} className="btn-secondary hoverable">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary hoverable" style={{ padding: "8px 18px" }}>
                {saving ? "Saving…" : isNew ? "Add contact" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; autoFocus?: boolean;
}) {
  const id = `contact-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</label>
      <input
        id={id} type={type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus} className="input-standard" style={{ width: "100%", fontSize: 13 }}
      />
    </div>
  );
}
