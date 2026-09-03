/**
 * Executive guidance self-tests (LIFEOS-082).
 *
 * ## What is proved red, and what is deliberately not
 *
 * The audit measured four questions returning *"Conqify can't answer that one"*
 * — including the sprint's own headline phrasing — a list with no cap that
 * omitted the strongest behavioural evidence in the fixture, and an entity scope
 * that was extracted and ignored. Those are the red cases.
 *
 * §32 also lists four cases that **already behaved correctly on main**: a future
 * follow-up was not surfaced early, recurring work was already excluded from
 * repeated deferral, a completed blocker did not surface, and rule tensions did
 * not reach guidance at all. Inventing red proofs for those would be
 * manufacturing evidence, so they are asserted as **forward guards** on the new
 * shortlist instead — which is what actually matters, because the shortlist is
 * the thing that could newly get them wrong.
 *
 * ## The assertions that matter are the refusals
 *
 * That a rule cannot move an item up the list. That a weekly commitment is not
 * avoidance. That a goal with no project is described by its predicate and not
 * by a verdict. That an empty store stays empty.
 *
 * Pure: no store writes, no clock, no AI.
 */

import type { NextAction, Project, Goal, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { COMMITMENT_ORDER, GOAL_PATH_MISSING } from "@/lib/commitment/signals";
import { resolutionsFor, resolutionsForAction } from "@/lib/commitment/resolve";
import { recommendNextAction } from "@/lib/today/recommend";
import { answerMemoryQuery } from "@/lib/memory/answer";
import { planMemoryQuery } from "@/lib/memory/query";
import {
  buildAttentionShortlist, sortAttention, attentionStrings,
  ATTENTION_ORDER, ATTENTION_DEFAULT_LIMIT, ATTENTION_MAX_LIMIT,
  ATTENTION_FORBIDDEN_WORDS, NOTHING_NEEDS_ATTENTION, ATTENTION_HEADING,
  type ExecutiveAttentionItem,
} from "@/lib/guidance/attention";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-10";
const D = (o = 0): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const A = (o = 0, h = 9): string => `${D(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: A(-9), updatedAt: A(-9), ...p,
} as NextAction);

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [],
  createdAt: A(-30), updatedAt: A(-30), ...p,
} as Goal);

const proj = (p: Partial<Project> & { id: string; title: string }): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: A(-30), updatedAt: A(-30), ...p,
} as Project);

function stateWith(over: Partial<StoreState>): StoreState {
  return { ...emptyStoreState(), ...over };
}

/**
 * A life with one of everything the sprint reasons about.
 *
 * Written from the audit's own fixture so the report and the suite can be read
 * side by side. The two blocked cases are the reason `a6` carries a due date:
 * `blocked` is conditioned on the blocked item being due or its blocker being
 * stuck, and a fixture that ignores that would assert nothing.
 */
function world(): StoreState {
  return stateWith({
    goals: [
      goal({ id: "g1", title: "Graduate school", horizon: "medium" }),
      goal({ id: "g2", title: "Graduate school funding" }),
      goal({ id: "g3", title: "Run a marathon", horizon: "long" }),
    ],
    projects: [proj({ id: "pr1", title: "Marathon training", goalId: "g3" })],
    nextActions: [
      act({ id: "a1", title: "Submit UH application", dueDate: D(-2), goalId: "g1" }),
      // Deferred three times, non-recurring.
      act({
        id: "a2", title: "Request recommendation letter",
        history: [
          { id: "e1", action: "created", at: A(-9) },
          { id: "e2", action: "deferred", at: A(-6, 10), detail: D(-4) },
          { id: "e3", action: "deferred", at: A(-4, 10), detail: D(-2) },
          { id: "e4", action: "deferred", at: A(-2, 10), detail: D(3) },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // WEEKLY RECURRING and deferred three times. §16's guard.
      act({
        id: "a3", title: "Weekly lab prep",
        recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
        history: [
          { id: "e5", action: "created", at: A(-9) },
          { id: "e6", action: "deferred", at: A(-6, 10), detail: D(-4) },
          { id: "e7", action: "deferred", at: A(-4, 10), detail: D(-2) },
          { id: "e8", action: "deferred", at: A(-2, 10), detail: D(3) },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Follow-up due TODAY.
      act({ id: "a4", title: "Transcript from registrar", status: "waiting", waitingOn: "the registrar", waitingSince: D(-9), followUpDate: D(0) } as Partial<NextAction> & { id: string; title: string }),
      // Follow-up FIVE DAYS OUT. §17: must not surface early.
      act({ id: "a5", title: "Reply from Maria", status: "waiting", waitingOn: "Maria", waitingSince: D(-3), followUpDate: D(5) } as Partial<NextAction> & { id: string; title: string }),
      // Blocked by an OPEN blocker, and itself due today.
      act({ id: "a6", title: "Book flights", dueDate: D(0), projectId: "pr1" }),
      act({ id: "a7", title: "Confirm conference dates" }),
      // Blocked by a COMPLETED blocker, also due today. §18: must not surface.
      act({ id: "a8", title: "Print poster", dueDate: D(0) }),
      act({ id: "a9", title: "Finalise poster text", status: "completed", completedAt: A(-1) } as Partial<NextAction> & { id: string; title: string }),
    ],
    actionDependencies: [
      { id: "d1", blockedId: "a6", blockerId: "a7", createdAt: A(-5) },
      { id: "d2", blockedId: "a8", blockerId: "a9", createdAt: A(-5) },
    ],
    constitutionElements: [
      { id: "s1", kind: "standard", status: "active", statement: "Answer people promptly.", adoptedAt: A(-30), linkedRefs: [], createdAt: A(-30), updatedAt: A(-30) },
      // Mentions "application" — so it attaches to the overdue item as context.
      { id: "s2", kind: "standard", status: "active", statement: "Finish every application I start.", adoptedAt: A(-30), linkedRefs: [], createdAt: A(-30), updatedAt: A(-30) },
      // Mentions "recommendation", which attaches to the REPEATED-DEFERRAL item
      // — the lowest-ranked row in the fixture. That placement is the whole
      // point: a mutation that lets a rule promote an item can only be seen if
      // the rule is attached to something that would have to MOVE. Attached to
      // the overdue row (already first) it changes nothing and proves nothing.
      { id: "s3", kind: "standard", status: "active", statement: "Ask for a recommendation early.", adoptedAt: A(-30), linkedRefs: [], createdAt: A(-30), updatedAt: A(-30) },
    ] as StoreState["constitutionElements"],
    protocols: [{ id: "p1", trigger: "I am angry", response: "wait before replying", status: "active", createdAt: A(-30), updatedAt: A(-30) }],
  });
}

export function runGuidanceSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const ix = buildTodayIndexes(s, TODAY);
  const list = (o = {}) => buildAttentionShortlist(s, ix, TODAY, o);
  const five = list({ limit: 5 });
  const kinds = (items: ExecutiveAttentionItem[]) => items.map((i) => i.kind);
  const titles = (items: ExecutiveAttentionItem[]) => items.map((i) => i.title);

  // ------------------------------------------------------------------------
  // §9 — a small set, not a guilt inventory.
  // ------------------------------------------------------------------------

  ok("82.1 the default shortlist is three", list().length === 3, String(list().length));
  ok("82.2 …and the default is stated", ATTENTION_DEFAULT_LIMIT === 3);
  ok("82.3 the ceiling is five", ATTENTION_MAX_LIMIT === 5);
  ok("82.4 a larger request is clamped", list({ limit: 99 }).length <= 5, String(list({ limit: 99 }).length));
  ok("82.5 fewer grounded items means fewer shown",
    buildAttentionShortlist(stateWith({ nextActions: [act({ id: "z", title: "One thing", dueDate: D(-1) })] }),
      buildTodayIndexes(stateWith({ nextActions: [act({ id: "z", title: "One thing", dueDate: D(-1) })] }), TODAY),
      TODAY).length === 1);

  // ------------------------------------------------------------------------
  // §7, §8 — ordering is a list of words, not a score.
  // ------------------------------------------------------------------------

  ok("82.6 the existing commitment order is spliced in whole",
    COMMITMENT_ORDER.every((k, i) =>
      ATTENTION_ORDER.filter((x) => (COMMITMENT_ORDER as readonly string[]).includes(x))[i] === k),
    ATTENTION_ORDER.join(","));
  ok("82.7 repeated deferral sits after every dated kind",
    ATTENTION_ORDER.indexOf("repeated_deferral") > ATTENTION_ORDER.indexOf("due_soon"),
    ATTENTION_ORDER.join(","));
  ok("82.8 …and before the structural kinds",
    ATTENTION_ORDER.indexOf("repeated_deferral") < ATTENTION_ORDER.indexOf("goal_path_missing"));
  ok("82.9 the shortlist is ordered by that list",
    five.every((c, i) => i === 0
      || ATTENTION_ORDER.indexOf(five[i - 1].kind) <= ATTENTION_ORDER.indexOf(c.kind)),
    kinds(five).join(" > "));
  ok("82.10 no item carries a score of any kind",
    five.every((i) => !Object.keys(i).some((k) => /score|weight|rank|priority|urgency|importance/i.test(k))),
    JSON.stringify(Object.keys(five[0] ?? {})));

  // §28 — stability. Same state, same answer.
  ok("82.11 the shortlist is stable across builds",
    JSON.stringify(list().map((i) => i.id)) === JSON.stringify(list().map((i) => i.id)));
  ok("82.12 …with stable derived ids", list().every((i) => /^[a-z_]+:[a-z_]+:/.test(i.id)), JSON.stringify(list().map((i) => i.id)));
  // §29 — a tie is broken deterministically, and BOTH are shown.
  {
    // SIX tied items, not two. A two-element tie passes a coin flip half the
    // time, so mutating the tie-break to `Math.random()` left the assertion
    // green — and flaky, which is worse than wrong. Six makes an accidental
    // pass a 1-in-720 event, and the exact expected order is asserted rather
    // than just the first element.
    const ids = ["f", "c", "a", "e", "b", "d"];
    const tied = sortAttention(ids.map((x) => ({
      ...five[0], id: `goal_path_missing:goal:${x}`, kind: "goal_path_missing", date: undefined,
    })) as ExecutiveAttentionItem[]);
    ok("82.13 a tie is ordered deterministically",
      tied.map((t) => t.id.slice(-1)).join("") === "abcdef", tied.map((t) => t.id.slice(-1)).join(""));
    ok("82.14 …and does not collapse to nothing", tied.length === 6, String(tied.length));
    ok("82.14b …and repeating the sort gives the same order",
      sortAttention(tied).map((t) => t.id).join("|") === tied.map((t) => t.id).join("|"));
  }

  // ------------------------------------------------------------------------
  // §10 — every item says why.
  // ------------------------------------------------------------------------

  ok("82.15 every item has an explanation", five.every((i) => i.explanation.trim().length > 0));
  ok("82.16 every item names its evidence", five.every((i) => i.evidence.trim().length > 0),
    JSON.stringify(five.map((i) => i.evidence)));
  ok("82.17 no explanation hedges", !five.some((i) => /seems|probably|might be important/i.test(i.explanation)),
    JSON.stringify(five.map((i) => i.explanation)));

  // ------------------------------------------------------------------------
  // §16 — repeated deferral, reusing LIFEOS-081.
  // ------------------------------------------------------------------------

  ok("82.18 a repeatedly deferred item reaches guidance",
    kinds(five).includes("repeated_deferral"), kinds(five).join(","));
  ok("82.19 …naming the record", titles(five).includes("Request recommendation letter"));
  ok("82.20 …with the factual count",
    five.some((i) => i.explanation === "You deferred this 3 times."),
    JSON.stringify(five.map((i) => i.explanation)));
  // THE §16 guard. The recurring action was deferred three times too.
  ok("82.21 recurring work is never repeated deferral",
    !titles(five).includes("Weekly lab prep"), titles(five).join(","));
  ok("82.22 …and it is absent whatever the cap", !titles(list({ limit: 5 })).includes("Weekly lab prep"));

  // §19 — one commitment, one row. An item already listed gains a reason, not a line.
  {
    const both = stateWith({
      nextActions: [act({
        id: "b1", title: "Overdue and deferred", dueDate: D(-3),
        history: [
          { id: "h1", action: "created", at: A(-9) },
          { id: "h2", action: "deferred", at: A(-6, 10), detail: D(-4) },
          { id: "h3", action: "deferred", at: A(-4, 10), detail: D(-3) },
        ],
      } as Partial<NextAction> & { id: string; title: string })],
    });
    const bl = buildAttentionShortlist(both, buildTodayIndexes(both, TODAY), TODAY, { limit: 5 });
    ok("82.23 an item is never listed twice", bl.length === 1, JSON.stringify(kinds(bl)));
    ok("82.24 …the more direct kind wins", bl[0].kind === "overdue", bl[0].kind);
    ok("82.25 …and the deferral rides along as a reason",
      bl[0].secondaryReasons.some((r) => r.text === "You deferred this 2 times."),
      JSON.stringify(bl[0].secondaryReasons.map((r) => r.text)));
  }

  // ------------------------------------------------------------------------
  // §17 — waiting. The grounded case only.
  // ------------------------------------------------------------------------

  ok("82.26 a follow-up due today surfaces", titles(five).includes("Transcript from registrar"), titles(five).join(","));
  ok("82.27 a follow-up five days out does NOT", !titles(list({ limit: 5 })).includes("Reply from Maria"), titles(five).join(","));

  // ------------------------------------------------------------------------
  // §18 — blocked. Live blockers only.
  // ------------------------------------------------------------------------

  ok("82.28 an item blocked by open work surfaces", titles(five).includes("Book flights"), titles(five).join(","));
  ok("82.29 …naming the blocker", five.some((i) => i.title === "Book flights" && /Confirm conference dates/.test(i.explanation)),
    JSON.stringify(five.filter((i) => i.title === "Book flights").map((i) => i.explanation)));
  ok("82.30 an item whose blocker is COMPLETED does not surface as blocked",
    !five.some((i) => i.title === "Print poster" && i.kind === "blocked"),
    JSON.stringify(five.filter((i) => i.title === "Print poster").map((i) => i.kind)));

  // ------------------------------------------------------------------------
  // §14 — goal wording matches the predicate.
  // ------------------------------------------------------------------------

  {
    const goalItems = list({ limit: 5 }).filter((i) => i.kind === "goal_path_missing");
    const all = buildAttentionShortlist(s, ix, TODAY, { limit: 5, entity: { kind: "goal", id: "g1" } });
    // The LITERAL sentence, not the constant. Asserting
    // `explanation.startsWith(GOAL_PATH_MISSING)` compares the constant with
    // itself, so rewriting it as a verdict left the assertion green — the exact
    // tautology this suite exists to avoid.
    ok("82.31 a goal with no project is described by its predicate",
      all.some((i) => i.explanation === "No active project is linked to this goal."),
      JSON.stringify(all.map((i) => i.explanation)));
    ok("82.31b …and the shared constant still says that",
      GOAL_PATH_MISSING === "No active project is linked to this goal", GOAL_PATH_MISSING);
    // Swept over a list that definitely CONTAINS the goal row. The unscoped
    // top-five can cut it off, which would make this pass for lack of a subject.
    ok("82.32 …and never as 'no path forward'",
      !attentionStrings(all).join(" ").toLowerCase().includes("no path forward"),
      JSON.stringify(all.map((i) => i.explanation)));
    ok("82.32b …nor any other verdict about the goal",
      !attentionStrings(all).join(" ").toLowerCase().match(/stuck|at risk|drift|going nowhere/),
      JSON.stringify(all.map((i) => i.explanation)));
    ok("82.33 a goal that HAS a project is not listed",
      !goalItems.some((i) => i.entity.id === "g3"), JSON.stringify(goalItems.map((i) => i.entity.id)));
  }

  // ------------------------------------------------------------------------
  // §21 — Personal Code is context, never rank.
  // ------------------------------------------------------------------------

  {
    const withRule = five.find((i) => i.ruleContext.length > 0);
    ok("82.34 a relevant rule attaches as context", !!withRule, JSON.stringify(five.map((i) => i.ruleContext)));
    ok("82.35 …quoting the user's own wording",
      !!withRule && withRule.ruleContext.some((r) => r === "Finish every application I start."),
      JSON.stringify(withRule?.ruleContext));
    // THE assertion. Strip every rule and the ORDER must not move.
    const noRules = stateWith({ ...s, constitutionElements: [], protocols: [] });
    const without = buildAttentionShortlist(noRules, buildTodayIndexes(noRules, TODAY), TODAY, { limit: 5 });
    ok("82.36 a rule cannot change the order",
      JSON.stringify(without.map((i) => i.id)) === JSON.stringify(five.map((i) => i.id)),
      `${without.map((i) => i.kind).join(",")} vs ${five.map((i) => i.kind).join(",")}`);
    ok("82.37 …nor which items are shown", without.length === five.length);
  }

  // ------------------------------------------------------------------------
  // §11, §12 — resolutions reused, never re-created.
  // ------------------------------------------------------------------------

  {
    const overdue = five.find((i) => i.kind === "overdue");
    ok("82.38 a signal-backed item carries its signal", !!overdue?.signal);
    const r = overdue?.signal ? resolutionsFor(s, overdue.signal, { ix, today: TODAY }) : [];
    ok("82.39 …so LIFEOS-071's resolutions are available", r.length > 0, JSON.stringify(r.map((x) => x.kind)));
    ok("82.40 …and none of them is destructive",
      !r.some((x) => /delete|remove|archive/i.test(x.kind)), JSON.stringify(r.map((x) => x.kind)));

    const rd = five.find((i) => i.kind === "repeated_deferral");
    ok("82.41 a repeated-deferral item carries no synthesised signal", !!rd && rd.signal === undefined);
    ok("82.42 …but does carry its action, for the record-based resolver", !!rd?.actionId);
    const r2 = rd?.actionId ? resolutionsForAction(s, rd.actionId, { ix, today: TODAY }) : [];
    ok("82.43 …which offers the same controls Suggested Next offers", r2.length > 0, JSON.stringify(r2.map((x) => x.kind)));
  }

  // ------------------------------------------------------------------------
  // §24, §26 — facts, never a diagnosis.
  // ------------------------------------------------------------------------

  {
    const strings = attentionStrings(list({ limit: 5 })).join(" ").toLowerCase();
    ok("82.44 nothing accuses the user",
      !ATTENTION_FORBIDDEN_WORDS.some((w) => strings.includes(w)),
      ATTENTION_FORBIDDEN_WORDS.filter((w) => strings.includes(w)).join(", "));
    ok("82.45 …and nothing psychologizes",
      !/(you are avoiding|anxious|sabotag|afraid|resistance)/i.test(strings));
    ok("82.46 the heading claims no priority", !/priorit/i.test(ATTENTION_HEADING), ATTENTION_HEADING);
  }

  // ------------------------------------------------------------------------
  // §38.10 — an empty store stays empty.
  // ------------------------------------------------------------------------

  {
    const e = emptyStoreState();
    ok("82.47 nothing is invented on an empty store",
      buildAttentionShortlist(e, buildTodayIndexes(e, TODAY), TODAY).length === 0);
    ok("82.48 …and the empty wording is bounded to the record",
      /Conqify has recorded/.test(NOTHING_NEEDS_ATTENTION), NOTHING_NEEDS_ATTENTION);
    ok("82.49 …never 'all caught up'", !/caught up|well done|great job/i.test(NOTHING_NEEDS_ATTENTION));
  }

  // ------------------------------------------------------------------------
  // §25 — entity scope.
  // ------------------------------------------------------------------------

  {
    const scoped = buildAttentionShortlist(s, ix, TODAY, { limit: 5, entity: { kind: "goal", id: "g1" } });
    ok("82.50 a goal scope keeps its own row", scoped.some((i) => i.entity.id === "g1"), JSON.stringify(titles(scoped)));
    ok("82.51 …and the action linked to it", scoped.some((i) => i.entity.id === "a1"), JSON.stringify(titles(scoped)));
    ok("82.52 …and nothing unrelated", !scoped.some((i) => i.entity.id === "a4"), JSON.stringify(titles(scoped)));

    const byProject = buildAttentionShortlist(s, ix, TODAY, { limit: 5, entity: { kind: "goal", id: "g3" } });
    ok("82.53 a goal scope reaches work under its projects",
      byProject.some((i) => i.entity.id === "a6"), JSON.stringify(titles(byProject)));
  }

  // ------------------------------------------------------------------------
  // §22, §38.11 — Today is untouched.
  // ------------------------------------------------------------------------

  {
    const before = recommendNextAction(s, ix, TODAY);
    buildAttentionShortlist(s, ix, TODAY, { limit: 5 });
    const after = recommendNextAction(s, ix, TODAY);
    ok("82.54 building the shortlist does not disturb Suggested Next",
      JSON.stringify(before.recommendation?.action.id ?? null) === JSON.stringify(after.recommendation?.action.id ?? null),
      `${before.recommendation?.action.id ?? "none"} vs ${after.recommendation?.action.id ?? "none"}`);
    ok("82.55 …and the commitment order is unmodified",
      COMMITMENT_ORDER.join(",") === "overdue,follow_up_due,returned_today,recurring_due,blocked,due_soon,project_no_next_action,goal_path_missing,dormant",
      COMMITMENT_ORDER.join(","));
  }

  // ------------------------------------------------------------------------
  // §23 — Memory. One class, one aspect.
  // ------------------------------------------------------------------------

  const plan = (q: string) => planMemoryQuery(q, { today: TODAY, projects: [] });
  const FOCUS_QS = ["What should I focus on?", "What am I neglecting?", "What should I deal with?", "What is stuck?"];
  FOCUS_QS.forEach((q, i) => {
    ok(`82.56.${i} routes to the guidance class: "${q}"`, plan(q)?.kind === "OPEN_WORK", String(plan(q)?.kind));
    ok(`82.57.${i} …as a shortlist`, plan(q)?.guidanceAspect === "focus", String(plan(q)?.guidanceAspect));
  });
  ok("82.58 'what still needs attention' remains the full list",
    plan("What still needs attention?")?.guidanceAspect === "all");
  ok("82.59 no new query class was created", plan("What should I focus on?")?.kind === "OPEN_WORK");

  {
    const a = answerMemoryQuery(s, "What should I focus on?", { today: TODAY });
    ok("82.60 the focus question is answered", a.status === "ANSWERED", a.status);
    ok("82.61 …with a capped shortlist", a.items.length === 3, String(a.items.length));
    ok("82.62 …each row saying why", a.items.every((i) => (i.detail ?? "").trim().length > 0));
    ok("82.63 …and the answer never says 'neglect'",
      !/neglect/i.test([a.heading, a.summary, ...a.items.map((i) => i.detail ?? "")].join(" ")));
    ok("82.64 …nor claims a priority",
      !/priorit/i.test([a.heading, a.summary].join(" ")), a.heading);
  }
  {
    const a = answerMemoryQuery(s, "What am I neglecting?", { today: TODAY });
    ok("82.65 the neglect question is answered with facts", a.status === "ANSWERED");
    ok("82.66 …and does not echo the accusation",
      !/neglect/i.test([a.heading ?? "", a.summary ?? ""].join(" ")), a.heading);
  }
  {
    const e = emptyStoreState();
    const a = answerMemoryQuery(e, "What should I focus on?", { today: TODAY });
    ok("82.67 an empty store answers calmly, not with an error",
      a.status === "NO_RECORDED_EVIDENCE" && a.items.length === 0, a.status);
    ok("82.68 …and does not say it cannot answer", !/can'?t answer/i.test(a.heading ?? ""), a.heading);
  }
  {
    // §25 — two goals match and neither exactly. The person picks.
    const amb = stateWith({
      goals: [goal({ id: "x1", title: "Graduate school applications" }), goal({ id: "x2", title: "Graduate school funding" })],
    });
    const a = answerMemoryQuery(amb, "What needs attention with graduate school?", { today: TODAY });
    ok("82.69 an ambiguous scope asks rather than picks", a.status === "NEEDS_CHOICE", a.status);
    ok("82.70 …offering both", (a.choices ?? []).length === 2, JSON.stringify((a.choices ?? []).map((c) => c.title)));
  }
  {
    const a = answerMemoryQuery(s, "What needs attention with graduate school?", { today: TODAY });
    ok("82.71 a resolved scope narrows the answer",
      a.items.every((i) => i.ref?.id === "g1" || i.ref?.id === "a1"),
      JSON.stringify(a.items.map((i) => [i.ref?.kind, i.ref?.id])));
  }

  // ------------------------------------------------------------------------
  // §35 — performance. Realistic stores, bounded work.
  // ------------------------------------------------------------------------

  for (const n of [100, 1000, 5000]) {
    const big = stateWith({
      nextActions: Array.from({ length: n }, (_, i) => act({
        id: `b${i}`, title: `Task ${i}`, dueDate: i % 7 === 0 ? D(-1) : D(3),
        history: [
          { id: `bc${i}`, action: "created", at: A(-9) },
          { id: `bd${i}`, action: "deferred", at: A(-6, 10), detail: D(-4) },
          { id: `be${i}`, action: "deferred", at: A(-4, 10), detail: D(-2) },
        ],
      } as Partial<NextAction> & { id: string; title: string })),
      goals: Array.from({ length: Math.floor(n / 10) }, (_, i) => goal({ id: `bg${i}`, title: `Goal ${i}` })),
    });
    const bix = buildTodayIndexes(big, TODAY);
    const t = Date.now();
    const built = buildAttentionShortlist(big, bix, TODAY);
    const scoped = buildAttentionShortlist(big, bix, TODAY, { entity: { kind: "goal", id: "bg0" } });
    const ms = Date.now() - t;
    ok(`82.72.${n} ${n} entities: shortlist + scoped under 3000ms`, ms < 3000, `${ms}ms`);
    ok(`82.73.${n} …and the cap still holds`, built.length <= ATTENTION_MAX_LIMIT && scoped.length <= ATTENTION_MAX_LIMIT,
      `${built.length}/${scoped.length}`);
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
