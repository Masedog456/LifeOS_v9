/**
 * One word per recorded change (LIFEOS-098 §7, §37, §43).
 *
 * ## The measured problem
 *
 * The audit found the same recorded fact described with different words
 * depending on which page you were standing on. `CHANGE_WORD` was declared in
 * four components and `EVENING_CHANGE_LABEL` in a fifth place, and they
 * disagreed:
 *
 *   recurring_completed   "Done for the day" on Today   /  "Kept" on a Project
 *   rescheduled           "Date changed" in the evening /  "Date moved" on a Goal
 *   returned              "Came back from a deferral"   /  "Came back"
 *   rule_adopted          "Standard adopted"            /  "Rule adopted"
 *
 * Worse than the disagreement: the two hand-maintained component tables were
 * INCOMPLETE, and an incomplete `Record<string, string>` fails silently through
 * its `?? "Changed"` fallback. Six kinds — `created`, `cancelled`, `restored`,
 * `due_cleared`, `planned`, `prerequisite_removed` — had no entry on either the
 * Project or the Goal page, and both tables carried a key `added` that
 * `buildExecutiveChanges` has never emitted. Measured against the coherence
 * fixture, a CANCELLED item on a project page read "Changed".
 *
 * Typing the map as `Record<ExecutiveChangeKind, string>` is what makes that
 * class of bug impossible rather than merely fixed: a new kind added to the
 * vocabulary is a compile error here until it is given a word.
 *
 * ## Why a prefix rule instead of five tables
 *
 * §4 protects real contextual difference, and there is one: on a Goal page
 * "Horizon changed" is unambiguous, while Today mixes goals and rules and
 * actions in one list and has to say *whose* horizon. That is the ONLY
 * legitimate difference the audit found between the five tables, so it is
 * expressed as one rule — a surface names the subject it is already scoped to —
 * rather than as four more copies that can drift again.
 *
 * The prefixed form is the default. A surface has to say what it is scoped to
 * in order to get the shorter one, so forgetting produces a redundant word and
 * never an ambiguous one.
 *
 * ## What this is not
 *
 * Not a view model (§5). It maps one enum to one string and knows nothing about
 * records, dates, or layout. `ConstitutionRevision["changeKind"]` keeps its own
 * seven-word vocabulary on the rules page — it carries kinds this enum has no
 * concept of (`edited`, `relinked`, `readopted`) — and its three overlapping
 * words already agree with the scoped forms below. Folding them together would
 * be the universal vocabulary §5 forbids.
 */

import type { ExecutiveChangeKind } from "@/lib/memory/changes";
import type { AutobiographicalEvent } from "@/lib/memory/week";

/**
 * What a change is ABOUT — the noun a mixed list has to name.
 *
 * `record` covers the kinds whose word already contains its own noun
 * ("Reflection added", "Note added"), so there is nothing for a scope to strip.
 */
export type ChangeSubject = "action" | "goal" | "rule" | "record";

interface ChangeEntry {
  subject: ChangeSubject;
  /** The word for a list that mixes subjects. Always unambiguous. */
  word: string;
  /** The word for a surface already scoped to this subject. Optional. */
  scoped?: string;
}

/**
 * Every kind, one word.
 *
 * The action words are LIFEOS-073's, which LIFEOS-091 already reused verbatim —
 * they were canonical before this sprint and are kept, not re-chosen. The rule
 * words follow LIFEOS-095 §32, which settled that this product calls a
 * `constitution_element` a **Rule**; "Standard adopted" was the drift.
 */
const VOCABULARY: Record<ExecutiveChangeKind, ChangeEntry> = {
  // ---- actions. A surface showing actions never needs a subject noun. ------
  created: { subject: "action", word: "Added" },
  completed: { subject: "action", word: "Completed" },
  recurring_completed: { subject: "action", word: "Done for the day" },
  cancelled: { subject: "action", word: "Cancelled" },
  deferred: { subject: "action", word: "Deferred" },
  // §9. Naming the deferral is what keeps "came back" from reading as a
  // reschedule returning. Deferred and rescheduled are different facts.
  returned: { subject: "action", word: "Came back from a deferral" },
  restored: { subject: "action", word: "Restored" },
  // §10. A date that moved, stated as an event — never as a status.
  rescheduled: { subject: "action", word: "Date changed" },
  due_cleared: { subject: "action", word: "Date removed" },
  planned: { subject: "action", word: "Planned" },
  prerequisite_removed: { subject: "action", word: "Prerequisite removed" },
  // §12. The historical episode, named so it cannot be read as the state.
  waiting_started: { subject: "action", word: "Started waiting" },
  waiting_ended: { subject: "action", word: "Stopped waiting" },

  // ---- goals ---------------------------------------------------------------
  goal_created: { subject: "goal", word: "Goal added", scoped: "Added" },
  goal_status_changed: { subject: "goal", word: "Goal status changed", scoped: "Status changed" },
  goal_horizon_changed: { subject: "goal", word: "Goal horizon changed", scoped: "Horizon changed" },
  goal_target_changed: { subject: "goal", word: "Goal target date changed", scoped: "Target date changed" },
  goal_replaced: { subject: "goal", word: "Goal replaced", scoped: "Replaced" },

  // ---- rules ---------------------------------------------------------------
  rule_adopted: { subject: "rule", word: "Rule adopted", scoped: "Adopted" },
  rule_revised: { subject: "rule", word: "Rule revised", scoped: "Revised" },
  rule_retired: { subject: "rule", word: "Rule retired", scoped: "Retired" },

  // ---- words and calendar. The noun is inside the word already. ------------
  reflection_added: { subject: "record", word: "Reflection added" },
  note_added: { subject: "record", word: "Note added" },
  capture_added: { subject: "record", word: "Captured" },
  decision_recorded: { subject: "record", word: "Decision recorded" },
  event_scheduled: { subject: "record", word: "Scheduled" },
};

/**
 * The word for one recorded change.
 *
 * @param kind  what was recorded.
 * @param scope what the surface is ALREADY scoped to. A Goal page passes
 *              `"goal"` and gets "Horizon changed"; a mixed list passes nothing
 *              and gets "Goal horizon changed".
 */
export function changeWord(kind: string, scope?: ChangeSubject): string {
  const entry = VOCABULARY[kind as ExecutiveChangeKind];
  // §32. An unknown kind is not guessed at and not blanked — "Changed" is the
  // one true thing left to say about a change whose name is not in this list.
  if (!entry) return "Changed";
  return scope && scope === entry.subject && entry.scoped ? entry.scoped : entry.word;
}

/** What a kind is about. Exported so a surface can decide its own grouping. */
export function changeSubject(kind: string): ChangeSubject | undefined {
  return VOCABULARY[kind as ExecutiveChangeKind]?.subject;
}

/** Every kind this vocabulary can name. Used by the coherence proofs. */
export const CHANGE_KIND_VOCABULARY = VOCABULARY as Readonly<
  Record<ExecutiveChangeKind, Readonly<ChangeEntry>>
>;

/**
 * The autobiographical kinds, mapped onto this vocabulary (moved here from
 * `lib/memory/changes.ts` by LIFEOS-098 so the mapping and the words are one
 * module — a surface holding a timeline event and a surface holding an
 * executive change now reach the same string through the same table).
 *
 * A rename, and a deliberate one: `waiting_stopped` becomes `waiting_ended`
 * because LIFEOS-081 §12 asks for the historical EPISODE to be nameable
 * separately from the current waiting STATE, and two words that differ by one
 * suffix are how those get confused.
 *
 * Kinds absent from this map are absent from the answer — that is the whole
 * mechanism, and it is why adding a kind to the timeline cannot silently start
 * making claims in `buildExecutiveChanges`.
 */
export const CHANGE_KIND_FOR_TIMELINE: Partial<
  Record<AutobiographicalEvent["kind"], ExecutiveChangeKind>
> = {
  completed_action: "completed",
  recurring_completion: "recurring_completed",
  action_created: "created",
  action_cancelled: "cancelled",
  action_deferred: "deferred",
  action_returned: "returned",
  action_restored: "restored",
  action_rescheduled: "rescheduled",
  action_due_cleared: "due_cleared",
  action_planned: "planned",
  prerequisite_removed: "prerequisite_removed",
  waiting_started: "waiting_started",
  waiting_stopped: "waiting_ended",
  note_created: "note_added",
  reflection_captured: "reflection_added",
  capture_created: "capture_added",
  decision_recorded: "decision_recorded",
  event_scheduled: "event_scheduled",
};

/**
 * The word for one AUTOBIOGRAPHICAL timeline event (§43).
 *
 * The same words as `changeWord`, reached through the map above rather than
 * through a parallel table. LIFEOS-073's `CHANGE_LABEL` and LIFEOS-091's
 * `EVENING_CHANGE_LABEL` agreed with each other; keeping them as two literals
 * is what let the four component copies drift away from both.
 */
export function timelineChangeWord(kind: string, scope?: ChangeSubject): string {
  const mapped = CHANGE_KIND_FOR_TIMELINE[kind as AutobiographicalEvent["kind"]];
  return mapped ? changeWord(mapped, scope) : "Changed";
}
