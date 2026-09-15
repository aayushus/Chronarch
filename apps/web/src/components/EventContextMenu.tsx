import React, { useEffect, useRef } from "react";

export interface MenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}

const MENU_WIDTH = 220;
const ROW_H = 32;

/** Right-click menu shared by Day/Week/Month views. Clamped into the
 * viewport, dismissed by click-away, Escape, or scroll. */
export default function EventContextMenu({ x, y, items, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("wheel", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onScroll);
    };
  }, [onClose]);

  const height = items.length * ROW_H + 8;
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(y, window.innerHeight - height - 8);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left: Math.max(8, left),
        top: Math.max(8, top),
        width: MENU_WIDTH,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        padding: 4,
        zIndex: 1200,
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onPick(item.id);
            onClose();
          }}
          className="hoverable"
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            background: "transparent",
            border: "none",
            borderRadius: 6,
            color: item.danger ? "var(--danger)" : "var(--text-primary)",
            fontSize: 13,
            padding: "6px 10px",
            height: ROW_H,
            cursor: item.disabled ? "default" : "pointer",
            opacity: item.disabled ? 0.45 : 1,
            textAlign: "left",
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
