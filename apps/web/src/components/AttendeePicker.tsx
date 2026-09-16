import React, { useEffect, useRef, useState } from "react";

import { ContactEntry, searchContacts } from "../api/calendar";
import { friendlyError } from "../api/client";

export interface PickerAttendee {
  name: string;
  email: string;
}

interface Props {
  value: PickerAttendee[];
  onChange: (next: PickerAttendee[]) => void;
  label?: string;
}

/** Contact autocomplete for invite lists: type to search the directory,
 * pick from the dropdown (or type a full email and press Enter). Only
 * resolved addresses are ever added — no guessing. */
export default function AttendeePicker({ value, onChange, label }: Props) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<ContactEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await searchContacts(q);
        const known = new Set(value.map((a) => a.email.toLowerCase()));
        setSuggestions(res.contacts.filter((c) => !known.has(c.email.toLowerCase())).slice(0, 6));
        setOpen(true);
        setError(null);
      } catch (e) {
        setError(friendlyError(e));
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function add(entry: { name: string; email: string }) {
    if (value.some((a) => a.email.toLowerCase() === entry.email.toLowerCase())) return;
    onChange([...value, entry]);
    setInput("");
    setSuggestions([]);
    setOpen(false);
  }

  function commitRawEmail() {
    const raw = input.trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
      add({ name: raw.split("@")[0], email: raw });
    } else if (suggestions.length === 1) {
      const c = suggestions[0];
      add({ name: c.display_name ?? c.email, email: c.email });
    }
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      {label && (
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      )}
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {value.map((a) => (
            <span
              key={a.email}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "rgba(10, 132, 255, 0.12)", border: "1px solid rgba(10, 132, 255, 0.3)",
                borderRadius: 14, padding: "3px 6px 3px 10px", fontSize: 12, fontWeight: 500,
                maxWidth: "100%",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.name} <span style={{ color: "var(--text-secondary)" }}>{a.email}</span>
              </span>
              <button
                onClick={() => onChange(value.filter((x) => x.email !== a.email))}
                aria-label={`Remove ${a.email}`}
                className="hoverable"
                style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "0 2px", fontSize: 12 }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitRawEmail();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Type a name or email…"
        aria-label="Add attendee"
        className="input-standard"
        style={{ width: "100%", fontSize: 13 }}
      />
      {open && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", marginTop: 4,
            background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 8,
            boxShadow: "var(--shadow-pop)", overflow: "hidden", maxHeight: 220, overflowY: "auto",
          }}
        >
          {suggestions.map((c) => (
            <button
              key={c.email}
              onClick={() => add({ name: c.display_name ?? c.email, email: c.email })}
              className="hoverable"
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                background: "none", border: "none", padding: "8px 12px", cursor: "pointer",
                color: "var(--text-primary)", fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.display_name ?? c.email}
              </span>
              {c.display_name && (
                <span style={{ color: "var(--text-secondary)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.email}
                </span>
              )}
              <span style={{ marginLeft: "auto", color: "var(--text-tertiary)", fontSize: 11, flexShrink: 0 }}>
                {c.event_count} meeting{c.event_count === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}
