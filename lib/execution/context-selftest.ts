/**
 * Project context self-tests (LIFEOS-087).
 *
 * ## The red proofs this suite pins
 *
 * §2's audit opened a project holding eleven actions, an overdue item, a
 * blocker, two waits and an action deferred three times:
 *
 *   1. every panel was empty — progress 0, milestones 0, reading 0, no sessions
 *   2. "What changed with Clinic launch?" reported nothing changed, because a
 *      Project has no history and the scope matched only the project record
 *   3. "What am I waiting on for Clinic launch?" answered "No action is marked
 *      as waiting on clinic launch" while the project held two waits — a
 *      regression LIFEOS-086 introduced
 *   4. "What is blocked on X?" routed to WAITING, conflating a dependency with
 *      a `waitingOn`
 *   5. "Who is involved?" and "What keeps getting deferred?" did not route
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A project model earns trust by what it refuses to claim: that a completed
 * blocker still blocks, that a future follow-up is due, that a goal-horizon
 * edit is project progress, that `updatedAt` is a lifecycle event, that two
 * similar names are one person, or that any of this is a health score.
 *
 * Pure: no store, no clock, no AI.
 */

import type { Goal, NextAction, Project, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildIndex } from "@/lib/command/search";
import { planMemoryQuery } from "@/lib/memory/query";
import { answerMemoryQuery } from "@/lib/memory/answer";
import { buildExecutiveChanges } from "@/lib/memory/changes";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { resolveRange } from "@/lib/insights/range";
import {
  buildProjectContext, projectPeople, projectStrings,
  MAX_RECENT, MAX_OPEN, PROJECT_HEADINGS, PROJECT_FORBIDDEN_WORDS,
  HISTORY_LIMITATION, NO_GOAL_LINKED, NO_OPEN_ACTIONS, NOTHING_COMPLETED,
} from "@/lib/execution/context";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-04";
const D = (o = 0): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const A = (o = 0, h = 9): string => `${D(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: A(-20), updatedAt: A(-20), ...p,
} as NextAction);
const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Goal);
const proj = (p: Partial<Project> & { id: string; title: string }): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Project);

/** The audit's fixture: every trap it found, in one store. */
function world(): StoreState {
  return {
    ...emptyStoreState(),
    goals: [goal({
      id: "g1", title: "Open the clinic", horizon: "medium",
      history: [{ id: "h1", at: A(-60, 8), kind: "created" },
        { id: "h2", at: A(-2, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" }],
    } as Partial<Goal> & { id: string; title: string })],
    projects: [
      // `updatedAt` is TODAY — the only date a Project carries, and never a
      // lifecycle event (§27).
      proj({ id: "pr1", title: "Clinic launch", goalId: "g1", description: "Priya is leading the fit-out.", updatedAt: A(0, 11) } as Partial<Project> & { id: string; title: string }),
      proj({ id: "pr2", title: "Website refresh" }),
    ],
    nextActions: [
      act({ id: "a1", title: "Sign the lease", projectId: "pr1", status: "completed", completedAt: A(-2, 14),
        history: [{ id: "e1", action: "created", at: A(-20) }, { id: "e2", action: "completed", at: A(-2, 14) }] } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a2", title: "Pay the deposit", projectId: "pr1", dueDate: D(-1) } as Partial<NextAction> & { id: string; title: string }),
      // A SECOND overdue action. Only one can be the recommendation, so the
      // other is an open row carrying both a due date and an overdue signal —
      // the only shape in which "does the row already say this?" can be tested.
      act({ id: "a15", title: "Return the keys", projectId: "pr1", dueDate: D(-2) } as Partial<NextAction> & { id: string; title: string }),
      // Blocked by an UNFINISHED blocker.
      act({ id: "a3", title: "Send final draft", projectId: "pr1" }),
      act({ id: "a4", title: "Need legal review", projectId: "pr1" }),
      // Blocked by a COMPLETED blocker — must never read as blocked.
      act({ id: "a5", title: "Order signage", projectId: "pr1" }),
      // Blocked by TWO blockers, one completed and one live. Without this the
      // "name the UNFINISHED blocker" logic is unreachable: every other blocked
      // row has exactly one blocker, so any choice picks the same record.
      act({ id: "a13", title: "Install the sign", projectId: "pr1" }),
      act({ id: "a6", title: "Confirm branding", projectId: "pr1", status: "completed", completedAt: A(-5, 10) } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a7", title: "Transcript from Maria", projectId: "pr1", status: "waiting", waitingOn: "Maria", waitingSince: D(-9), followUpDate: D(0) } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a8", title: "Signed form", projectId: "pr1", status: "waiting", waitingOn: "Jordan", waitingSince: D(-2), followUpDate: D(6) } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a9", title: "Email professor", projectId: "pr1",
        history: [{ id: "e5", action: "created", at: A(-20) },
          { id: "e6", action: "deferred", at: A(-3, 10), detail: D(-2) },
          { id: "e7", action: "deferred", at: A(-2, 10), detail: D(-1) },
          { id: "e8", action: "deferred", at: A(-1, 10), detail: D(2) }] } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a10", title: "Ask Marcus Webb for the survey", projectId: "pr1" }),
      act({ id: "a11", title: "Reply to Marcus", projectId: "pr1" }),
      // Deferred twice and THEN completed. It owns no current row, so it
      // reaches Recently — which is where the one-row-per-record rule has to
      // hold, since a row-owning action is excluded from Recently entirely.
      act({ id: "a14", title: "Chase the surveyor", projectId: "pr1", status: "completed", completedAt: A(-1, 16),
        history: [{ id: "c1", action: "created", at: A(-20) },
          { id: "c2", action: "deferred", at: A(-4, 9), detail: D(-3) },
          { id: "c3", action: "deferred", at: A(-3, 9), detail: D(-2) },
          { id: "c4", action: "completed", at: A(-1, 16) }] } as Partial<NextAction> & { id: string; title: string }),
      // Outside the project entirely — and ALSO repeatedly deferred, so a
      // project-scoped deferral question differs from an unscoped one. With
      // only one such action store-wide, scoping could not be tested.
      act({ id: "a12", title: "Water the plants",
        history: [{ id: "w1", action: "created", at: A(-20) },
          { id: "w2", action: "deferred", at: A(-3, 9), detail: D(-2) },
          { id: "w3", action: "deferred", at: A(-2, 9), detail: D(-1) },
          { id: "w4", action: "deferred", at: A(-1, 9), detail: D(2) }] } as Partial<NextAction> & { id: string; title: string }),
    ],
    actionDependencies: [
      { id: "d1", blockedId: "a3", blockerId: "a4", createdAt: A(-5) },
      { id: "d2", blockedId: "a5", blockerId: "a6", createdAt: A(-5) },
      { id: "d3", blockedId: "a13", blockerId: "a6", createdAt: A(-5) },   // completed
      { id: "d4", blockedId: "a13", blockerId: "a4", createdAt: A(-5) },   // live
    ] as StoreState["actionDependencies"],
    constitutionElements: [{
      id: "s1", kind: "standard", status: "active",
      statement: "Never reply to Marcus while angry.",
      adoptedAt: A(-60), linkedRefs: [], createdAt: A(-60), updatedAt: A(-60),
    }] as StoreState["constitutionElements"],
  };
}

export function runProjectContextSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const ix = buildTodayIndexes(s, TODAY, "09:00");
  const ctx = (id = "pr1", st: StoreState = s) =>
    buildProjectContext(st, id, buildTodayIndexes(st, TODAY, "09:00"), TODAY)!;
  const ask = (q: string) => answerMemoryQuery(s, q, { today: TODAY, searchIndex: buildIndex(s), todayIndexes: ix });
  const plan = (q: string) => planMemoryQuery(q, { today: TODAY, projects: (s.projects ?? []).map((p) => ({ id: p.id, title: p.title })) });
  const c = ctx();

  // ==========================================================================
  // §5, §6 — purpose and ancestry, from the recorded link only.
  // ==========================================================================
  {
    ok("87.1 the linked Goal resolves", c.goal?.id === "g1", `${c.goal?.id}`);
    ok("87.2 …from goalId, not from a similar-looking title", c.project.goalId === "g1");
    const orphan = ctx("pr2");
    ok("87.3 a project with no goalId reports none", orphan.goal === undefined);
    ok("87.4 …and says so factually", NO_GOAL_LINKED === "No Goal linked.");
    // A goal whose title resembles the project must NOT be adopted.
    const tempting = {
      ...s,
      goals: [...(s.goals ?? []), goal({ id: "g2", title: "Website refresh goals" } as Partial<Goal> & { id: string; title: string })],
    } as StoreState;
    ok("87.5 a lexically similar Goal is never inferred", ctx("pr2", tempting).goal === undefined);
  }

  // ==========================================================================
  // §8 — one recommendation, from the existing recommender.
  // ==========================================================================
  {
    ok("87.6 a next action is recommended", !!c.next, `${c.nextNote}`);
    ok("87.7 …from this project", c.next?.action.projectId === "pr1");
    // TWO actions are overdue; the recommender picks the one that has been
    // overdue longer, and this asserts that rather than a fixture accident.
    ok("87.8 …and it is the action overdue longest", c.next?.action.id === "a15", c.next?.action.title);
    ok("87.9 …explaining itself in the recommender's own words",
      (c.next?.reasons ?? []).length > 0, JSON.stringify(c.next?.reasons.map((r) => r.text)));
    // An empty project says so instead of recommending nothing-in-particular.
    ok("87.10 a project with no actions has no recommendation", !ctx("pr2").next);
    ok("87.11 …and is marked empty", ctx("pr2").empty === true);
    // §8's reuse, asserted structurally: a blocker OUTSIDE the project must
    // still block, which is why the FULL index is passed with narrowed state.
    const cross = {
      ...s,
      actionDependencies: [...(s.actionDependencies ?? []), { id: "d3", blockedId: "a2", blockerId: "a12", createdAt: A(-5) }],
    } as StoreState;
    ok("87.12 a blocker outside the project still blocks",
      ctx("pr1", cross).next?.action.id !== "a2",
      `${ctx("pr1", cross).next?.action.title}`);
  }

  // ==========================================================================
  // §10 — real blocker evidence only.
  // ==========================================================================
  {
    ok("87.13 an action behind an unfinished blocker is blocked",
      c.blocked.some((r) => r.action.id === "a3"), JSON.stringify(c.blocked.map((r) => r.action.title)));
    ok("87.14 …and the blocker is named", c.blocked.find((r) => r.action.id === "a3")?.blockedBy?.id === "a4");
    // The centre of §10.
    ok("87.15 an action whose blocker is COMPLETED is not blocked",
      !c.blocked.some((r) => r.action.id === "a5"), JSON.stringify(c.blocked.map((r) => r.action.id)));
    // The row with two blockers must name the LIVE one.
    const two = c.blocked.find((r) => r.action.id === "a13");
    ok("87.16 a row with two blockers names the UNFINISHED one",
      two?.blockedBy?.id === "a4", `${two?.blockedBy?.id}`);
    ok("87.16b …and never the completed one",
      !c.blocked.some((r) => r.blockedBy?.id === "a6"), JSON.stringify(c.blocked.map((r) => r.blockedBy?.id)));
    ok("87.16c …and both dependencies really exist",
      (s.actionDependencies ?? []).filter((d) => d.blockedId === "a13").length === 2);
    ok("87.17 …though the dependency genuinely exists",
      (s.actionDependencies ?? []).some((d) => d.blockedId === "a5" && d.blockerId === "a6"));
    ok("87.18 blocked is never inferred from inactivity",
      !c.blocked.some((r) => r.action.id === "a11"), JSON.stringify(c.blocked.map((r) => r.action.id)));
  }

  // ==========================================================================
  // §11 — waiting, and a future follow-up that stays future.
  // ==========================================================================
  {
    ok("87.19 both waits are shown", c.waiting.length === 2, JSON.stringify(c.waiting.map((r) => r.action.title)));
    const maria = c.waiting.find((r) => r.action.id === "a7");
    const jordan = c.waiting.find((r) => r.action.id === "a8");
    ok("87.20 a follow-up that has arrived is due", maria?.followUpDue === true);
    ok("87.21 a follow-up six days out is NOT due", jordan?.followUpDue === false, `${jordan?.followUpDate}`);
    ok("87.22 …and the due one sorts first", c.waiting[0]?.action.id === "a7");
    // The row already renders "Follow up today"; the signal saying the same
    // thing beneath it was the same fact twice on one line.
    ok("87.22b an attention line never restates the follow-up the row shows",
      !maria?.attention, `${maria?.attention}`);
    ok("87.22c …and the row still carries the fact itself", maria?.followUpDue === true);
    // The same rule for a due date: an open row renders it, so an "overdue"
    // signal saying the same thing beneath it is the fact twice.
    const overdueRow = c.openRows.find((r) => r.action.id === "a2");
    ok("87.22d an overdue open row carries its due date", overdueRow?.dueDate === D(-1), `${overdueRow?.dueDate}`);
    ok("87.22e …and no attention line restating it", !overdueRow?.attention, `${overdueRow?.attention}`);
    ok("87.22f …though the signal layer genuinely raised one for it",
      buildCommitmentSignals(s, ix, { today: TODAY }).some((x) => x.recordRef.id === "a2" && x.kind === "overdue"));
    ok("87.23 the wait names who, verbatim", maria?.waitingOn === "Maria");
    ok("87.24 …and when it began, from waitingSince", maria?.since === D(-9), `${maria?.since}`);
  }

  // ==========================================================================
  // §26 — one action, one row.
  // ==========================================================================
  {
    const ids = [
      ...(c.next ? [c.next.action.id] : []),
      ...c.openRows.map((r) => r.action.id),
      ...c.blocked.map((r) => r.action.id),
      ...c.waiting.map((r) => r.action.id),
    ];
    ok("87.25 no action appears in two sections", new Set(ids).size === ids.length, JSON.stringify(ids));
    // The recommendation is overdue AND would otherwise be an open row.
    ok("87.26 the recommendation is not repeated under open",
      !c.openRows.some((r) => r.action.id === c.next?.action.id));
    // A waiting action is never also open.
    ok("87.27 a waiting action is not also open",
      !c.openRows.some((r) => r.action.id === "a7" || r.action.id === "a8"));
    // §15, §26. The deferral count ATTACHES; it is not a section.
    const deferred = c.openRows.find((r) => r.action.id === "a9");
    ok("87.28 a repeated deferral attaches a count to its own row",
      /deferred this 3 times/i.test(deferred?.deferral ?? ""), deferred?.deferral);
    ok("87.29 …and no shame language", !/avoid|lazy|failing|keep failing/i.test(deferred?.deferral ?? ""));
    ok("87.30 completed work is never a row", !ids.includes("a1") && !ids.includes("a6"));
    ok("87.31 an action from another project is never a row", !ids.includes("a12"));
  }

  // ==========================================================================
  // §13, §14, §24, §35 — recent movement.
  // ==========================================================================
  {
    ok("87.32 a completed linked action is recent movement",
      c.recent.some((x) => x.entity.id === "a1" && x.kind === "completed"),
      JSON.stringify(c.recent.map((x) => [x.kind, x.title])));
    // §24. `buildExecutiveChanges` emits one entry per EVENT, so an action with
    // two deferrals produced two identical rows before deduplication. Tested on
    // a COMPLETED action, because one that still owns a row above is excluded
    // from Recently altogether and so could never show the defect.
    const deferRows = c.recent.filter((x) => x.kind === "deferred" && x.entity.id === "a14");
    ok("87.33 two deferrals of one action are ONE recent row", deferRows.length === 1, `${deferRows.length}`);
    ok("87.34 the fixture really does hold two deferral events for it",
      (s.nextActions ?? []).find((a) => a.id === "a14")!.history!.filter((h) => h.action === "deferred").length === 2);
    ok("87.34b …and its completion is a separate row",
      c.recent.some((x) => x.kind === "completed" && x.entity.id === "a14"),
      JSON.stringify(c.recent.map((x) => [x.kind, x.entity.id])));
    ok("87.35 recent is newest first",
      c.recent.every((x, i) => i === 0 || c.recent[i - 1].occurredAt >= x.occurredAt),
      JSON.stringify(c.recent.map((x) => x.occurredAt)));
    ok("87.36 recent is capped", c.recent.length <= MAX_RECENT, `${c.recent.length}`);
    // …proved with a fixture that EXCEEDS it. Two rows survived deduplication
    // in the base fixture, so the cap could not have failed.
    const busy = {
      ...s,
      nextActions: [...(s.nextActions ?? []), ...Array.from({ length: 9 }, (_, i) =>
        act({ id: `r${i}`, title: `Finished thing ${i}`, projectId: "pr1", status: "completed", completedAt: A(-1, 10 + (i % 8)),
          history: [{ id: `rh${i}`, action: "completed", at: A(-1, 10 + (i % 8)) }] } as Partial<NextAction> & { id: string; title: string }))],
    } as StoreState;
    ok("87.36b the fixture over-supplies recent changes",
      buildExecutiveChanges(busy, resolveRange("last_7_days", { today: TODAY }))
        .filter((x) => x.kind === "completed").length > MAX_RECENT);
    ok("87.36c …and recent is still capped at five",
      ctx("pr1", busy).recent.length === MAX_RECENT, `${ctx("pr1", busy).recent.length}`);
    // §14. A goal-horizon edit is NOT project progress.
    ok("87.37 a goal horizon change is not project movement",
      !c.recent.some((x) => x.kind === "goal_horizon_changed"),
      JSON.stringify(c.recent.map((x) => x.kind)));
    ok("87.38 …though the horizon really did change in the window",
      buildExecutiveChanges(s, resolveRange("last_7_days", { today: TODAY }))
        .some((x) => x.kind === "goal_horizon_changed"));
    // §35. Bounded window, stated.
    ok("87.39 the window is bounded and named", c.range.startKey === D(-6) && !!c.range.label, c.range.label);
    // The row above is the live truth, and Recently is for what moved.
    ok("87.39b an action that owns a row is not repeated under recent",
      !c.recent.some((x) => x.entity.id === "a9"),
      JSON.stringify(c.recent.map((x) => [x.kind, x.title])));
    ok("87.39c …though its deferral count is still stated, on its own row",
      /deferred this 3 times/i.test(c.openRows.find((r) => r.action.id === "a9")?.deferral ?? ""));
    ok("87.39d …and a completed action, which owns no row, still appears",
      c.recent.some((x) => x.entity.id === "a1"));
    ok("87.40 every recent row belongs to this project",
      c.recent.every((x) => (s.nextActions ?? []).find((a) => a.id === x.entity.id)?.projectId === "pr1"));
  }

  // ==========================================================================
  // §12, §34 — people, conservatively.
  // ==========================================================================
  {
    const names = c.people.map((p) => p.name);
    ok("87.41 someone named in waitingOn is involved", names.includes("Maria") && names.includes("Jordan"), JSON.stringify(names));
    ok("87.42 …labelled by the strongest grounding",
      c.people.find((p) => p.name === "Maria")?.grounding === "waiting");
    ok("87.43 someone named in an action title is involved", names.includes("Marcus"));
    ok("87.44 someone named in the project description is involved", names.includes("Priya"));
    // A surname fragment is not a person in its own right.
    ok("87.45 'Webb' is not listed as a separate person", !names.includes("Webb"), JSON.stringify(names));
    // §34. The ambiguity is carried, never resolved.
    ok("87.46 Marcus carries the longer name as ambiguity",
      c.people.find((p) => p.name === "Marcus")?.longerForms.join() === "Marcus Webb",
      JSON.stringify(c.people.find((p) => p.name === "Marcus")?.longerForms));
    ok("87.47 …and the two are never merged into one entry",
      names.filter((n) => n.startsWith("Marcus")).length === 1, JSON.stringify(names));
    // The sentence-initial capital is an artifact, not a name.
    ok("87.48 a title's first word is not a person", !names.includes("Email") && !names.includes("Ask") && !names.includes("Reply"), JSON.stringify(names));
    ok("87.49 …and the real name right after it still is",
      projectPeople(s, s.projects![0], (s.nextActions ?? []).filter((a) => a.projectId === "pr1"))
        .some((p) => p.name === "Marcus"));
    // The acronym must be RECORDED, or `personHint` filters it out for a reason
    // that has nothing to do with the acronym guard and the test proves nothing.
    const acro = act({ id: "z", title: "Send the PDF to UH", projectId: "pr1" });
    const acroState = { ...s, nextActions: [...(s.nextActions ?? []), acro] } as StoreState;
    ok("87.50 an acronym is not a person",
      !projectPeople(acroState, acroState.projects![0], [acro]).some((p) => ["PDF", "UH"].includes(p.name)),
      JSON.stringify(projectPeople(acroState, acroState.projects![0], [acro]).map((p) => p.name)));
  }

  // ==========================================================================
  // §16 — Personal Code is context, never priority.
  // ==========================================================================
  {
    ok("87.51 rules are strings, not ranked records", c.rules.every((r) => typeof r === "string"));
    // A rule reaches the page only through the EXISTING relevance system, so it
    // cannot arrive by naming a person the project happens to mention.
    // A rule is context: the recommendation is the action overdue longest,
    // exactly as it would be with no Personal Code in the store at all.
    const noRules = { ...s, constitutionElements: [] } as StoreState;
    ok("87.52 a rule never reorders anything",
      ctx("pr1", noRules).next?.action.id === c.next?.action.id,
      `${ctx("pr1", noRules).next?.action.id} vs ${c.next?.action.id}`);
  }

  // ==========================================================================
  // §27, §28, §29 — no history invented, no score, no false progress.
  // ==========================================================================
  {
    const blob = JSON.stringify(c);
    ok("87.53 no health, momentum, risk or percentage field",
      !/"(?:health|momentum|risk|alignment|progressPercent|[a-z]*Score)":/i.test(blob),
      (blob.match(/"(?:health|momentum|risk|[a-z]*Score)":/i) ?? [])[0] ?? "");
    ok("87.54 the context has exactly the documented fields",
      Object.keys(c).sort().join(",")
      === "blocked,counts,empty,goal,next,nextNote,openRows,people,project,range,recent,rules,waiting",
      Object.keys(c).sort().join(","));
    // §27. `updatedAt` is today, and it is never a lifecycle event.
    ok("87.55 project.updatedAt is not used as a change",
      !c.recent.some((x) => x.entity.kind === "project"), JSON.stringify(c.recent.map((x) => x.entity.kind)));
    ok("87.56 …and the limitation is stated", /no history of project changes/i.test(HISTORY_LIMITATION));
    // §29. Exactly scoped to recorded linked completions.
    ok("87.57 the empty-recent sentence names the window and the scope",
      /No linked actions completed in/.test(NOTHING_COMPLETED("the last 7 days")));
    ok("87.58 …and never says 'no progress'", !/no progress/i.test(NOTHING_COMPLETED("x")));
    const said = projectStrings(c).join(" ").toLowerCase();
    for (const w of PROJECT_FORBIDDEN_WORDS) {
      ok(`87.59 the project view never says "${w}"`, !said.includes(w.toLowerCase()));
    }
    ok("87.60 §30's empty state never calls a project stalled",
      !/stalled|stuck|dead|abandoned/i.test(NO_OPEN_ACTIONS), NO_OPEN_ACTIONS);
  }

  // ==========================================================================
  // §17 — the questions, through Memory.
  // ==========================================================================
  {
    const changed = ask("What changed with Clinic launch?");
    ok("87.61 'what changed with X' no longer reports nothing",
      changed.status === "ANSWERED", `${changed.status} :: ${changed.summary}`);
    ok("87.62 …counting the project's own completed work",
      /completed 2 items/.test(changed.summary ?? ""), changed.summary);

    const waiting = ask("What am I waiting on for Clinic launch?");
    ok("87.63 'what am I waiting on for X' is scoped to the project",
      waiting.status === "ANSWERED" && waiting.items.length === 2,
      `${waiting.status} ${waiting.items.length}`);
    ok("87.64 …and names the project, not a person", /Clinic launch/.test(waiting.heading), waiting.heading);
    // The regression LIFEOS-086 introduced, pinned.
    ok("87.65 …and never says 'waiting on clinic launch'",
      !/waiting on clinic launch/i.test(waiting.summary ?? ""), waiting.summary);

    const blocked = ask("What is blocked on Clinic launch?");
    ok("87.66 'what is blocked' reads dependency state",
      blocked.status === "ANSWERED" && blocked.items.length === 2,
      `${blocked.status} ${blocked.items.length}`);
    ok("87.66b …and excludes the action whose only blocker is completed",
      !blocked.items.some((i) => i.text === "Order signage"),
      JSON.stringify(blocked.items.map((i) => i.text)));
    ok("87.67 …naming the unfinished blocker",
      blocked.items.every((i) => /Need legal review/.test(i.detail ?? "")),
      JSON.stringify(blocked.items.map((i) => i.detail)));
    ok("87.68 …and not the completed one",
      !blocked.items.some((i) => /Confirm branding/.test(i.detail ?? "")));

    const who = ask("Who is involved in Clinic launch?");
    ok("87.69 'who is involved' routes and answers", who.status === "ANSWERED", `${who.status}`);
    ok("87.70 …from the same people derivation", who.items.length === c.people.length,
      `${who.items.length} vs ${c.people.length}`);
    ok("87.71 …carrying the ambiguity", /also has/.test(JSON.stringify(who.items)));

    const def = ask("What keeps getting deferred on Clinic launch?");
    ok("87.72 'what keeps getting deferred' routes", def.status === "ANSWERED", `${def.status}`);
    ok("87.73 …scoped to this project's actions",
      def.items.length === 2 && def.items.every((i) => i.text !== "Water the plants"),
      JSON.stringify(def.items.map((i) => i.text)));
    // Non-vacuous: an action OUTSIDE the project is deferred just as often, and
    // the unscoped question returns it too. Scoped must be strictly smaller.
    const unscoped = ask("What do I keep putting off?");
    ok("87.73b …and an unscoped deferral question returns more",
      unscoped.items.length === 3 && unscoped.items.some((i) => i.text === "Water the plants"),
      JSON.stringify(unscoped.items.map((i) => i.text)));

    ok("87.74 'what should I do next for X' still works",
      ask("What should I do next for Clinic launch?").status === "ANSWERED");
    ok("87.75 a project question keeps its class",
      plan("What changed with Clinic launch?")?.projectRef?.id === "pr1");
  }

  // ==========================================================================
  // Caps, purity, determinism, cost.
  // ==========================================================================
  {
    const many = {
      ...s,
      nextActions: [...(s.nextActions ?? []), ...Array.from({ length: 20 }, (_, i) =>
        act({ id: `x${i}`, title: `Extra task ${i}`, projectId: "pr1" }))],
    } as StoreState;
    ok("87.76 the fixture over-supplies open work",
      (many.nextActions ?? []).filter((a) => a.projectId === "pr1" && a.status === "open").length > MAX_OPEN);
    ok("87.77 the open list is capped", ctx("pr1", many).openRows.length === MAX_OPEN,
      `${ctx("pr1", many).openRows.length}`);

    const before = JSON.stringify(s);
    ctx(); ctx("pr2");
    ok("87.78 building a project context mutates nothing", JSON.stringify(s) === before);
    ok("87.79 no new persistence noun was added",
      !("projectContexts" in s) && !("projectHistory" in s));
    ok("87.80 a missing project returns undefined",
      buildProjectContext(s, "nope", ix, TODAY) === undefined);

    const reversed = { ...s, nextActions: [...(s.nextActions ?? [])].reverse() } as StoreState;
    ok("87.81 the same project returns the same rows, whatever the store's order",
      JSON.stringify(ctx("pr1").openRows.map((r) => r.action.id))
      === JSON.stringify(ctx("pr1", reversed).openRows.map((r) => r.action.id)),
      JSON.stringify(ctx("pr1", reversed).openRows.map((r) => r.action.id)));
    ok("87.82 …and the same recommendation",
      ctx("pr1").next?.action.id === ctx("pr1", reversed).next?.action.id);
    ok("87.83 headings are the five documented ones", Object.keys(PROJECT_HEADINGS).length === 5);

    // §41. Cost, at a size a real store reaches.
    const big = {
      ...emptyStoreState(),
      goals: [goal({ id: "bg", title: "Big goal" })],
      projects: Array.from({ length: 50 }, (_, i) => proj({ id: `bp${i}`, title: `Project ${i}`, goalId: "bg" } as Partial<Project> & { id: string; title: string })),
      nextActions: Array.from({ length: 5000 }, (_, i) => act({
        id: `ba${i}`, title: i % 5 === 0 ? `Email Dana about item ${i}` : `Task ${i}`,
        projectId: `bp${i % 50}`,
        status: i % 7 === 0 ? "waiting" : "open",
        waitingOn: i % 7 === 0 ? "Dana" : undefined,
        dueDate: i % 13 === 0 ? D(-1) : undefined,
      } as Partial<NextAction> & { id: string; title: string })),
    } as StoreState;
    const bix = buildTodayIndexes(big, TODAY, "09:00");
    const t = Date.now();
    for (let i = 0; i < 5; i++) buildProjectContext(big, `bp${i}`, bix, TODAY);
    const ms = Date.now() - t;
    ok("87.84 five project contexts over 5,000 actions under 3000ms", ms < 3000, `${ms}ms`);
    ok("87.85 …and the big fixture really has work in it",
      (buildProjectContext(big, "bp0", bix, TODAY)?.counts.open ?? 0) > 0);
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
