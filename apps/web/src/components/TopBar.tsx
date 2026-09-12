import React from "react";

export type CalendarViewMode = "day" | "week" | "month" | "year";

interface Props {
  viewedDate: Date;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onToday: () => void;
  onShift: (delta: number) => void;
  onCreateEvent: () => void;
}

export default function TopBar({
  viewedDate,
  viewMode,
  onViewModeChange,
  onToday,
  onShift,
  onCreateEvent,
}: Props) {
  const dateLabel = viewedDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const weekdayLabel = viewedDate.toLocaleDateString(undefined, { weekday: "long" });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 24px",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={onCreateEvent} title="New event (N)" className="icon-btn hoverable" style={circleBtnStyle}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
        </button>
        <div>
          <div className="date-header tabular-nums" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
            {dateLabel}
          </div>
          {viewMode === "day" && (
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{weekdayLabel}</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-raised)", borderRadius: 8, padding: 3 }}>
        {(["day", "week", "month", "year"] as CalendarViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => onViewModeChange(mode)}
            className="hoverable"
            style={{
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              fontWeight: 500,
              background: viewMode === mode ? "var(--accent)" : "transparent",
              color: viewMode === mode ? "#fff" : "var(--text-secondary)",
              transition: "var(--transition-fast)",
            }}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onToday} className="hoverable" style={navBtnStyle}>
          Today
        </button>
        <button onClick={() => onShift(-1)} className="hoverable" style={navBtnStyle} title="Previous">
          ‹
        </button>
        <button onClick={() => onShift(1)} className="hoverable" style={navBtnStyle} title="Next">
          ›
        </button>
      </div>
    </div>
  );
}

const circleBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  cursor: "pointer",
};

const navBtnStyle: React.CSSProperties = {
  background: "var(--bg-raised)",
  border: "none",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: 14,
  cursor: "pointer",
  padding: "6px 10px",
};
