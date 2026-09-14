import React from "react";

import Icon, { IconName } from "./Icon";

/** Shared empty state (Chronarch design philosophy): icon tile + title +
 * guidance + one CTA. Every empty list in the app uses this — no bespoke
 * emoji placeholders, no dead ends.
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
        background: "var(--bg-raised)",
        borderRadius: "var(--radius-md)",
        border: "1px dashed var(--border)",
        padding: "36px 20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "rgba(10, 132, 255, 0.12)",
          color: "var(--accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 8,
        }}
      >
        <Icon name={icon} size={20} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          marginBottom: actionLabel ? 16 : 0,
          maxWidth: 460,
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
          style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600 }}
        >
          + {actionLabel}
        </button>
      )}
    </div>
  );
}
