/** EventCard helper tests. */
import { describe, expect, it } from "vitest";

import { allDayInk, avatarColor, avatarStack, detectMeetingKind } from "./EventCard";

describe("avatarStack", () => {
  it("initializes from names, caps at max, counts overflow", () => {
    const { shown, extra } = avatarStack([
      { email: "a@x.com", name: "Ava Reid" },
      { email: "b@x.com", name: "Brian Osei" },
      { email: "c@x.com" },
      { email: "d@x.com", name: "Dee" },
    ], 3);
    expect(shown.map((s) => s.initials)).toEqual(["AR", "BO", "C"]);
    expect(extra).toBe(1);
  });

  it("handles empty and nameless lists", () => {
    expect(avatarStack([])).toEqual({ shown: [], extra: 0 });
    const { shown } = avatarStack([{ email: "x@y.com" }]);
    expect(shown[0].initials).toBe("X");
  });

  it("colors deterministically from the same seed", () => {
    expect(avatarColor("ava@x.com")).toBe(avatarColor("ava@x.com"));
    expect(avatarColor("a")).not.toBe(avatarColor("zzzz-unlikely-same"));
  });
});

describe("allDayInk", () => {
  it("stays readable on the tint in both themes", () => {
    expect(allDayInk("dark")).toBe("#ffffff");
    expect(allDayInk("light")).toBe("var(--card-ink)");
  });
});

describe("detectMeetingKind", () => {
  it("detects Google Meet links and labels", () => {
    const { isVideoCall, kind } = detectMeetingKind("1:1 Sync", "meet.google.com/abc-def-ghi");
    expect(isVideoCall).toBe(true);
    expect(kind).toBe("meet");
  });

  it("detects Zoom meetings", () => {
    const { isVideoCall, kind } = detectMeetingKind("Quarterly Planning (Zoom)");
    expect(isVideoCall).toBe(true);
    expect(kind).toBe("zoom");
  });

  it("detects Teams meetings", () => {
    const { isVideoCall, kind } = detectMeetingKind("Sprint Demo", "https://teams.microsoft.com/l/meetup-join");
    expect(isVideoCall).toBe(true);
    expect(kind).toBe("teams");
  });

  it("returns false for regular in-person events", () => {
    const { isVideoCall } = detectMeetingKind("Coffee with Sarah", "Room 402");
    expect(isVideoCall).toBe(false);
  });
});

