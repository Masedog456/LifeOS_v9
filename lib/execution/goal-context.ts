/**
 * Goal context — where a goal is headed, and what is carrying it (LIFEOS-088 §4).
 *
 * ## What the audit found
 *
 * A goal holding an overdue action, a blocked action, two waits, an action
 * deferred three times and a perfectly good next action rendered six empty
 * panels, four counts, and none of the commitments. Two of its lines were worse
 * than absent — they were false. A project carrying eleven actions was drawn at
 * "0%", and an active goal whose work is tracked as directly-linked actions was
 * told "No active project is linked to this goal. Add a project" while
 * `recommendNextAction` was already naming its next action.
 *
 * So this composes what already exists — commitment signals, the attention
 * shortlist, executive changes, repeated deferral, the blocked map, goal
 * history, and the one recommender — and adds no ranking of its own (§15).
 *
 * ## No score, no percentage (§38)
 *
 * There is no goal health, no momentum, no alignment and no progress bar.
 * `goalProgress` is honest — it returns `null` rather than fabricating — and it
 * is deliberately NOT used here: this view reports counts, which are the thing
 * that is actually known. `projectProgress` reaches a row only when
 * `projectProgressMeasurable` says the number rests on something countable.
 *
 * ## A path is not the same question as a project (§11, §13, §14)
 *
 * `goalPathMissing` asks one narrow question — is there an active project? — and
 * its sentence claims exactly that and no more. It is correct, Today depends on
 * it, and it is left alone. But a goal can be carried by actions linked straight
 * to it, with no project anywhere, and calling that a missing path is false. So
 * `path` here is three-valued, and the `none` case says what it actually
 * checked rather than pronouncing on the goal.
 *
 * ## Horizon is not a target (§6, §7)
 *
 * Both are shown, both come straight from the record, and neither is ever
 * derived from the other. A `life` goal may carry a date; a `now` goal may carry
 * none. Nothing here compares a target date against a horizon's guidance span.
 *
 * ## Direction is not progress (§16, §17)
 *
 * `movement` counts completed linked work. A horizon change, a status edit, a
 * new target date and a title edit are direction or bookkeeping, and they live
 * in `direction`, never in `movement`.
 *
 * ## Ownership precedence, so one action is one row (§34)
 *
 *   NEXT      owns the recommendation
 *   WAITING   owns any action whose status is `waiting`
 *   BLOCKED   owns any action with an UNFINISHED blocker
 *   SUPPORT   owns ordinary live work
 *   ATTENTION owns nothing — it attaches its reason to the row above
 *   DEFERRAL  owns nothing — it attaches a count to the row above
 *   RECENTLY  excludes anything that currently owns a row
 *
 * ## Pure
 *
 * A function of `(state, goalId, ix, today)`. No store writes, no clock of its
 * own, no network, no AI, no persistence.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { Goal, GoalHistoryEvent, GoalHorizon, NextAction, Project, StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { ExecutiveChange } from "@/lib/memory/changes";
import type { Recommendation } from "@/lib/today/recommend";
import { todayKey } from "@/lib/reviews/dates";
import { resolveRange, type ResolvedRange } from "@/lib/insights/range";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { buildAttentionShortlist } from "@/lib/guidance/attention";
import { buildExecutiveChanges, repeatedlyPostponed, postponedLine } from "@/lib/memory/changes";
import { recommendNextAction } from "@/lib/today/recommend";
import { longerForms, personHint } from "@/lib/people/context";
import { nameCandidates } from "@/lib/execution/context";
import { isLive } from "@/lib/actions/due";
import { goalLinkedActions, goalLinkedProjects, goalPathState } from "@/lib/execution/alignment";
import type { GoalPath } from "@/lib/execution/alignment";
import { goalHistory, goalLineage, successorOf, describeGoalHistoryEvent } from "@/lib/execution/lifecycle";
import { goalHorizonLabel } from "@/lib/execution/horizons";
import { projectProgress, projectProgressMeasurable } from "@/lib/execution/progress";

// ------------------------------------------------------------------ caps ---

/** §18. Enough to see what moved; never a changelog. */
export const MAX_RECENT = 5;
/** A small support list, not a backlog wall. */
export const MAX_SUPPORT = 8;
/** §23. People are context, not a roster. */
export const MAX_PEOPLE = 6;
/** How many lifecycle entries the view carries. The rest live on the record. */
export const MAX_HISTORY = 6;
/** §18. The default window for "recently". Memory answers deeper history. */
export const RECENT_RANGE = "last_7_days" as const;

// --------------------------------------------------------------- results ---

/** One action, owned by exactly one section (§34). */
export interface GoalRow {
  id: string;
  action: NextAction;
  /** How this action reaches the goal. The link the user made, stated. */
  via: "direct" | { project: Project };
  /** An attention fact about this SAME action, attached rather than repeated. */
  attention?: string;
  /** "You deferred this 3 times." — attached, never a section of its own (§19). */
  deferral?: string;
  dueDate?: string;
  /** For a blocked row: the unfinished action it is waiting on. */
  blockedBy?: NextAction;
  /** For a waiting row: verbatim from the record. */
  waitingOn?: string;
  since?: string;
  followUpDate?: string;
  /** True only when the follow-up date has actually arrived (§21). */
  followUpDue?: boolean;
}

/** One project under the goal. Counts, and a percentage only when one is real. */
export interface GoalProjectLine {
  project: Project;
  /** §38. `undefined` unless `projectProgressMeasurable` is true. */
  percent?: number;
  open: number;
  waiting: number;
  blocked: number;
  completed: number;
}

/**
 * Re-exported so a caller of this module has one import (§13, §14).
 *
 * The definition lives in `lib/execution/alignment.ts` beside `goalPathMissing`,
 * which answers the narrower project-only question — one module owning both is
 * how the two stay distinguishable instead of drifting into a third
 * incompatible definition of "has a path".
 */
export type { GoalPath };

/** Someone the goal's own records name (§23). */
export interface GoalPerson {
  name: string;
  grounding: "waiting" | "action";
  waiting: number;
  actions: number;
  /** Longer names in the store beginning with this one — ambiguity, unresolved. */
  longerForms: string[];
  route: string;
}

/** One entry from the goal's own append-only history (§8). */
export interface GoalHistoryLine {
  id: string;
  day: DayKey;
  text: string;
  note?: string;
}

export interface GoalContext {
  goal: Goal;

  // ---- overview ---------------------------------------------------------
  /** §6. Straight from `goal.horizon`. Never inferred from a date. */
  horizon?: GoalHorizon;
  horizonLabel: string;
  /** §7. Straight from `goal.targetDate`. Independent of the horizon. */
  targetDate?: string;
  path: GoalPath;
  /**
   * The sentence the path deserves, or nothing at all.
   *
   * Absent when there is an active project (the project rows already say it),
   * and absent on a goal that is not `active` — a paused goal has no active
   * project BY the user's own decision, and a replaced or achieved goal is
   * finished, so flagging any of them invents a problem out of a choice the
   * person already made. That is `goalPathMissing`'s own rule, kept.
   */
  pathNote?: string;
  /** The projects under the goal, with counts rather than a fabricated bar. */
  projects: GoalProjectLine[];
  counts: { projects: number; activeProjects: number; open: number; waiting: number; blocked: number; completedRecently: number };

  // ---- next and support -------------------------------------------------
  /** §15. `recommendNextAction` over this goal's actions. Not a new ranker. */
  next?: Recommendation;
  /** Why there is no recommendation, in the recommender's own words. */
  nextNote?: string;
  support: GoalRow[];

  // ---- stuck and waiting ------------------------------------------------
  blocked: GoalRow[];
  waiting: GoalRow[];

  // ---- recently ---------------------------------------------------------
  /** §16. Completed linked work only. A direction change is never in here. */
  movement: ExecutiveChange[];
  /** §17. The goal's own recorded transitions in the window. Not progress. */
  direction: ExecutiveChange[];
  /** The window both looked at, said out loud. */
  range: ResolvedRange;

  // ---- context ----------------------------------------------------------
  /** §8. From `goal.history[]`, newest first. Never from `updatedAt`. */
  history: GoalHistoryLine[];
  /** §9. The goal this one became, when the record names one that still exists. */
  successor?: Goal;
  /** True when the goal is `replaced` but its successor has been deleted. */
  successorMissing: boolean;
  /** The date the replacement was recorded, from history — never `updatedAt`. */
  replacedOn?: DayKey;
  /** The whole replacement chain, oldest first, when there is more than one. */
  lineage: Goal[];
  people: GoalPerson[];
  /** §24. Rules already attached by the existing relevance system. Context only. */
  rules: string[];

  /** No project and no action reaches this goal. A fact, not a judgement. */
  noWorkLinked: boolean;
}

// ------------------------------------------------------------- the model ---

export function buildGoalContext(
  state: StoreState,
  goalId: string,
  ix: TodayIndexes,
  today: DayKey = todayKey(),
): GoalContext | undefined {
  const goal = (state.goals ?? []).find((g) => g.id === goalId);
  if (!goal) return undefined;

  const projects = goalLinkedProjects(state, goal.id);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const activeProjects = projects.filter((p) => p.status === "active");

  // Deduplicated by `goalLinkedActions`: an action naming both the goal and one
  // of its projects is ONE commitment, and counting it twice would inflate
  // every number on the page.
  const mine = goalLinkedActions(state, goal.id);
  const mineIds = new Set(mine.map((a) => a.id));

  /** How an action reaches the goal. The recorded link, never a guess. */
  const viaOf = (a: NextAction): GoalRow["via"] => {
    const p = a.projectId ? projectById.get(a.projectId) : undefined;
    // A direct `goalId` is the user's own statement that this serves the goal,
    // so it wins over the inherited route even when both links exist.
    return a.goalId === goal.id || !p ? "direct" : { project: p };
  };

  // ---- facts about these actions, from the builders that already know ----
  const signals = new Map<string, { kind: string; explanation: string }>();
  for (const sig of buildCommitmentSignals(state, ix, { today })) {
    if (sig.recordRef.kind === "action" && mineIds.has(sig.recordRef.id) && !signals.has(sig.recordRef.id)) {
      signals.set(sig.recordRef.id, { kind: sig.kind, explanation: sig.explanation });
    }
  }

  /**
   * An attention line that restates what the row already shows is noise — the
   * defect 087's visual review caught, arriving here by the same door.
   */
  const attentionFor = (a: NextAction, shows: { due?: boolean; followUp?: boolean }): string | undefined => {
    const sig = signals.get(a.id);
    if (!sig) return undefined;
    if (shows.due && (sig.kind === "overdue" || sig.kind === "due_soon")) return undefined;
    if (shows.followUp && sig.kind === "follow_up_due") return undefined;
    return sig.explanation;
  };

  const range = resolveRange(RECENT_RANGE, { today });
  const deferrals = new Map<string, string>();
  for (const p of repeatedlyPostponed(state, range)) {
    if (mineIds.has(p.action.id)) deferrals.set(p.action.id, postponedLine(p));
  }

  const row = (
    a: NextAction,
    extra: Partial<GoalRow> = {},
    shows: { due?: boolean; followUp?: boolean } = {},
  ): GoalRow => ({
    id: `row:${a.id}`,
    action: a,
    via: viaOf(a),
    attention: attentionFor(a, shows),
    deferral: deferrals.get(a.id),
    dueDate: a.dueDate,
    ...extra,
  });

  // ---- §15. ONE recommendation, from the existing recommender -------------
  //
  // The state is narrowed to this goal's actions; the INDEX is the full one, so
  // an action blocked by a blocker outside the goal is still correctly
  // excluded. Passing a narrowed index would have quietly unblocked it.
  const rec = recommendNextAction({ ...state, nextActions: mine }, ix, today);
  const nextId = rec.recommendation?.action.id;

  // ---- ownership, in one pass (§34) --------------------------------------
  const owned = new Set<string>();
  if (nextId) owned.add(nextId);

  const waiting: GoalRow[] = [];
  const blocked: GoalRow[] = [];
  const support: GoalRow[] = [];

  for (const a of mine) {
    if (!isLive(a) || owned.has(a.id)) continue;

    if (a.status === "waiting") {
      owned.add(a.id);
      waiting.push(row(a, {
        waitingOn: a.waitingOn?.trim(),
        since: a.waitingSince?.slice(0, 10),
        followUpDate: a.followUpDate,
        // §21. A date in the future is not a date that has arrived, and nothing
        // here says a wait has gone on too long.
        followUpDue: !!a.followUpDate && a.followUpDate <= today,
      }, { followUp: !!a.followUpDate }));
      continue;
    }

    // §22. Real blocker evidence only. `blockedActionIds` already excludes an
    // action whose blocker is COMPLETED, and nothing infers blocked from
    // inactivity.
    if (ix.blockedActionIds.has(a.id)) {
      owned.add(a.id);
      const blockerId = [...(ix.blockedByMap.get(a.id) ?? [])]
        .find((bid) => { const b = ix.actionsById.get(bid); return !!b && isLive(b); });
      blocked.push(row(a, { blockedBy: blockerId ? ix.actionsById.get(blockerId) : undefined }));
      continue;
    }

    owned.add(a.id);
    support.push(row(a, {}, { due: !!a.dueDate }));
  }

  const byDate = (x: GoalRow, y: GoalRow) =>
    (x.dueDate ?? "9999").localeCompare(y.dueDate ?? "9999") || x.action.id.localeCompare(y.action.id);
  support.sort(byDate);
  blocked.sort(byDate);
  waiting.sort((x, y) =>
    (x.followUpDue === y.followUpDue ? 0 : x.followUpDue ? -1 : 1)
    || (x.since ?? "").localeCompare(y.since ?? "")
    || x.action.id.localeCompare(y.action.id));

  // ---- §13, §14. Is anything carrying this goal? -------------------------
  //
  // An active project is the ordinary answer. Failing that, actions linked
  // STRAIGHT to the goal are real support (§11) — this is the case the product
  // used to call a missing path while its own recommender named the next step.
  // Actions under a paused or abandoned project are deliberately NOT counted:
  // that project's state is the user's own decision about them, and the
  // `NO_PATH` sentence names both checks so the reader can see which applied.
  const path = goalPathState(state, goal);

  // ---- §38. Counts, and a percentage only where one is real --------------
  const projectLines: GoalProjectLine[] = projects.map((p) => {
    const acts = mine.filter((a) => a.projectId === p.id);
    return {
      project: p,
      // A project with no milestones, no explicit completion and no override
      // returns 0 from `projectProgress`, which is the absence of evidence
      // rather than a measurement. It is omitted, not printed.
      percent: projectProgressMeasurable(p) ? projectProgress(p) : undefined,
      open: acts.filter((a) => isLive(a) && a.status !== "waiting" && !ix.blockedActionIds.has(a.id)).length,
      waiting: acts.filter((a) => a.status === "waiting").length,
      blocked: acts.filter((a) => isLive(a) && ix.blockedActionIds.has(a.id)).length,
      completed: acts.filter((a) => a.status === "completed").length,
    };
  });

  // ---- §16, §17, §18. What moved, and what merely changed ---------------
  //
  // Scoped by the goal's linked ACTIONS AND PROJECTS, not by the goal entity: a
  // change scoped to `{kind:"goal", id}` returns the goal's own history and
  // nothing that happened under it — the audit measured exactly one row on a
  // week in which an action completed and another was deferred three times.
  //
  // Deduplicated per (kind, record), because `buildExecutiveChanges` emits one
  // entry per EVENT and an action deferred three times produced three identical
  // rows. And an action that OWNS A ROW above is excluded: its row is the live
  // truth and already carries the fact.
  const projectIds = new Set(projects.map((p) => p.id));
  const changes = buildExecutiveChanges(state, range);
  /** Each list keeps its own memory, so neither can silently eat the other's rows. */
  const dedupe = (list: ExecutiveChange[]) => {
    const seen = new Set<string>();
    return list
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
      .filter((c) => {
        const key = `${c.kind}:${c.entity.kind}:${c.entity.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_RECENT);
  };

  const isMovement = (c: ExecutiveChange) =>
    (c.entity.kind === "action" && mineIds.has(c.entity.id))
    || (c.entity.kind === "project" && projectIds.has(c.entity.id));

  const direction = dedupe(changes.filter((c) => c.entity.kind === "goal" && c.entity.id === goal.id));
  const movement = dedupe(changes.filter((c) => isMovement(c) && !owned.has(c.entity.id)));

  // §16. The COUNT is over the whole window, not over the capped display list —
  // a five-row cap must never become "5 things completed".
  const completedRecently = changes.filter((c) => c.kind === "completed" && isMovement(c)).length;

  // ---- §8, §9. The recorded life of the goal itself ----------------------
  const titleOf = (id: string) => (state.goals ?? []).find((g) => g.id === id)?.title;
  const history: GoalHistoryLine[] = [...goalHistory(goal)]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_HISTORY)
    .map((e) => ({
      id: e.id,
      day: e.at.slice(0, 10) as DayKey,
      text: describeGoalHistoryEvent(e, titleOf),
      note: e.note,
    }));

  const successor = successorOf(state, goal);
  const replacedEvent = [...goalHistory(goal)]
    .filter((e: GoalHistoryEvent) => e.kind === "replaced")
    .sort((a, b) => a.at.localeCompare(b.at))
    .pop();
  const lineage = goalLineage(state, goal.id);

  // ---- §23. People the goal's own records name ---------------------------
  const people = goalPeople(state, goal, mine);

  // ---- §24. Rules, through the EXISTING relevance system only ------------
  const rules = [...new Set(
    buildAttentionShortlist(state, ix, today, { limit: 5 })
      .filter((a) => a.entity.kind === "action" && mineIds.has(a.entity.id))
      .flatMap((a) => a.ruleContext),
  )];

  return {
    goal,
    horizon: goal.horizon,
    horizonLabel: goalHorizonLabel(goal.horizon),
    targetDate: goal.targetDate,
    path,
    pathNote: goal.status !== "active" || path === "project" ? undefined
      : path === "actions" ? PATH_VIA_ACTIONS : NO_PATH,
    projects: projectLines,
    counts: {
      projects: projects.length,
      activeProjects: activeProjects.length,
      open: support.length + (nextId ? 1 : 0),
      waiting: waiting.length,
      blocked: blocked.length,
      completedRecently,
    },
    next: rec.recommendation ?? undefined,
    nextNote: rec.recommendation ? undefined : rec.note,
    support: support.slice(0, MAX_SUPPORT),
    blocked, waiting,
    movement, direction, range,
    history,
    successor,
    // The record says it was replaced and the successor is gone. Reported as
    // deleted rather than by printing the id it still holds (§9).
    successorMissing: goal.status === "replaced" && !successor,
    replacedOn: replacedEvent ? (replacedEvent.at.slice(0, 10) as DayKey) : undefined,
    lineage,
    people, rules,
    noWorkLinked: mine.length === 0 && projects.length === 0,
  };
}

// ---------------------------------------------------------------- people ---

/**
 * Names the goal's own records contain (§23).
 *
 * Grounded in `waitingOn` — the one structured field — and in action titles the
 * user wrote themselves, using LIFEOS-087's conservative candidate scan. Nothing
 * is merged: "Marcus" and "Marcus Webb" remain distinct references, and the
 * longer form travels with the shorter as unresolved ambiguity.
 */
export function goalPeople(state: StoreState, goal: Goal, mine: NextAction[]): GoalPerson[] {
  const found = new Map<string, { grounding: "waiting" | "action"; waiting: number; actions: number }>();

  const note = (name: string, grounding: "waiting" | "action") => {
    const cur = found.get(name) ?? { grounding, waiting: 0, actions: 0 };
    if (grounding === "waiting") { cur.grounding = "waiting"; cur.waiting++; } else cur.actions++;
    found.set(name, cur);
  };

  for (const a of mine) {
    if (a.status === "waiting" && a.waitingOn && personHint(state, a.waitingOn.trim())) {
      note(a.waitingOn.trim(), "waiting");
    }
    for (const cand of nameCandidates(a.title ?? "")) note(cand, "action");
  }
  for (const cand of nameCandidates(goal.description ?? "", { skipFirst: false })) note(cand, "action");

  return [...found.entries()]
    .map(([name, v]) => ({
      name, ...v,
      longerForms: longerForms(state, name).filter((f) => f !== name),
      route: `/people/${encodeURIComponent(name)}`,
    }))
    .filter((p) => !!personHint(state, p.name))
    .sort((a, b) => (b.waiting - a.waiting) || a.name.localeCompare(b.name))
    .slice(0, MAX_PEOPLE);
}

// ----------------------------------------------------------------- words ---

/** §28. Five sections, and no sixth. */
export const GOAL_HEADINGS = {
  overview: "Where this is headed",
  next: "Next and support",
  stuck: "Stuck and waiting",
  recent: "Recently",
  context: "Context",
} as const;

/** §6. An unset horizon is a real state, not a missing value — and never guessed. */
export const NO_HORIZON =
  "No horizon set, so Conqify cannot say how far away this is.";

/** §7. Said when there is no target date. It never implies one is needed. */
export const NO_TARGET = "No target date set.";

/**
 * §13, §14. The `none` case, stating the two checks it actually made.
 *
 * The old sentence — "No active project is linked to this goal. Add a project" —
 * was literally true and still misleading, because it appeared on goals whose
 * work was tracked as directly-linked actions. This one cannot: it is only ever
 * reached when both checks came back empty, and it names both.
 */
export const NO_PATH =
  "No active project, and no action linked directly to this goal.";

/** §14. The case the product used to call a missing path. */
export const PATH_VIA_ACTIONS =
  "No project — this goal is carried by actions linked directly to it.";

/** §38. Said instead of a percentage that would rest on nothing. */
export const PROGRESS_NOT_MEASURED =
  "Not measured — this project has no milestones and is not marked complete.";

/** §29. Scoped exactly to recorded linked completions. */
export const NOTHING_MOVED = (label: string) =>
  `No linked action or project completed in ${label}.`;

/** §8. There is no such limitation for goals, but there IS one for undated history. */
export const NO_HISTORY =
  "This goal was created before Conqify recorded goal transitions, so its earlier changes are not known.";

/** §5, §38. Words a goal command view may never use. */
export const GOAL_FORBIDDEN_WORDS: readonly string[] = [
  "goal health", "momentum", "risk score", "alignment", "on track", "off track",
  "stalled", "at risk", "velocity", "behind schedule", "no progress", "failing",
  "healthy", "unhealthy", "no path forward", "you should really", "you keep",
  "mission statement", "% complete", "goal score",
];

/** Every string this layer can render, for the sweep. */
export function goalStrings(c: GoalContext): string[] {
  return [
    ...Object.values(GOAL_HEADINGS),
    NO_HORIZON, NO_TARGET, NO_PATH, PATH_VIA_ACTIONS, PROGRESS_NOT_MEASURED,
    NOTHING_MOVED(c.range.label), NO_HISTORY,
    c.nextNote ?? "",
    ...c.support.flatMap((r) => [r.attention ?? "", r.deferral ?? ""]),
    ...c.blocked.flatMap((r) => [r.attention ?? "", r.deferral ?? ""]),
    ...c.waiting.flatMap((r) => [r.attention ?? "", r.deferral ?? ""]),
    ...c.history.map((h) => h.text),
    ...c.rules,
  ].filter(Boolean);
}
