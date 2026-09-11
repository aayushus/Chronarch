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

export default function TopBar({ viewedDate, viewMode, onViewModeChange, onToday, onShift, onCreateEvent }: Props) {
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
        <button onClick={onCreateEvent} title="New event" style={circleBtnStyle}>
          +
        </button>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{dateLabel}</div>
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
            style={{
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              background: viewMode === mode ? "var(--bg-raised-hover)" : "transparent",
              color: viewMode === mode ? "var(--text-primary)" : "var(--text-secondary)",
              textTransform: "capitalize",
            }}
          >
            {mode}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => onShift(-1)} style={navBtnStyle}>
          ‹
        </button>
        <button onClick={onToday} style={{ ...navBtnStyle, padding: "6px 14px", fontSize: 13 }}>
          Today
        </button>
        <button onClick={() => onShift(1)} style={navBtnStyle}>
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
  fontSize: 18,
  lineHeight: "28px",
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
