/**
 * Goal horizons — where in a life a goal sits (LIFEOS-078).
 *
 * ## The gap this closes
 *
 * A Goal could say WHAT the user is trying to accomplish and never WHEN in a
 * life it belongs. "Book the dentist" and "be someone my children trust" were
 * the same kind of object, ordered by `priority` — which is urgency, not
 * direction. The product could show what was due. It could not show where a
 * life was going.
 *
 * ## What a horizon is NOT
 *
 *  - **Not a date calculator.** Nothing here reads `targetDate`, and nothing
 *    writes one. A `life` goal usually has no date at all; a `life` goal MAY
 *    carry a date for the one step being taken toward it this month. Both
 *    round-trip unchanged. The ranges below are guidance for a person deciding,
 *    never arithmetic the product performs on their behalf.
 *  - **Not a priority.** `priority` already exists and means something else.
 *    A `life` goal is not automatically more important than a `now` goal, and
 *    horizon deliberately does NOT influence what Today suggests.
 *  - **Not a score.** There is no alignment percentage, no balance rating, and
 *    no judgement about having too many goals at one horizon.
 *
 * ## The name
 *
 * `PlanningHorizon` (`lib/planning/horizon.ts`) already owns the word "horizon"
 * in this codebase, for a different noun: when the user has chosen to WORK on
 * an action (`today | this_week | later | someday | unscheduled`). The two are
 * unrelated, so the type here is `GoalHorizon` and never `Horizon`, and the two
 * modules never import each other. The user-facing word stays "horizon" for
 * goals because it is the right English word — the separation is in code.
 */

import type { Goal, GoalHorizon, StoreState } from "@/types/mvp";

/**
 * Nearest first. This is the DISPLAY order and nothing else — it is not a
 * ranking, and being later in the list never makes a goal more or less
 * important. Goals with no horizon are listed separately, never slotted in.
 */
export const GOAL_HORIZONS: readonly GoalHorizon[] = ["now", "near", "medium", "long", "life"];

const HORIZON_SET = new Set<string>(GOAL_HORIZONS);

/** Whether an arbitrary value is one of the five horizons. Used at every boundary. */
export function isGoalHorizon(v: unknown): v is GoalHorizon {
  return typeof v === "string" && HORIZON_SET.has(v);
}

export const GOAL_HORIZON_LABEL: Record<GoalHorizon, string> = {
  now: "Now",
  near: "Near",
  medium: "Medium",
  long: "Long",
  life: "Life",
};

/**
 * The human meaning of each horizon, written as the person's own frame.
 *
 * The time spans are GUIDANCE — what a person typically means by the word — and
 * the product never checks a goal's target date against them. A goal is not
 * "wrong" for having a date outside its horizon's span.
 */
export const GOAL_HORIZON_GUIDANCE: Record<GoalHorizon, string> = {
  now: "What you are actually working on — days to weeks.",
  near: "Next up, roughly one to three months.",
  medium: "This season of your life, roughly three to twelve months.",
  long: "Where you are heading over one to five years.",
  life: "Who you are trying to become. No deadline, and none is expected.",
};

/** The one-line prompt shown where a horizon is chosen. Never a nudge. */
export const GOAL_HORIZON_PROMPT = "How far away is this?";

/** What an unset horizon is called. It is a real state, not a missing value. */
export const GOAL_HORIZON_UNSET_LABEL = "No horizon set";

/** A label for a possibly-unset horizon, with no invented default. */
export function goalHorizonLabel(h: GoalHorizon | undefined): string {
  return h ? GOAL_HORIZON_LABEL[h] : GOAL_HORIZON_UNSET_LABEL;
}

export interface GoalHorizonGroup {
  /** `undefined` for the goals whose horizon the user has not set. */
  horizon?: GoalHorizon;
  label: string;
  goals: Goal[];
}

/**
 * Group goals by horizon, nearest first, with the unset group LAST.
 *
 * Empty horizons are returned as empty groups on purpose: seeing that nothing
 * sits at `long` is the point of the view, and silently omitting the row would
 * hide exactly the fact the user opened the page to see. Callers that want a
 * compact list can filter.
 *
 * Order within a group is the caller's — this function never re-sorts, so the
 * page's existing ordering is preserved.
 */
export function groupGoalsByHorizon(goals: Goal[]): GoalHorizonGroup[] {
  const groups: GoalHorizonGroup[] = GOAL_HORIZONS.map((h) => ({
    horizon: h,
    label: GOAL_HORIZON_LABEL[h],
    goals: [],
  }));
  const unset: GoalHorizonGroup = { horizon: undefined, label: GOAL_HORIZON_UNSET_LABEL, goals: [] };
  const byHorizon = new Map<GoalHorizon, GoalHorizonGroup>(
    groups.map((g) => [g.horizon as GoalHorizon, g]),
  );

  for (const goal of goals) {
    const target = isGoalHorizon(goal.horizon) ? byHorizon.get(goal.horizon) : undefined;
    (target ?? unset).goals.push(goal);
  }
  return [...groups, unset];
}

/**
 * How many goals sit at each horizon — a count, never a verdict.
 *
 * Deliberately returns raw numbers with no "balance", "spread" or "too many"
 * interpretation attached. A person with eleven `now` goals may be having a
 * demanding month; the product does not get to call that a problem.
 */
export function goalHorizonCounts(state: StoreState): Record<GoalHorizon | "unset", number> {
  const out: Record<string, number> = { now: 0, near: 0, medium: 0, long: 0, life: 0, unset: 0 };
  for (const g of state.goals ?? []) {
    out[isGoalHorizon(g.horizon) ? g.horizon : "unset"] += 1;
  }
  return out as Record<GoalHorizon | "unset", number>;
}
