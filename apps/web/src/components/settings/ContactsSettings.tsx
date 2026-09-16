import React, { useEffect, useState } from "react";

import { friendlyError } from "../../api/client";
import { ContactEntry, searchContacts } from "../../api/calendar";
import EmptyState from "../EmptyState";
import Icon from "../Icon";

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
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    void runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void runSearch(query.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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
            People found in your invites, collected automatically as calendars sync.
            Quick-add and the assistant use this list to resolve names to emails.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 20, background: "rgba(255, 69, 58, 0.15)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", display: "inline-flex" }}>
          <Icon name="search" size={14} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search contacts"
          className="input-standard"
          style={{ width: "100%", paddingLeft: 34 }}
        />
      </div>

      {contacts.length === 0 && !searching ? (
        <EmptyState
          icon="addressBook"
          title={query.trim() ? "No matches" : "No contacts yet"}
          body={
            query.trim()
              ? `Nobody matches “${query.trim()}”. Try an email address instead.`
              : "Contacts appear here once an account syncs — every invitee and organizer on your events is added automatically."
          }
          actionLabel={!query.trim() && onOpenAccounts ? "Go to Accounts" : undefined}
          onAction={!query.trim() && onOpenAccounts ? onOpenAccounts : undefined}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {contacts.map((c) => (
            <div
              key={c.email}
              style={{
                background: "var(--bg-raised)", borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)", padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 12,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                  background: "rgba(10, 132, 255, 0.14)", color: "var(--accent)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
                }}
              >
                {initials(c.email, c.display_name)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.display_name ?? c.email}
                </span>
                {c.display_name && (
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.email}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                {c.event_count} meeting{c.event_count === 1 ? "" : "s"}
                {c.last_seen_at ? ` · seen ${formatSeen(c.last_seen_at)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {searching && (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 10 }}>Searching…</div>
      )}
    </div>
  );
}
