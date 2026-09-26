import React from "react";

import Icon from "./Icon";

/** Shared settings primitives (2027 UI round): one header, one error
 * banner, one pill — instead of the same inline styles pasted per section.
 */

export function SectionHeader({ title, count, badge, description }: {
  title: string;
  /** Numeric "3 Links" badge next to the title. */
  count?: { value: number; singular: string; plural?: string };
  /** Custom badge (status pills like "AI Connected") — exclusive with count. */
  badge?: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{title}</h2>
        {count && (
          <Badge tone="info">{count.value} {count.value === 1 ? count.singular : (count.plural ?? `${count.singular}s`)}</Badge>
        )}
        {badge}
      </div>
      {description && (
        <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
          {description}
        </p>
      )}
    </>
  );
}

/** The app's one error surface. Dismissible when a handler is given, so a
 *  failure never sits on screen with no way to clear it; `role="alert"` so a
 *  screen reader announces it. `margin` is opt-in because the calendar places
 *  the banner above its canvas rather than stacking it (see CalendarPage). */
export function ErrorBanner({
  children,
  onDismiss,
  margin,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
  margin?: string;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: "var(--text-sm)",
        lineHeight: 1.45,
        borderRadius: "var(--radius-sm)",
        padding: "9px 10px 9px 12px",
        marginBottom: margin ?? 20,
        background: "rgba(255, 69, 58, 0.15)",
        border: "1px solid var(--danger)",
        color: "var(--danger)",
      }}
    >
      <Icon name="alert-triangle" size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="icon-btn hoverable"
          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: 3, opacity: 0.85, flexShrink: 0 }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export type BadgeTone = "info" | "success" | "warning" | "danger" | "neutral";

/** Tone → {background, foreground} pairs. Pure (tested): components stay thin. */
export function badgeStyle(tone: BadgeTone): { background: string; color: string; border?: string } {
  switch (tone) {
    case "info":
      return { background: "rgba(10, 132, 255, 0.12)", color: "var(--primary)", border: "1px solid rgba(10, 132, 255, 0.25)" };
    case "success":
      return { background: "rgba(48, 209, 88, 0.14)", color: "var(--success)" };
    case "warning":
      return { background: "rgba(255, 159, 10, 0.14)", color: "var(--warning)" };
    case "danger":
      return { background: "rgba(255, 69, 58, 0.15)", color: "var(--danger)" };
    case "neutral":
      return { background: "var(--bg-app)", color: "var(--text-tertiary)" };
  }
}

export function Badge({ tone, children, label }: { tone: BadgeTone; children: React.ReactNode; label?: string }) {
  const s = badgeStyle(tone);
  return (
    <span aria-label={label} style={{ fontSize: "var(--text-sm)", fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-xl)", whiteSpace: "nowrap", background: s.background, color: s.color, border: s.border ?? "1px solid transparent" }}>
      {children}
    </span>
  );
}
