/** Pure booking-link wizard rules (extracted for testability).
 *
 * The wizard broke twice in the wild:
 * 1. A 2-char slug ("30") left Continue disabled with only a generic hint —
 *    the availability check never runs below 3 chars, so `ok` stays null.
 * 2. The Calendar step listed every workspace calendar (the admin endpoint
 *    is unscoped) while the backend only accepts calendars under the
 *    host's OWN account — users picked a demo calendar and ate a 422.
 */

export interface SlugCheckState {
  checking: boolean;
  ok: boolean | null;
  reason?: string;
}

export interface WizardCalendar {
  id: string;
  writable: boolean;
  account_id: string;
}

export type HintTone = "ok" | "error" | "idle";

export const MIN_SLUG_LENGTH = 3;

export function slugHint(slug: string, state: SlugCheckState): { text: string; tone: HintTone } {
  if (state.checking) return { text: "Checking…", tone: "idle" };
  if (state.ok) return { text: "Available.", tone: "ok" };
  if (state.reason) return { text: state.reason, tone: "error" };
  const trimmed = slug.trim().toLowerCase();
  if (trimmed.length > 0 && trimmed.length < MIN_SLUG_LENGTH) {
    return {
      text: `Need at least ${MIN_SLUG_LENGTH} characters — “${trimmed}” is only ${trimmed.length}. Try e.g. “${trimmed}-call”.`,
      tone: "error",
    };
  }
  return { text: "Lowercase letters, numbers, hyphens, 3–60 chars.", tone: "idle" };
}

/** Calendars a booking link may actually target: writable AND under an
 * account the host owns. Mirrors backend `is_calendar_owner`. Generic so
 * callers keep their full row type (AdminCalendar, …). */
export function ownedWritableCalendars<T extends WizardCalendar>(
  calendars: T[],
  ownedAccountIds: Set<string>,
): T[] {
  return calendars.filter((c) => c.writable && ownedAccountIds.has(c.account_id));
}

/** Writable calendars the host can see but must NOT pick (other users'). */
export function hasUnownedWritable<T extends WizardCalendar>(
  calendars: T[],
  ownedAccountIds: Set<string>,
): boolean {
  return calendars.some((c) => c.writable && !ownedAccountIds.has(c.account_id));
}

/** A selected id is stale when it is set but no longer in the valid list
 * (account reassigned, calendar deleted, or never owned). */
export function selectionIsStale<T extends WizardCalendar>(calendarId: string, valid: T[]): boolean {
  return calendarId.length > 0 && !valid.some((c) => c.id === calendarId);
}

export interface StepInput {
  title: string;
  slugOk: boolean | null;
  duration: number;
  calendarId: string;
}

export function stepValid(step: number, input: StepInput): boolean {
  if (step === 0) {
    return input.title.trim().length > 0 && input.slugOk === true && input.duration >= 5;
  }
  if (step === 1 || step === 2) {
    // Rules (step 2) re-validates the destination: an empty/stale id must
    // disable Create, not surface a backend 422.
    return input.calendarId.length > 0;
  }
  return true;
}
