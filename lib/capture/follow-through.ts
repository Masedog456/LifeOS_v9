/**
 * Capture follow-through (LIFEOS-103).
 *
 * ## What the audit permitted, and what it refused
 *
 * §2 asked which captures end without a grounded next move. Measured across
 * sixteen shapes, the answer was **one**: a wait with no follow-up date. Every
 * other candidate the brief raised failed on evidence rather than taste, and the
 * reasons are worth carrying here because they are what keeps this file one
 * function instead of an engine.
 *
 *   GOAL, no path       Goals are never auto-writable, so they commit through
 *                       the review panel — which leaves NO success panel at all
 *                       (measured: finished=false, results=false, kept=false).
 *                       §29's primary surface does not exist for them. And
 *                       `GOAL_NO_PATH` is already in the Decision Inbox with the
 *                       options §13 proposes, so this would duplicate a global
 *                       queue that §31 forbids duplicating.
 *   PROJECT, no next    Capture cannot create a Project. "Sort out the Clinic
 *                       lease" makes an Action linked to the existing project —
 *                       and in doing so RESOLVES the empty state it would have
 *                       suggested about.
 *   completion,         §18 and §16. Nothing grounded to add that the existing
 *   blocked work        recommender and blocker explanation do not already say.
 *
 * ## The one rule, and why each clause is there
 *
 * A wait qualifies when the record is `waiting`, has a person, and has no
 * `followUpDate`. That is not a judgement about the user — it is three facts
 * about a row, which is what §8 means by grounded, and it is why no text is
 * generated: the suggestion opens the control the person already has (§25).
 *
 * ## Pure, and unpersisted
 *
 * A derivation over the store (§46). No table, no status, no snooze, no
 * dismissal record. Re-derived on every render, so a correction that adds a
 * follow-up date makes it vanish (§39) and an undo that removes the record
 * makes it vanish (§40) without either path knowing this file exists.
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { CaptureOutcome } from "@/lib/capture/home";

/** The kinds this file can produce. One, deliberately (§22). */
export type FollowThroughKind = "ADD_WAIT_FOLLOW_UP";

export interface CaptureFollowThrough {
  /** The outcome this belongs to, so the panel can place it. */
  outcomeId: string;
  kind: FollowThroughKind;
  /** The record's own name. Never generated prose. */
  title: string;
  /** Why this is being offered — a fact about the record (§43). */
  reason: string;
  /** The control's label. An action the user takes, not advice (§43). */
  actionLabel: string;
}

/**
 * §43. Factual, and about the record.
 *
 * Not "you seem stuck", not "the best thing to do is", not "this has been
 * waiting a while" — the last of those is a nudge wearing a fact, and the
 * record's age is not what makes a follow-up date useful.
 */
export const NO_FOLLOW_UP_REASON = "No follow-up date is set.";
export const ADD_FOLLOW_UP_LABEL = "Add a follow-up date";

/** §27. One suggestion per outcome, and at most this many on screen. */
export const MAX_VISIBLE = 2;

/**
 * Does this waiting record have nothing scheduling the next look at it?
 *
 * Exported so the deterministic suite can assert the rule directly, and so
 * there is one definition of "unscheduled wait" if anything else ever needs it.
 *
 * `status === "waiting"` rather than "has a `waitingOn`": a record that once
 * waited and has been returned to `open` keeps its person in history, and
 * offering a follow-up on live work would be advice about the wrong thing.
 */
export function waitNeedsFollowUp(a: NextAction | undefined): boolean {
  if (!a || a.status !== "waiting") return false;
  if (a.followUpDate) return false;
  // A wait with nobody named is a wait Conqify cannot describe, and §8 forbids
  // a suggestion whose reason it cannot state.
  return !!a.waitingOn?.trim();
}

/**
 * The follow-through for a set of just-committed outcomes.
 *
 * Reads the STORE, not the outcomes' own fields, for LIFEOS-102's reason: the
 * outcome list is a projection and the record is the truth. A record corrected
 * a second ago must be read as it is now.
 */
export function followThroughFor(
  state: StoreState,
  outcomes: readonly CaptureOutcome[],
): CaptureFollowThrough[] {
  const out: CaptureFollowThrough[] = [];
  for (const o of outcomes) {
    if (o.kind !== "action") continue;
    const a = (state.nextActions ?? []).find((x) => x.id === o.id);
    if (!waitNeedsFollowUp(a)) continue;
    out.push({
      outcomeId: o.id,
      kind: "ADD_WAIT_FOLLOW_UP",
      title: a!.title,
      reason: NO_FOLLOW_UP_REASON,
      actionLabel: ADD_FOLLOW_UP_LABEL,
    });
    // §27. Each outcome may contribute one; the whole panel shows at most two,
    // so a five-clause capture cannot turn a success into a checklist.
    if (out.length >= MAX_VISIBLE) break;
  }
  return out;
}

/** Every string this file can put on screen, for the language guards to sweep. */
export const FOLLOW_THROUGH_STRINGS: string[] = [
  NO_FOLLOW_UP_REASON,
  ADD_FOLLOW_UP_LABEL,
];
