import React, { useState } from "react";
import { Link } from "react-router-dom";

import Icon from "./Icon";

export type CalendarViewMode = "day" | "week" | "month" | "agenda" | "year";

interface Props {
  viewedDate: Date;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onToday: () => void;
  onShift: (delta: number) => void;
  onCreateEvent: () => void;
  onOpenPalette: () => void;
  onOpenIcsImport?: () => void;
  userInitials: string;
  lastSyncedAt?: string | null;
  isSyncing?: boolean;
  onSyncNow?: () => void;
}

/** Mondays header: command bar + New Event split-button + sync/avatar
 * cluster on top; date title + underlined view tabs + Today nav below. */
export default function TopBar({
  viewedDate,
  viewMode,
  onViewModeChange,
  onToday,
  onShift,
  onCreateEvent,
  onOpenPalette,
  onOpenIcsImport,
  userInitials,
  lastSyncedAt,
  isSyncing,
  onSyncNow,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const endOfAgenda = new Date(viewedDate);
  endOfAgenda.setDate(endOfAgenda.getDate() + 13);
  const dateLabel =
    viewMode === "year"
      ? String(viewedDate.getFullYear())
      : viewMode === "agenda"
      ? `${viewedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${endOfAgenda.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : viewedDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  const syncLabel = lastSyncedAt ? formatTimeAgo(new Date(lastSyncedAt)) : "Ready";

  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)", padding: "10px 24px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={onOpenPalette}
          className="hoverable"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--bg-raised)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: "7px 12px",
            color: "var(--text-tertiary)",
            fontSize: 13,
            cursor: "pointer",
            minWidth: 0,
          }}
        >
          <Icon name="search" size={14} />
          <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Search or type a command
          </span>
          <kbd>⌘F</kbd>
        </button>

        <div style={{ display: "flex", flexShrink: 0, position: "relative" }}>
          <button onClick={onCreateEvent} className="btn-primary hoverable" style={{ borderRadius: "8px 0 0 8px", padding: "7px 14px" }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
            <span>New Event</span>
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More create options"
            className="btn-primary hoverable"
            style={{ borderRadius: "0 8px 8px 0", padding: "7px 10px", borderLeft: "1px solid rgba(255,255,255,0.3)" }}
          >
            <Icon name="chevronRight" size={13} />
          </button>
          {menuOpen && onOpenIcsImport && (
            <div style={{ position: "absolute", top: 36, right: 0, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-pop)", padding: 4, zIndex: 50, minWidth: 180 }}>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenIcsImport();
                }}
                className="hoverable"
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "var(--text-primary)", cursor: "pointer" }}
              >
                <Icon name="upload" size={13} />
                Import .ics file
              </button>
            </div>
          )}
        </div>

        {onSyncNow && (
          <button
            onClick={onSyncNow}
            disabled={isSyncing}
            className="hoverable"
            title="Sync with Google, Microsoft & ICS calendars"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "var(--bg-raised)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 16,
              color: "var(--text-secondary)",
              fontSize: 12,
              padding: "6px 12px",
              cursor: isSyncing ? "wait" : "pointer",
              flexShrink: 0,
            }}
          >
            <span style={{ display: "inline-flex", fontSize: 13 }}>
              <Icon name="refresh" size={13} />
            </span>
            <span>{isSyncing ? "Syncing…" : `Synced ${syncLabel}`}</span>
          </button>
        )}

        <Link
          to="/settings"
          title="Account & settings"
          style={{
            width: 30, height: 30, borderRadius: "50%", background: "var(--accent)", color: "#fff",
            fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center",
            justifyContent: "center", textDecoration: "none", flexShrink: 0,
          }}
        >
          {userInitials || "?"}
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <div className="date-header tabular-nums" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", paddingBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {dateLabel}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 2, overflowX: "auto", maxWidth: "100%" }}>
          {(["day", "week", "month", "agenda", "year"] as CalendarViewMode[]).map((mode) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                className="hoverable"
                style={{
                  border: "none",
                  background: "none",
                  padding: "8px 12px",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  borderBottom: active ? "2px solid var(--text-primary)" : "2px solid transparent",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 6, flexShrink: 0 }}>
          <button onClick={onToday} className="hoverable" style={navBtnStyle}>
            Today
          </button>
          <button onClick={() => onShift(-1)} className="hoverable" style={navBtnStyle} title="Previous" aria-label="Previous">
            <Icon name="chevronLeft" size={14} />
          </button>
          <button onClick={() => onShift(1)} className="hoverable" style={navBtnStyle} title="Next" aria-label="Next">
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  if (isNaN(date.getTime())) return "Unknown";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const navBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  padding: "6px 8px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
