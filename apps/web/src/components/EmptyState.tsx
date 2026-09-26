import React from "react";

import Icon, { IconName } from "./Icon";

/** Shared empty state (Chronarch design philosophy): icon tile + title +
 *  guidance + one CTA. Every empty list in the app uses this — no bespoke
 *  emoji placeholders, no dead ends.
 *
 *  Two deliberate choices. The border is a solid hairline, not dashed:
 *  dashed is the language of *incomplete or invalid*, and an empty list is
 *  neither — it is Tuesday. And the icon tile is accent-tinted *only when
 *  there is a CTA*, so the one saturated element in an empty state is the
 *  next step rather than the decoration. Four call sites pass an icon with no
 *  action (audit-log no-results, kiosk unpaired, no calendars, no contacts),
 *  so the tile is never hidden — it drops to a neutral wash instead.
 */
interface Props {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon, title, body, actionLabel, onAction }: Props) {
  return (
    <div
      style={{
        background: "transparent",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--radius-xl)",
          background: actionLabel ? "var(--accent-soft)" : "var(--wash-faint)",
          color: actionLabel ? "var(--accent)" : "var(--text-tertiary)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <Icon name={icon} size={20} />
      </div>
      <div style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
        {title}
      </div>
      <div
        style={{
          fontSize: "var(--text-sm)",
          lineHeight: 1.55,
          color: "var(--text-secondary)",
          marginBottom: actionLabel ? 18 : 0,
          maxWidth: 440,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {body}
      </div>
      {actionLabel && (
        <button
          onClick={onAction}
          className="btn-primary hoverable"
          style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}
        >
          <Icon name="plus" size={13} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
