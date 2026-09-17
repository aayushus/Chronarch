import React from "react";
import { Link } from "react-router-dom";

import { CalendarSummary } from "../api/calendar";
import Icon from "./Icon";
import { avatarInitials } from "./EventCard";
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
  canManageAccounts: boolean;
  onOpenCopilot: () => void;
  onOpenIcsImport: () => void;
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
  canManageAccounts,
  onOpenCopilot,
  onOpenIcsImport,
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
      className="vibrancy"
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
      {/* App Branding Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 16px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <img src="/logo.svg" alt="" width={22} height={22} style={{ borderRadius: 6 }} />
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", fontFamily: "Georgia, 'Times New Roman', serif" }}>Chronarch</span>
        </div>
      </div>

      {/* Quick Actions (macOS / Apple Calendar Style) */}
      <div style={{ padding: "0 8px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
        <button
          onClick={onOpenCopilot}
          className="hoverable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            width: "100%",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "6px 10px",
            background: "rgba(10, 132, 255, 0.12)",
            color: "var(--accent)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <Icon name="sparkles" size={14} />
          <span>Ask Copilot</span>
        </button>

        <button
          onClick={onOpenIcsImport}
          className="hoverable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            width: "100%",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "6px 10px",
            background: "transparent",
            color: "var(--text-secondary)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ opacity: 0.8, display: "inline-flex" }}>
            <Icon name="upload" size={13} />
          </span>
          <span>Import .ics</span>
        </button>
      </div>

      <div style={{ height: 1, background: "var(--border-subtle)", margin: "0 8px 6px" }} />

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            padding: "6px 10px 4px",
          }}
        >
          Calendars
        </div>
        {groups.size === 0 && (
          <div style={{ textAlign: "center", padding: "20px 8px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(10, 132, 255, 0.12)",
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 8,
              }}
            >
              <Icon name="calendar" size={18} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>No calendars yet</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10, lineHeight: 1.45 }}>
              {canManageAccounts ? "Connect Google, Microsoft, CalDAV, or an ICS feed to begin." : "Ask your admin to connect a calendar."}
            </div>
            {canManageAccounts && (
              <Link
                to="/settings"
                style={{
                  display: "inline-block",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  padding: "6px 12px",
                  textDecoration: "none",
                }}
              >
                Connect first account
              </Link>
            )}
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
                className="hoverable"
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
                {!(cal.can_reschedule ?? cal.writable) && !(cal.can_create ?? cal.writable) && (
                  <span style={{ color: "var(--text-tertiary)", display: "inline-flex" }} title="Read-only">
                    <Icon name="lock" size={11} />
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <span
          style={{
            width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", color: "#fff",
            fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center",
            justifyContent: "center", flexShrink: 0,
          }}
        >
          {avatarInitials(userDisplayName)}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={userDisplayName}
        >
          {userDisplayName}
        </span>
        <Link
          to="/settings"
          className="hoverable"
          title="Account & settings"
          style={{
            display: "inline-flex",
            color: "var(--text-tertiary)",
            borderRadius: 6,
            padding: 6,
          }}
        >
          <span aria-hidden style={{ display: "inline-flex" }}>
            <Icon name="settings" size={14} />
          </span>
        </Link>
      </div>
    </aside>
  );
}
