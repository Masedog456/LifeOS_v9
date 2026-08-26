/**
 * When an open commitment has genuinely gone quiet (LIFEOS-073 §8).
 *
 * ## One predicate, one elapsed number
 *
 * "This has gone quiet" was being decided in three places with three different
 * answers, and the LIFEOS-073 audit caught all three disagreeing on one page:
 *
 *   - Today's "worth returning to" fallback read `dormancyView`, which maps
 *     EVERY action regardless of status or date, so an action **due today** was
 *     announced as "No recorded activity in 116 days" — the surface telling the
 *     user they had forgotten something sitting on today's list.
 *   - The same fallback surfaced an action the user had explicitly deferred a
 *     month out, answering a question they had already answered.
 *   - The blocked-item explanation printed the dormancy THRESHOLD where the
 *     elapsed count belonged, so one record read "no recorded activity in 30
 *     days" beside its own signal saying "120 days".
 *
 * The eligibility rule below is LIFEOS-070's, unchanged — it is centralised
 * here rather than restated, so "quiet" means one thing everywhere and the
 * number shown is always the real elapsed duration.
 *
 * ## Why a due date disqualifies
 *
 * Silence only means "forgotten" when nothing else explains it. A due date, a
 * deferral, or a wait all explain the silence: the user has already said when
 * they intend to deal with it. Calling those forgotten is not a reminder, it is
 * the product arguing with a decision the user already made.
 */

import type { NextAction } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { dayDiff } from "@/lib/reviews/dates";
import { isLive } from "@/lib/actions/due";
import { dueKeyOf } from "@/lib/actions/due";
import { isDeferredAhead } from "@/lib/actions/defer";

/** What the quiet-check found. `inactiveDays` is always the REAL elapsed count. */
export interface ActionDormancy {
  /** Days since the last recorded activity. Never the threshold constant. */
  inactiveDays: number;
  /** The instant the count was measured from. */
  lastAt: string;
  /** True once `inactiveDays` has reached the caller's threshold. */
  quiet: boolean;
}

/**
 * Is this action eligible to be called quiet at all?
 *
 * Open, not waiting, not deferred, not completed or cancelled, not recurring,
 * and carrying no date that already explains the silence.
 */
export function canGoQuiet(a: NextAction, today: DayKey): boolean {
  if (!isLive(a)) return false;                 // completed / cancelled
  if (a.status === "waiting") return false;     // someone else holds it
  if (a.status === "deferred") return false;    // the user parked it
  if (isDeferredAhead(a, today)) return false;  // …including a stale due date
  if (dueKeyOf(a)) return false;                // a date explains the silence
  return true;
}

/**
 * How long this action has actually been quiet, or `null` when the question
 * does not apply to it.
 *
 * The measurement point is the LATER of indexed activity and the record's own
 * `updatedAt`. The activity index carries status transitions, not field edits,
 * so an action changed five minutes ago can have no index entry at all — and
 * reading only the index reported work the user had just touched as forgotten
 * (LIFEOS-071 `stopWaiting`, LIFEOS-073 audit). `updatedAt` is recorded
 * evidence that the record changed, so it counts.
 */
export function actionDormancy(
  a: NextAction,
  lastActivity: Map<string, string>,
  today: DayKey,
  thresholdDays: number,
): ActionDormancy | null {
  if (!canGoQuiet(a, today)) return null;
  const indexed = lastActivity.get(`action:${a.id}`);
  const lastAt = [indexed, a.updatedAt, a.createdAt]
    .filter((x): x is string => !!x)
    .sort()
    .pop();
  if (!lastAt) return null;
  const day = lastAt.slice(0, 10);
  // Touched today (or dated ahead of today) is not quiet by any reading.
  if (day >= today) return { inactiveDays: 0, lastAt, quiet: false };
  const inactiveDays = dayDiff(today, day);
  return { inactiveDays, lastAt, quiet: inactiveDays >= thresholdDays };
}

/** Neutral phrasing carrying the REAL count. Never "you neglected this". */
export function dormancyLine(d: ActionDormancy): string {
  return `No recorded activity in ${d.inactiveDays} day${d.inactiveDays === 1 ? "" : "s"}.`;
}
