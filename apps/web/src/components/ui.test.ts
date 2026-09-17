/** ui.tsx primitive tests. */
import { describe, expect, it } from "vitest";

import { badgeStyle } from "./ui";

describe("badgeStyle", () => {
  it("maps every tone to a background/foreground pair", () => {
    for (const tone of ["info", "success", "warning", "danger", "neutral"] as const) {
      const s = badgeStyle(tone);
      expect(s.background.length).toBeGreaterThan(0);
      expect(s.color.length).toBeGreaterThan(0);
    }
  });

  it("keeps danger readable (red on red-wash, not red on red)", () => {
    const s = badgeStyle("danger");
    expect(s.background).not.toBe(s.color);
  });
});
