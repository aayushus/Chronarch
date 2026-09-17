/** Kiosk sleep + label + countdown tests. */
import { describe, expect, it } from "vitest";

import { addDays, dayLabel, daysUntil, isAsleep, pickCountdowns, startOfWeekSunday, tint } from "./kiosk";

function at(h: number, m = 0): Date {
  const d = new Date(2026, 8, 17, h, m);
  return d;
}

describe("isAsleep", () => {
  it("sleeps overnight windows that wrap midnight", () => {
    expect(isAsleep(at(23, 0), "22:00", "07:00")).toBe(true);
    expect(isAsleep(at(3, 0), "22:00", "07:00")).toBe(true);
    expect(isAsleep(at(12, 0), "22:00", "07:00")).toBe(false);
    expect(isAsleep(at(7, 0), "22:00", "07:00")).toBe(false); // end is exclusive
    expect(isAsleep(at(22, 0), "22:00", "07:00")).toBe(true); // start is inclusive
  });

  it("sleeps same-day windows", () => {
    expect(isAsleep(at(13, 0), "12:00", "14:00")).toBe(true);
    expect(isAsleep(at(15, 0), "12:00", "14:00")).toBe(false);
  });

  it("never sleeps on degenerate windows", () => {
    expect(isAsleep(at(3, 0), "22:00", "22:00")).toBe(false);
    expect(isAsleep(at(3, 0), "bogus", "07:00")).toBe(false);
    expect(isAsleep(at(3, 0), "", "")).toBe(false);
  });
});

describe("dayLabel", () => {
  const today = new Date(2026, 8, 17, 12, 0);
  it("names today and tomorrow relatively", () => {
    expect(dayLabel(new Date(2026, 8, 17, 9, 0), today)).toBe("Today");
    expect(dayLabel(new Date(2026, 8, 18, 9, 0), today)).toBe("Tomorrow");
  });

  it("falls back to a full date beyond tomorrow", () => {
    expect(dayLabel(new Date(2026, 8, 19, 9, 0), today)).toContain("September 19");
  });
});

describe("pickCountdowns", () => {  const now = new Date(2026, 8, 17, 12, 0);
  const ev = (id: string, start: string, extra = {}) => ({
    id, title: id, start, all_day: false, masked: false, ...extra,
  });

  it("counts whole days and skips near-term events", () => {
    expect(daysUntil("2026-09-17T23:00:00", now)).toBe(0);
    expect(daysUntil("2026-09-19T09:00:00", now)).toBe(2);
    const picks = pickCountdowns(
      [ev("soon", "2026-09-18T09:00:00"), ev("later", "2026-09-25T09:00:00")],
      now,
    );
    expect(picks.map((p) => p.id)).toEqual(["later"]);
    expect(picks[0].days).toBe(8);
  });

  it("prefers all-day events and hides masked ones", () => {
    const picks = pickCountdowns(
      [
        ev("timed", "2026-09-20T09:00:00"),
        ev("secret", "2026-09-20T09:00:00", { masked: true }),
        ev("trip", "2026-09-30T00:00:00", { all_day: true }),
      ],
      now,
    );
    expect(picks.map((p) => p.id)).toEqual(["trip", "timed"]);
  });

  it("caps at three", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      ev(`e${i}`, `2026-10-${String(i + 1).padStart(2, "0")}T09:00:00`, { all_day: true }),
    );
    expect(pickCountdowns(many, now)).toHaveLength(3);
  });
});

describe("startOfWeekSunday / addDays", () => {
  it("finds the Sunday of any week", () => {
    // Thu Sep 17 2026 -> Sun Sep 13.
    const sunday = startOfWeekSunday(new Date(2026, 8, 17, 12, 0));
    expect([sunday.getFullYear(), sunday.getMonth(), sunday.getDate()]).toEqual([2026, 8, 13]);
    expect(sunday.getDay()).toBe(0);
    // Sunday itself is stable.
    expect(startOfWeekSunday(new Date(2026, 8, 13, 9, 0)).getDate()).toBe(13);
    expect(addDays(sunday, 6).getDate()).toBe(19);
  });
});

describe("tint", () => {
  it("tints 6-digit hex with alpha", () => {
    expect(tint("#0a84ff", 0.25)).toBe("rgba(10, 132, 255, 0.25)");
  });

  it("expands 3-digit hex and clamps alpha", () => {
    expect(tint("#fff", 2)).toBe("rgba(255, 255, 255, 1)");
    expect(tint("#000", -1)).toBe("rgba(0, 0, 0, 0)");
  });

  it("falls back to gray on garbage", () => {
    expect(tint("not-a-color", 0.3)).toBe("rgba(152, 152, 157, 0.3)");
    expect(tint("", 0.3)).toBe("rgba(152, 152, 157, 0.3)");
  });
});
