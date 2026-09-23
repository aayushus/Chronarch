import React from "react";

import { useAppearance } from "../appearance";
import type { Attendee } from "../api/calendar";
import { contrastText, tint } from "../lib/color";

/** Mondays card language: white floating card, colored top bar, ink title,
 * muted meta, avatar stack + overflow menu. One language for Month/Agenda
 * (and the pattern Day/Week lanes follow), both app themes.
 */

export interface Avatar {
  initials: string;
  bg: string;
}

/** "Ava Reid" → "AR", "x@y.com" → "X". Shared avatar helper. */
export function avatarInitials(displayName: string): string {
  const src = (displayName || "").trim() || "?";
  const parts = src.replace(/[._-]+/g, " ").split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

/** First `max` attendee avatars + overflow count. Pure (tested). */
export function avatarStack(attendees: Attendee[], max = 3): { shown: Avatar[]; extra: number } {
  const shown: Avatar[] = [];
  for (const a of attendees) {
    if (shown.length >= max) break;
    // Prefer the display name; fall back to the email local-part so
    // "x@y.com" reads "X" rather than alphabet soup.
    const source = (a.name || "").trim() || (a.email || "?").split("@")[0] || "?";
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "?";
    const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
    const initials = (first + last).toUpperCase();
    shown.push({ initials, bg: avatarColor(source) });
  }
  return { shown, extra: Math.max(0, attendees.length - shown.length) };
}

/** Deterministic pastel avatar background from a name/email hash. */
export function avatarColor(seed: string): string {
  const palette = ["#7c5cd6", "#2f9e8f", "#d9822b", "#c94f5e", "#3f7ed1", "#8a9a3b"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function ProgressBar({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", gap: 3, marginBottom: 7 }}>
      <span style={{ width: 26, height: 4, borderRadius: 2, background: color }} />
      <span style={{ width: 14, height: 4, borderRadius: 2, background: "var(--card-line)" }} />
    </div>
  );
}

function AvatarDots({ avatars, extra }: { avatars: Avatar[]; extra: number }) {
  if (avatars.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {avatars.map((a, i) => (
        <span
          key={i}
          style={{
            width: 20, height: 20, borderRadius: "50%", background: a.bg, color: "#fff",
            fontSize: 8.5, fontWeight: 700, display: "inline-flex", alignItems: "center",
            justifyContent: "center", border: "2px solid var(--card-bg)",
            marginLeft: i === 0 ? 0 : -7,
          }}
        >
          {a.initials}
        </span>
      ))}
      {extra > 0 && (
        <span style={{ fontSize: 10, color: "var(--card-muted)", marginLeft: 4 }}>+{extra}</span>
      )}
    </span>
  );
}

export interface EventCardProps {
  color: string;
  title: string;
  /** e.g. "10:00 – 11:00 AM · Board Room" (string or rich node). */
  meta?: React.ReactNode;
  attendees?: Attendee[];
  selected?: boolean;
  /** Dense month cells: tighter padding, no avatars/menu — fits 2 cards/row. */
  compact?: boolean;
  /** Provider badge label e.g. "G", "MS", "ICS" */
  providerBadge?: string;
  onOpen: () => void;
  onMenu?: (e: React.MouseEvent) => void;
}

/** Standard timed-event card (month cells, agenda rows). */
export function EventCard({ color, title, meta, attendees = [], selected, compact, providerBadge, onOpen, onMenu }: EventCardProps) {
  const { shown, extra } = avatarStack(attendees);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu?.(e);
      }}
      className="event-block"
      style={{
        background: color,
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
        padding: compact ? "5px 8px" : "8px 12px",
        cursor: "pointer",
        minWidth: 0,
        position: "relative",
        outline: selected ? "2px solid #ffffff" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {providerBadge && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 5px",
              borderRadius: 4,
              background: "rgba(255, 255, 255, 0.2)",
              color: contrastText(color),
              lineHeight: 1,
              marginBottom: 4,
            }}
          >
            {providerBadge}
          </span>
        )}
      </div>
      <div style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: contrastText(color), lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </div>
      {meta && (
        <div style={{ fontSize: compact ? 10.5 : 11.5, fontWeight: 500, color: contrastText(color) === "#ffffff" ? "rgba(255, 255, 255, 0.88)" : "rgba(0, 0, 0, 0.7)", marginTop: compact ? 2 : 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {meta}
        </div>
      )}
      {!compact && (shown.length > 0 || onMenu) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 5 }}>
          <AvatarDots avatars={shown} extra={extra} />
          {onMenu && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMenu(e);
              }}
              aria-label="Event actions"
              style={{ border: "none", background: "none", color: contrastText(color) === "#ffffff" ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.6)", fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
            >
              ···
            </button>
          )}
        </div>
      )}
    </div>
  );
}


/** All-day chip ink: the tint washes toward the app background, so dark
 * mode needs white text while light mode keeps ink. Pure (tested). */
export function allDayInk(theme: "dark" | "light"): string {
  return theme === "dark" ? "#ffffff" : "var(--card-ink)";
}
export function AllDayChip({ color, title, selected, onOpen, onMenu }: {
  color: string; title: string; selected?: boolean; onOpen: () => void; onMenu?: (e: React.MouseEvent) => void;
}) {
  const { theme } = useAppearance();
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu?.(e);
      }}
      className="event-block"
      style={{
        background: tint(color.startsWith("#") ? color : "#0a84ff", theme === "dark" ? 0.45 : 0.32),
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        fontWeight: 600,
        color: allDayInk(theme),
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        outline: selected ? `2px solid ${color}` : "none",
      }}
    >
      {title}
    </div>
  );
}
