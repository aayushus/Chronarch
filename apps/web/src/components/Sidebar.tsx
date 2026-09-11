import React from "react";

import { CalendarSummary } from "../api/calendar";
import MiniMonth from "./MiniMonth";

interface Props {
  calendars: CalendarSummary[];
  hiddenCalendarIds: Set<string>;
  onToggleCalendar: (id: string) => void;
  viewedDate: Date;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onMonthShift: (delta: number) => void;
  userDisplayName: string;
  onLogout: () => void;
}

export default function Sidebar({
  calendars,
  hiddenCalendarIds,
  onToggleCalendar,
  viewedDate,
  selectedDate,
  onSelectDate,
  onMonthShift,
  userDisplayName,
  onLogout,
}: Props) {
  const groups = new Map<string, { label: string; calendars: CalendarSummary[] }>();
  for (const cal of calendars) {
    if (!groups.has(cal.account_id)) {
      groups.set(cal.account_id, { label: cal.account_label, calendars: [] });
    }
    groups.get(cal.account_id)!.calendars.push(cal);
  }

  return (
    <aside
      style={{
        width: 240,
        minWidth: 240,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px 8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/logo.svg" alt="" width={20} height={20} style={{ borderRadius: 5 }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Chronarch</span>
        </div>
        <button
          onClick={onLogout}
          title={`Sign out (${userDisplayName})`}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-tertiary)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
        {groups.size === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "12px 8px" }}>
            No calendars connected yet.
          </div>
        )}
        {[...groups.entries()].map(([accountId, group]) => (
          <div key={accountId} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-tertiary)",
                padding: "6px 8px 4px",
                textTransform: "none",
              }}
            >
              {group.label}
            </div>
            {group.calendars.map((cal) => (
              <label
                key={cal.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={!hiddenCalendarIds.has(cal.id)}
                  onChange={() => onToggleCalendar(cal.id)}
                  style={{ accentColor: cal.color, width: 14, height: 14 }}
                />
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--text-primary)",
                  }}
                >
                  {cal.name}
                </span>
                {!cal.writable && (
                  <span style={{ fontSize: 9, color: "var(--text-tertiary)" }} title="Read only">
                    🔒
                  </span>
                )}
              </label>
            ))}
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <MiniMonth
          viewedDate={viewedDate}
          selectedDate={selectedDate}
          onSelect={onSelectDate}
          onMonthShift={onMonthShift}
        />
      </div>
    </aside>
  );
}
