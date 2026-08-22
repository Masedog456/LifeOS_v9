/**
 * Shared Today indexes (LIFEOS-062 §33).
 *
 * ## One pass, not eight
 *
 * The audit found `buildActivityIndex` running TWICE per Today render — once in
 * the Return card, once in the Insights card — and every other card deriving its
 * own slice from `useStore()` independently. That is the shape that turns a
 * page into a performance problem quietly: each card is individually cheap, and
 * the page is the sum.
 *
 * So every index Today needs is built here, once, and threaded into the
 * sections. Nothing in `lib/today/` may build an index of its own.
 *
 * ## Everything is reused
 *
 * Not one new scanner. `buildActivityIndex`, `buildBlocksMap`,
 * `buildBlockedByMap`, `completionIndex`, `eventsOnDay` and `assignmentFor` all
 * already existed; this composes them and stops there.
 *
 * ## Pure
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { buildActivityIndex, type ActivityEvent } from "@/lib/insights/activity";
import { buildBlocksMap, buildBlockedByMap, isBlocked } from "@/lib/actions/dependencies";
import { completionIndex } from "@/lib/mvpStore";
import { eventsOnDay, nextEventToday, nowLocalTime, type EventOccurrence } from "@/lib/time/events";
import { assignmentFor } from "@/lib/planning/horizon";
import { CONSTITUTION_KIND_LABEL } from "@/types/mvp";
import { minutesUntil } from "@/lib/today/recommend";
import type { LocalTime } from "@/lib/time/localtime";

export interface TodayIndexes {
  today: DayKey;
  now: LocalTime;
  /** Every action by id — the lookup every dependency question needs. */
  actionsById: Map<string, NextAction>;
  /** blockerId → ids it blocks. */
  blocksMap: Map<string, Set<string>>;
  /** blockedId → ids blocking it. */
  blockedByMap: Map<string, Set<string>>;
  /** Actions with at least one UNMET blocker. Never recommended (§16). */
  blockedActionIds: Set<string>;
  /** actionId → completed occurrence dates, for recurring sources. */
  completions: Map<string, string[]>;
  /** Today's event occurrences, chronological. */
  occurrences: EventOccurrence[];
  /** The next event that has not started, if any. */
  nextEvent?: EventOccurrence;
  /** Minutes until that event. `undefined` when there is no next event. */
  minutesToNextEvent?: number;
  /** Ids the user explicitly assigned to the `today` horizon. */
  plannedTodayIds: Set<string>;
  /** actionId → adopted Constitution element label, when explicitly linked. */
  constitutionByAction: Map<string, string>;
  /** The activity index, built ONCE and shared. */
  activity: ActivityEvent[];
}

export function buildTodayIndexes(state: StoreState, today: DayKey, now?: LocalTime): TodayIndexes {
  const clock = now ?? nowLocalTime();
  const actions = state.nextActions ?? [];

  const actionsById = new Map<string, NextAction>();
  for (const a of actions) actionsById.set(a.id, a);

  const deps = state.actionDependencies ?? [];
  const blocksMap = buildBlocksMap(deps);
  const blockedByMap = buildBlockedByMap(deps);

  const blockedActionIds = new Set<string>();
  for (const a of actions) {
    if (isBlocked(a, blockedByMap, actionsById)) blockedActionIds.add(a.id);
  }

  const occurrences = eventsOnDay(state, today);
  const nextEvent = nextEventToday(occurrences, clock);

  const plannedTodayIds = new Set<string>();
  for (const a of actions) {
    if (assignmentFor(state.planningAssignments ?? [], { kind: "action", id: a.id })?.horizon === "today") {
      plannedTodayIds.add(a.id);
    }
  }

  // §18: an ADOPTED element that EXPLICITLY links to an action. No inference, no
  // ranking, no alignment engine — a sentence of context or nothing at all.
  const constitutionByAction = new Map<string, string>();
  for (const el of state.constitutionElements ?? []) {
    if (el.status !== "active" || !el.adoptedAt) continue;
    for (const ref of el.linkedRefs ?? []) {
      if (ref.kind === "action" && !constitutionByAction.has(ref.id)) {
        constitutionByAction.set(ref.id, `${CONSTITUTION_KIND_LABEL[el.kind]}: ${el.statement}`);
      }
    }
  }

  return {
    today,
    now: clock,
    actionsById,
    blocksMap,
    blockedByMap,
    blockedActionIds,
    completions: completionIndex(state),
    occurrences,
    nextEvent,
    minutesToNextEvent: minutesUntil(clock, nextEvent?.startTime),
    plannedTodayIds,
    constitutionByAction,
    activity: buildActivityIndex(state),
  };
}
