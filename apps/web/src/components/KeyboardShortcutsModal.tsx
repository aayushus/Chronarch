import React from "react";
import Icon from "./Icon";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Views & Navigation",
    shortcuts: [
      { keys: ["T"], description: "Jump to Today" },
      { keys: ["D"], description: "Day view" },
      { keys: ["W"], description: "Week view" },
      { keys: ["M"], description: "Month view" },
      { keys: ["A"], description: "Agenda view" },
      { keys: ["Y"], description: "Year view" },
      { keys: ["←", "or", ","], description: "Previous period" },
      { keys: ["→", "or", "."], description: "Next period" },
    ],
  },
  {
    title: "Actions & Modals",
    shortcuts: [
      { keys: ["C", "or", "N"], description: "Create new event" },
      { keys: ["/"], description: "Focus search" },
      { keys: ["⌘", "K"], description: "Open Command Palette" },
      { keys: ["?"], description: "Show Keyboard Shortcuts" },
      { keys: ["Esc"], description: "Close active modal / deselect" },
    ],
  },
];

export default function KeyboardShortcutsModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card mount-rise"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "94vw",
          padding: 24,
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-raised)",
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div id="shortcuts-title" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-lg)", fontWeight: 700 }}>
            <Icon name="command" size={18} />
            Keyboard Shortcuts
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="hoverable"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: 4,
              display: "inline-flex",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--text-tertiary)",
                  marginBottom: 8,
                }}
              >
                {group.title}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  background: "var(--bg-subtle)",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {group.shortcuts.map((sc, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "4px 0",
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    <span style={{ color: "var(--text-primary)" }}>{sc.description}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {sc.keys.map((k, ki) =>
                        k === "or" ? (
                          <span key={ki} style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                            or
                          </span>
                        ) : (
                          <kbd
                            key={ki}
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: "var(--text-xs)",
                              fontWeight: 600,
                              background: "var(--bg-raised)",
                              border: "1px solid var(--border-subtle)",
                              boxShadow: "0 1px 1px rgba(0, 0, 0, 0.08)",
                              padding: "2px 6px",
                              borderRadius: "var(--radius-sm)",
                              color: "var(--text-primary)",
                              minWidth: 20,
                              textAlign: "center",
                            }}
                          >
                            {k}
                          </kbd>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 18,
            paddingTop: 12,
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          <span>Press <kbd style={{ padding: "1px 4px", background: "var(--bg-subtle)", borderRadius: 3 }}>?</kbd> anytime to open this guide</span>
          <button onClick={onClose} className="btn-secondary hoverable" style={{ padding: "4px 12px", fontSize: "var(--text-xs)" }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
