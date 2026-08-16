/**
 * Today's two loose-end signals (LIFEOS-052).
 *
 * The Life Organization Gap Audit found Today answered "what did I plan to work
 * on?" but not "what deserves my attention now?" — and that two of the cheapest
 * improvements were already sitting in the codebase unwired: the count of
 * captures still waiting to be organized, and the Return primitive
 * (`dormancyView`) buried at `/insights/dormancy`.
 *
 * Both signals here are DERIVED from existing deterministic sources. Nothing new
 * is stored, nothing is inferred, no AI is involved, and neither signal ever
 * pushes a notification.
 *
 * ## Language rule
 *
 * `dormancyView` already enforces strictly neutral wording — records are never
 * called abandoned, stale, neglected, or unhealthy. That guarantee is extended
 * here rather than reinvented: this module states a fact ("No recorded activity
 * in 94 days") and offers a reason, never a judgment and never an obligation.
 * `RETURN_FORBIDDEN_WORDS` exists so a test can hold the line.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { dormancyView, type DormantRecord } from "@/lib/insights/dormancy";
import { queueCounts } from "@/lib/inbox/queue";
import { todayKey, type DayKey } from "@/lib/reviews/dates";

/**
 * Words that must never appear in a Return surface. Guilt is not a feature: a
 * product whose premise is calm cannot borrow motivation from shame.
 */
export const RETURN_FORBIDDEN_WORDS = [
  "abandoned", "neglected", "stale", "overdue", "behind", "failed",
  "should have", "you forgot", "streak", "don't break",
];

/** Days of inactivity before a record is eligible to be offered as a Return. */
export const RETURN_THRESHOLD_DAYS = 30;

export interface CaptureInboxSignal {
  /** Captures still sitting in the inbox, unprocessed. */
  count: number;
  /** Plain, non-directive sentence. Empty when there is nothing to say. */
  label: string;
}

/**
 * How many captures still need organizing.
 *
 * Counts only `inbox` captures — deferred, processed, archived, and discarded
 * ones are not loose ends. The label is a statement of fact with no imperative:
 * "3 captures to organize", never "You have 3 captures waiting!".
 *
 * Delegates to `queueCounts` rather than recounting. `TodayInboxCard` already
 * renders this number from the same function, and two independent counts of the
 * same thing is how a UI starts contradicting itself.
 */
export function captureInboxSignal(state: StoreState): CaptureInboxSignal {
  const count = queueCounts(state.captures ?? []).inbox;
  if (count === 0) return { count: 0, label: "" };
  return { count, label: count === 1 ? "1 capture to organize" : `${count} captures to organize` };
}

export interface ReturnSuggestion {
  ref: RecordRefLite;
  title: string;
  /** Whole days since the most recent recorded activity. */
  inactiveDays: number;
  /** Why this appeared — the user must always be able to tell. */
  reason: string;
}

/**
 * At most ONE thing worth returning to.
 *
 * One, not a list: a list of quiet records is a backlog, and a backlog is the
 * thing this signal is supposed to relieve. Selection is deterministic — the
 * longest-quiet eligible record, tie-broken by ref key — so the same state
 * always yields the same suggestion and the surface never feels like a slot
 * machine.
 *
 * Returns `null` when nothing qualifies, which is a perfectly good Today.
 */
export function returnSuggestion(
  state: StoreState,
  index: ActivityEvent[],
  thresholdDays: number = RETURN_THRESHOLD_DAYS,
  today: DayKey = todayKey(),
): ReturnSuggestion | null {
  const dormant: DormantRecord[] = dormancyView(state, index, thresholdDays, undefined, today);
  if (dormant.length === 0) return null;

  // A record with NO activity at all reports `Infinity` days. Those are the
  // QUIETEST records in the system, so excluding them would hide exactly what
  // this signal exists to surface — but "in Infinity days" is not a sentence, so
  // they get their own true wording instead of a number.
  const best = dormant
    .slice()
    .sort((a, b) => b.inactiveDays - a.inactiveDays || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))[0];
  if (!best) return null;

  return {
    ref: { kind: best.kind, id: best.id },
    title: best.title,
    inactiveDays: best.inactiveDays,
    reason: Number.isFinite(best.inactiveDays)
      ? `No recorded activity in ${best.inactiveDays} days.`
      : "No recorded activity yet.",
  };
}

/** True when a string is free of guilt/pressure language. Used by tests and UI. */
export function isNeutralLanguage(text: string): boolean {
  const lower = (text ?? "").toLowerCase();
  return !RETURN_FORBIDDEN_WORDS.some((w) => lower.includes(w));
}
