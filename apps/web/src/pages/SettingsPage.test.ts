/** Settings sidebar grouping tests (imports the dependency-free nav module). */
import { describe, expect, it } from "vitest";

import { NAV, filterNav, groupSections } from "../components/settings/settingsNav";

describe("groupSections", () => {
  it("covers every nav item exactly once, pinned Account first", () => {
    const groups = groupSections(NAV);
    const seen = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(seen.sort()).toEqual(NAV.map((n) => n.key).sort());
    expect(groups[0].header).toBeNull();
    expect(groups[0].items.map((i) => i.key)).toEqual(["account"]);
  });

  it("orders groups Workspace → Sharing → Access → Intelligence → System", () => {
    const headers = groupSections(NAV).map((g) => g.header);
    expect(headers).toEqual([null, "Workspace", "Sharing", "Access", "Intelligence", "System"]);
  });

  it("puts Booking/Kiosk/Delegates together and drops empty groups", () => {
    const sharing = groupSections(NAV).find((g) => g.header === "Sharing")!;
    expect(sharing.items.map((i) => i.key)).toEqual(["booking", "kiosk", "delegates"]);
    const partial = groupSections(NAV.filter((n) => ["account", "audit"].includes(n.key)));
    expect(partial.map((g) => g.header)).toEqual([null, "System"]);
  });

  it("gives every section a distinct icon", () => {
    const icons = NAV.map((n) => n.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("filterNav", () => {
  it("returns everything on empty query", () => {
    expect(filterNav(NAV, "  ")).toHaveLength(NAV.length);
  });

  it("matches labels and group names", () => {
    expect(filterNav(NAV, "kiosk").map((n) => n.key)).toEqual(["kiosk"]);
    expect(filterNav(NAV, "sharing").map((n) => n.key)).toEqual(["booking", "kiosk", "delegates"]);
    expect(filterNav(NAV, "AI").map((n) => n.key)).toEqual(["ai"]);
  });
});
