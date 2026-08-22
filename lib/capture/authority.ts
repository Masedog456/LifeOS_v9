/**
 * The authority gradient (LIFEOS-060 §4).
 *
 * ## Interpretation is free; mutation is not
 *
 * The rule this sprint adopts: **read aggressively, write carefully.** A parser
 * may guess at anything, because a guess costs nothing until it becomes a
 * record. Authority therefore attaches to the WRITE, and scales with what the
 * write would cost the user if it were wrong.
 *
 *   - a wrong note            → the user deletes a line
 *   - a wrong errand          → the user deletes a line
 *   - a wrong Project         → structure the user must now maintain or dismantle
 *   - a wrong belief          → a claim about what the user thinks, attributed to them
 *
 * The last of those is not recoverable by deleting a row, which is why it sits
 * outside the pipeline entirely rather than behind a stricter gate.
 *
 * ## The never-auto tier is enforced structurally, not by a check
 *
 * There is no `belief` or `constitution_element` member of `CandidateKind`.
 * The universal capture pipeline cannot produce one — not "does not", *cannot*.
 * That is the LIFEOS-059 lesson applied here: a guarantee the type system keeps
 * beats a guarantee every future caller has to remember.
 *
 * Belief proposals remain reachable by the explicit, separately-labelled path
 * they always had. What changed is that they are no longer where an errand goes.
 */

/** How much authority a candidate has to become a record. */
export type AuthorityLevel = "auto_safe" | "auto_with_undo" | "confirm" | "never_auto";

/**
 * Every kind universal capture may propose.
 *
 * `belief` and `constitution_element` are absent BY DESIGN — see above. Adding
 * one here would be a deliberate act with a test to break, not an oversight.
 */
export type CandidateKind = "action" | "waiting" | "note" | "protocol" | "reflection" | "project" | "goal" | "event";

export const CANDIDATE_KINDS: readonly CandidateKind[] = [
  "action", "waiting", "note", "protocol", "reflection", "project", "goal",
  // Time foundation (LIFEOS-061). An Event is something that HAPPENS — never a
  // task, and never given completion semantics.
  "event",
];

/** Kinds this pipeline must never be able to write. Asserted by the suite. */
export const FORBIDDEN_CANDIDATE_KINDS: readonly string[] = [
  "belief", "constitution", "constitution_element", "decision", "principle", "framework",
];

/**
 * Base authority per kind.
 *
 * `note` is `auto_with_undo` rather than `auto_safe` because it still creates a
 * record. Nothing in this sprint is `auto_safe` except metadata that attaches to
 * a record the user already confirmed — see `associationAuthority`.
 */
const BASE: Record<CandidateKind, AuthorityLevel> = {
  // Ordinary life. Cheap to undo, and the whole point of the sprint.
  action: "auto_with_undo",
  waiting: "auto_with_undo",
  note: "auto_with_undo",
  // Normative: a protocol states how the user intends to behave. Confirmed.
  protocol: "confirm",
  // A reflection is a statement about the user's inner life. Confirmed.
  reflection: "confirm",
  // Structure the user must live with. §10: never created automatically.
  project: "confirm",
  goal: "confirm",
  // An event is as cheap to undo as an errand — it creates one dated row and
  // nothing else. Same tier as an action.
  event: "auto_with_undo",
};

/**
 * Authority for a candidate, given how confident the classification was.
 *
 * A low-confidence reading is never granted more authority than `confirm`, no
 * matter how cheap its kind: "possible" means the system does not know what this
 * is, and acting on not-knowing is how a capture tool loses trust.
 */
export function authorityFor(kind: CandidateKind, confidence: "high" | "likely" | "possible"): AuthorityLevel {
  const base = BASE[kind];
  if (base === "confirm" || base === "never_auto") return base;
  return confidence === "high" ? base : "confirm";
}

/**
 * Authority for attaching an EXISTING record to a candidate the user confirmed.
 *
 * `auto_safe`: it creates nothing, it is visible on the record, and detaching is
 * one click. Note this only applies to a STRONG match — an ambiguous one is a
 * question, and questions are asked, not answered on the user's behalf.
 */
export function associationAuthority(strength: "strong" | "ambiguous" | "none"): AuthorityLevel {
  return strength === "strong" ? "auto_safe" : "confirm";
}

/** Does this authority level mean the candidate arrives pre-selected? */
export function preselected(level: AuthorityLevel): boolean {
  return level === "auto_safe" || level === "auto_with_undo";
}

/**
 * Plain-language note for the UI, or `null` when the level needs no explanation.
 *
 * `auto_with_undo` says nothing: the checkbox already communicates it, and
 * narrating every safe default would bury the two cases that matter.
 */
export function authorityNote(level: AuthorityLevel): string | null {
  switch (level) {
    case "confirm": return "Needs your confirmation";
    case "never_auto": return "Conqify will not create this for you";
    default: return null;
  }
}
