/**
 * Goal horizons, lifecycle and alignment self-tests (LIFEOS-078).
 *
 * Appended to the execution suite rather than given a route of its own —
 * horizon is a field of a Goal, not a new noun, and the tests should live where
 * a reader looks for goal behaviour.
 *
 * What these assert, and why each one exists:
 *
 *  - horizon is SEMANTIC. Setting one never touches `targetDate`, setting a
 *    target date never produces a horizon, and every combination round-trips.
 *  - lifecycle history is APPEND-ONLY and records transitions, not typo fixes.
 *  - replacement is one-directional, cycle-safe, and survives the successor
 *    being deleted without printing an id or inventing a name.
 *  - alignment is COUNTS AND DATES. There is no score anywhere in the output,
 *    and the assertions check the strings for it.
 *  - progress is `null` when nothing measurable backs it.
 *
 * Pure: no store, no clock beyond fixed fixtures, no AI.
 */

import type { Goal, NextAction, Project, StoreState } from "@/types/mvp";
import {
  GOAL_HORIZONS, GOAL_HORIZON_LABEL, goalHorizonCounts, goalHorizonLabel,
  groupGoalsByHorizon, isGoalHorizon,
} from "@/lib/execution/horizons";
import {
  GOAL_LIFECYCLE_LABEL, GOAL_STATUS_CHOICES, appendGoalHistory, canonicalGoal,
  describeGoalHistoryEvent, goalCreatedEvent, goalHistory, goalHorizonEvent,
  goalLineage, goalReplacedEvent, goalStatusEvent, isGoalClosed, predecessorOf,
  successorOf,
} from "@/lib/execution/lifecycle";
import {
  ancestryExplanation, actionAncestry, goalAlignmentFacts, goalLinkedActions,
  goalsMissingPath,
} from "@/lib/execution/alignment";
import { goalProgress } from "@/lib/execution/progress";
import { goalSummary } from "@/lib/execution/goals";
import { emptyStoreState } from "@/lib/ux/backup";
import { answerMemoryQuery } from "@/lib/memory/answer";
import { planMemoryQuery } from "@/lib/memory/query";

export interface SelfTestResult { name: string; pass: boolean; detail: string }

const AT = "2026-09-01T10:00:00.000Z";
const AT2 = "2026-09-05T10:00:00.000Z";

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], createdAt: AT, updatedAt: AT, ...p,
});
const project = (p: Partial<Project> & { id: string; title: string }): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: AT, updatedAt: AT, ...p,
});
const action = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", priority: "medium", context: "anywhere",
  estimatedSize: "unspecified", energy: "unspecified", tags: [], notes: "",
  linkedRefs: [], history: [], createdAt: AT, updatedAt: AT, ...p,
} as NextAction);

/**
 * A COMPLETE StoreState with the goal-shaped domains filled in.
 *
 * Every canonical domain has to be present, not just the three this sprint
 * touches: the memory answer layer builds a search index over the whole state,
 * and a partial fixture fails there with "captures is not iterable" — a test
 * harness breaking on its own shortcut rather than on the code under test.
 */
function stateWith(over: Partial<StoreState>): StoreState {
  return { ...emptyStoreState(), ...over };
}

/** Nothing in an alignment surface may read as a rating (§11, §43). */
const SCORE_WORDS = ["score", "%", "aligned", "momentum", "confidence", "rating", "streak", "on track"];

export function goalHorizonAssertions(): SelfTestResult[] {
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail: cond ? detail : `FAILED — ${detail}` });

  // ===================================================== 78.1 the vocabulary

  ok("78.1 five horizons, nearest first", GOAL_HORIZONS.join(",") === "now,near,medium,long,life", GOAL_HORIZONS.join(","));
  ok("78.2 every horizon has a label", GOAL_HORIZONS.every((h) => !!GOAL_HORIZON_LABEL[h]));
  ok("78.3 an unknown value is not a horizon", !isGoalHorizon("someday") && !isGoalHorizon("") && !isGoalHorizon(undefined) && !isGoalHorizon(3));
  ok("78.4 …and an unset horizon reads as a state, not a blank", goalHorizonLabel(undefined) === "No horizon set", goalHorizonLabel(undefined));

  // ============================== 78.5 horizon is NOT derived from a date ===
  //
  // §5's three cases. If any of these produced a horizon from a date, or a date
  // from a horizon, the feature would be a calculator wearing a word.

  const lifeNoDate = goal({ id: "g-life", title: "Be someone my kids trust", horizon: "life" });
  const lifeWithDate = goal({ id: "g-life-d", title: "Same, one step", horizon: "life", targetDate: "2026-10-01" });
  const dateNoHorizon = goal({ id: "g-date", title: "Ship the thing", targetDate: "2026-10-01" });
  ok("78.5 a life goal may carry no date", lifeNoDate.horizon === "life" && lifeNoDate.targetDate === undefined);
  ok("78.6 …and a life goal MAY carry a near date, unchanged", lifeWithDate.horizon === "life" && lifeWithDate.targetDate === "2026-10-01");
  ok("78.7 a near target date produces NO horizon", dateNoHorizon.horizon === undefined, String(dateNoHorizon.horizon));

  // ===================================================== 78.8 grouping =====

  const gs = [
    goal({ id: "a", title: "A", horizon: "now" }),
    goal({ id: "b", title: "B", horizon: "life" }),
    goal({ id: "c", title: "C" }),
    goal({ id: "d", title: "D", horizon: "now" }),
  ];
  const groups = groupGoalsByHorizon(gs);
  ok("78.8 six groups — five horizons plus the unset one", groups.length === 6, String(groups.length));
  ok("78.9 the unset group is LAST", groups[groups.length - 1].horizon === undefined);
  ok("78.10 goals land in their own horizon", groups[0].goals.map((g) => g.id).join(",") === "a,d", groups[0].goals.map((g) => g.id).join(","));
  ok("78.11 …and order within a group is the caller's, not re-sorted", groups[0].goals[0].id === "a");
  ok("78.12 an unset horizon is not silently reassigned", groups[5].goals.map((g) => g.id).join(",") === "c");
  const counts = goalHorizonCounts(stateWith({ goals: gs }));
  ok("78.13 counts are counts", counts.now === 2 && counts.life === 1 && counts.unset === 1 && counts.medium === 0, JSON.stringify(counts));
  // A corrupted value must not create a sixth bucket or crash the page.
  const corrupt = groupGoalsByHorizon([goal({ id: "x", title: "X", horizon: "eventually" as never })]);
  ok("78.14 a value outside the enum falls into unset, not a new group",
    corrupt.length === 6 && corrupt[5].goals.length === 1, String(corrupt.length));

  // ============================================ 78.15 append-only history ==

  const base = goal({ id: "g1", title: "G1" });
  const h1 = appendGoalHistory(base, goalCreatedEvent("e1", AT));
  const h2 = appendGoalHistory(h1, goalStatusEvent("e2", AT2, "active", "paused"));
  ok("78.15 history starts empty for a legacy goal", goalHistory(base).length === 0);
  ok("78.16 appending adds exactly one entry", goalHistory(h2).length === 2, String(goalHistory(h2).length));
  ok("78.17 …at the END, oldest first", goalHistory(h2)[0].id === "e1" && goalHistory(h2)[1].id === "e2");
  ok("78.18 …and never mutates the goal it was given", goalHistory(h1).length === 1 && goalHistory(base).length === 0);
  // The whole point of an append-only record: the earlier entry survives verbatim.
  ok("78.19 an earlier entry is untouched by a later one",
    JSON.stringify(goalHistory(h2)[0]) === JSON.stringify(goalCreatedEvent("e1", AT)));

  // A goal whose `history` is corrupt in storage must read as empty, not throw.
  ok("78.20 a non-array history reads as empty",
    goalHistory({ ...base, history: "nope" as never }).length === 0);

  // ================================================ 78.21 history wording ==

  ok("78.21 a created entry says so", describeGoalHistoryEvent(goalCreatedEvent("e", AT)) === "Goal created.");
  ok("78.22 a status transition names both ends",
    describeGoalHistoryEvent(goalStatusEvent("e", AT, "active", "completed")) === "Active → Achieved.",
    describeGoalHistoryEvent(goalStatusEvent("e", AT, "active", "completed")));
  ok("78.23 a horizon change names both ends",
    describeGoalHistoryEvent(goalHorizonEvent("e", AT, "near", "life")) === "Horizon Near → Life.",
    describeGoalHistoryEvent(goalHorizonEvent("e", AT, "near", "life")));
  ok("78.24 setting a first horizon does not invent a previous one",
    describeGoalHistoryEvent(goalHorizonEvent("e", AT, undefined, "now")) === "Horizon set to Now.",
    describeGoalHistoryEvent(goalHorizonEvent("e", AT, undefined, "now")));
  ok("78.25 clearing a horizon says what it was",
    describeGoalHistoryEvent(goalHorizonEvent("e", AT, "now", undefined)) === "Horizon cleared (was Now).");
  ok("78.26 a replacement names the successor's title",
    describeGoalHistoryEvent(goalReplacedEvent("e", AT, "active", "g2"), () => "The truer goal") === "Replaced by “The truer goal”.",
    describeGoalHistoryEvent(goalReplacedEvent("e", AT, "active", "g2"), () => "The truer goal"));
  // §39/0039's lesson: a deleted record's WORDS must not reappear, and an id is
  // not a name — so neither is printed.
  const gone = describeGoalHistoryEvent(goalReplacedEvent("e", AT, "active", "g2"), () => undefined);
  ok("78.27 a deleted successor degrades to a sentence, never an id",
    gone === "Replaced by a goal that has since been deleted." && !gone.includes("g2"), gone);

  // ============================================== 78.28 lifecycle labels ===

  ok("78.28 `replaced` is a status", GOAL_LIFECYCLE_LABEL.replaced === "Replaced");
  ok("78.29 `completed` reads as Achieved, and is not renamed in DATA", GOAL_LIFECYCLE_LABEL.completed === "Achieved");
  ok("78.30 `someday` still has a label — legacy rows keep working", GOAL_LIFECYCLE_LABEL.someday === "Someday");
  ok("78.31 …but is NOT offered for a new goal", !GOAL_STATUS_CHOICES.includes("someday"));
  ok("78.32 …and neither is `replaced`, which needs a successor", !GOAL_STATUS_CHOICES.includes("replaced"));
  ok("78.33 replaced counts as closed", isGoalClosed(goal({ id: "z", title: "Z", status: "replaced" })));
  ok("78.34 paused does not", !isGoalClosed(goal({ id: "z", title: "Z", status: "paused" })));

  // ================================================== 78.35 succession =====

  const gA = goal({ id: "A", title: "Run a marathon", status: "replaced", successorGoalId: "B" });
  const gB = goal({ id: "B", title: "Run without pain", status: "replaced", successorGoalId: "C" });
  const gC = goal({ id: "C", title: "Move every day" });
  const chain = stateWith({ goals: [gA, gB, gC] });

  ok("78.35 successor resolves forward", successorOf(chain, gA)?.id === "B");
  ok("78.36 predecessor is a LOOKUP, not a stored field", predecessorOf(chain, gC)?.id === "B" && (gC as Goal & { predecessorGoalId?: string }).predecessorGoalId === undefined);
  ok("78.37 the lineage reads oldest first, from any member",
    goalLineage(chain, "B").map((g) => g.id).join(",") === "A,B,C",
    goalLineage(chain, "B").map((g) => g.id).join(","));
  ok("78.38 …from the head too", goalLineage(chain, "A").map((g) => g.id).join(",") === "A,B,C");
  ok("78.39 the canonical goal is the one still being pursued", canonicalGoal(chain, "A")?.id === "C");
  ok("78.40 a goal that was never replaced is its own canonical",
    canonicalGoal(stateWith({ goals: [gC] }), "C")?.id === "C");

  // A dangling successor ends the chain the product can VERIFY.
  const dangling = stateWith({ goals: [goal({ id: "A", title: "A", status: "replaced", successorGoalId: "missing" })] });
  ok("78.41 a deleted successor ends the lineage instead of hanging",
    goalLineage(dangling, "A").map((g) => g.id).join(",") === "A");
  ok("78.42 …and the canonical goal is the last one that exists", canonicalGoal(dangling, "A")?.id === "A");

  // A cycle can only arrive through imported or corrupted data. It must stop.
  const loopA = goal({ id: "A", title: "A", successorGoalId: "B" });
  const loopB = goal({ id: "B", title: "B", successorGoalId: "A" });
  const looped = stateWith({ goals: [loopA, loopB] });
  const loopChain = goalLineage(looped, "A");
  ok("78.43 a cycle terminates instead of hanging", loopChain.length <= 2, String(loopChain.length));
  ok("78.44 …and never repeats a goal", new Set(loopChain.map((g) => g.id)).size === loopChain.length);
  ok("78.45 a goal that does not exist has no lineage", goalLineage(chain, "nope").length === 0);

  // ============================================ 78.46 alignment as facts ===

  const gGoal = goal({ id: "G", title: "Grow the business" });
  const pActive = project({ id: "P1", title: "Hire", goalId: "G" });
  const pDone = project({ id: "P2", title: "Website", goalId: "G", status: "completed" });
  const aOpen = action({ id: "A1", title: "Post the listing", projectId: "P1" });
  const aDirect = action({ id: "A2", title: "Call the accountant", goalId: "G" });
  const aBoth = action({ id: "A3", title: "Both links", goalId: "G", projectId: "P1" });
  const aDone = action({ id: "A4", title: "Done one", projectId: "P1", status: "completed", completedAt: "2026-08-25T09:00:00.000Z" });
  const world = stateWith({ goals: [gGoal], projects: [pActive, pDone], nextActions: [aOpen, aDirect, aBoth, aDone] });
  const facts = goalAlignmentFacts(world, gGoal, "2026-09-01");

  ok("78.46 an action reaching a goal twice is counted ONCE",
    goalLinkedActions(world, "G").length === 4, String(goalLinkedActions(world, "G").length));
  ok("78.47 project counts are counts", facts.projects.total === 2 && facts.projects.active === 1 && facts.projects.completed === 1, JSON.stringify(facts.projects));
  ok("78.48 open actions counted, completed excluded", facts.actions.open === 3, String(facts.actions.open));
  ok("78.49 a recent completion is evidence", facts.actions.completedRecently === 1, String(facts.actions.completedRecently));
  ok("78.50 a completion outside the window is not",
    goalAlignmentFacts(stateWith({ goals: [gGoal], projects: [pActive], nextActions: [{ ...aDone, completedAt: "2026-01-01T09:00:00.000Z", updatedAt: "2026-01-01T09:00:00.000Z" }] }), gGoal, "2026-09-01").actions.completedRecently === 0);
  ok("78.51 the facts carry a date, not a trend", typeof facts.lastActivityDay === "string" && facts.lastActivityDay!.length === 10, String(facts.lastActivityDay));
  ok("78.52 no score field exists on the facts",
    !Object.keys(facts).some((k) => /score|percent|rating|momentum|alignment/i.test(k)), Object.keys(facts).join(","));

  // ======================================== 78.53 goal_path_missing rules ==

  const noPath = goal({ id: "NP", title: "Learn to sail" });
  ok("78.53 an active goal with no active project is flagged",
    goalAlignmentFacts(stateWith({ goals: [noPath] }), noPath).pathMissing);
  ok("78.54 …and appears in the list", goalsMissingPath(stateWith({ goals: [noPath] })).map((g) => g.id).join(",") === "NP");
  ok("78.55 a goal WITH an active project is not flagged", !facts.pathMissing);
  for (const status of ["paused", "someday", "completed", "abandoned", "replaced"] as const) {
    ok(`78.56.${status} a ${status} goal is never flagged — that was the user's decision`,
      !goalAlignmentFacts(stateWith({ goals: [{ ...noPath, status }] }), { ...noPath, status }).pathMissing);
  }
  // A goal whose only project is completed still has no ACTIVE project. Stated
  // as a fact about records, which is why the wording survives this case.
  const doneOnly = stateWith({ goals: [gGoal], projects: [pDone] });
  ok("78.57 a goal whose only project is completed has no active path",
    goalAlignmentFacts(doneOnly, gGoal).pathMissing);

  // ================================================= 78.58 Today ancestry ==

  ok("78.58 ancestry follows the project's goal",
    ancestryExplanation(world, aOpen) === "Supports Grow the business through Hire.",
    String(ancestryExplanation(world, aOpen)));
  ok("78.59 a direct goal link needs no project",
    ancestryExplanation(world, aDirect) === "Supports Grow the business.",
    String(ancestryExplanation(world, aDirect)));
  ok("78.60 an unlinked action gets NO line rather than an empty one",
    ancestryExplanation(world, action({ id: "L", title: "Loose" })) === undefined);
  // The goal was deleted; the project link is still real. Say only what holds.
  const orphan = stateWith({ goals: [], projects: [pActive], nextActions: [aOpen] });
  ok("78.61 a deleted goal leaves the project, not a fabricated goal",
    ancestryExplanation(orphan, aOpen) === "Part of Hire." && actionAncestry(orphan, aOpen).goal === undefined,
    String(ancestryExplanation(orphan, aOpen)));
  ok("78.62 no ancestry sentence mentions a horizon",
    !GOAL_HORIZONS.some((h) => (ancestryExplanation(world, aOpen) ?? "").toLowerCase().includes(h)));

  // ============================================ 78.63 honest progress ======

  const bare = goal({ id: "bare", title: "Nothing measured" });
  ok("78.63 a goal with no projects is NOT 0% — it is unmeasured",
    goalProgress(bare, []) === null, String(goalProgress(bare, [])));
  ok("78.64 …and a goal whose projects have no milestones is too",
    goalProgress(gGoal, [project({ id: "PX", title: "PX", goalId: "G" })]) === null,
    String(goalProgress(gGoal, [project({ id: "PX", title: "PX", goalId: "G" })])));
  ok("78.65 an explicitly completed goal is 100 — the user said so",
    goalProgress({ ...bare, status: "completed" }, []) === 100);
  ok("78.66 a manual override is honoured even with nothing else",
    goalProgress({ ...bare, manualProgress: 40 }, []) === 40);
  ok("78.67 a completed project makes it measurable again",
    goalProgress(gGoal, [pDone]) === 100, String(goalProgress(gGoal, [pDone])));
  // The half-fabricated mean: one finished project and one with nothing
  // recorded used to average to 50, and half of that number was invented.
  ok("78.67b one unmeasurable project makes the whole average unknowable",
    goalProgress(gGoal, [pDone, pActive]) === null, String(goalProgress(gGoal, [pDone, pActive])));
  ok("78.67c …and two measurable ones still average normally",
    goalProgress(gGoal, [pDone, { ...pDone, id: "P3", status: "active", milestones: [
      { id: "m1", title: "m1", status: "done", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: AT, updatedAt: AT },
      { id: "m2", title: "m2", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: AT, updatedAt: AT },
    ] }]) === 75, String(goalProgress(gGoal, [pDone, { ...pDone, id: "P3", status: "active", milestones: [
      { id: "m1", title: "m1", status: "done", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: AT, updatedAt: AT },
      { id: "m2", title: "m2", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: AT, updatedAt: AT },
    ] }])));
  ok("78.68 the summary line no longer says 0% complete",
    !goalSummary(stateWith({ goals: [bare] }), bare).includes("%"),
    goalSummary(stateWith({ goals: [bare] }), bare));

  // ================================================ 78.69 no scores at all =

  const surfaces = [
    goalSummary(world, gGoal),
    ancestryExplanation(world, aOpen) ?? "",
    ...GOAL_HORIZONS.map((h) => GOAL_HORIZON_LABEL[h]),
    ...goalHistory(h2).map((e) => describeGoalHistoryEvent(e)),
  ];
  const offending = surfaces.filter((s) => SCORE_WORDS.some((w) => s.toLowerCase().includes(w)));
  ok("78.69 no goal-direction surface contains a score word", offending.length === 0, offending.join(" | "));

  // ================================================ 78.70 the Today budget ==
  //
  // `goalsMissingPath` runs on every Today render. The first version answered
  // it through the full alignment facts, which walk every action in the store —
  // an O(goals x actions) scan for a question that depends only on projects.
  // This budget is what keeps that from creeping back in.
  {
    const big = stateWith({ goals: [], projects: [], nextActions: [] });
    for (let i = 0; i < 300; i++) big.goals.push(goal({ id: `bg${i}`, title: `G${i}` }));
    for (let i = 0; i < 600; i++) big.projects.push(project({ id: `bp${i}`, title: `P${i}`, goalId: `bg${i % 300}`, status: i % 3 === 0 ? "active" : "paused" }));
    for (let i = 0; i < 3000; i++) big.nextActions.push(action({ id: `ba${i}`, title: `A${i}`, projectId: `bp${i % 600}` }));

    const t0 = Date.now();
    const flagged = goalsMissingPath(big);
    const ms = Date.now() - t0;
    ok("78.70 goalsMissingPath over 300 goals / 600 projects / 3000 actions stays under budget",
      ms < 60, `${ms}ms for ${flagged.length} flagged`);
    ok("78.71 …and still answers correctly at that size", flagged.length === 200, String(flagged.length));

    // A 300-long replacement chain must not degrade into a re-walk per step.
    const chainState = stateWith({ goals: Array.from({ length: 300 }, (_, i) =>
      goal({ id: `c${i}`, title: `C${i}`, successorGoalId: i < 299 ? `c${i + 1}` : undefined })) });
    const t1 = Date.now();
    const line = goalLineage(chainState, "c150");
    const ms1 = Date.now() - t1;
    ok("78.72 a 300-long lineage resolves under budget", ms1 < 60, `${ms1}ms`);
    ok("78.73 …and returns the whole chain, once each", line.length === 300, String(line.length));
  }

  // =============================================== 78.74 Memory, grounded ==
  //
  // §18's seven questions, answered from stored fields. Before this sprint all
  // seven returned NO_RECORDED_EVIDENCE — honest, and useless.
  {
    const TODAY = "2026-09-15";
    const m = stateWith({
      goals: [
        goal({ id: "m1", title: "Finish the thesis", horizon: "now" }),
        goal({ id: "m2", title: "Be someone they trust", horizon: "life" }),
        goal({ id: "m3", title: "Learn to sail", status: "paused",
          history: [{ id: "e1", at: "2026-08-02T09:00:00.000Z", kind: "status", fromStatus: "active", toStatus: "paused" }] }),
        goal({ id: "m4", title: "Ship v1", status: "completed",
          history: [{ id: "e2", at: "2026-09-03T09:00:00.000Z", kind: "status", fromStatus: "active", toStatus: "completed" }] }),
        goal({ id: "m5", title: "Run a marathon", status: "replaced", successorGoalId: "m6",
          history: [{ id: "e3", at: "2026-09-04T09:00:00.000Z", kind: "replaced", fromStatus: "active", toStatus: "replaced", successorGoalId: "m6" }] }),
        goal({ id: "m6", title: "Move every day", horizon: "medium" }),
      ],
      projects: [project({ id: "mp1", title: "Chapter three", goalId: "m1" })],
      nextActions: [action({ id: "ma1", title: "Draft the intro", projectId: "mp1", status: "completed", completedAt: "2026-09-10T09:00:00.000Z" })],
    });
    const ask = (q: string) => answerMemoryQuery(m, q, { today: TODAY });

    ok("78.74 §18 'what am I working toward long term' is routed to GOALS",
      planMemoryQuery("What am I working toward long term?")?.kind === "GOALS",
      String(planMemoryQuery("What am I working toward long term?")?.kind));
    const direction = ask("What am I working toward long term?");
    ok("78.75 …and answers from horizon, naming the life goal",
      direction.items.some((i) => i.text === "Be someone they trust"), JSON.stringify(direction.items.map((i) => i.text)));
    ok("78.76 …and does NOT sweep in the near-term goal",
      !direction.items.some((i) => i.text === "Finish the thesis"), JSON.stringify(direction.items.map((i) => i.text)));

    const paused = ask("Which goals are paused?");
    ok("78.77 §18 paused goals are listed", paused.items.map((i) => i.text).join(",") === "Learn to sail", JSON.stringify(paused.items.map((i) => i.text)));
    ok("78.78 …dated from the TRANSITION, not from updatedAt",
      paused.items[0]?.day === "2026-08-02", String(paused.items[0]?.day));
    ok("78.79 …and the evidence names the history field",
      paused.items[0]?.evidence === "goal.history[].toStatus", String(paused.items[0]?.evidence));

    const achieved = ask("Which goals did I achieve?");
    ok("78.80 §18 achieved goals are listed", achieved.items.map((i) => i.text).join(",") === "Ship v1", JSON.stringify(achieved.items.map((i) => i.text)));
    const abandoned = ask("Which goals did I abandon?");
    ok("78.81 §18 …and nothing abandoned is REPORTED as nothing, not as silence",
      abandoned.status === "NO_RECORDED_EVIDENCE" && /No goal/.test(abandoned.summary ?? ""), String(abandoned.summary));
    ok("78.82 …and a replaced goal is NOT counted as abandoned",
      !abandoned.items.some((i) => i.text === "Run a marathon"));

    const replaced = ask("What replaced my old goal?");
    ok("78.83 §18 the replacement names the successor",
      replaced.items.some((i) => i.detail?.includes("Move every day")), JSON.stringify(replaced.items.map((i) => i.detail)));
    ok("78.84 §17 …and never prints the successor's id",
      !JSON.stringify(replaced.items).includes("\"m6\""), JSON.stringify(replaced.items.map((i) => i.detail)));

    // §17: the successor is gone. Say so; never print the id.
    const orphaned = stateWith({ goals: [goal({ id: "x1", title: "Old direction", status: "replaced", successorGoalId: "x-gone" })] });
    const orphanAns = answerMemoryQuery(orphaned, "What replaced my old goal?", { today: TODAY });
    ok("78.85 §17 a deleted successor is reported as deleted",
      orphanAns.items[0]?.detail?.includes("deleted") === true, String(orphanAns.items[0]?.detail));
    ok("78.86 §17 …and its id appears nowhere in the answer",
      !JSON.stringify(orphanAns).includes("x-gone"), JSON.stringify(orphanAns.items));

    const noPath = ask("Which active goals have no project path?");
    ok("78.87 §18 goals with no active project are listed",
      noPath.items.some((i) => i.text === "Be someone they trust"), JSON.stringify(noPath.items.map((i) => i.text)));
    ok("78.88 §15 …with the project-shaped limitation stated, not hidden",
      /linked projects only/.test(noPath.limitation ?? ""), String(noPath.limitation));

    // §19 — the exclusions, which are the point.
    const moved = ask("What goals moved forward this month?");
    ok("78.89 §19 a completed action under a goal IS progress",
      moved.items.some((i) => i.text === "Finish the thesis"), JSON.stringify(moved.items.map((i) => i.text)));
    ok("78.90 §19 …and the limitation names what does NOT count",
      /not progress/.test(moved.limitation ?? ""), String(moved.limitation));
    const edited = stateWith({
      goals: [goal({ id: "m1", title: "Edited only", horizon: "now", updatedAt: "2026-09-10T09:00:00.000Z",
        history: [
          { id: "h1", at: "2026-09-10T09:00:00.000Z", kind: "horizon", fromHorizon: "near", toHorizon: "now" },
          { id: "h2", at: "2026-09-11T09:00:00.000Z", kind: "target_date" },
        ] })],
    });
    const editedAns = answerMemoryQuery(edited, "What goals moved forward this month?", { today: TODAY });
    ok("78.91 §19 a horizon change is NOT progress",
      editedAns.items.length === 0 && editedAns.status === "NO_RECORDED_EVIDENCE", JSON.stringify(editedAns.items));
    ok("78.92 §19 …and neither is a target-date change on its own", editedAns.items.length === 0);

    // §11/§43 across every goal answer the sprint added.
    const allText = [direction, paused, achieved, abandoned, replaced, noPath, moved]
      .flatMap((a) => [a.heading, a.summary ?? "", a.limitation ?? "", ...a.items.map((i) => `${i.text} ${i.detail ?? ""}`)]);
    const bad = allText.filter((t) => /\b\d+%|\bscore\b|\bon track\b|\bbehind\b|\bmomentum\b/i.test(t));
    ok("78.93 §11 no goal answer carries a percentage or a verdict", bad.length === 0, bad.join(" | "));
  }

  return results;
}
