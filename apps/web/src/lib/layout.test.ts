/** dayLane regression tests: lanes must never leave the grid. */
import { describe, expect, it } from "vitest";

import { dayLane } from "./layout";

describe("dayLane", () => {
  it("keeps every lane's right edge inside the region", () => {
    for (let count = 1; count <= 4; count++) {
      for (let col = 0; col < count; col++) {
        expect(dayLane(col, count).rightEdge).toBeLessThanOrEqual(1);
      }
    }
  });

  it("measures from the post-gutter region, not the full width", () => {
    const single = dayLane(0, 1);
    expect(single.left).toContain("58px");
    expect(single.left).toContain("100% - 66px");
    expect(single.width).toContain("100% - 66px");
    // The old formula referenced bare full-width percentages.
    expect(single.left).not.toMatch(/\+\s*0(%|\s)/);
  });

  it("splits the region evenly across columns", () => {
    const [a, b] = [dayLane(0, 2), dayLane(1, 2)];
    expect(a.left).toContain("* 0");
    expect(b.left).toContain("* 0.5");
    expect(a.width).toBe(b.width);
  });

  it("clamps degenerate input instead of producing garbage", () => {
    expect(dayLane(0, 0).rightEdge).toBeLessThanOrEqual(1);
    expect(dayLane(9, 2).rightEdge).toBeLessThanOrEqual(1);
  });
});
