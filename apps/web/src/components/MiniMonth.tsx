import React from "react";

import { WEEKDAY_SHORT, monthGridCells, sameDay, startOfMonth } from "../lib/dates";
import Icon from "./Icon";

interface Props {
  viewedDate: Date;
  selectedDate: Date;
  onSelect: (d: Date) => void;
  onMonthShift: (delta: number) => void;
}

export default function MiniMonth({ viewedDate, selectedDate, onSelect, onMonthShift }: Props) {
  const monthStart = startOfMonth(viewedDate);
  const days = monthGridCells(monthStart.getFullYear(), monthStart.getMonth());

  const today = new Date();

  return (
    <div style={{ padding: "12px 12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => onMonthShift(-1)} className="icon-btn" style={navBtnStyle} aria-label="Previous month">
          <Icon name="chevronLeft" size={13} />
        </button>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
          {monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => onMonthShift(1)} className="icon-btn" style={navBtnStyle} aria-label="Next month">
          <Icon name="chevronRight" size={13} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={i} style={{ fontSize: "var(--text-xs)", textAlign: "center", color: "var(--text-tertiary)" }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {days.map((d) => {
          const isToday = sameDay(d, today);
          const isSelected = sameDay(d, selectedDate);
          const isCurrentMonth = d.getMonth() === monthStart.getMonth();
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(d)}
              className="tabular-nums hoverable"
              style={{
                aspectRatio: "1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-sm)",
                border: "none",
                borderRadius: isToday ? 6 : 999,
                cursor: "pointer",
                background: isToday ? "var(--danger)" : isSelected ? "var(--bg-raised-hover)" : "transparent",
                color: isToday ? "var(--text-on-fill)" : isCurrentMonth ? "var(--text-primary)" : "var(--text-tertiary)",
                fontWeight: isToday ? 700 : 400,
                boxShadow: isToday ? "0 2px 6px rgba(255, 69, 58, 0.35)" : "none",
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
        <button
          onClick={() => onSelect(new Date())}
          className="btn-secondary"
          style={{
            width: "100%",
            padding: "5px 12px",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            borderRadius: "var(--radius-pill)",
            background: "var(--wash-lift)",
            color: "var(--accent)",
            border: "1px solid var(--accent-dim)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--danger)" }} />
          Today
        </button>
      </div>
    </div>
  );
}


const navBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-secondary)",
  fontSize: "var(--text-md)",
  cursor: "pointer",
  padding: 4,
};
