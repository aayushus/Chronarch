import React from "react";

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
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{title}</h2>
        {count && (
          <Badge tone="info">{count.value} {count.value === 1 ? count.singular : (count.plural ?? `${count.singular}s`)}</Badge>
        )}
        {badge}
      </div>
      {description && (
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
          {description}
        </p>
      )}
    </>
  );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 20, background: "rgba(255, 69, 58, 0.15)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
      {children}
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
    <span aria-label={label} style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12, whiteSpace: "nowrap", background: s.background, color: s.color, border: s.border ?? "1px solid transparent" }}>
      {children}
    </span>
  );
}
