/** monthTime compact-range tests (TZ-safe: round-trips local wall time). */
import { describe, expect, it } from "vitest";

import { monthTime } from "./dates";

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
