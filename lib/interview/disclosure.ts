/**
 * The pre-consent disclosure for the Constitution Builder (LIFEOS-058A).
 *
 * ## Why this is a module and not JSX
 *
 * LIFEOS-058 shipped a disclosure bullet that read *"Signing out or clearing
 * your data deletes them."* Sign-out did not delete them. Every automated gate
 * passed, because a sentence written inline in a component is a sentence no test
 * can hold to anything.
 *
 * That sentence is not decoration. It is shown BEFORE the first question, and it
 * is what a person weighs when deciding whether to type about their marriage,
 * their faith, or their drinking. A false promise there is worse than no promise
 * at all, so the copy now lives where a test can reach it — the same move
 * `lib/constitution/copy.ts` made for the evidence wording contract.
 *
 * ## The rule the tests enforce
 *
 * Every deletion path this copy names must correspond to a real code path that
 * actually calls `clearInterviewSession()`. `DELETION_PATHS` below is that list,
 * with the function responsible recorded next to each one, so a future change
 * that removes a call site fails a test instead of quietly turning the sentence
 * into a lie again.
 */

/** One way an interview is destroyed, and the code that does it. */
export interface DeletionPath {
  /** How the user would describe it. */
  label: string;
  /** The function that actually calls `clearInterviewSession()`. */
  via: string;
}

/**
 * Every path that deletes an in-progress interview. Adding a line here without
 * a real call site is exactly the defect this file exists to prevent.
 */
export const DELETION_PATHS: readonly DeletionPath[] = [
  { label: "discarding the interview", via: "ConstitutionBuilder.endInterview → clearInterviewSession" },
  { label: "finishing the interview", via: "ConstitutionBuilder.endInterview → clearInterviewSession" },
  { label: "signing out", via: "authStore.signOut → clearInterviewSession" },
  { label: "resetting local data", via: "resetStore → clearState → clearInterviewSession" },
];

/**
 * The disclosure, in the order shown.
 *
 * Each bullet states one thing that is literally true of the shipped build:
 *   1. AI is involved at all — the single most important thing to say first.
 *   2. Nothing is compulsory.
 *   3. A proposal is not an adoption.
 *   4. Where the answers live.
 *   5. What destroys them — and ONLY paths that really do.
 */
export const INTERVIEW_DISCLOSURE: readonly string[] = [
  "AI is involved. Your answers are sent to a model to generate questions and suggestions.",
  "Your answers may contain sensitive things. Every question is optional and every section can be skipped.",
  "Anything Conqify proposes is a draft. Adoption is always an explicit, separate choice.",
  "Your answers stay in this browser. They are not synced, not exported, and not backed up.",
  "Discarding the interview, finishing it, or signing out deletes them, as does resetting your local data.",
];

/** The lead paragraph above the bullets. */
export const INTERVIEW_DISCLOSURE_INTRO =
  "This process helps you think through what matters, what is difficult, and how you want to live. " +
  "Conqify may suggest wording, but nothing becomes part of your Constitution until you choose it.";

/**
 * Claims this copy may never make again.
 *
 * `"clearing your data"` is banned because no control is called that: the real
 * one is "Reset local prototype data". Naming a control that does not exist
 * sends someone hunting for it and leaves the data in place meanwhile.
 */
export const FORBIDDEN_DISCLOSURE_PHRASES: readonly string[] = [
  "clearing your data",
  "deleted when you sign in",
  "automatically deleted",
  "deleted from our servers",
  "we do not store",
  "permanently erased",
];

/** True when a candidate disclosure line breaks the contract. Case-insensitive. */
export function violatesDisclosureContract(text: string): string[] {
  const low = (text ?? "").toLowerCase();
  return FORBIDDEN_DISCLOSURE_PHRASES.filter((p) => low.includes(p));
}
