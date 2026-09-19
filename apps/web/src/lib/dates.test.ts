/** monthTime compact-range tests (TZ-safe: round-trips local wall time). */
import { describe, expect, it } from "vitest";

import { getISOWeek, monthGridCells, monthTime } from "./dates";

function iso(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

describe("monthTime", () => {
  it("prints the meridiem once for same-half ranges", () => {
    expect(monthTime(iso(2026, 9, 18, 10), iso(2026, 9, 18, 11))).toBe("10 – 11 AM");
    expect(monthTime(iso(2026, 9, 18, 10, 30), iso(2026, 9, 18, 11))).toBe("10:30 – 11 AM");
  });

  it("prints both meridiems across noon/midnight", () => {
    expect(monthTime(iso(2026, 9, 18, 11), iso(2026, 9, 18, 13))).toBe("11 AM – 1 PM");
    expect(monthTime(iso(2026, 9, 18, 22), iso(2026, 9, 18, 23, 30))).toBe("10 – 11:30 PM");
  });
});

describe("monthGridCells", () => {
  it("trims to whole intersecting weeks (September 2026 → 5 rows)", () => {
    const cells = monthGridCells(2026, 8);
    expect(cells.length).toBe(35);
    // Monday-start: Mon Aug 31 … Sun Oct 4.
    expect(cells[0].getDate()).toBe(31);
    expect(cells[34].getDate()).toBe(4);
    expect(cells[34].getMonth()).toBe(9);
  });

  it("uses 6 rows only when the month spans six weeks", () => {
    // August 2026: Sat Aug 1 … Mon Aug 31 spans Jul 27 – Sep 6.
    expect(monthGridCells(2026, 7).length).toBe(42);
    // February 2026 starts on a Sunday: still week-aligned.
    const feb = monthGridCells(2026, 1);
    expect(feb.length % 7).toBe(0);
    expect(feb[0].getDay()).toBe(1);
  });
});

describe("getISOWeek", () => {
  it("calculates correct ISO week numbers", () => {
    // Jan 1 2026 is a Thursday -> Week 1
    expect(getISOWeek(new Date(2026, 0, 1))).toBe(1);
    // Sep 19 2026 is a Saturday -> Week 38
    expect(getISOWeek(new Date(2026, 8, 19))).toBe(38);
  });
});
