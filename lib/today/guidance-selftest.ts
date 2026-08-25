/**
 * Next Action Guidance self-tests (LIFEOS-072 §24, §25).
 *
 * Section 2 pins every defect the §4 audit found by running the deployed
 * recommender against constructed cases. Each of them produced a wrong
 * recommendation in a shipped build, and none was caught by an existing test:
 *
 *   a future deferral recommended because its old due date had passed
 *   a blocker recommended for unblocking something already completed
 *   a recurring occurrence that could never be recommended at all
 *   a timed deadline still ahead losing to one that had already passed
 *   "planned today" that stayed true forever
 *
 * Section 3 holds the line that matters more than any of them: a tie is not
 * permission to guess.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { NextAction, PlanningAssignment, Project, StoreState } from "@/types/mvp";
import { buildTodayIndexes } from "@/lib/today/indexes";
import {
  recommendNextAction, NO_STANDOUT, RECOMMENDATION_HORIZON_DAYS,
  type RecommendResult,
} from "@/lib/today/recommend";
import { isDeferredAhead } from "@/lib/actions/defer";
import { answerMemoryQuery } from "@/lib/memory/answer";
import { planMemoryQuery } from "@/lib/memory/query";
import { resolutionsForAction } from "@/lib/commitment/resolve";
import { violatesTodayLanguage, buildTodayView } from "@/lib/today/view";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const T = "2026-08-25";        // a Tuesday
const YESTERDAY = "2026-08-24";
const TWO_AGO = "2026-08-23";
const TOMORROW = "2026-08-26";
const NEXT_WEEK = "2026-09-02";
const FAR = "2026-12-01";
const OLD = "2026-05-01";

const iso = (d: string, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { id: string; title: string }): NextAction {
  seq += 1;
  return {
    description: "", status: "open", createdAt: iso(OLD), updatedAt: iso(OLD), notes: "",
    linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
    order: seq, history: [],
    ...p,
  } as NextAction;
}

const dep = (id: string, blockerId: string, blockedId: string) =>
  ({ id, blockerId, blockedId, createdAt: iso(OLD) });

/** Run the recommender over a hand-built state. */
function rec(
  actions: NextAction[],
  opts: {
    deps?: Array<{ id: string; blockerId: string; blockedId: string }>;
    now?: string;
    completions?: Array<{ id: string; actionId: string; occurrenceDate: string; completedAt: string }>;
    plans?: PlanningAssignment[];
    projects?: Project[];
  } = {},
): RecommendResult {
  const s = emptyState();
  s.nextActions = actions;
  s.actionDependencies = (opts.deps ?? []) as StoreState["actionDependencies"];
  s.recurrenceCompletions = (opts.completions ?? []) as StoreState["recurrenceCompletions"];
  s.planningAssignments = opts.plans ?? [];
  s.projects = opts.projects ?? [];
  return recommendNextAction(s, buildTodayIndexes(s, T, opts.now ?? "09:00"), T);
}

const winner = (r: RecommendResult): string | null => r.recommendation?.action.title ?? null;
const codes = (r: RecommendResult): string[] => r.recommendation?.reasons.map((x) => x.code) ?? [];
const texts = (r: RecommendResult): string => (r.recommendation?.reasons ?? []).map((x) => x.text).join(" | ");

/** A planning assignment placed into `today` on a given day. */
const plannedOn = (actionId: string, day: string): PlanningAssignment => ({
  id: `pa-${actionId}`, ref: { kind: "action", id: actionId }, horizon: "today", order: 0,
  createdAt: iso(day), updatedAt: iso(day),
  history: [{ id: `ph-${actionId}`, at: iso(day), action: "planned", toHorizon: "today" }],
});

export async function runGuidanceSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

  // ============================== 1. eligibility (§5)

  {
    const other = act({ id: "o", title: "Other" });
    eq("1.1 waiting is never recommended",
      winner(rec([act({ id: "w", title: "WaitingOverdue", dueDate: YESTERDAY, status: "waiting", waitingOn: "X", waitingSince: iso(OLD) }), other])),
      "Other");
    eq("1.2 completed is never recommended",
      winner(rec([act({ id: "c", title: "Done", dueDate: YESTERDAY, status: "completed", completedAt: iso(T) }), other])),
      "Other");
    eq("1.3 cancelled is never recommended",
      winner(rec([act({ id: "x", title: "Cancelled", dueDate: YESTERDAY, status: "cancelled", cancelledAt: iso(T) }), other])),
      "Other");
    eq("1.4 blocked is never recommended",
      winner(rec([act({ id: "b1", title: "BlockedOverdue", dueDate: YESTERDAY }), act({ id: "b2", title: "Blocker" })],
        { deps: [dep("d", "b2", "b1")] })),
      "Blocker");
    ok("1.5 an empty store recommends nothing", rec([]).recommendation === null);
  }

  // ============ 2. THE AUDIT DEFECTS, PINNED (§13)

  {
    // ---- future-deferred with a stale overdue date
    const deferred = act({ id: "d1", title: "DeferredButOverdue", dueDate: YESTERDAY, status: "deferred", deferredUntil: NEXT_WEEK });
    ok("2.1 a future deferral is not executable", isDeferredAhead(deferred, T));
    eq("2.2 …and is never recommended, stale due date or not",
      winner(rec([deferred, act({ id: "d2", title: "PlainOpen" })])), "PlainOpen");
    ok("2.3 …while a deferral whose day ARRIVED is eligible again",
      !isDeferredAhead(act({ id: "d3", title: "Back", status: "deferred", deferredUntil: T }), T));
    // A someday deferral has no date and stays out.
    ok("2.4 a someday deferral is never recommended",
      winner(rec([act({ id: "d4", title: "Someday", dueDate: YESTERDAY, status: "deferred" }), act({ id: "d5", title: "Open2" })])) === "Open2");

    // Found by the LIFEOS-072 browser smoke, not by the audit: `dormancyView`
    // reads every action regardless of status, so Today's older "worth returning
    // to" fallback announced an item deferred a month out as "No recorded
    // activity in 120 days" — telling the user they had forgotten something they
    // had explicitly parked. Suppression now runs off the same shared predicate.
    {
      const s = emptyState();
      s.nextActions = [
        act({ id: "p1", title: "ParkedAhead", createdAt: iso(OLD), updatedAt: iso(OLD), dueDate: TWO_AGO, status: "deferred", deferredUntil: FAR }),
      ];
      const v = buildTodayView(s, buildTodayIndexes(s, T, "09:00"));
      ok("2.4b a future deferral is not offered as 'worth returning to'",
        v.returnItem === null || v.returnItem.ref.id !== "p1", JSON.stringify(v.returnItem));
      ok("2.4c …and is never described as dormant anywhere in Today",
        !v.signals.some((x) => x.recordRef.id === "p1" && x.kind === "dormant"));

      // …while a genuinely quiet OPEN item is still surfaced. The fix suppresses
      // parked work, not the whole signal.
      const s2 = emptyState();
      s2.nextActions = [act({ id: "q1", title: "QuietOpen", createdAt: iso(OLD), updatedAt: iso(OLD) })];
      const v2 = buildTodayView(s2, buildTodayIndexes(s2, T, "09:00"));
      ok("2.4d a quiet OPEN item is still surfaced",
        v2.signals.some((x) => x.recordRef.id === "q1") || v2.returnItem?.ref.id === "q1",
        JSON.stringify(v2.returnItem));
    }

    // ---- blocker of a completed dependent
    const r = rec([
      act({ id: "g1", title: "BlockedDone", status: "completed", completedAt: iso(T) }),
      act({ id: "g2", title: "BlockerOfDone" }),
      act({ id: "g3", title: "BareOther" }),
    ], { deps: [dep("e", "g2", "g1")] });
    ok("2.5 unblocking something already completed is not a reason",
      !codes(r).includes("blocks_other"), codes(r).join(","));
    ok("2.6 …so nothing stands out on that evidence alone", r.recommendation === null, winner(r) ?? "");
    // …but a LIVE dependent still counts.
    const live = rec([
      act({ id: "h1", title: "BlockedLive", dueDate: YESTERDAY }),
      act({ id: "h2", title: "BlockerOfLive" }),
    ], { deps: [dep("e2", "h2", "h1")] });
    eq("2.7 unblocking live work still counts", winner(live), "BlockerOfLive");
    ok("2.8 …and names what it unlocks", /Unlocks BlockedLive/.test(texts(live)), texts(live));

    // ---- recurring occurrence eligibility
    const recurring = act({ id: "r1", title: "RecurringDueToday", recurrence: { frequency: "daily", interval: 1 } });
    eq("2.9 a recurring occurrence due today is now recommendable",
      winner(rec([recurring])), "RecurringDueToday");
    ok("2.10 …with its own reason code", codes(rec([recurring])).includes("recurring_due"));
    eq("2.11 …and a completed occurrence is not",
      winner(rec([recurring], { completions: [{ id: "rc", actionId: "r1", occurrenceDate: T, completedAt: iso(T, 7) }] })),
      null);
    // A weekly rule whose day is not today has no occurrence today.
    eq("2.12 a recurring action not due today is not recommended",
      winner(rec([act({ id: "r2", title: "WeeklyOtherDay", createdAt: iso(TWO_AGO), recurrence: { frequency: "weekly", interval: 1, weekdays: [0] } })])),
      null);

    // ---- unpassed due-time vs generic overdue
    const timed = rec([
      act({ id: "tm1", title: "DueAt1030", dueDate: T, dueTime: "10:30" }),
      act({ id: "tm2", title: "OverdueGeneric", dueDate: YESTERDAY }),
    ], { now: "09:00" });
    eq("2.13 a due-time today that hasn't passed outranks generic overdue",
      winner(timed), "DueAt1030");
    ok("2.14 …explained by the time, not a score", /Due today at 10:30/.test(texts(timed)), texts(timed));
    ok("2.15 …and the comparison is stated", !!timed.recommendation?.counterfactual, timed.recommendation?.counterfactual);
    // Once it HAS passed, it no longer jumps the queue.
    const passed = rec([
      act({ id: "tm3", title: "DueAt0800", dueDate: T, dueTime: "08:00" }),
      act({ id: "tm4", title: "OverdueTwoDays", dueDate: TWO_AGO }),
    ], { now: "20:00" });
    eq("2.16 a due-time that already passed does not outrank overdue", winner(passed), "OverdueTwoDays");

    // ---- passed due-time wording
    const late = rec([act({ id: "tm5", title: "Class", dueDate: T, dueTime: "14:00" })], { now: "20:00" });
    ok("2.17 a passed due-time is described as passed",
      /Was due at 14:00 today/.test(texts(late)), texts(late));
    ok("2.18 …and never as coming up", !/coming up|upcoming/i.test(texts(late)));
    const early = rec([act({ id: "tm6", title: "Class", dueDate: T, dueTime: "14:00" })], { now: "09:00" });
    ok("2.19 …while an unpassed one reads as due today", /Due today at 14:00/.test(texts(early)), texts(early));

    // ---- planned-today stickiness
    const planToday = rec([act({ id: "p1", title: "PlannedToday" }), act({ id: "p2", title: "Unplanned" })],
      { plans: [plannedOn("p1", T)] });
    eq("2.20 an action planned for today TODAY is recommended", winner(planToday), "PlannedToday");
    ok("2.21 …for that reason", codes(planToday).includes("planned_today"));
    const planStale = rec([act({ id: "p3", title: "PlannedLastWeek" }), act({ id: "p4", title: "Unplanned2" })],
      { plans: [plannedOn("p3", "2026-08-18")] });
    ok("2.22 a plan made LAST week is not still 'planned today'",
      !codes(planStale).includes("planned_today"), codes(planStale).join(","));
    ok("2.23 …so it no longer wins on that basis", planStale.recommendation === null, winner(planStale) ?? "");
  }

  // ============================== 3. ties are never guessed (§16, §25 H/I)

  {
    const twoOverdue = rec([
      act({ id: "t1", title: "AlphaFirst", dueDate: YESTERDAY }),
      act({ id: "t2", title: "BetaSecond", dueDate: YESTERDAY }),
    ]);
    eq("3.1 two identically overdue actions produce no standout", twoOverdue.recommendation, null);
    eq("3.2 …with the standard wording", twoOverdue.note, NO_STANDOUT);
    ok("3.3 …and alphabetical order does not decide", winner(twoOverdue) !== "AlphaFirst");
    eq("3.4 …while still reporting how many were considered", twoOverdue.consideredCount, 2);

    const differentAges = rec([
      act({ id: "t3", title: "CreatedEarlier", createdAt: iso("2026-05-01"), dueDate: YESTERDAY }),
      act({ id: "t4", title: "CreatedLater", createdAt: iso("2026-06-01"), dueDate: YESTERDAY }),
    ]);
    eq("3.5 recency never breaks a tie", differentAges.recommendation, null);

    const project: Project = {
      id: "pr1", title: "LotPilot", description: "", status: "active", priority: "high", notes: "",
      milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: iso(OLD), updatedAt: iso(T),
    } as Project;
    const linkedVsNot = rec([
      act({ id: "t5", title: "LinkedAction", dueDate: YESTERDAY, projectId: "pr1" }),
      act({ id: "t6", title: "UnlinkedAction", dueDate: YESTERDAY }),
    ], { projects: [project] });
    eq("3.6 project membership alone never breaks a tie", linkedVsNot.recommendation, null);
    ok("3.7 …and a high-priority project does not leak in either",
      !JSON.stringify(linkedVsNot).includes("high"));

    // A single candidate with nothing to say is still nameable — that is a fact,
    // not a guess.
    const only = rec([act({ id: "t7", title: "TheOnlyOne" })]);
    eq("3.8 the single executable action is named", winner(only), "TheOnlyOne");
    eq("3.9 …as the only candidate, not as a priority", codes(only), ["only_candidate"]);
    // …but two undated actions are not distinguishable.
    eq("3.10 two undated actions produce no standout",
      rec([act({ id: "t8", title: "Bare1" }), act({ id: "t9", title: "Bare2" })]).recommendation, null);
  }

  // ============================== 4. the §24 torture list

  {
    eq("4.1 due today beats due later",
      winner(rec([act({ id: "a", title: "DueToday", dueDate: T }), act({ id: "b", title: "DueLater", dueDate: FAR })])),
      "DueToday");
    eq("4.2 overdue beats due soon",
      winner(rec([act({ id: "c", title: "Overdue", dueDate: YESTERDAY }), act({ id: "d", title: "DueTomorrow", dueDate: TOMORROW })])),
      "Overdue");
    eq("4.6 overdue beats returned-today",
      winner(rec([
        act({ id: "e", title: "ReturnedToday", history: [{ id: "h", at: iso(T, 7), action: "returned", fromStatus: "deferred", toStatus: "open", detail: T }] }),
        act({ id: "f", title: "OverdueOther", dueDate: YESTERDAY }),
      ])),
      "OverdueOther");
    eq("4.7 due-today beats planned-today",
      winner(rec([act({ id: "g", title: "PlannedToday" }), act({ id: "h", title: "DueToday2", dueDate: T })],
        { plans: [plannedOn("g", T)] })),
      "DueToday2");
    eq("4.14 a blocker of a FAR-FUTURE task does not jump the queue",
      winner(rec([
        act({ id: "i", title: "BlockedFarFuture", dueDate: FAR }),
        act({ id: "j", title: "BlockerOfFuture" }),
        act({ id: "k", title: "DueTodayPlain", dueDate: T }),
      ], { deps: [dep("d2", "j", "i")] })),
      "DueTodayPlain");
    // §14: the recommendation horizon is the narrow one, not Today's Upcoming.
    eq("4.x the recommendation horizon is the narrow named one", RECOMMENDATION_HORIZON_DAYS, 3);
    ok("4.x2 a date beyond that horizon is not a reason",
      !codes(rec([act({ id: "l", title: "DueIn5", dueDate: "2026-08-30" })])).includes("due_within_horizon"),
      codes(rec([act({ id: "l", title: "DueIn5", dueDate: "2026-08-30" })])).join(","));
  }

  // ============================== 5. explanation and counterfactual (§18, §19)

  {
    const r = rec([act({ id: "m", title: "DueToday3", dueDate: T }), act({ id: "n", title: "DueFar", dueDate: FAR })]);
    ok("5.1 every recommendation has at least one reason", (r.recommendation?.reasons.length ?? 0) > 0);
    ok("5.2 …and a short comparison", !!r.recommendation?.counterfactual, r.recommendation?.counterfactual);
    ok("5.3 …naming the alternative", /DueFar/.test(r.recommendation?.counterfactual ?? ""));
    ok("5.4 …in one sentence, not a narrative",
      (r.recommendation?.counterfactual ?? "").length < 160, String((r.recommendation?.counterfactual ?? "").length));
    // A sole candidate has nothing to compare against.
    ok("5.5 a sole candidate carries no counterfactual",
      !rec([act({ id: "o2", title: "Only" })]).recommendation?.counterfactual);
    // Where only the stable tie-breaker separated them there is nothing to say,
    // and the recommender says nothing rather than dressing it up.
    ok("5.6 no counterfactual is invented from the tie-breaker",
      rec([act({ id: "p5", title: "A", dueDate: YESTERDAY }), act({ id: "p6", title: "B", dueDate: YESTERDAY })]).recommendation === null);

    // ---- the counterfactual may not state a fact the record does not carry.
    //
    // All three were found by the §30 claim retest, not by section 5's own
    // fixtures — each fixture happened to give the runner-up the property the
    // sentence assumed, so the clause read true while the code was wrong.
    {
      // (i) an UNDATED runner-up was described as "due later".
      const cf1 = rec([act({ id: "u1", title: "DueToday4", dueDate: T }), act({ id: "u2", title: "Undated" })])
        .recommendation?.counterfactual ?? "";
      ok("5.7 an undated runner-up is never called 'due later'", !/Undated is due later/.test(cf1), cf1);
      ok("5.8 …it is described as having no date", /Undated has no date/.test(cf1), cf1);
      // …while a genuinely later-dated one still reads as due later.
      const cf2 = rec([act({ id: "u3", title: "DueToday5", dueDate: T }), act({ id: "u4", title: "Later", dueDate: FAR })])
        .recommendation?.counterfactual ?? "";
      ok("5.9 …and a dated one still does", /Later is due later/.test(cf2), cf2);

      // (ii) a runner-up that DOES unblock work was told it unblocks nothing.
      const s = emptyState();
      s.nextActions = [
        act({ id: "k1", title: "BigBlocker" }), act({ id: "k2", title: "SmallBlocker" }),
        act({ id: "k3", title: "Dep1" }), act({ id: "k4", title: "Dep2" }), act({ id: "k5", title: "Dep3" }),
      ];
      s.actionDependencies = [
        dep("z1", "k1", "k3"), dep("z2", "k1", "k4"), dep("z3", "k2", "k5"),
      ] as StoreState["actionDependencies"];
      const cf3 = recommendNextAction(s, buildTodayIndexes(s, T, "09:00"), T).recommendation?.counterfactual ?? "";
      ok("5.10 a runner-up that unblocks something is not told it unblocks nothing",
        !/SmallBlocker doesn't unblock anything/.test(cf3), cf3);
      ok("5.11 …the comparison is stated as a count of records", /unblocks more/.test(cf3), cf3);

      // (iii) a dated runner-up was told it had "no date pressing on it".
      const s2 = emptyState();
      s2.nextActions = [
        act({ id: "v1", title: "CameBackToday", history: [
          { id: "vh", action: "returned", at: iso(T), fromStatus: "deferred", toStatus: "open", detail: T },
        ] as NextAction["history"] }),
        act({ id: "v2", title: "DatedFar", dueDate: FAR }),
      ];
      const cf4 = recommendNextAction(s2, buildTodayIndexes(s2, T, "09:00"), T).recommendation?.counterfactual ?? "";
      ok("5.12 a runner-up WITH a date is never said to have none",
        !/DatedFar has no date/.test(cf4), cf4);
    }
  }

  // ============================== 6. negative assertions (§25)

  {
    const r = rec([act({ id: "q", title: "Q", dueDate: YESTERDAY })]);
    const blob = JSON.stringify(r);
    ok("6.A no numeric score field anywhere",
      !/"(?:score|weight|rank|points|value)":\s*-?\d/.test(blob), blob.slice(0, 200));
    ok("6.B no urgency/risk/priority metric",
      !/"(?:urgency|risk|priority|importance|confidence)":/i.test(blob));
    ok("6.C no percentage in any reason text", !/%/.test(texts(r)));
    ok("6.J no filler recommendation when evidence is weak",
      rec([act({ id: "r3", title: "X" }), act({ id: "r4", title: "Y" })]).recommendation === null);
    // Language.
    const all = [texts(r), r.recommendation?.counterfactual ?? "", NO_STANDOUT].join(" ");
    eq("6.x no forbidden Today language", violatesTodayLanguage(all), []);
    ok("6.x2 no imperative pressure",
      !/you need to|you should definitely|highest priority|this is urgent/i.test(all), all);
  }

  // ============================== 7. resolution + Memory bridges (§20, §21)

  {
    const s = emptyState();
    s.nextActions = [act({ id: "z1", title: "DueTodayZ", dueDate: T })];
    const ix = buildTodayIndexes(s, T, "09:00");
    const r = recommendNextAction(s, ix, T);
    const actions = resolutionsForAction(s, r.recommendation!.action.id, { today: T, ix });
    ok("7.1 the recommended action carries resolution controls", actions.length > 0);
    ok("7.2 …from the shared resolver, including completion",
      actions.some((a) => a.kind === "complete_action"));
    ok("7.3 …and never a recommendation-specific mutation kind",
      actions.every((a) => ["complete_action", "complete_occurrence", "defer", "reschedule", "open_record"].includes(a.kind)),
      actions.map((a) => a.kind).join(","));

    // §21. The question routes, and to the same builder.
    for (const q of ["What should I do next?", "What should I work on?", "What next?"]) {
      eq(`7.x "${q}" routes to NEXT_ACTION`, planMemoryQuery(q, { today: T })?.kind, "NEXT_ACTION");
    }
    const answer = answerMemoryQuery(s, "What should I do next?", { today: T, todayIndexes: ix });
    eq("7.4 Memory answers with the same action", answer.items[0]?.ref?.id, r.recommendation!.action.id);
    eq("7.5 …and the same status when one stands out", answer.status, "ANSWERED");
    ok("7.6 …carrying the same reasons",
      codes(r).every((c) => (answer.items[0]?.evidence ?? "").includes(c)),
      answer.items[0]?.evidence);

    // A tie in Memory is a tie on Today. No second guidance path means no
    // second answer.
    const tied = emptyState();
    tied.nextActions = [act({ id: "z2", title: "A", dueDate: YESTERDAY }), act({ id: "z3", title: "B", dueDate: YESTERDAY })];
    const tix = buildTodayIndexes(tied, T, "09:00");
    const tiedAnswer = answerMemoryQuery(tied, "What should I do next?", { today: T, todayIndexes: tix });
    eq("7.7 a tie gives Memory no standout either", tiedAnswer.status, "NO_RECORDED_EVIDENCE");
    eq("7.8 …with the same wording Today uses", tiedAnswer.summary, NO_STANDOUT);
    ok("7.9 …and names nothing", tiedAnswer.items.length === 0);
  }

  // ============================== 8. purity and no persistence (§29)

  {
    const s = emptyState();
    s.nextActions = [act({ id: "y1", title: "Y", dueDate: YESTERDAY })];
    const ix = buildTodayIndexes(s, T, "09:00");
    const before = JSON.stringify(s);
    const a = recommendNextAction(s, ix, T);
    const b = recommendNextAction(s, ix, T);
    eq("8.1 recommending mutates nothing", JSON.stringify(s), before);
    eq("8.2 …and is deterministic", JSON.stringify(a), JSON.stringify(b));
    ok("8.3 the recommendation has no id", !("id" in (a.recommendation as unknown as Record<string, unknown>)));
    eq("8.4 the store still has 46 domains", STORE_DOMAINS.length, 46);
    // The only domain whose name brushes this sprint's vocabulary is `recommendations`,
    // which is the pre-existing research-recommendation domain and predates guidance.
    eq("8.5 no guidance domain was added",
      (STORE_DOMAINS as string[]).filter((d) => /guidance|recommend|ranking|priorit/i.test(d)).join(","),
      "recommendations");
    ok("8.6 …and guidance persists nothing of its own",
      !(STORE_DOMAINS as string[]).some((d) => /nextAction.*(score|rank)|suggest/i.test(d)));
  }

  // ============================== 9. performance (§27)

  {
    for (const [n, budget] of [[100, 200], [1000, 500], [5000, 2500]] as Array<[number, number]>) {
      const s = emptyState();
      const day = (i: number) => {
        const d = new Date(Date.UTC(2026, 7, 25));
        d.setUTCDate(d.getUTCDate() - (i % 90));
        return d.toISOString().slice(0, 10);
      };
      s.nextActions = Array.from({ length: n }, (_, i) =>
        act({ id: `b${i}`, title: `Task ${i}`, createdAt: iso(day(i)), dueDate: i % 3 === 0 ? day(i) : undefined }));
      s.actionDependencies = Array.from({ length: Math.floor(n / 10) }, (_, i) =>
        dep(`bd${i}`, `b${i}`, `b${i + 1}`)) as StoreState["actionDependencies"];
      const ix = buildTodayIndexes(s, T, "09:00");
      const t0 = Date.now();
      recommendNextAction(s, ix, T);
      const ms = Date.now() - t0;
      ok(`9.x ${n} actions recommended in ${ms}ms`, ms < budget, `${ms}ms (budget ${budget}ms)`);
    }
  }

  const passed = results.filter((x) => x.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - started,
    results,
  };
}
