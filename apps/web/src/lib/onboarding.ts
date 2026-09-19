/** Onboarding wizard flow (pure logic — the page is thin).
 *
 * Skippable-everything by design: every step has Skip, the header pill
 * nags until the first account connects, and delegates never enter.
 */

export const ONBOARD_DONE_KEY = "chronarch_onboarded";
export const ONBOARD_STEP_KEY = "chronarch_onboarding_step";

export const STEPS = ["welcome", "connect", "you", "share", "done"] as const;
export type OnboardStep = (typeof STEPS)[number];

export interface OnboardState {
  accountCount: number;
  displayName: string;
}

export function stepIndex(step: string | null): number {
  const i = STEPS.indexOf(step as OnboardStep);
  return i < 0 ? 0 : i;
}

/** Continue gate per step. Connect is deliberately ungated — users link
 * whatever they like (including several accounts per provider) and move
 * on whenever; Skip exists regardless. */
export function canProceed(step: OnboardStep, state: OnboardState): boolean {
  switch (step) {
    case "you":
      return state.displayName.trim().length > 0;
    case "welcome":
    case "connect":
    case "share":
    case "done":
      return true;
  }
}

/** Show the setup nag: admins with nothing connected who never finished. */
export function shouldNag(params: {
  role: string | undefined;
  accountCount: number;
  onboarded: boolean;
}): boolean {
  if (params.role !== "admin") return false;
  if (params.onboarded) return false;
  return params.accountCount === 0;
}

export interface OAuthStatus {
  provider: string;
  client_id_configured: boolean;
  client_secret_configured: boolean;
}

/** Whether saved keys exist. "saved" is deliberately NOT "ready" — only
 * a real OAuth round-trip proves keys work (a stored client can be
 * deleted/rotated provider-side). Pure (tested). */
export function providerStatus(
  configs: OAuthStatus[] | null,
  provider: "google" | "microsoft",
): "saved" | "needed" | "unknown" {
  if (!configs) return "unknown";
  const row = configs.find((c) => c.provider === provider);
  if (!row) return "needed";
  return row.client_id_configured && row.client_secret_configured ? "saved" : "needed";
}

export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode */
  }
}

export function clearFlag(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}
