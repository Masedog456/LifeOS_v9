/**
 * What the beta records, said plainly (LIFEOS-059 §12).
 *
 * ## Why this is a module
 *
 * LIFEOS-058A shipped a privacy sentence that was false, and every gate passed,
 * because the sentence lived in JSX where no test could reach it. The fix was
 * not better wording — it was putting the claim where a test can hold it to the
 * behaviour. Same move here, before the same mistake.
 *
 * Each line below is paired in `DISCLOSURE_CLAIMS` with the code that makes it
 * true, and the tests assert the pairing. A line that stops being true should
 * break a build, not survive into a beta where people are deciding how much to
 * trust us.
 *
 * ## The standard the copy has to meet
 *
 * Not *"we collect usage data to improve the experience."* That sentence is
 * true of a keylogger. Say what is recorded, what is not, where it lives, and
 * how to destroy it — in words a tester can check against their own device.
 */

/** One promise, and the thing that keeps it. */
export interface DisclosureClaim {
  line: string;
  /** The module or function responsible for the promise being true. */
  kept_by: string;
}

export const DISCLOSURE_CLAIMS: readonly DisclosureClaim[] = [
  {
    line: "Conqify records counts about how you use the beta — how many questions you answered, whether you adopted or dismissed a suggestion, whether you hid something from AI.",
    kept_by: "lib/beta/events.ts — BETA_EVENTS",
  },
  {
    line: "It never records what you wrote. Not your answers, not your Constitution, not your notes, not your sources. The record has no field those could go in.",
    kept_by: "lib/beta/events.ts — buildBetaEvent value allowlist",
  },
  {
    line: "It never records your name, your email, or anything identifying you.",
    kept_by: "lib/beta/events.ts — ALLOWED_BETA_FIELDS",
  },
  {
    line: "All of it stays in this browser. Nothing is uploaded, synced, or included in your export.",
    kept_by: "lib/beta/store.ts — local key, no network",
  },
  {
    line: "If you send beta feedback, only what you type in that box is shared, and only when you send it.",
    kept_by: "lib/beta/feedback.ts — explicit saveFeedback, no upload path",
  },
  {
    line: "Resetting your local data or signing out deletes all of it.",
    kept_by: "lib/beta/store.ts — clearEvidence, wired into clearState and signOut",
  },
];

/** The disclosure, in order. */
export const BETA_DISCLOSURE: readonly string[] = DISCLOSURE_CLAIMS.map((c) => c.line);

export const BETA_DISCLOSURE_HEADING = "What the beta records";

/**
 * Vague phrasings this copy may never use.
 *
 * Each one is a sentence that sounds reassuring while describing nothing a
 * person could check.
 */
export const FORBIDDEN_DISCLOSURE_PHRASES: readonly string[] = [
  "usage data",
  "to improve the experience",
  "analytics",
  "telemetry to help us",
  "anonymous data",
  "we may collect",
  "from time to time",
  "industry standard",
];

export function violatesBetaDisclosure(text: string): string[] {
  const low = (text ?? "").toLowerCase();
  return FORBIDDEN_DISCLOSURE_PHRASES.filter((p) => low.includes(p));
}
