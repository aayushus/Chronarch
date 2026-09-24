/** Beta helper tests. */
import { describe, expect, it } from "vitest";

import { dayStats, formatMinutes, greeting } from "./focus";

describe("greeting", () => {
  it("tracks the daypart", () => {
    expect(greeting(2)).toBe("Good night");
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(21)).toBe("Good evening");
  });
});

describe("dayStats", () => {
  const day = new Date(2026, 8, 17, 8, 0);
  // Local wall-clock round-trip: TZ-safe in any zone.
  const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).toISOString();
  const ev = (id: string, s: string, e: string, all_day = false) => ({ id, title: id, start: s, end: e, all_day });

  it("counts meetings and finds up-next", () => {
    const stats = dayStats(
      [
        ev("a", at(17, 9), at(17, 10)),
        ev("b", at(17, 14), at(17, 14, 30)),
        ev("c", at(18, 9), at(18, 10)),
        ev("d", at(17, 0, 1), at(17, 23, 59), true),
      ],
      day,
      new Date(2026, 8, 17, 8, 30),
    );
    expect(stats.count).toBe(2);
    expect(stats.meetingMinutes).toBe(90);
    expect(stats.freeMinutes).toBe(480 - 90);
    expect(stats.upNext?.id).toBe("a");
  });

  it("returns null up-next when the day is over", () => {
    const stats = dayStats(
      [ev("a", at(17, 9), at(17, 10))],
      day,
      new Date(2026, 8, 17, 18, 0),
    );
    expect(stats.upNext).toBeNull();
    expect(stats.freeMinutes).toBe(480 - 60);
  });

  it("never promotes cancelled meetings to up-next", () => {
    const stats = dayStats(
      [
        ev("cancelled", at(17, 9), at(17, 10)),
        ev("real", at(17, 11), at(17, 11, 30)),
      ].map((event) => event.id === "cancelled" ? { ...event, title: "Cancelled: customer meeting" } : event),
      day,
      new Date(2026, 8, 17, 8, 30),
    );
    expect(stats.upNext?.id).toBe("real");
  });

  it("clips off-hours meetings out of free time", () => {
    const stats = dayStats(
      [ev("early", at(17, 6), at(17, 8))],
      day,
      new Date(2026, 8, 17, 5, 0),
    );
    expect(stats.meetingMinutes).toBe(120);
    expect(stats.freeMinutes).toBe(480);
  });
});

describe("formatMinutes", () => {
  it("compacts durations", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(150)).toBe("2h 30m");
  });
});
