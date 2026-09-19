/** Onboarding flow-logic tests. */
import { describe, expect, it } from "vitest";

import { canProceed, providerStatus, shouldNag, stepIndex } from "./onboarding";

describe("stepIndex", () => {
  it("defaults unknown steps to welcome", () => {
    expect(stepIndex("connect")).toBe(1);
    expect(stepIndex("preferences")).toBe(2);
    expect(stepIndex("bogus")).toBe(0);
    expect(stepIndex(null)).toBe(0);
  });
});

describe("canProceed", () => {
  it("connect and preferences steps are deliberately ungated", () => {
    expect(canProceed("welcome", { accountCount: 0, displayName: "" })).toBe(true);
    expect(canProceed("connect", { accountCount: 0, displayName: "" })).toBe(true);
    expect(canProceed("connect", { accountCount: 3, displayName: "" })).toBe(true);
    expect(canProceed("preferences", { accountCount: 1, displayName: "Ava" })).toBe(true);
    expect(canProceed("share", { accountCount: 0, displayName: "" })).toBe(true);
    expect(canProceed("done", { accountCount: 0, displayName: "" })).toBe(true);
  });
});

describe("shouldNag", () => {
  it("nags only unfinished admins with zero accounts", () => {
    const base = { role: "admin", accountCount: 0, onboarded: false };
    expect(shouldNag(base)).toBe(true);
    expect(shouldNag({ ...base, role: "delegate" })).toBe(false);
    expect(shouldNag({ ...base, accountCount: 2 })).toBe(false);
    expect(shouldNag({ ...base, onboarded: true })).toBe(false);
    expect(shouldNag({ ...base, role: undefined })).toBe(false);
  });
});

describe("providerStatus", () => {
  const configs = [
    { provider: "google", client_id_configured: true, client_secret_configured: true },
    { provider: "microsoft", client_id_configured: true, client_secret_configured: false },
  ];
  it("reports saved keys without claiming they work", () => {
    expect(providerStatus(configs, "google")).toBe("saved");
    expect(providerStatus(configs, "microsoft")).toBe("needed");
  });

  it("treats missing rows and unloaded configs safely", () => {
    expect(providerStatus([], "google")).toBe("needed");
    expect(providerStatus(null, "google")).toBe("unknown");
  });
});
