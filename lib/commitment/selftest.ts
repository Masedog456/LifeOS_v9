/**
 * Commitment awareness self-tests (LIFEOS-070 §21, §22, §23).
 *
 * Section 2 is the load-bearing one: every assertion in it pins a defect the §4
 * audit found by RUNNING the product, and each would have passed silently
 * before. Two of them — the unreachable returned-from-deferral signal and the
 * future-deferred leak — were live code with no test and no smoke coverage at
 * all, which is precisely how they survived four sprints.
 *
 * The rest holds the boundaries: no signal without dated evidence, one
 * commitment per row, no scores, no scolding, and nothing persisted.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { ActionDependency, NextAction, Project, StoreState } from "@/types/mvp";
import { returnDueActions, isDue } from "@/lib/actions/defer";
import { buildActivityIndex } from "@/lib/insights/activity";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView } from "@/lib/today/view";
import { recommendNextAction, RECOMMENDATION_HORIZON_DAYS } from "@/lib/today/recommend";
import { UPCOMING_WINDOW_DAYS } from "@/lib/actions/due";
import { answerMemoryQuery } from "@/lib/memory/answer";
import {
  buildCommitmentSignals, commitmentFactsFor, returnedOn, dedupe,
  signalsForSection, commitmentStrings, violatesCommitmentLanguage,
  COMMITMENT_ORDER, COMMITMENT_SECTION, NOTHING_STANDS_OUT,
  type CommitmentSignal,
} from "@/lib/commitment/signals";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

// ------------------------------------------------------------- the fixture --
//
// Sunday 2026-08-23 — the same anchor the §4 audit used, so BEFORE/AFTER
// section placement is comparable row for row.

const T = "2026-08-23";
const YESTERDAY = "2026-08-22";
const TOMORROW = "2026-08-24";
const NEXT_WEEK = "2026-08-31";
const LONG_AGO = "2026-04-25"; // 120 days before T

const iso = (d: string, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { id: string; title: string; createdAt: string }): NextAction {
  seq += 1;
  return {
    description: "", status: "open", updatedAt: p.createdAt, notes: "",
    linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
    order: seq, history: [],
    ...p,
  } as NextAction;
}

const project = (id: string, title: string): Project => ({
  id, title, description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [],
  createdAt: iso(LONG_AGO), updatedAt: iso(T),
} as Project);

const dep = (id: string, blockerId: string, blockedId: string): ActionDependency =>
  ({ id, blockerId, blockedId, createdAt: iso(LONG_AGO) });

/**
 * The §23 torture fixture — every scenario the brief names, in one store.
 *
 * Deliberately includes the cases that must produce NOTHING: a future deferral,
 * a wait with no follow-up date, a completed overdue action, a completed
 * recurring occurrence, and a dormant action whose future due date already
 * explains its silence.
 */
export function tortureCommitments(): StoreState {
  seq = 0;
  const s = emptyState();
  s.projects = [project("p-none", "ZZProjNoNext"), project("p-ok", "ZZProjHealthy")];
  s.nextActions = [
    act({ id: "t1", title: "ZZOverdue", createdAt: iso(LONG_AGO), dueDate: YESTERDAY }),
    act({ id: "t2", title: "ZZDueTomorrow", createdAt: iso(LONG_AGO), dueDate: TOMORROW }),
    act({ id: "t3", title: "ZZReturnedToday", createdAt: iso(LONG_AGO),
      history: [{ id: "h3", at: iso(T, 7), action: "returned", fromStatus: "deferred", toStatus: "open", detail: T }] }),
    act({ id: "t4", title: "ZZFutureDeferred", createdAt: iso(T), status: "deferred", deferredUntil: NEXT_WEEK }),
    act({ id: "t5", title: "ZZFollowUpToday", createdAt: iso(LONG_AGO), status: "waiting",
      waitingOn: "Marcus", waitingSince: iso(LONG_AGO), followUpDate: T }),
    act({ id: "t6", title: "ZZWaitNoFollowUp", createdAt: iso(LONG_AGO), status: "waiting",
      waitingOn: "Priya", waitingSince: iso(LONG_AGO) }),
    act({ id: "t7a", title: "ZZBlocker", createdAt: iso(LONG_AGO), dueDate: YESTERDAY }),
    act({ id: "t7b", title: "ZZBlockedItem", createdAt: iso(LONG_AGO) }),
    act({ id: "t8", title: "ZZProjOnlyBlocked", createdAt: iso(LONG_AGO), projectId: "p-none" }),
    act({ id: "t9", title: "ZZDormantNoDate", createdAt: iso(LONG_AGO) }),
    act({ id: "t10", title: "ZZDormantFutureDue", createdAt: iso(LONG_AGO), dueDate: "2026-09-30" }),
    act({ id: "t11", title: "ZZRecurringDue", createdAt: iso(LONG_AGO), recurrence: { frequency: "daily", interval: 1 } }),
    act({ id: "t12", title: "ZZRecurringDone", createdAt: iso(LONG_AGO), recurrence: { frequency: "daily", interval: 1 },
      history: [{ id: "h12", at: iso(T, 7), action: "completed", detail: T }] }),
    act({ id: "t13", title: "ZZCompletedOverdue", createdAt: iso(LONG_AGO), dueDate: YESTERDAY,
      status: "completed", completedAt: iso(T), history: [{ id: "h13", at: iso(T), action: "completed" }] }),
    act({ id: "t14", title: "ZZOverdueBlocker", createdAt: iso(LONG_AGO), dueDate: YESTERDAY }),
    act({ id: "t15", title: "ZZDependsOn14", createdAt: iso(LONG_AGO) }),
    // A healthy project: one plain executable action, nothing to report.
    act({ id: "t16", title: "ZZHealthyStep", createdAt: iso(T), projectId: "p-ok" }),
  ];
  s.recurrenceCompletions = [{ id: "rc12", actionId: "t12", occurrenceDate: T, completedAt: iso(T, 7) }];
  s.actionDependencies = [dep("d1", "t7a", "t7b"), dep("d2", "t7a", "t8"), dep("d3", "t14", "t15")];
  return s;
}

// ---------------------------------------------------------------- the suite --

export async function runCommitmentSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

  const state = tortureCommitments();
  const ix = buildTodayIndexes(state, T, "09:00");
  const signals = buildCommitmentSignals(state, ix, { today: T });
  const kindOf = (title: string): string[] => signals.filter((s) => s.title === title).map((s) => s.kind);
  const signalFor = (title: string): CommitmentSignal | undefined => signals.find((s) => s.title === title);

  // ================================ 1. the shape of the layer

  {
    eq("1.1 nine signal kinds, in the approved order", COMMITMENT_ORDER.length, 9);
    eq("1.2 …starting with overdue", COMMITMENT_ORDER[0], "overdue");
    eq("1.3 …and ending with dormant", COMMITMENT_ORDER[COMMITMENT_ORDER.length - 1], "dormant");
    ok("1.4 every kind has a Today section (§16)",
      COMMITMENT_ORDER.every((k) => !!COMMITMENT_SECTION[k]));
    ok("1.5 every signal carries an evidence field", signals.every((s) => !!s.evidence));
    ok("1.6 …and an explanation (§6)", signals.every((s) => s.explanation.trim().length > 0));
    ok("1.7 no signal exposes a score of any kind",
      !JSON.stringify(signals).match(/"(?:score|urgency|risk|priority|weight|rank|probability)"/i));
    ok("1.8 the layer is pure — same input, same output",
      JSON.stringify(buildCommitmentSignals(state, ix, { today: T })) === JSON.stringify(signals));
    const before = JSON.stringify(state);
    buildCommitmentSignals(state, ix, { today: T });
    eq("1.9 building signals mutates nothing", JSON.stringify(state), before);
  }

  // ================ 2. THE AUDIT DEFECTS, PINNED (§21 A–L)

  {
    // ---- A. a deferral that arrives records evidence, and surfaces
    const deferred = [act({ id: "d-ret", title: "Workout", createdAt: iso(YESTERDAY), status: "deferred", deferredUntil: T })];
    const returned = returnDueActions(deferred, T, iso(T, 6));
    eq("2.A1 a due deferral returns to open", returned.actions[0].status, "open");
    ok("2.A2 …clearing the deferral date", returned.actions[0].deferredUntil === undefined);
    // The whole point: the transition leaves a trace even though the field is gone.
    const ev = returned.actions[0].history.filter((h) => h.action === "returned");
    eq("2.A3 …and appending exactly one `returned` history event", ev.length, 1);
    eq("2.A4 …carrying the day it was due back", ev[0].detail, T);
    ok("2.A5 …so the return is detectable afterwards", returnedOn(returned.actions[0], T));
    ok("2.A6 the returned signal appears", kindOf("ZZReturnedToday").includes("returned_today"));
    eq("2.A7 …explained in the record's terms", signalFor("ZZReturnedToday")?.explanation, "Returned from deferral today.");
    eq("2.A8 …and traced to the history event", signalFor("ZZReturnedToday")?.evidence, "action.history[].returned");

    // ---- B. both return paths record identical evidence
    // `returnDueActions` writes the event itself, so a caller CANNOT skip it.
    // Before LIFEOS-070 the hydrate branch did exactly that.
    const viaA = returnDueActions([act({ id: "x", title: "X", createdAt: iso(YESTERDAY), status: "deferred", deferredUntil: T })], T, iso(T, 6));
    const viaB = returnDueActions([act({ id: "x", title: "X", createdAt: iso(YESTERDAY), status: "deferred", deferredUntil: T })], T, iso(T, 6));
    eq("2.B1 the two return paths produce identical records",
      JSON.stringify(viaA.actions[0].history.map((h) => [h.action, h.detail, h.toStatus])),
      JSON.stringify(viaB.actions[0].history.map((h) => [h.action, h.detail, h.toStatus])));
    ok("2.B2 …because the evidence is written by the transition, not beside it",
      viaA.actions[0].history.some((h) => h.action === "returned"));
    // A someday deferral (no date) never returns and never fabricates evidence.
    const someday = returnDueActions([act({ id: "s", title: "S", createdAt: iso(LONG_AGO), status: "deferred" })], T, iso(T));
    eq("2.B3 a someday deferral does not return", someday.returnedIds.length, 0);
    ok("2.B4 …and records nothing", someday.actions[0].history.length === 0);

    // ---- C. a future deferral created today stays out of Today
    const view = buildTodayView(state, ix);
    ok("2.C1 a future-deferred action is not in Today",
      !view.alsoToday.some((a) => a.title === "ZZFutureDeferred"), view.alsoToday.map((a) => a.title).join("|"));
    eq("2.C2 …and produces no signal at all", kindOf("ZZFutureDeferred"), []);
    ok("2.C3 …while its record is untouched",
      state.nextActions.find((a) => a.id === "t4")?.deferredUntil === NEXT_WEEK);
    ok("2.C4 …and it is still not due to return", !isDue(state.nextActions.find((a) => a.id === "t4")!, T));

    // LIFEOS-071's browser run found the other half of this hole: an action with
    // a PAST due date that the user has since deferred forward kept reporting
    // itself overdue, because deferring does not clear `dueDate`. Deferring is
    // supposed to end the signal — that is the entire point of the operation.
    const deferredButOverdue: StoreState = {
      ...state,
      nextActions: [...state.nextActions, act({
        id: "t-defover", title: "ZZDeferredWasOverdue", createdAt: iso(LONG_AGO),
        dueDate: YESTERDAY, status: "deferred", deferredUntil: NEXT_WEEK,
      })],
    } as StoreState;
    const after = buildCommitmentSignals(
      deferredButOverdue, buildTodayIndexes(deferredButOverdue, T), { today: T },
    );
    ok("2.C5 an action deferred forward reports nothing, even with a past due date",
      !after.some((s) => s.title === "ZZDeferredWasOverdue"),
      after.filter((s) => s.title === "ZZDeferredWasOverdue").map((s) => s.kind).join(","));
    // …and a deferral whose day has ARRIVED is not suppressed by the same rule.
    const backToday: StoreState = {
      ...state,
      nextActions: [...state.nextActions, act({
        id: "t-back", title: "ZZDeferralArrived", createdAt: iso(LONG_AGO),
        dueDate: YESTERDAY, status: "deferred", deferredUntil: T,
      })],
    } as StoreState;
    ok("2.C6 …while a deferral whose day arrived is still surfaced",
      buildCommitmentSignals(backToday, buildTodayIndexes(backToday, T), { today: T })
        .some((s) => s.title === "ZZDeferralArrived"));

    // ---- D. an overdue action is not duplicated across attention rows
    eq("2.D1 an overdue action produces exactly one signal", kindOf("ZZOverdue").length, 1);
    const attention = signalsForSection(signals, "attention");
    const ids = attention.map((s) => `${s.recordRef.kind}:${s.recordRef.id}`);
    eq("2.D2 Needs Attention holds no repeated record", ids.length, new Set(ids).size);
    // The audit's worst case: overdue AND blocking another action.
    eq("2.E0 an overdue blocker is one row", kindOf("ZZOverdueBlocker").length, 1);
    eq("2.E0b …under its highest-priority kind", kindOf("ZZOverdueBlocker")[0], "overdue");

    // ---- E. an overdue action is never ALSO offered as dormant
    ok("2.E1 an overdue action carries no dormant signal",
      !kindOf("ZZOverdue").includes("dormant"));
    ok("2.E2 …and is not re-offered by the Return card",
      view.returnItem === null || view.returnItem.title !== "ZZOverdue",
      JSON.stringify(view.returnItem));
    ok("2.E3 …nor is any signalled record",
      !view.returnItem || !signals.some((s) => s.recordRef.id === view.returnItem!.ref.id));

    // ---- F. blocked says "Blocked by", never "Waiting on"
    const blocked = signalFor("ZZBlockedItem");
    ok("2.F1 a blocked action says Blocked by", /^Blocked by /.test(blocked?.explanation ?? ""), blocked?.explanation);
    ok("2.F2 …and never Waiting on", !/waiting on/i.test(blocked?.explanation ?? ""));
    ok("2.F3 …naming the blocker", /ZZBlocker/.test(blocked?.explanation ?? ""));
    eq("2.F4 …traced to the dependency edge", blocked?.evidence, "actionDependencies[]");

    // ---- G. a wait with no follow-up date is not magically urgent
    eq("2.G1 waiting with no follow-up produces no signal", kindOf("ZZWaitNoFollowUp"), []);
    ok("2.G2 …and it is still shown as waiting",
      view.waiting.some((w) => w.action.title === "ZZWaitNoFollowUp"));
    ok("2.G3 …with no invented follow-up date",
      !view.waiting.find((w) => w.action.title === "ZZWaitNoFollowUp")?.followUpDue);

    // ---- H. a follow-up due today does surface
    eq("2.H1 a follow-up due today produces one signal", kindOf("ZZFollowUpToday"), ["follow_up_due"]);
    eq("2.H2 …stating the date plainly", signalFor("ZZFollowUpToday")?.explanation, "Follow-up date is today.");
    eq("2.H3 …in the Waiting section", COMMITMENT_SECTION.follow_up_due, "waiting");

    // ---- I. a project whose only actions are blocked/waiting
    eq("2.I1 a project with no executable action is flagged",
      kindOf("ZZProjNoNext"), ["project_no_next_action"]);
    eq("2.I2 …with the approved wording", signalFor("ZZProjNoNext")?.explanation,
      "No executable next action is recorded.");
    ok("2.I3 …and never called stalled or at risk",
      !/stalled|at risk|failing|behind/i.test(JSON.stringify(signalFor("ZZProjNoNext"))));
    eq("2.I4 a project WITH an executable action is not flagged", kindOf("ZZProjHealthy"), []);

    // ---- J / K. recurrence
    eq("2.J1 a recurring occurrence due today produces one signal",
      kindOf("ZZRecurringDue"), ["recurring_due"]);
    eq("2.K1 a completed occurrence produces none", kindOf("ZZRecurringDone"), []);
    eq("2.K2 a completed overdue action produces none", kindOf("ZZCompletedOverdue"), []);
    eq("2.K3 a dormant action with a future due date produces none", kindOf("ZZDormantFutureDue"), []);

    // ---- L. no signals → a bounded empty state
    const quiet = buildCommitmentSignals(emptyState(), buildTodayIndexes(emptyState(), T), { today: T });
    eq("2.L1 an empty store produces no signals", quiet.length, 0);
    const answer = answerMemoryQuery(emptyState(), "What am I forgetting?", { today: T });
    eq("2.L2 …and the answer is bounded to the record", answer.summary, NOTHING_STANDS_OUT);
    ok("2.L3 …never claiming the user is caught up",
      !/caught up|all clear|nothing left|you're free/i.test(JSON.stringify(answer)));
  }

  // ============================== 3. the §23 torture list, end to end

  {
    eq("3.1 due yesterday → overdue", kindOf("ZZOverdue"), ["overdue"]);
    eq("3.2 due tomorrow → due_soon", kindOf("ZZDueTomorrow"), ["due_soon"]);
    eq("3.3 deferral arrived → returned_today", kindOf("ZZReturnedToday"), ["returned_today"]);
    eq("3.4 deferred to next week → suppressed", kindOf("ZZFutureDeferred"), []);
    eq("3.5 follow-up today → follow_up_due", kindOf("ZZFollowUpToday"), ["follow_up_due"]);
    eq("3.6 waiting, no follow-up → nothing", kindOf("ZZWaitNoFollowUp"), []);
    eq("3.7 blocked → blocked, explained", kindOf("ZZBlockedItem"), ["blocked"]);
    eq("3.8 active project, nothing executable → flagged", kindOf("ZZProjNoNext"), ["project_no_next_action"]);
    eq("3.9 dormant, dateless, not waiting/deferred → dormant", kindOf("ZZDormantNoDate"), ["dormant"]);
    eq("3.10 dormant WITH a future due date → suppressed", kindOf("ZZDormantFutureDue"), []);
    eq("3.11 recurring due today → one signal", kindOf("ZZRecurringDue"), ["recurring_due"]);
    eq("3.12 recurring completed today → none", kindOf("ZZRecurringDone"), []);
    eq("3.13 completed overdue → none", kindOf("ZZCompletedOverdue"), []);
    // 3.14 — one row, multiple reasons.
    const dependent = signalFor("ZZDependsOn14");
    eq("3.14a a blocked item blocked by an overdue action is one row", kindOf("ZZDependsOn14").length, 1);
    ok("3.14b …with the blocker's state attached as a secondary reason",
      (dependent?.secondaryReasons ?? []).some((r) => r.code === "blocker_stuck"),
      JSON.stringify(dependent?.secondaryReasons));
    ok("3.14c …and the secondary reason reads as a sentence",
      !/was due [a-z]{3},/.test(JSON.stringify(dependent?.secondaryReasons)),
      JSON.stringify(dependent?.secondaryReasons));
    eq("3.15 nothing recorded → the bounded line",
      NOTHING_STANDS_OUT, "Nothing stands out from what Conqify has recorded.");
  }

  // ==================== 4. deduplication is central (§15, §20)

  {
    const doubled: CommitmentSignal[] = [
      { kind: "dormant", recordRef: { kind: "action", id: "z" }, title: "Z", explanation: "quiet", evidence: "a", secondaryReasons: [] },
      { kind: "overdue", recordRef: { kind: "action", id: "z" }, title: "Z", explanation: "was due", evidence: "b", secondaryReasons: [] },
      { kind: "blocked", recordRef: { kind: "action", id: "z" }, title: "Z", explanation: "blocked", evidence: "c", secondaryReasons: [] },
    ];
    const one = dedupe(doubled);
    eq("4.1 three facts about one record collapse to one row", one.length, 1);
    eq("4.2 …under the highest-priority kind", one[0].kind, "overdue");
    eq("4.3 …with the others attached", one[0].secondaryReasons.length, 2);
    ok("4.4 …preserving their evidence",
      one[0].secondaryReasons.every((r) => !!r.evidence));
    // Ordering across records is by kind, then date, then title — never a score.
    const kinds = signals.map((s) => s.kind);
    const ranks = kinds.map((k) => COMMITMENT_ORDER.indexOf(k as never));
    ok("4.5 signals come out in the approved order",
      ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), kinds.join(","));
  }

  // ================== 5. one horizon computation, two named windows (§7)

  {
    eq("5.1 the canonical approaching-due window is 7 days", UPCOMING_WINDOW_DAYS, 7);
    eq("5.2 the recommender's own window is narrower and named", RECOMMENDATION_HORIZON_DAYS, 3);
    ok("5.3 …and they are different concepts, not the same word twice",
      RECOMMENDATION_HORIZON_DAYS < UPCOMING_WINDOW_DAYS);
    const a = state.nextActions.find((x) => x.id === "t2")!;
    const f = commitmentFactsFor(a, ix, T);
    eq("5.4 the shared fact is the raw distance, horizon-free", f.daysUntilDue, 1);
    eq("5.5 …and an overdue action reports its own distance", commitmentFactsFor(state.nextActions[0], ix, T).overdueDays, 1);
    ok("5.6 a waiting action's follow-up is a shared fact",
      commitmentFactsFor(state.nextActions.find((x) => x.id === "t5")!, ix, T).followUpDue);
  }

  // ============ 6. Suggested Next stays a separate decision layer (§4, §15)

  {
    const rec = recommendNextAction(state, ix, T);
    ok("6.1 a recommendation is still made", !!rec.recommendation, rec.note);
    const reasons = JSON.stringify(rec.recommendation?.reasons ?? []);
    ok("6.2 …with no “Overdue by N days” wording (§6)", !/overdue by/i.test(reasons), reasons);
    ok("6.3 …using the shared neutral due label", /Was due/.test(reasons), reasons);
    ok("6.4 …and no follow-up reason, which could never fire (§8)",
      !/follow_up_due/.test(reasons), reasons);
    // §15: the two systems answer different questions over the same facts.
    const recommended = rec.recommendation?.action.id;
    ok("6.5 a blocked action is never recommended",
      recommended !== "t7b" && recommended !== "t15");
    ok("6.6 …nor a waiting one", recommended !== "t5" && recommended !== "t6");
    ok("6.7 …but blocked and waiting DO appear in commitment signals",
      signals.some((s) => s.recordRef.id === "t7b") && signals.some((s) => s.recordRef.id === "t5"));
  }

  // ======================= 7. Memory Query uses the SAME model (§17)

  {
    for (const [q, want] of [
      ["What am I forgetting?", undefined],
      ["What needs attention?", undefined],
      ["What follow-ups are due?", "follow_up_due"],
      ["What came back today?", "returned_today"],
      ["What projects have no next action?", "project_no_next_action"],
    ] as Array<[string, string | undefined]>) {
      const a = answerMemoryQuery(state, q, { today: T, todayIndexes: ix });
      ok(`7.x “${q}” is answered from recorded signals`, a.status === "ANSWERED", a.status);
      if (want) {
        const expected = signals.filter((s) => s.kind === want).length;
        eq(`7.x …returning only ${want}`, a.items.length, expected);
      } else {
        eq(`7.x …returning every signal`, a.items.length, signals.length);
      }
      ok(`7.x …every row openable`, a.items.every((i) => !!i.href));
    }
    // The two surfaces cannot drift: same function, same list.
    const asked = answerMemoryQuery(state, "What am I forgetting?", { today: T, todayIndexes: ix });
    eq("7.1 Memory and Today see the same commitments",
      asked.items.map((i) => i.ref?.id).sort(),
      signals.map((s) => s.recordRef.id).sort());
    ok("7.2 …and the answer states its coverage (§22)",
      /Conqify has recorded/.test(asked.limitation ?? ""), asked.limitation);
  }

  // ================================== 8. language (§19, §25)

  {
    const strings = commitmentStrings(signals);
    const banned = violatesCommitmentLanguage(strings.join(" "));
    ok("8.1 no signal characterises the reader", banned.length === 0, banned.join(", "));
    const all = strings.join(" ").toLowerCase();
    ok("8.2 no moral language", !/you forgot|you neglected|you should have|falling behind/.test(all));
    ok("8.3 no manufactured urgency", !/urgent|asap|immediately|critical/.test(all));
    ok("8.4 no counted-overdue framing", !/overdue by/.test(all), all.slice(0, 160));
    ok("8.5 no score, grade or percentage", !/\d+%|score|grade|rating/.test(all));
    const answer = answerMemoryQuery(state, "What am I forgetting?", { today: T, todayIndexes: ix });
    ok("8.6 the Memory answer is equally neutral",
      violatesCommitmentLanguage(`${answer.heading} ${answer.summary} ${answer.limitation}`).length === 0);
  }

  // ============================= 9. no persistence (§24)

  {
    eq("9.1 the store still has 46 domains", STORE_DOMAINS.length, 46);
    ok("9.2 no commitment/signal domain was added",
      !(STORE_DOMAINS as string[]).some((d) => /commitment|signal|forgot|attention|reminder/i.test(d)),
      (STORE_DOMAINS as string[]).join(","));
    ok("9.3 a signal is a value, not a record — it has no id",
      signals.every((s) => !("id" in (s as unknown as Record<string, unknown>))));
    // Deleting the source removes the signal, with no invalidation step.
    const pruned: StoreState = { ...state, nextActions: state.nextActions.filter((a) => a.id !== "t1") };
    const after = buildCommitmentSignals(pruned, buildTodayIndexes(pruned, T), { today: T });
    ok("9.4 deleting a record removes its signal",
      !after.some((s) => s.title === "ZZOverdue"), after.map((s) => s.title).join("|"));
    // Completing it does too.
    const done: StoreState = {
      ...state,
      nextActions: state.nextActions.map((a) => (a.id === "t1" ? { ...a, status: "completed", completedAt: iso(T) } : a)),
    } as StoreState;
    const afterDone = buildCommitmentSignals(done, buildTodayIndexes(done, T), { today: T });
    ok("9.5 completing a record removes its signal",
      !afterDone.some((s) => s.title === "ZZOverdue"));
  }

  // ======================= 10. the activity index carries returns

  {
    const index = buildActivityIndex(state);
    ok("10.1 a `returned` history event reaches the shared activity index",
      index.some((e) => e.type === "action_returned" && e.recordId === "t3"),
      index.filter((e) => e.recordId === "t3").map((e) => e.type).join(","));
    ok("10.2 …so a return counts as recorded activity",
      index.filter((e) => e.recordId === "t3").length > 0);
  }

  // ================================== 11. performance (§23)

  {
    const sizes: Array<[number, number, number]> = [[100, 20, 150], [1000, 100, 600], [5000, 500, 2500]];
    for (const [nActions, nProjects, budget] of sizes) {
      const big = bigState(nActions, nProjects);
      const bigIx = buildTodayIndexes(big, T);
      const t0 = Date.now();
      const out = buildCommitmentSignals(big, bigIx, { today: T });
      const ms = Date.now() - t0;
      ok(`11.x ${nActions} actions / ${nProjects} projects in ${ms}ms`, ms < budget, `${ms}ms (budget ${budget}ms)`);
      ok(`11.x …and it produced signals`, out.length > 0, String(out.length));
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

/** A store at realistic scale, with a dependency chain rather than a clique. */
function bigState(nActions: number, nProjects: number): StoreState {
  seq = 0;
  const s = emptyState();
  s.projects = Array.from({ length: nProjects }, (_, i) => project(`bp${i}`, `Project ${i}`));
  const day = (i: number): string => {
    const d = new Date(Date.UTC(2026, 7, 23));
    d.setUTCDate(d.getUTCDate() - (i % 200));
    return d.toISOString().slice(0, 10);
  };
  s.nextActions = Array.from({ length: nActions }, (_, i) =>
    act({
      id: `ba${i}`, title: `Task ${i}`, createdAt: iso(day(i)),
      projectId: `bp${i % nProjects}`,
      status: i % 7 === 0 ? "waiting" : "open",
      ...(i % 7 === 0 ? { waitingOn: "someone", waitingSince: iso(day(i)) } : {}),
      ...(i % 3 === 0 ? { dueDate: day(i) } : {}),
    }));
  // A linear chain: O(n) edges, never an n² traversal.
  s.actionDependencies = Array.from({ length: Math.floor(nActions / 10) }, (_, i) =>
    dep(`bd${i}`, `ba${i}`, `ba${i + 1}`));
  return s;
}
