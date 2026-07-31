/**
 * Action flow (LIFEOS-039, Feature 6).
 *
 * Deterministic counts of action transitions within the range — created,
 * started, waiting, deferred, completed, cancelled, restored — plus the raw
 * transition list. It does NOT imply more completions are better and creates NO
 * velocity score. Pure.
 */

import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { countType } from "@/lib/insights/metrics";

export interface ActionFlow {
  created: number;
  started: number;
  waiting: number;
  deferred: number;
  completed: number;
  cancelled: number;
  restored: number;
  /** Chronological transition events (recordId + type + at), for a readable list. */
  transitions: { at: string; type: string; id: string }[];
}

export function actionFlow(index: ActivityEvent[], range: ResolvedRange): ActionFlow {
  const ev = eventsInRange(index, range).filter((e) => e.recordKind === "action");
  return {
    created: countType(ev, "action_created"),
    started: countType(ev, "action_started"),
    waiting: countType(ev, "action_waiting"),
    deferred: countType(ev, "action_deferred"),
    completed: countType(ev, "action_completed"),
    cancelled: countType(ev, "action_cancelled"),
    restored: countType(ev, "action_restored"),
    transitions: ev.map((e) => ({ at: e.at, type: e.type, id: e.recordId })),
  };
}
