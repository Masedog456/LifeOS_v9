/**
 * Replanning self-tests (LIFEOS-090).
 *
 * ## The red proofs this suite pins
 *
 * §2's audit ran the real store and found one generic control offered to every
 * kind of work:
 *
 *   1. deferring a WAIT set `status: "deferred"` and left `waitingOn: "Maria"`
 *      and `waitingSince` behind — the wait was orphaned, not cleared, and every
 *      surface that asks "what am I waiting on?" tests `status === "waiting"`
 *   2. deferring a RECURRING action parked the whole series
 *   3. rescheduling BLOCKED work said nothing about the blocker
 *   4. `batchAction(["plain","wait","recur"], "defer")` did 1 and 2 at once
 *   5. there was no "Not today" at all
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A replanning layer earns trust by what it refuses: to turn a wait into
 * scheduled work, to move one occurrence by moving a series, to guess at
 * "later", to count a neutral date change as a postponement, to treat "I'm not
 * doing this" as a delay, or to apply one mutation to a mixed selection.
 *
 * Pure: no store, no clock, no AI.
 */

import type { NextAction, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { recommendNextAction } from "@/lib/today/recommend";
import { repeatedlyPostponed } from "@/lib/memory/changes";
import { resolveRange } from "@/lib/insights/range";
import { resolutionsForAction, recommendationResolutionsFor, RESOLUTION_KINDS } from "@/lib/commitment/resolve";
import { extractTemporal } from "@/lib/capture/dates";
import { isLive } from "@/lib/actions/due";
import { isDeferredAhead } from "@/lib/actions/defer";
import { addDays, weekStartKey, type DayKey } from "@/lib/reviews/dates";
import {
  planReplan, applyReplan, summarize, notTodayChoices, restOfWeek, dayFor,
  replanStrings, NEEDS_A_DAY, RECURRING_NOTE, WAITING_NOTE, STOP_NOTE, REPLAN_FORBIDDEN_WORDS,
  type ReplanOps, type ReplanIntent, type ReplanProposal,
} from "@/lib/planning/replan";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** A Wednesday, so "the rest of this week" has days in it. */
const TODAY = "2026-09-09";
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

/** The audit's world. */
function world(): StoreState {
  return {
    ...emptyStoreState(),
    goals: [{ id: "g1", title: "Open the clinic", description: "", status: "active", priority: "medium",
      notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], history: [],
      createdAt: A(-60), updatedAt: A(-60) }],
    projects: [{ id: "p1", title: "Clinic launch", goalId: "g1", description: "", status: "active",
      priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: A(-60), updatedAt: A(-60) }],
    nextActions: [
      act({ id: "a-plain", title: "Pay the deposit", projectId: "p1", dueDate: D(0) }),
      act({ id: "a-over", title: "Send the signed lease", projectId: "p1", dueDate: D(-2) }),
      act({ id: "a-wait", title: "Transcript from Maria", projectId: "p1", status: "waiting",
        waitingOn: "Maria", waitingSince: A(-9), followUpDate: D(0) }),
      act({ id: "a-blocked", title: "Send final draft", projectId: "p1", dueDate: D(0) }),
      act({ id: "a-blocker", title: "Need legal review", projectId: "p1" }),
      act({ id: "a-recur", title: "Water the plants", projectId: "p1", dueDate: D(0),
        recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 4] } }),
      // Deferred three times — a genuine repeated postponement.
      act({ id: "a-thrice", title: "Email professor", projectId: "p1",
        history: [{ id: "e1", action: "created", at: A(-20) },
          { id: "e2", action: "deferred", at: A(-3, 10), detail: D(-2) },
          { id: "e3", action: "deferred", at: A(-2, 10), detail: D(-1) },
          { id: "e4", action: "deferred", at: A(-1, 10), detail: D(2) }] }),
      // Rescheduled three times and never deferred — must NOT read as postponed.
      act({ id: "a-resched", title: "Book the surveyor", projectId: "p1", dueDate: D(3),
        history: [{ id: "f1", action: "created", at: A(-20) },
          { id: "f2", action: "due_set", at: A(-3, 10), detail: D(1) },
          { id: "f3", action: "due_set", at: A(-2, 10), detail: D(2) },
          { id: "f4", action: "due_set", at: A(-1, 10), detail: D(3) }] }),
      act({ id: "a-direct", title: "Draft the business plan", goalId: "g1", dueDate: D(0) }),
      act({ id: "a-done", title: "Order transcripts", projectId: "p1", status: "completed", completedAt: A(-6) }),
    ],
    actionDependencies: [{ id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: A(-5) }],
  } as StoreState;
}

/** A recording ops double, so what WOULD be written is inspectable. */
function recorder() {
  const calls: string[] = [];
  const ops: ReplanOps = {
    completeAction: (id) => { calls.push(`completeAction:${id}`); },
    completeOccurrence: (id, day) => { calls.push(`completeOccurrence:${id}:${day}`); return true; },
    deferAction: (id, option) => { calls.push(`deferAction:${id}:${typeof option === "string" ? option : option.date}`); },
    setActionDueDate: (id, d) => { calls.push(`setActionDueDate:${id}:${d}`); },
    setNextFollowUpDate: (id, d) => { calls.push(`setNextFollowUpDate:${id}:${d}`); return true; },
    stopWaiting: (id) => { calls.push(`stopWaiting:${id}`); return true; },
    createAction: (input) => { calls.push(`createAction:${input.title}`); return "new"; },
    reopenAction: (id) => { calls.push(`reopenAction:${id}`); },
    uncompleteOccurrence: (id, day) => { calls.push(`uncompleteOccurrence:${id}:${day}`); },
    cancelAction: (id) => { calls.push(`cancelAction:${id}`); },
  };
  return { ops, calls };
}

export function runReplanSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const ix = buildTodayIndexes(s, TODAY, "09:00");
  const plan = (ids: string[], intent: ReplanIntent, st: StoreState = s) =>
    planReplan(st, ids, intent, st === s ? ix : buildTodayIndexes(st, TODAY, "09:00"), TODAY);
  const kindsFor = (id: string) => resolutionsForAction(s, id, { ix, today: TODAY }).map((r) => r.kind);

  // ==========================================================================
  // §4, §24, §26 — defer and reschedule are different facts.
  // ==========================================================================
  {
    const d = plan(["a-plain"], { kind: "defer", option: "tomorrow" });
    const r = plan(["a-plain"], { kind: "reschedule", day: D(4) });
    ok("90.1 §4 a defer maps to the deferral primitive",
      d.proposals[0]?.op === "deferAction", String(d.proposals[0]?.op));
    ok("90.2 §4 a reschedule maps to the due-date primitive",
      r.proposals[0]?.op === "setActionDueDate", String(r.proposals[0]?.op));
    ok("90.3 §4 …and they are never the same op", d.proposals[0]?.op !== r.proposals[0]?.op);

    // The audit measured this as already true. It is asserted because the thing
    // most likely to break it is this sprint.
    const range = resolveRange("last_7_days", { today: TODAY });
    const postponed = repeatedlyPostponed(s, range).map((p) => p.action.id);
    ok("90.4 §26 three deferrals read as repeated postponement",
      postponed.includes("a-thrice"), postponed.join());
    ok("90.5 §24 …and three neutral reschedules do NOT",
      !postponed.includes("a-resched"), postponed.join());
  }

  // ==========================================================================
  // §11 — RED 1. A wait is not deferred work.
  // ==========================================================================
  {
    const p = plan(["a-wait"], { kind: "defer", option: "tomorrow" });
    ok("90.6 §11 a wait cannot be deferred", p.proposals.length === 0, JSON.stringify(p.proposals));
    ok("90.7 §11 …it becomes an exception naming the wait",
      p.exceptions[0]?.reason === "waiting" && /Maria/.test(p.exceptions[0]?.note ?? ""),
      String(p.exceptions[0]?.note));
    ok("90.8 §11 …offering the follow-up instead, at the day already chosen",
      p.exceptions[0]?.instead?.op === "setNextFollowUpDate"
      && p.exceptions[0]?.instead?.day === D(1),
      JSON.stringify(p.exceptions[0]?.instead));
    ok("90.9 §11 …and that alternative keeps it waiting",
      p.exceptions[0]?.instead?.kind === "follow_up");

    const f = plan(["a-wait"], { kind: "follow_up", day: D(2) });
    ok("90.10 §11 a follow-up on a wait is a proposal",
      f.proposals[0]?.op === "setNextFollowUpDate" && f.proposals[0]?.day === D(2),
      JSON.stringify(f.proposals[0]));
    ok("90.11 §11 …explained as continuing the wait",
      /Keep waiting/.test(f.proposals[0]?.explanation ?? ""), String(f.proposals[0]?.explanation));

    // The row itself must not offer the operation that would damage it.
    ok("90.12 §11 a waiting row is offered the two honest operations",
      kindsFor("a-wait").includes("set_follow_up") && kindsFor("a-wait").includes("stop_waiting"),
      kindsFor("a-wait").join());
    ok("90.13 §11 …and never a plain reschedule",
      !kindsFor("a-wait").includes("reschedule"), kindsFor("a-wait").join());
    const notToday = resolutionsForAction(s, "a-wait", { ix, today: TODAY })
      .find((r) => r.kind === "not_today");
    ok("90.14 §11 …and if 'Not today' is shown at all it is disabled, with the reason",
      !notToday || (notToday.enabled === false && /waiting/i.test(notToday.explanation ?? "")),
      JSON.stringify(notToday));
    ok("90.15 §11 a follow-up off a wait has no meaning and is refused",
      plan(["a-plain"], { kind: "follow_up", day: D(2) }).exceptions.length === 1);
  }

  // ==========================================================================
  // §14, §15 — RED 2. One occurrence is not the series.
  // ==========================================================================
  {
    const p = plan(["a-recur"], { kind: "defer", option: "tomorrow" });
    ok("90.16 §14 a recurring record cannot be deferred",
      p.proposals.length === 0, JSON.stringify(p.proposals));
    ok("90.17 §15 …and the limitation is stated rather than faked",
      p.exceptions[0]?.reason === "recurring_series" && p.exceptions[0]?.note === RECURRING_NOTE,
      String(p.exceptions[0]?.note));
    ok("90.18 §14 …nor rescheduled, which would move the series anchor",
      plan(["a-recur"], { kind: "reschedule", day: D(4) }).proposals.length === 0);
    ok("90.19 §14 the row keeps the occurrence-scoped completion",
      kindsFor("a-recur").includes("complete_occurrence"), kindsFor("a-recur").join());
    ok("90.20 §14 …and never the one that would end the series",
      !kindsFor("a-recur").includes("complete_action"), kindsFor("a-recur").join());
    const nt = resolutionsForAction(s, "a-recur", { ix, today: TODAY }).find((r) => r.kind === "not_today");
    ok("90.21 §15 'Not today' is shown DISABLED with the reason, not hidden",
      nt?.enabled === false && nt?.explanation === RECURRING_NOTE, JSON.stringify(nt));
    ok("90.22 §15 no proposal in this layer can write a recurrence rule",
      !replanStrings(p).some((x) => /recurrence|every week|repeat every/i.test(x)),
      JSON.stringify(replanStrings(p)));
  }

  // ==========================================================================
  // §13 — RED 3. A blocker is a fact on the proposal, not a veto.
  // ==========================================================================
  {
    const p = plan(["a-blocked"], { kind: "defer", option: "tomorrow" });
    ok("90.23 §13 blocked work can still be replanned when the user insists",
      p.proposals.length === 1, JSON.stringify(p.exceptions));
    ok("90.24 §13 …with the blocker named on the proposal",
      /Need legal review/.test(p.proposals[0]?.blockerNote ?? ""), String(p.proposals[0]?.blockerNote));
    ok("90.25 §13 …saying plainly that the date does not unblock it",
      /won't unblock/.test(p.proposals[0]?.blockerNote ?? ""));
    ok("90.26 §30 …and it asks rather than running on the press",
      p.proposals[0]?.authority === "confirm", String(p.proposals[0]?.authority));
    ok("90.27 §13 the row leads with the blocker",
      kindsFor("a-blocked")[0] === "open_blocker", kindsFor("a-blocked").join());
    // Word-sniffing was the wrong test: the honest sentence is "won't unblock
    // it", so the word IS there. What must be true is that no proposal names an
    // op that could touch a dependency — the ops list is the real guard.
    ok("90.28 §46.5 no proposal names an op that could touch a dependency",
      p.proposals.every((x) => ["deferAction", "setActionDueDate", "setNextFollowUpDate", "cancelAction"].includes(x.op)),
      p.proposals.map((x) => x.op).join());
    // An unblocked action carries no blocker note and runs with undo.
    const plainP = plan(["a-plain"], { kind: "defer", option: "tomorrow" });
    ok("90.29 §29 an ordinary defer runs with undo",
      plainP.proposals[0]?.authority === "auto_with_undo" && !plainP.proposals[0]?.blockerNote,
      JSON.stringify(plainP.proposals[0]));
  }

  // ==========================================================================
  // §19 — RED 4. A mixed batch shows its exceptions.
  // ==========================================================================
  {
    const p = plan(["a-plain", "a-wait", "a-recur"], { kind: "defer", option: "next_week" });
    ok("90.30 §19 only the item the intent fits is proposed",
      p.proposals.map((x) => x.actionId).join() === "a-plain",
      p.proposals.map((x) => x.actionId).join());
    ok("90.31 §19 …and each exception carries its own reason",
      p.exceptions.map((x) => x.reason).sort().join() === "recurring_series,waiting",
      p.exceptions.map((x) => x.reason).join());
    ok("90.32 §19 the summary counts them separately",
      summarize(p) === "3 selected · 1 can move · 1 is waiting · 1 repeats", summarize(p));
    ok("90.33 §30 …and a batch always asks", p.requiresConfirmation === true);

    // §19. Applying takes PROPOSALS, so an excluded item cannot be swept in.
    const { ops, calls } = recorder();
    applyReplan(p.proposals, ops);
    ok("90.34 §19 applying the plan touches only the proposed item",
      calls.length === 1 && calls[0].startsWith("deferAction:a-plain"), calls.join(" | "));
    ok("90.35 §19 …so the wait and the series are untouched",
      !calls.some((c) => c.includes("a-wait") || c.includes("a-recur")), calls.join(" | "));

    // …unless the user explicitly takes the alternative offered.
    const { ops: ops2, calls: calls2 } = recorder();
    const taken = p.exceptions.filter((e) => e.instead).map((e) => e.instead as ReplanProposal);
    applyReplan([...p.proposals, ...taken], ops2);
    ok("90.36 §19 an exception moves only when its alternative is taken",
      calls2.some((c) => c.startsWith("setNextFollowUpDate:a-wait")), calls2.join(" | "));
    ok("90.37 §19 …and the recurring one offers no alternative at all",
      p.exceptions.find((e) => e.actionId === "a-recur")?.instead === undefined);
  }

  // ==========================================================================
  // §5, §7, §8 — the quick choices.
  // ==========================================================================
  {
    const c = notTodayChoices(TODAY);
    const ids = c.map((x) => x.id);
    ok("90.38 §5 tomorrow is offered", ids[0] === "tomorrow" && c[0].day === D(1), JSON.stringify(c[0]));
    ok("90.39 §8 next week reuses the store's own convention",
      c.find((x) => x.id === "next_week")?.day === addDays(weekStartKey(TODAY), 7),
      JSON.stringify(c.find((x) => x.id === "next_week")));
    ok("90.40 §5 someday is offered, and carries no date",
      c.find((x) => x.id === "someday")?.day === undefined);

    // §7. The parser refuses to date "later this week", so the days are offered
    // as themselves rather than as one guessed weekday.
    ok("90.41 §7 the parser classes “later this week” as vague",
      extractTemporal("later this week", TODAY).dueDate === undefined);
    ok("90.42 §7 …so the remaining days of the week are offered individually",
      c.filter((x) => x.id.startsWith("day:")).length === restOfWeek(TODAY).length
      && restOfWeek(TODAY).length > 0,
      JSON.stringify(c.filter((x) => x.id.startsWith("day:")).map((x) => x.label)));
    ok("90.43 §7 …every one of them a real day in this week",
      restOfWeek(TODAY).every((d) => d >= weekStartKey(TODAY) && d <= addDays(weekStartKey(TODAY), 6)),
      JSON.stringify(restOfWeek(TODAY)));
    ok("90.44 §7 …and tomorrow is not repeated under a second name",
      !restOfWeek(TODAY).includes(D(1)), JSON.stringify(restOfWeek(TODAY)));
    // A week with no days left offers none rather than inventing one.
    const sunday = "2026-09-13";
    ok("90.45 §7 a week with no days left offers none",
      restOfWeek(sunday).length === 0, JSON.stringify(restOfWeek(sunday)));
  }

  // ==========================================================================
  // §36 — vague language is never guessed at.
  // ==========================================================================
  {
    const p = plan(["a-plain"], { kind: "defer" });
    ok("90.46 §36 an intent with no day proposes nothing",
      p.proposals.length === 0, JSON.stringify(p.proposals));
    ok("90.47 §36 …and asks for one", p.exceptions[0]?.note === NEEDS_A_DAY, String(p.exceptions[0]?.note));
    ok("90.48 §36 …while someday, which IS a supported state, goes through",
      plan(["a-plain"], { kind: "defer", option: "someday" }).proposals[0]?.op === "deferAction");
    ok("90.49 §36 dayFor never invents a day",
      dayFor({ kind: "defer" }, TODAY) === undefined);
  }

  // ==========================================================================
  // §16, §17 — stop is a lifecycle change, never a delay.
  // ==========================================================================
  {
    const p = plan(["a-plain"], { kind: "stop" });
    ok("90.50 §16 stop maps to the lifecycle primitive",
      p.proposals[0]?.op === "cancelAction", String(p.proposals[0]?.op));
    // Same shape: STOP_NOTE says "it is not deleted", so the word is present on
    // purpose. The guard is that no delete primitive is reachable from here.
    ok("90.51 §17 …and no delete primitive is reachable from this layer",
      p.proposals.every((x) => x.op === "cancelAction"), p.proposals.map((x) => x.op).join());
    ok("90.51a §17 …with the wording saying so out loud",
      /not deleted/i.test(STOP_NOTE), STOP_NOTE);
    ok("90.52 §16 …and never to a deferral", p.proposals[0]?.op !== "deferAction");
    ok("90.53 §30 …and it always asks", p.requiresConfirmation === true && p.proposals[0]?.authority === "confirm");
    ok("90.54 §16 the wording says what happens, without implying a delay",
      /^Stop /.test(p.proposals[0]?.explanation ?? "") && !/later|postpone/i.test(p.proposals[0]?.explanation ?? ""),
      String(p.proposals[0]?.explanation));
    // §16. Stop applies to a wait and a series too — it is not replanning.
    ok("90.55 §16 stop reaches a waiting record",
      plan(["a-wait"], { kind: "stop" }).proposals[0]?.op === "cancelAction");
    ok("90.56 §16 …and a recurring one",
      plan(["a-recur"], { kind: "stop" }).proposals[0]?.op === "cancelAction");
  }

  // ==========================================================================
  // §21, §22, §23, §31 — what replanning must not disturb.
  // ==========================================================================
  {
    // §21. Nothing caches the recommendation; deferring the winner recomputes.
    const before = recommendNextAction(s, ix, TODAY).recommendation?.action.id;
    ok("90.57 §21 the recommender picks the overdue item first", before === "a-over", String(before));
    const deferred = {
      ...s,
      nextActions: (s.nextActions ?? []).map((a) =>
        a.id === "a-over" ? { ...a, status: "deferred" as const, deferredUntil: D(1) } : a),
    } as StoreState;
    const beforeR = recommendNextAction(s, ix, TODAY);
    const after = recommendNextAction(deferred, buildTodayIndexes(deferred, TODAY, "09:00"), TODAY);
    ok("90.58 §21 …and once it is deferred it is never recommended again",
      after.recommendation?.action.id !== "a-over", String(after.recommendation?.action.id));
    ok("90.58a §21 …because it left the pool the recommender considers",
      after.consideredCount === beforeR.consideredCount - 1,
      `${beforeR.consideredCount} -> ${after.consideredCount}`);
    // LIFEOS-072 declines when nothing stands out rather than picking one at
    // random, so the honest guarantee is a fresh answer — not a fresh pick.
    ok("90.58b §21 …and the answer is recomputed, not cached",
      !!after.recommendation || !!after.note, String(after.note));
    ok("90.59 §46.2 a deferred action is still live",
      isLive({ ...s.nextActions[0], status: "deferred" } as NextAction));
    ok("90.60 §5 …and it is out of today's way",
      isDeferredAhead({ ...s.nextActions[0], status: "deferred", deferredUntil: D(1) } as NextAction, TODAY));

    // §22, §23, §31. A proposal names an op and a day, and nothing else.
    const p = plan(["a-direct"], { kind: "defer", option: "tomorrow" });
    const fields = Object.keys(p.proposals[0] ?? {});
    ok("90.61 §22, §23 a proposal carries no project or goal field to disturb",
      !fields.includes("projectId") && !fields.includes("goalId"), fields.join());
    ok("90.62 §31 …and no priority field either",
      !fields.includes("priority"), fields.join());
    const { ops, calls } = recorder();
    applyReplan(p.proposals, ops);
    ok("90.63 §22, §23 applying calls one primitive and nothing else",
      calls.length === 1 && calls[0] === "deferAction:a-direct:tomorrow", calls.join(" | "));
    // §8. A named option is passed THROUGH to the store rather than resolved
    // here, so the store's own convention stays the only one.
    const dated = plan(["a-direct"], { kind: "defer", day: D(4) });
    const { ops: o2, calls: c2 } = recorder();
    applyReplan(dated.proposals, o2);
    ok("90.63a §8 …and an explicit day is passed as that day",
      c2[0] === `deferAction:a-direct:${D(4)}`, c2.join(" | "));
  }

  // ==========================================================================
  // §8 — a finished record is restored, not replanned.
  // ==========================================================================
  {
    const p = plan(["a-done"], { kind: "defer", option: "tomorrow" });
    ok("90.64 a completed record is not replanned",
      p.proposals.length === 0 && p.exceptions[0]?.reason === "not_live", JSON.stringify(p.exceptions[0]));
    ok("90.65 …and the note says what to do instead",
      /reopen/i.test(p.exceptions[0]?.note ?? ""), String(p.exceptions[0]?.note));
  }

  // ==========================================================================
  // §32, §35 — the words.
  // ==========================================================================
  {
    const all = [
      ...replanStrings(plan(["a-plain"], { kind: "defer", option: "tomorrow" })),
      ...replanStrings(plan(["a-wait"], { kind: "defer", option: "tomorrow" })),
      ...replanStrings(plan(["a-recur"], { kind: "defer", option: "tomorrow" })),
      ...replanStrings(plan(["a-blocked"], { kind: "reschedule", day: D(4) })),
      ...replanStrings(plan(["a-plain"], { kind: "stop" })),
    ].map((x) => x.toLowerCase());
    const bad = REPLAN_FORBIDDEN_WORDS.filter((w) => all.some((x) => x.includes(w)));
    ok("90.66 §32 nothing here reasons about the person", bad.length === 0, bad.join(" | "));
    ok("90.67 §35 …and no explanation is a percentage", !all.some((x) => /\d\s*%/.test(x)));
    ok("90.68 §35 an explanation is imperative and factual",
      /^Not today — back /.test(plan(["a-plain"], { kind: "defer", option: "tomorrow" }).proposals[0]?.explanation ?? ""),
      String(plan(["a-plain"], { kind: "defer", option: "tomorrow" }).proposals[0]?.explanation));
    ok("90.69 §41 no id appears in any rendered string",
      !all.some((x) => x.includes("a-plain") || x.includes("a-wait")), JSON.stringify(all.slice(0, 4)));
  }

  // ==========================================================================
  // §33 — one mutation path, and the row agrees with the batch.
  // ==========================================================================
  {
    ok("90.70 §33 every proposal names an existing store primitive",
      (["a-plain", "a-blocked", "a-direct"] as const).every((id) => {
        const p = plan([id], { kind: "defer", option: "tomorrow" });
        return p.proposals.every((x) =>
          ["deferAction", "setActionDueDate", "setNextFollowUpDate", "cancelAction"].includes(x.op));
      }));
    // The row's controls and the batch's judgement must agree about each record,
    // or the same action would mean different things in two places.
    for (const [id, canDefer] of [["a-plain", true], ["a-wait", false], ["a-recur", false]] as const) {
      const rowOffersIt = resolutionsForAction(s, id, { ix, today: TODAY })
        .some((r) => r.kind === "not_today" && r.enabled !== false);
      const batchAllowsIt = plan([id], { kind: "defer", option: "tomorrow" }).proposals.length > 0;
      ok(`90.71.${id} §33 the row and the batch agree about ${id}`,
        rowOffersIt === canDefer && batchAllowsIt === canDefer,
        `row=${rowOffersIt} batch=${batchAllowsIt} want=${canDefer}`);
    }
    ok("90.72 §5 'Not today' is part of the shared vocabulary",
      (RESOLUTION_KINDS as readonly string[]).includes("not_today"));
    ok("90.73 §33 …and a record with no action falls back to opening it",
      recommendationResolutionsFor(undefined, ix).join() === "open_record");
  }

  // ==========================================================================
  // §42 — replanning is instantaneous at size.
  // ==========================================================================
  {
    for (const n of [100, 1000, 5000]) {
      const big = {
        ...emptyStoreState(),
        nextActions: Array.from({ length: n }, (_, i) => act({ id: `b${i}`, title: `Action ${i}`, dueDate: D(0) })),
      } as StoreState;
      const bix = buildTodayIndexes(big, TODAY, "09:00");
      const t = Date.now();
      planReplan(big, [`b0`], { kind: "defer", option: "tomorrow" }, bix, TODAY);
      const one = Date.now() - t;
      const ids = Array.from({ length: Math.min(50, n) }, (_, i) => `b${i}`);
      const t2 = Date.now();
      const batch = planReplan(big, ids, { kind: "defer", option: "tomorrow" }, bix, TODAY);
      const many = Date.now() - t2;
      ok(`90.74.${n} one replan over ${n} actions is under 50ms`, one < 50, `${one}ms`);
      ok(`90.75.${n} …and a 50-item preview under 200ms`, many < 200, `${many}ms`);
      ok(`90.76.${n} …and the preview really did plan them all`,
        batch.proposals.length === ids.length, `${batch.proposals.length}/${ids.length}`);
    }
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
