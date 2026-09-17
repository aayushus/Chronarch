/** Booking wizard regression tests — the two bugs hit live on 2026-09-17.
 *
 * 1. Slug "30" left Continue disabled with a generic hint (the availability
 *    check never runs below 3 chars, so `ok` stays null forever).
 * 2. The Calendar step listed unowned workspace calendars while the backend
 *    only accepts the host's own — Create died with a 422.
 */
import { describe, expect, it } from "vitest";

import {
  MIN_SLUG_LENGTH,
  hasUnownedWritable,
  ownedWritableCalendars,
  selectionIsStale,
  slugHint,
  stepValid,
  type WizardCalendar,
} from "./bookingWizard";

const IDLE = { checking: false, ok: null };

function cal(id: string, account_id: string, writable = true): WizardCalendar {
  return { id, account_id, writable };
}

describe("slugHint", () => {
  it("tells the user a 2-char slug is too short (the live '30' case)", () => {
    const hint = slugHint("30", IDLE);
    expect(hint.tone).toBe("error");
    expect(hint.text).toContain(`${MIN_SLUG_LENGTH}`);
    expect(hint.text).toContain("30");
  });

  it("shows the generic format hint for an empty field, not an error", () => {
    const hint = slugHint("", IDLE);
    expect(hint.tone).toBe("idle");
    expect(hint.text).toContain("Lowercase");
  });

  it("surfaces the backend reason verbatim (taken / reserved)", () => {
    const hint = slugHint("intro", {
      checking: false,
      ok: false,
      reason: "'intro' is taken — try another link address.",
    });
    expect(hint.tone).toBe("error");
    expect(hint.text).toContain("taken");
  });

  it("confirms an available slug and flags the checking state", () => {
    expect(slugHint("fresh-link", { checking: false, ok: true }).tone).toBe("ok");
    expect(slugHint("fresh-link", { checking: false, ok: true }).text).toBe("Available.");
    expect(slugHint("fre", { checking: true, ok: null }).text).toBe("Checking…");
  });
});

describe("ownedWritableCalendars", () => {
  const mine = new Set(["acct-mine"]);

  it("keeps only writable calendars under owned accounts", () => {
    const all = [
      cal("c1", "acct-mine", true),
      cal("c2", "acct-mine", false), // owned but read-only provider-side
      cal("c3", "acct-demo", true), // writable but someone else's
    ];
    expect(ownedWritableCalendars(all, mine).map((c) => c.id)).toEqual(["c1"]);
  });

  it("flags visible-but-unpickable calendars so the UI can explain", () => {
    expect(hasUnownedWritable([cal("c3", "acct-demo", true)], mine)).toBe(true);
    expect(hasUnownedWritable([cal("c1", "acct-mine", true)], mine)).toBe(false);
    expect(hasUnownedWritable([], mine)).toBe(false);
  });

  it("clears a selection that was never valid (demo calendar picked pre-fix)", () => {
    const valid = ownedWritableCalendars([cal("c3", "acct-demo", true)], mine);
    expect(selectionIsStale("c3", valid)).toBe(true);
    expect(selectionIsStale("", valid)).toBe(false);
    expect(
      selectionIsStale("c1", ownedWritableCalendars([cal("c1", "acct-mine", true)], mine)),
    ).toBe(false);
  });
});

describe("stepValid", () => {
  const base = { title: "Intro", slugOk: true as boolean | null, duration: 30, calendarId: "c1" };

  it("gates Basics on title + verified slug + sane duration", () => {
    expect(stepValid(0, base)).toBe(true);
    expect(stepValid(0, { ...base, title: "  " })).toBe(false);
    // slug "30": check skipped -> ok null -> blocked with the hint above.
    expect(stepValid(0, { ...base, slugOk: null })).toBe(false);
    expect(stepValid(0, { ...base, slugOk: false })).toBe(false);
    expect(stepValid(0, { ...base, duration: 3 })).toBe(false);
  });

  it("requires a destination on Calendar AND Rules (no 422 on Create)", () => {
    expect(stepValid(1, base)).toBe(true);
    expect(stepValid(1, { ...base, calendarId: "" })).toBe(false);
    expect(stepValid(2, base)).toBe(true);
    expect(stepValid(2, { ...base, calendarId: "" })).toBe(false);
  });
});
