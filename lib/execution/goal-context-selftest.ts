/**
 * Goal context self-tests (LIFEOS-088).
 *
 * ## The red proofs this suite pins
 *
 * §2's audit opened a goal carrying an overdue action, a blocked action, two
 * waits, a triple deferral and a perfectly good next action:
 *
 *   1. six empty panels, four counts, and none of the commitments
 *   2. an active goal with two directly-linked actions was told "No active
 *      project is linked to this goal. Add a project" while the recommender
 *      was already naming its next step
 *   3. a project holding eleven actions was drawn at "0%", because
 *      `projectProgress` returns 0 for a project with nothing countable
 *   4. "What changed with Open the clinic?" reported the whole store — a
 *      completed action from a DIFFERENT goal was in the list
 *   5. searching a goal's exact title returned nothing, because "Open" was
 *      swallowed as a status filter
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A goal model earns trust by what it refuses to claim: that a completed
 * blocker still blocks, that a future follow-up is due, that a horizon change
 * is progress, that `updatedAt` is a lifecycle date, that a target date can be
 * inferred from a horizon, that the goal is "blocked" because one action is, or
 * that any of this is a percentage.
 *
 * Pure: no store, no clock, no AI.
 */

import type { Goal, NextAction, Project, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildIndex } from "@/lib/command/search";
import { answerMemoryQuery } from "@/lib/memory/answer";
import { buildExecutiveChanges } from "@/lib/memory/changes";
import { searchEverything } from "@/lib/search/everything";
import { resolveRange } from "@/lib/insights/range";
import { goalProgress, projectProgress, projectProgressMeasurable } from "@/lib/execution/progress";
import { goalPathMissing, goalPathState, goalsCarriedByActions, goalsWithoutAnyPath } from "@/lib/execution/alignment";
import {
  buildGoalContext, goalPeople, goalStrings,
  MAX_RECENT, MAX_SUPPORT, MAX_HISTORY, GOAL_HEADINGS, GOAL_FORBIDDEN_WORDS,
  NO_HORIZON, NO_TARGET, NO_PATH, PATH_VIA_ACTIONS, NOTHING_MOVED,
} from "@/lib/execution/goal-context";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-04";
const D = (o = 0): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const A = (o = 0, h = 9): string => `${D(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

type P<T> = Partial<T> & { id: string; title: string };
const act = (p: P<NextAction>): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: A(-20), updatedAt: A(-20), ...p,
} as NextAction);
const goal = (p: P<Goal>): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Goal);
const proj = (p: P<Project>): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Project);

/**
 * The audit's fixture: every trap it found, in one store.
 *
 *   g1  projects (active / completed / abandoned), a blocker, a blocker that is
 *       already COMPLETED, two waits, a triple deferral, a direct action, an
 *       action linked BOTH ways, a horizon change and a status change
 *   g2  active, no project, two directly-linked actions — §14's whole point
 *   g3  replaced, with a successor that still exists — §9
 */
function world(): StoreState {
  return {
    ...emptyStoreState(),
    goals: [
      goal({
        id: "g1", title: "Open the clinic", description: "A practice of my own by next spring.",
        horizon: "medium", targetDate: D(120), updatedAt: A(-1, 10),
        history: [
          { id: "h1", at: A(-60, 8), kind: "created" },
          { id: "h2", at: A(-30, 9), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
          { id: "h3", at: A(-3, 9), kind: "status", fromStatus: "paused", toStatus: "active" },
        ],
      }),
      goal({
        id: "g2", title: "Get properly fit", horizon: "long", updatedAt: A(-8, 9),
        history: [{ id: "h4", at: A(-60, 8), kind: "created" }],
      }),
      goal({
        // `updatedAt` is a DIFFERENT day from the replacement entry on purpose:
        // when the two coincide, an assertion that reads the history cannot be
        // told apart from one that reads `updatedAt` (§8).
        id: "g3", title: "Find a clinic to join", status: "replaced", successorGoalId: "g1",
        horizon: "near", updatedAt: A(-1, 9),
        history: [
          { id: "h5", at: A(-90, 8), kind: "created" },
          { id: "h6", at: A(-40, 9), kind: "replaced", fromStatus: "active", toStatus: "replaced", successorGoalId: "g1" },
        ],
      }),
    ],
    projects: [
      proj({ id: "pr1", title: "Clinic launch", goalId: "g1", description: "Priya is leading the fit-out.", updatedAt: A(0, 11) }),
      proj({ id: "pr2", title: "Premises search", goalId: "g1", status: "completed", updatedAt: A(-12, 9) }),
      proj({ id: "pr3", title: "Franchise route", goalId: "g1", status: "abandoned", updatedAt: A(-35, 9) }),
      proj({ id: "pr4", title: "Website refresh" }),
    ],
    nextActions: [
      act({ id: "a1", title: "Sign the lease", projectId: "pr1", status: "completed", completedAt: A(-2, 14),
        history: [{ id: "e1", action: "created", at: A(-20) }, { id: "e2", action: "completed", at: A(-2, 14) }] }),
      act({ id: "a2", title: "Pay the deposit", projectId: "pr1", dueDate: D(-1) }),
      act({ id: "a3", title: "Send final draft", projectId: "pr1" }),
      act({ id: "a4", title: "Need legal review", projectId: "pr1" }),
      // Blocked by a COMPLETED action — must never read as blocked.
      act({ id: "a5", title: "Order signage", projectId: "pr1" }),
      act({ id: "a6", title: "Confirm branding", projectId: "pr1", status: "completed", completedAt: A(-5, 10) }),
      act({ id: "a7", title: "Transcript from Maria", projectId: "pr1", status: "waiting", waitingOn: "Maria", waitingSince: D(-9), followUpDate: D(0) }),
      act({ id: "a8", title: "Signed form", projectId: "pr1", status: "waiting", waitingOn: "Jordan", waitingSince: D(-2), followUpDate: D(6) }),
      act({ id: "a9", title: "Email professor", projectId: "pr1",
        history: [{ id: "e5", action: "created", at: A(-20) },
          { id: "e6", action: "deferred", at: A(-3, 10), detail: D(-2) },
          { id: "e7", action: "deferred", at: A(-2, 10), detail: D(-1) },
          { id: "e8", action: "deferred", at: A(-1, 10), detail: D(2) }] }),
      act({ id: "a10", title: "Ask Marcus Webb for the survey", projectId: "pr1" }),
      act({ id: "a11", title: "Book the accountant", goalId: "g1" }),
      act({ id: "a12", title: "Book a gym induction", goalId: "g2" }),
      act({ id: "a13", title: "Buy running shoes", goalId: "g2", status: "completed", completedAt: A(-4, 9),
        history: [{ id: "e9", action: "created", at: A(-30) }, { id: "e10", action: "completed", at: A(-4, 9) }] }),
      // Reaches g1 BOTH directly and through pr1. One commitment.
      act({ id: "a14", title: "Confirm the fit-out date", projectId: "pr1", goalId: "g1" }),
      // Blocked by TWO actions, the completed one listed FIRST. The only shape
      // in which "is the blocker named a live one?" can be tested at all.
      act({ id: "a15", title: "Hand over the keys", projectId: "pr1" }),
      // Deferred twice and then completed, so it owns no live row and reaches
      // Recently with two same-kind events — the only shape in which the
      // per-record dedupe can be tested.
      act({ id: "a16", title: "Chase the surveyor", projectId: "pr1", status: "completed", completedAt: A(-1, 15),
        history: [{ id: "f1", action: "created", at: A(-20) },
          { id: "f2", action: "deferred", at: A(-3, 11), detail: D(-2) },
          { id: "f3", action: "deferred", at: A(-2, 11), detail: D(-1) },
          { id: "f4", action: "completed", at: A(-1, 15) }] }),
    ],
    actionDependencies: [
      { id: "d1", blockedId: "a3", blockerId: "a4", createdAt: A(-5) },
      { id: "d2", blockedId: "a5", blockerId: "a6", createdAt: A(-5) },
      { id: "d3", blockedId: "a15", blockerId: "a6", createdAt: A(-6) },
      { id: "d4", blockedId: "a15", blockerId: "a4", createdAt: A(-5) },
    ],
    constitutionElements: [{
      id: "s1", kind: "standard", status: "active",
      statement: "Never pay a deposit without reading the contract twice.",
      adoptedAt: A(-60), linkedRefs: [], createdAt: A(-60), updatedAt: A(-60),
    }],
  } as StoreState;
}

export function runGoalContextSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const ctx = (id = "g1", st: StoreState = s) =>
    buildGoalContext(st, id, buildTodayIndexes(st, TODAY, "09:00"), TODAY)!;
  const ask = (q: string, st: StoreState = s) =>
    answerMemoryQuery(st, q, { today: TODAY, searchIndex: buildIndex(st), todayIndexes: buildTodayIndexes(st, TODAY, "09:00") });
  const c = ctx();
  const g2 = ctx("g2");
  const g3 = ctx("g3");

  // ==========================================================================
  // §6, §7 — horizon and target, both read, neither derived.
  // ==========================================================================
  {
    ok("88.1 the horizon is the recorded one", c.horizon === "medium", String(c.horizon));
    ok("88.2 …shown by its own label, never inferred", c.horizonLabel === "Medium", c.horizonLabel);
    ok("88.3 the target date is the recorded one", c.targetDate === D(120), String(c.targetDate));
    // §7. The two are independent facts. A goal may carry either, both, or
    // neither, and one is never computed from the other.
    ok("88.4 a goal with a horizon and no target reports no target",
      g2.horizon === "long" && g2.targetDate === undefined, `${g2.horizon}/${g2.targetDate}`);
    const dated = { ...s, goals: [{ ...s.goals[0], horizon: undefined, targetDate: D(30) }] } as StoreState;
    const dc = ctx("g1", dated);
    ok("88.5 …and a goal with a target and no horizon does NOT gain one from the date",
      dc.horizon === undefined && dc.targetDate === D(30), `${dc.horizon}/${dc.targetDate}`);
    ok("88.6 …and says the horizon is unset rather than guessing",
      dc.horizonLabel === "No horizon set", dc.horizonLabel);
    ok("88.7 the unset-horizon wording names the limitation",
      /cannot say how far away/.test(NO_HORIZON), NO_HORIZON);
    ok("88.8 the no-target wording implies no obligation",
      NO_TARGET === "No target date set.", NO_TARGET);
    // A `life` goal MAY carry a date. Nothing rejects or flags that.
    const lifeDated = { ...s, goals: [{ ...s.goals[0], horizon: "life", targetDate: D(9) }] } as StoreState;
    const lc = ctx("g1", lifeDated);
    ok("88.9 a life-horizon goal keeps a near target date untouched",
      lc.horizon === "life" && lc.targetDate === D(9), `${lc.horizon}/${lc.targetDate}`);
  }

  // ==========================================================================
  // §11, §13, §14 — THE red. A goal carried by direct actions has a path.
  // ==========================================================================
  {
    ok("88.10 a goal with an active project has a path through it", c.path === "project", c.path);
    ok("88.11 …and says nothing about a missing path", c.pathNote === undefined, String(c.pathNote));

    // The measured red: g2 is active, has NO project, and has an open action
    // linked straight to it. The old product said "No active project is linked
    // to this goal. Add a project" while the recommender named its next step.
    ok("88.12 §14 a goal carried ONLY by directly-linked actions has a path",
      g2.path === "actions", g2.path);
    ok("88.13 …and it is described as carried, not as missing",
      g2.pathNote === PATH_VIA_ACTIONS, String(g2.pathNote));
    ok("88.14 …and the recommender really does name a next step for it",
      g2.next?.action.id === "a12", String(g2.next?.action.id));
    ok("88.15 …while the narrow project-only signal still answers its own question",
      goalPathMissing(s, s.goals[1]) === true);
    ok("88.16 …and its sentence claims only that, so it stays true",
      goalsCarriedByActions(s).map((g) => g.id).join() === "g2", goalsCarriedByActions(s).map((g) => g.id).join());

    // Genuinely nothing carrying it.
    const bare = { ...s, goals: [goal({ id: "gz", title: "Learn the cello" })], projects: [], nextActions: [] } as StoreState;
    const bc = ctx("gz", bare);
    ok("88.17 a goal with no project and no direct action has no path", bc.path === "none", bc.path);
    ok("88.18 …and the sentence names BOTH checks it made", bc.pathNote === NO_PATH, String(bc.pathNote));
    ok("88.19 …and never says 'no path forward'", !/no path forward/i.test(NO_PATH), NO_PATH);
    ok("88.20 §13 the words are the two facts, not a verdict",
      NO_PATH === "No active project, and no action linked directly to this goal.", NO_PATH);
    ok("88.21 goalsWithoutAnyPath finds it and not g2",
      goalsWithoutAnyPath(bare).map((g) => g.id).join() === "gz", goalsWithoutAnyPath(bare).map((g) => g.id).join());

    // A paused goal has no active project BY the user's decision.
    const paused = { ...s, goals: [{ ...s.goals[1], status: "paused" }] } as StoreState;
    ok("88.22 a paused goal is never flagged for a missing path",
      ctx("g2", paused).pathNote === undefined, String(ctx("g2", paused).pathNote));
    ok("88.23 …and neither is a replaced one", g3.pathNote === undefined, String(g3.pathNote));
    ok("88.24 …though the derivation itself stays factual about it", g3.path === "none", g3.path);

    // An action reached only through a PAUSED project is that project's state,
    // not a path invented on the goal's behalf.
    const viaPaused = {
      ...s,
      goals: [goal({ id: "gp", title: "Ship the book" })],
      projects: [proj({ id: "pp", title: "Draft", goalId: "gp", status: "paused" })],
      nextActions: [act({ id: "pa", title: "Write chapter 2", projectId: "pp" })],
    } as StoreState;
    const finished = {
      ...s,
      goals: [goal({ id: "gf", title: "Learn Portuguese" })],
      projects: [],
      nextActions: [act({ id: "fa", title: "Buy the textbook", goalId: "gf", status: "completed", completedAt: A(-3) })],
    } as StoreState;
    ok("88.25a a goal whose only direct action is FINISHED has no path",
      goalPathState(finished, finished.goals[0]) === "none",
      goalPathState(finished, finished.goals[0]));

    ok("88.25 an open action under a PAUSED project does not invent a path",
      goalPathState(viaPaused, viaPaused.goals[0]) === "none",
      goalPathState(viaPaused, viaPaused.goals[0]));
  }

  // ==========================================================================
  // §38, §39 — no fabricated percentage anywhere.
  // ==========================================================================
  {
    const pr1 = c.projects.find((p) => p.project.id === "pr1")!;
    ok("88.26 §38 a project with nothing countable shows NO percentage",
      pr1.percent === undefined, String(pr1.percent));
    ok("88.27 …and the old page really did print 0 for it",
      projectProgress(s.projects[0]) === 0 && !projectProgressMeasurable(s.projects[0]));
    ok("88.28 …while it carries real work the counts CAN state",
      pr1.open + pr1.waiting + pr1.blocked + pr1.completed > 0,
      `${pr1.open}/${pr1.waiting}/${pr1.blocked}/${pr1.completed}`);
    const pr2 = c.projects.find((p) => p.project.id === "pr2")!;
    ok("88.29 …and a completed project keeps the percentage it has earned",
      pr2.percent === 100, String(pr2.percent));
    ok("88.30 §39 goalProgress stays null rather than fabricating",
      goalProgress(s.goals[0], s.projects) === null, String(goalProgress(s.goals[0], s.projects)));
    ok("88.31 §39 …and the command view never carries a goal percentage at all",
      !("progress" in (c as unknown as Record<string, unknown>)));
    const nums = JSON.stringify(goalStrings(c));
    ok("88.32 no rendered string of this layer contains a percent sign",
      !nums.includes("%"), nums.slice(0, 200));
  }

  // ==========================================================================
  // §15 — one recommender, scoped by state, indexed by the whole store.
  // ==========================================================================
  {
    ok("88.33 the recommendation is the goal's own overdue action",
      c.next?.action.id === "a2", String(c.next?.action.id));
    ok("88.34 …and carries the recommender's reasons verbatim",
      (c.next?.reasons.length ?? 0) > 0, JSON.stringify(c.next?.reasons.map((r) => r.text)));
    // The blocked action must not be recommended even though its blocker is in
    // the same goal — and, more importantly, a blocker OUTSIDE the goal must
    // still block, which is why the FULL index is passed.
    const outside = {
      ...s,
      actionDependencies: [{ id: "dx", blockedId: "a11", blockerId: "zz", createdAt: A(-5) }],
      nextActions: [...s.nextActions, act({ id: "zz", title: "Unrelated blocker" })],
    } as StoreState;
    const oc = ctx("g1", outside);
    ok("88.35 an action blocked from OUTSIDE the goal is still blocked",
      oc.blocked.some((r) => r.action.id === "a11"), oc.blocked.map((r) => r.action.id).join());
    ok("88.36 …and is never offered as the next action",
      oc.next?.action.id !== "a11", String(oc.next?.action.id));
    const none = ctx("g3");
    ok("88.37 no candidates gives the recommender's own note, not a scolding",
      !!none.nextNote && !/should|stalled|behind/i.test(none.nextNote), String(none.nextNote));
  }

  // ==========================================================================
  // §20, §21, §22 — stuck and waiting, and what must NOT be claimed.
  // ==========================================================================
  {
    ok("88.38 §22 the genuinely blocked actions are listed, and only those",
      c.blocked.map((r) => r.action.id).sort().join() === "a15,a3",
      c.blocked.map((r) => r.action.id).join());
    ok("88.39 §22 an action whose blocker is COMPLETED is not blocked",
      !c.blocked.some((r) => r.action.id === "a5"));
    ok("88.40 …and it appears as ordinary support instead",
      c.support.some((r) => r.action.id === "a5"), c.support.map((r) => r.action.id).join());
    ok("88.41 the blocker NAMED is the unfinished one",
      c.blocked.find((r) => r.action.id === "a3")?.blockedBy?.id === "a4",
      String(c.blocked.find((r) => r.action.id === "a3")?.blockedBy?.id));
    // Two blockers, the COMPLETED one recorded first. Naming whichever comes
    // first would put a finished action on screen as the thing holding this up.
    const twoBlockers = c.blocked.find((r) => r.action.id === "a15");
    ok("88.41a an action with a completed AND a live blocker is blocked",
      !!twoBlockers, c.blocked.map((r) => r.action.id).join());
    ok("88.41b …and the LIVE blocker is the one named, not the first recorded",
      twoBlockers?.blockedBy?.id === "a4", String(twoBlockers?.blockedBy?.id));

    // Read defensively: an assertion that THROWS when the product breaks is
    // not a proof — the mutation harness cannot tell a crash from a pass.
    const due = c.waiting.find((r) => r.action.id === "a7");
    const future = c.waiting.find((r) => r.action.id === "a8");
    ok("88.42 §21 a follow-up dated today has arrived", due?.followUpDue === true, String(due?.followUpDue));
    ok("88.43 §21 a follow-up six days out has NOT", future?.followUpDue === false, String(future?.followUpDate));
    ok("88.44 §21 waiting rows carry the recorded person, verbatim",
      due?.waitingOn === "Maria" && future?.waitingOn === "Jordan", `${due?.waitingOn}/${future?.waitingOn}`);
    ok("88.45 §21 …and the date the wait started, from waitingSince",
      due?.since === D(-9), String(due?.since));
    ok("88.46 §21 nothing says a wait has gone on too long",
      !/too long|overdue|chase|nag/i.test(JSON.stringify(goalStrings(c))));

    // §20. The goal is not "blocked" because ONE action is: other executable
    // work remains, and the model has no goal-level blocked claim at all.
    ok("88.47 §20 the goal is never reported as blocked",
      !("blockedGoal" in (c as unknown as Record<string, unknown>))
      && c.blocked.length > 0 && !!c.next,
      `${c.blocked.length} blocked, next=${c.next?.action.id}`);
    ok("88.48 §20 …and executable work really does remain alongside the blocker",
      c.support.length > 0, String(c.support.length));
  }

  // ==========================================================================
  // §19, §34 — one action, one row.
  // ==========================================================================
  {
    const ids = [
      ...(c.next ? [c.next.action.id] : []),
      ...c.support.map((r) => r.action.id),
      ...c.blocked.map((r) => r.action.id),
      ...c.waiting.map((r) => r.action.id),
    ];
    ok("88.49 §34 no action occupies two rows", new Set(ids).size === ids.length, ids.join());
    ok("88.50 §34 the recommendation is not repeated under support",
      !c.support.some((r) => r.action.id === c.next?.action.id));
    ok("88.51 §34 a waiting action is not also an open row",
      !c.support.some((r) => r.action.status === "waiting"));

    // The action reaching the goal BOTH ways is one commitment.
    ok("88.52 an action linked to both the goal and its project appears once",
      ids.filter((i) => i === "a14").length === 1, ids.join());
    ok("88.53 …and its direct link is the one reported",
      c.support.find((r) => r.action.id === "a14")?.via === "direct");
    ok("88.54 …while a project-only action reports the project",
      (c.support.find((r) => r.action.id === "a10")?.via as { project: Project })?.project.id === "pr1");

    // §19. The deferral count ATTACHES; it is never a section.
    const deferred = c.support.find((r) => r.action.id === "a9")!;
    ok("88.55 §19 repeated deferral attaches to the row it is about",
      /deferred this 3 times/i.test(deferred.deferral ?? ""), String(deferred.deferral));
    ok("88.56 §19 …with no shame language anywhere",
      !/again|still|keep|finally|procrastin/i.test(JSON.stringify(goalStrings(c))));
    ok("88.57 §19 …and it does not become a row of its own",
      c.support.filter((r) => r.action.id === "a9").length === 1);

    // A row that already shows a fact does not also carry a signal restating it.
    ok("88.58 the row's own follow-up is not repeated as an attention line",
      !/follow.?up/i.test(c.waiting.map((r) => r.attention ?? "").join(" ")),
      c.waiting.map((r) => r.attention).join(" | "));
  }

  // ==========================================================================
  // §16, §17, §18 — what moved, and what merely changed.
  // ==========================================================================
  {
    ok("88.59 §18 the default window is the last seven days",
      c.range.label === resolveRange("last_7_days", { today: TODAY }).label, c.range.label);
    ok("88.60 §16 a completed linked action is movement",
      c.movement.some((m) => m.entity.id === "a1"), c.movement.map((m) => m.entity.id).join());
    ok("88.61 §16 …and work under a DIFFERENT goal is not",
      !c.movement.some((m) => m.entity.id === "a13"), c.movement.map((m) => m.entity.id).join());
    ok("88.62 §17 the goal's status change is direction, never movement",
      c.direction.some((d) => d.kind === "goal_status_changed")
      && !c.movement.some((m) => m.kind === "goal_status_changed"),
      `${c.direction.map((d) => d.kind).join()} / ${c.movement.map((m) => m.kind).join()}`);
    ok("88.63 §16 a horizon change is not counted as progress",
      !c.movement.some((m) => m.kind === "goal_horizon_changed"));
    ok("88.64 §34 an action that owns a live row is not repeated under Recently",
      !c.movement.some((m) => m.entity.id === "a9"), c.movement.map((m) => m.entity.id).join());
    ok("88.65 …but a completed action, which owns no row, still appears",
      c.movement.some((m) => m.entity.id === "a1"));

    // One EVENT per row would have put the triple deferral on screen three
    // times. Dedupe per (kind, record) is what stops it.
    const keys = c.movement.map((m) => `${m.kind}:${m.entity.id}`);
    ok("88.66 §34 Recently holds one row per record and kind",
      new Set(keys).size === keys.length, keys.join());
    // a16 was deferred TWICE and then completed, so it owns no live row and
    // really does reach Recently with two same-kind events. Without the dedupe
    // it is two identical "Deferred Chase the surveyor" rows.
    ok("88.66a the fixture really does produce a repeated kind for one record",
      buildExecutiveChanges(s, resolveRange("last_7_days", { today: TODAY }))
        .filter((x) => x.entity.id === "a16" && x.kind === "deferred").length === 2);
    ok("88.66b …and Recently collapses them to one",
      c.movement.filter((m) => m.entity.id === "a16" && m.kind === "deferred").length === 1,
      c.movement.filter((m) => m.entity.id === "a16").map((m) => m.kind).join());
    ok("88.67 §18 …and is capped", c.movement.length <= MAX_RECENT, String(c.movement.length));

    // §29. The empty case is scoped to what was actually checked.
    const quiet = ctx("g3");
    ok("88.68 §29 nothing-moved names the window and the link, not 'no progress'",
      /No linked action or project completed in /.test(NOTHING_MOVED(quiet.range.label))
      && !/no progress/i.test(NOTHING_MOVED(quiet.range.label)), NOTHING_MOVED(quiet.range.label));

    // The COUNT is over the window, never over the capped display list.
    const busy = {
      ...s,
      nextActions: [
        ...s.nextActions,
        ...Array.from({ length: 8 }, (_, i) => act({
          id: `bulk${i}`, title: `Bulk ${i}`, projectId: "pr1", status: "completed",
          completedAt: A(-1, 8 + i),
          history: [{ id: `bh${i}`, action: "completed", at: A(-1, 8 + i) }],
        })),
      ],
    } as StoreState;
    const bc = ctx("g1", busy);
    ok("88.69 the completed count exceeds the display cap rather than matching it",
      bc.counts.completedRecently > MAX_RECENT && bc.movement.length === MAX_RECENT,
      `${bc.counts.completedRecently} counted, ${bc.movement.length} shown`);
  }

  // ==========================================================================
  // §8, §9 — lifecycle from history, never from updatedAt.
  // ==========================================================================
  {
    ok("88.70 §8 the history is the goal's own recorded transitions",
      c.history.length === 3, String(c.history.length));
    ok("88.71 §8 newest first", c.history[0]?.day === D(-3), String(c.history[0]?.day));
    ok("88.72 §8 …dated from the entry, never from updatedAt",
      c.history.every((h) => h.day !== s.goals[0].updatedAt.slice(0, 10)),
      `${c.history.map((h) => h.day).join()} vs ${s.goals[0].updatedAt.slice(0, 10)}`);
    ok("88.73 §8 the status transition states both ends",
      c.history.some((h) => /Paused → Active/.test(h.text)), c.history.map((h) => h.text).join(" | "));
    // A fixture that never exceeds a cap cannot test the cap.
    const longHistory = {
      ...s,
      goals: [{
        ...s.goals[0],
        history: Array.from({ length: 9 }, (_, i) => ({
          id: `lh${i}`, at: A(-9 + i, 9), kind: "horizon" as const,
          fromHorizon: "near" as const, toHorizon: "medium" as const,
        })),
      }],
    } as StoreState;
    const lh = ctx("g1", longHistory);
    ok("88.74 §8 nine recorded transitions are capped to six",
      lh.history.length === MAX_HISTORY, String(lh.history.length));
    ok("88.74a §8 …and the six kept are the most recent",
      lh.history[0]?.day === D(-1), String(lh.history[0]?.day));
    const noHistory = { ...s, goals: [{ ...s.goals[0], history: [] }] } as StoreState;
    ok("88.75 §8 a goal with no history reports none rather than dating updatedAt",
      ctx("g1", noHistory).history.length === 0);

    ok("88.76 §9 the successor is named from the record", g3.successor?.id === "g1", String(g3.successor?.id));
    ok("88.77 §9 …dated from the history entry", g3.replacedOn === D(-40), String(g3.replacedOn));
    ok("88.77a §9 …which is NOT the day updatedAt would have given",
      g3.replacedOn !== s.goals[2].updatedAt.slice(0, 10),
      `${g3.replacedOn} vs ${s.goals[2].updatedAt.slice(0, 10)}`);
    ok("88.78 §9 …and the lineage runs oldest first",
      g3.lineage.map((g) => g.id).join(">") === "g3>g1", g3.lineage.map((g) => g.id).join(">"));
    const orphan = { ...s, goals: [goal({ id: "go", title: "Old direction", status: "replaced", successorGoalId: "gone" })] } as StoreState;
    const oc = ctx("go", orphan);
    ok("88.79 §9 a deleted successor is reported as deleted", oc.successorMissing === true);
    ok("88.80 §9 …and no id is printed anywhere in this layer",
      !JSON.stringify(goalStrings(oc)).includes("gone"), JSON.stringify(goalStrings(oc)));
    ok("88.81 §9 a goal that was never replaced claims nothing",
      c.successorMissing === false && c.replacedOn === undefined);
  }

  // ==========================================================================
  // §23, §24 — people and rules, conservative.
  // ==========================================================================
  {
    const names = c.people.map((p) => p.name);
    ok("88.82 §23 people the records actually name are found",
      names.includes("Maria") && names.includes("Jordan") && names.includes("Marcus"), names.join());
    ok("88.83 §23 a surname fragment is not a separate person",
      !names.includes("Webb"), names.join());
    ok("88.84 §23 …and a sentence-initial capital is not a name",
      !names.includes("Ask") && !names.includes("Send") && !names.includes("Book"), names.join());
    const marcus = c.people.find((p) => p.name === "Marcus")!;
    ok("88.85 §23 Marcus and Marcus Webb remain distinct references",
      marcus.longerForms.includes("Marcus Webb"), JSON.stringify(marcus.longerForms));
    ok("88.86 §23 …and they are never merged into one entry",
      !names.includes("Marcus Webb"), names.join());
    ok("88.87 §23 a wait is the stronger grounding and wins the label",
      c.people.find((p) => p.name === "Maria")?.grounding === "waiting");
    ok("88.88 §23 goalPeople is bounded", goalPeople(s, s.goals[0], []).length === 0);

    ok("88.89 §24 a rule grounded in an item's own words reaches the page",
      c.rules.some((r) => /reading the contract twice/.test(r)), JSON.stringify(c.rules));
    ok("88.90 §24 …and a goal whose work names nothing gets no Rules wallpaper",
      g2.rules.length === 0, JSON.stringify(g2.rules));
  }

  // ==========================================================================
  // §5, §28 — the words, and the section count.
  // ==========================================================================
  {
    ok("88.91 §28 there are exactly five primary sections",
      Object.keys(GOAL_HEADINGS).length === 5, Object.keys(GOAL_HEADINGS).join());
    const surfaces = [...goalStrings(c), ...goalStrings(g2), ...goalStrings(g3)].map((x) => x.toLowerCase());
    const bad = GOAL_FORBIDDEN_WORDS.filter((w) => surfaces.some((x) => x.includes(w)));
    ok("88.92 §5, §38 no forbidden word appears on any goal surface", bad.length === 0, bad.join(" | "));
    ok("88.93 §5 nothing here writes a mission statement",
      !surfaces.some((x) => /you are the kind of person|your purpose is|this goal means/.test(x)));
    ok("88.94 the support list is capped", c.support.length <= MAX_SUPPORT, String(c.support.length));
  }

  // ==========================================================================
  // §25, §26 — Memory and Search reach the same facts.
  // ==========================================================================
  {
    // RED 4. A goal scope means the goal's WORK, not only its own history.
    const range = resolveRange("last_7_days", { today: TODAY });
    const scoped = buildExecutiveChanges(s, range, { entity: { kind: "goal", id: "g1" } });
    ok("88.95 §26 a goal-scoped change list includes work under the goal",
      scoped.some((x) => x.entity.id === "a1"), scoped.map((x) => x.entity.id).join());
    ok("88.96 §26 …and excludes work under a different goal",
      !scoped.some((x) => x.entity.id === "a13"), scoped.map((x) => x.entity.id).join());
    ok("88.97 §26 …while keeping the goal's own history",
      scoped.some((x) => x.entity.kind === "goal" && x.entity.id === "g1"));

    const changed = ask("What changed with Open the clinic?");
    ok("88.98 §26 the question resolves to the goal despite the stripped article",
      /Open the clinic/.test(changed.heading), changed.heading);
    ok("88.99 §26 …and no longer reports another goal's work",
      !(changed.items ?? []).some((i) => i.text === "Buy running shoes"),
      JSON.stringify((changed.items ?? []).map((i) => i.text)));

    // §14 through Memory.
    const path = ask("Which active goals have no project path?");
    ok("88.100 §25 a goal carried by directly-linked actions is not listed as pathless",
      !(path.items ?? []).some((i) => i.text === "Get properly fit"),
      JSON.stringify((path.items ?? []).map((i) => i.text)));
    ok("88.101 §25 …and is named as carried instead of silently dropped",
      /carried by actions linked directly/.test(path.limitation ?? ""), String(path.limitation));

    // RED 5. A filter must not swallow a record's own title.
    const found = searchEverything(s, "Open the clinic", { today: TODAY });
    ok("88.102 §25 a goal is findable by its exact title",
      found.results.some((r) => r.entityId === "g1" && r.entityType === "goal"),
      `${found.total} results`);
    ok("88.103 §25 …as an exact title match, not buried",
      found.results[0]?.matchReason === "Exact title match", String(found.results[0]?.matchReason));
    ok("88.104 §25 …and the filter it did not apply is not reported as applied",
      found.filters.status === undefined, JSON.stringify(found.filters));
    // The retry is narrow: a query where the filter DOES work is untouched.
    const stillFiltered = searchEverything(s, "open actions", { today: TODAY });
    ok("88.105 §25 a query whose filter finds something keeps the filter",
      stillFiltered.filters.status === "open", JSON.stringify(stillFiltered.filters));
  }

  // ==========================================================================
  // §45 — the shape holds at size.
  // ==========================================================================
  {
    const big = {
      ...emptyStoreState(),
      goals: Array.from({ length: 100 }, (_, i) => goal({ id: `bg${i}`, title: `Goal ${i}` })),
      projects: Array.from({ length: 300 }, (_, i) => proj({ id: `bp${i}`, title: `P${i}`, goalId: `bg${i % 100}` })),
      nextActions: Array.from({ length: 5000 }, (_, i) => act({ id: `ba${i}`, title: `A${i}`, projectId: `bp${i % 300}` })),
    } as StoreState;
    const bix = buildTodayIndexes(big, TODAY, "09:00");
    const t = Date.now();
    for (let i = 0; i < 5; i++) buildGoalContext(big, `bg${i}`, bix, TODAY);
    const ms = Date.now() - t;
    ok("88.106 five goal contexts over 5,000 actions under 3000ms", ms < 3000, `${ms}ms`);
    ok("88.107 …and the big fixture really has work in it",
      (buildGoalContext(big, "bg0", bix, TODAY)?.counts.open ?? 0) > 0);
    ok("88.108 …and the support list stays capped at that size",
      (buildGoalContext(big, "bg0", bix, TODAY)?.support.length ?? 99) <= MAX_SUPPORT);
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - t0,
    results,
  };
}
