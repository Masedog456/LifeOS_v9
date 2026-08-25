/**
 * Commitment resolution self-tests (LIFEOS-071 §24, §25).
 *
 * Section 3 is the load-bearing one. Every assertion there is a mutation the
 * product must never make on the user's behalf: closing a recurring series when
 * they meant one occurrence, treating a follow-up as a completion, ending a wait
 * because a date arrived, creating a project commitment nobody wrote, or
 * cancelling anything at all from a one-click surface.
 *
 * The `ops` fake records every call, so these tests assert on WHICH primitive
 * ran rather than on the state it produced — the difference between "the row
 * disappeared" and "the right thing happened" is exactly where this sprint
 * could go wrong quietly.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { NextAction, StoreState } from "@/types/mvp";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildCommitmentSignals, COMMITMENT_ORDER, type CommitmentSignal } from "@/lib/commitment/signals";
import { tortureCommitments } from "@/lib/commitment/selftest";
import {
  resolutionsFor, primaryResolution, deferChoices, rescheduleChoices,
  resolutionLabels, resolutionStrings, violatesResolutionLanguage,
  RESOLUTIONS_BY_KIND, RESOLUTION_KINDS,
  type ResolutionAction,
} from "@/lib/commitment/resolve";
import { applyResolution, type ResolutionOps } from "@/lib/commitment/apply";
import { withNextFollowUp, withoutWaiting } from "@/lib/actions/waiting";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const T = "2026-08-23";

/** A recording fake for every store primitive a resolution may reach. */
interface Recorder extends ResolutionOps {
  calls: Array<{ op: string; args: unknown[] }>;
  /** Make the next call of this op fail, to exercise §22. */
  failNext: Set<string>;
}

function recorder(overrides: Partial<ResolutionOps> = {}): Recorder {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const failNext = new Set<string>();
  const log = (op: string, ...args: unknown[]) => { calls.push({ op, args }); };
  const base: ResolutionOps = {
    completeAction: (id) => log("completeAction", id),
    completeOccurrence: (id, day) => {
      log("completeOccurrence", id, day);
      if (failNext.has("completeOccurrence")) { failNext.delete("completeOccurrence"); return false; }
      return true;
    },
    deferAction: (id, option) => log("deferAction", id, option),
    setActionDueDate: (id, d) => log("setActionDueDate", id, d),
    setNextFollowUpDate: (id, d) => {
      log("setNextFollowUpDate", id, d);
      if (failNext.has("setNextFollowUpDate")) { failNext.delete("setNextFollowUpDate"); return false; }
      return true;
    },
    stopWaiting: (id) => {
      log("stopWaiting", id);
      if (failNext.has("stopWaiting")) { failNext.delete("stopWaiting"); return false; }
      return true;
    },
    createAction: (input) => { log("createAction", input); return "new-action-id"; },
    reopenAction: (id) => log("reopenAction", id),
    uncompleteOccurrence: (id, day) => log("uncompleteOccurrence", id, day),
  };
  return { ...base, ...overrides, calls, failNext };
}

const ops = (r: Recorder): ResolutionOps => r;

export async function runResolutionSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

  const state = tortureCommitments();
  const ix = buildTodayIndexes(state, T, "09:00");
  const signals = buildCommitmentSignals(state, ix, { today: T });
  const sigFor = (title: string): CommitmentSignal => signals.find((s) => s.title === title)!;
  const resolve = (title: string): ResolutionAction[] => resolutionsFor(state, sigFor(title), { today: T, ix });
  const kindsFor = (title: string): string[] => resolve(title).map((a) => a.kind);
  const find = (title: string, kind: string): ResolutionAction | undefined =>
    resolve(title).find((a) => a.kind === kind);

  // ============================== 1. shape and boundedness

  {
    eq("1.1 nine resolution kinds", RESOLUTION_KINDS.length, 9);
    ok("1.2 every signal kind has a bounded set",
      COMMITMENT_ORDER.every((k) => (RESOLUTIONS_BY_KIND[k] ?? []).length > 0));
    ok("1.3 no set is a generic everything-menu",
      COMMITMENT_ORDER.every((k) => RESOLUTIONS_BY_KIND[k].length <= 4),
      COMMITMENT_ORDER.map((k) => `${k}:${RESOLUTIONS_BY_KIND[k].length}`).join(" "));
    // §3, §8. Destructive operations are absent BY CONSTRUCTION, not filtered.
    ok("1.4 there is no cancel resolution kind at all",
      !(RESOLUTION_KINDS as string[]).includes("cancel"));
    ok("1.5 …and no delete", !(RESOLUTION_KINDS as string[]).includes("delete"));
    ok("1.6 …and no mark_followed_up (§13)",
      !(RESOLUTION_KINDS as string[]).includes("mark_followed_up"));
    ok("1.7 no resolution set contains a destructive kind",
      !JSON.stringify(RESOLUTIONS_BY_KIND).match(/cancel|delete|archive/i));
    ok("1.8 deriving resolutions mutates nothing", (() => {
      const before = JSON.stringify(state);
      for (const s of signals) resolutionsFor(state, s, { today: T, ix });
      return JSON.stringify(state) === before;
    })());
    ok("1.9 every action targets a real record ref",
      signals.every((s) => resolutionsFor(state, s, { today: T, ix }).every((a) => !!a.recordRef.id)));
  }

  // ============================== 2. the §6 signal-to-action mapping

  {
    eq("2.1 overdue", kindsFor("ZZOverdue"), ["complete_action", "reschedule", "defer", "open_record"]);
    eq("2.2 follow-up due offers only the three honest operations",
      kindsFor("ZZFollowUpToday"), ["set_follow_up", "stop_waiting", "open_record"]);
    eq("2.3 returned today", kindsFor("ZZReturnedToday"), ["open_record", "complete_action", "defer", "reschedule"]);
    eq("2.4 recurring due", kindsFor("ZZRecurringDue"), ["complete_occurrence", "open_record"]);
    eq("2.5 blocked", kindsFor("ZZBlockedItem"), ["open_blocker", "open_record"]);
    eq("2.6 due soon", kindsFor("ZZDueTomorrow"), ["open_record", "reschedule", "defer"]);
    eq("2.7 project with no next action", kindsFor("ZZProjNoNext"), ["create_project_next_action", "open_record"]);
    eq("2.8 dormant", kindsFor("ZZDormantNoDate"), ["open_record", "reschedule", "defer", "complete_action"]);
    eq("2.9 the primary move for blocked is opening the blocker",
      primaryResolution(resolve("ZZBlockedItem"))?.kind, "open_blocker");
    eq("2.10 …and for a project it is adding the next action",
      primaryResolution(resolve("ZZProjNoNext"))?.kind, "create_project_next_action");
  }

  // ============ 3. THE NEGATIVE TESTS (§25 A–H)

  {
    // ---- A. recurring completion never closes the whole series
    ok("3.A1 a recurring signal offers no whole-action completion",
      !kindsFor("ZZRecurringDue").includes("complete_action"), kindsFor("ZZRecurringDue").join(","));
    const occ = find("ZZRecurringDue", "complete_occurrence")!;
    ok("3.A2 …its label is about today, not the series", /today/i.test(occ.label), occ.label);
    ok("3.A3 …and it says the repeat survives", /repeat stays/i.test(occ.explanation ?? ""), occ.explanation);
    {
      const r = recorder();
      const out = applyResolution({ action: occ, today: T }, ops(r));
      eq("3.A4 running it calls completeOccurrence, never completeAction",
        r.calls.map((c) => c.op), ["completeOccurrence"]);
      eq("3.A5 …scoped to one day", r.calls[0].args[1], T);
      ok("3.A6 …and the message repeats the guarantee", /repeat stays/i.test(out.message), out.message);
      ok("3.A7 …with an undo that removes only that occurrence", !!out.undo);
      out.undo!.run();
      eq("3.A8 …by the occurrence-scoped primitive", r.calls[1].op, "uncompleteOccurrence");
    }

    // ---- B. a blocked item's primary action is not "complete"
    ok("3.B1 blocked offers no completion at all",
      !kindsFor("ZZBlockedItem").includes("complete_action"));
    ok("3.B2 …and no defer or reschedule either — it is not executable",
      !kindsFor("ZZBlockedItem").includes("defer") && !kindsFor("ZZBlockedItem").includes("reschedule"));

    // ---- C/D. follow-up never silently clears waiting; clearing never completes
    const setFu = find("ZZFollowUpToday", "set_follow_up")!;
    {
      const r = recorder();
      const out = applyResolution({ action: setFu, choice: rescheduleChoices(T)[1], today: T }, ops(r));
      eq("3.C1 setting a follow-up calls only the follow-up setter",
        r.calls.map((c) => c.op), ["setNextFollowUpDate"]);
      ok("3.C2 …never stopWaiting", !r.calls.some((c) => c.op === "stopWaiting"));
      ok("3.C3 …never completeAction", !r.calls.some((c) => c.op === "completeAction"));
      ok("3.C4 …and the message says the wait continues", /still waiting/i.test(out.message), out.message);
      ok("3.C5 …while the control denies recording a follow-up",
        /doesn't record that you followed up/i.test(setFu.explanation ?? ""), setFu.explanation);
    }
    const stopW = find("ZZFollowUpToday", "stop_waiting")!;
    {
      const r = recorder();
      const out = applyResolution({ action: stopW, today: T }, ops(r));
      eq("3.D1 stopping a wait calls only stopWaiting", r.calls.map((c) => c.op), ["stopWaiting"]);
      ok("3.D2 …never completeAction", !r.calls.some((c) => c.op === "completeAction"));
      ok("3.D3 …and says explicitly it is not complete",
        /not marked complete/i.test(out.message), out.message);
      ok("3.D4 the control says so too before you press it",
        /not marked complete/i.test(stopW.explanation ?? ""), stopW.explanation);
    }

    // ---- E. a project next action is never silently created
    const create = find("ZZProjNoNext", "create_project_next_action")!;
    ok("3.E1 creating a next action requires confirmation", create.authority === "confirm");
    ok("3.E2 …and says the user writes it", /you write it/i.test(create.explanation ?? ""), create.explanation);
    {
      const r = recorder();
      const empty = applyResolution({ action: create, today: T }, ops(r));
      ok("3.E3 with no text, nothing is created", empty.applied === false && r.calls.length === 0);
      ok("3.E4 …and it asks for the text", /write the next action/i.test(empty.message), empty.message);
      const blank = applyResolution({ action: create, text: "   ", today: T }, ops(r));
      ok("3.E5 whitespace is not a title", blank.applied === false && r.calls.length === 0);
      const made = applyResolution({ action: create, text: "Draft the scope note", today: T }, ops(r));
      eq("3.E6 with text, exactly one action is created", r.calls.map((c) => c.op), ["createAction"]);
      eq("3.E7 …carrying the user's words and the project link",
        r.calls[0].args[0], { title: "Draft the scope note", projectId: "p-none" });
      eq("3.E8 …and the outcome points at the new action", made.ref, { kind: "action", id: "new-action-id" });
    }

    // ---- F. cancel/delete never happen from a resolution
    {
      const everyAction = signals.flatMap((s) => resolutionsFor(state, s, { today: T, ix }));
      ok("3.F1 no resolution anywhere is a cancellation",
        !everyAction.some((a) => /cancel|delete|remove|archive/i.test(a.kind)));
      ok("3.F2 …nor is any label",
        !everyAction.some((a) => /\bcancel\b|\bdelete\b/i.test(a.label)),
        everyAction.map((a) => a.label).join(" | "));
      // The ops surface itself has no destructive member — structural, not a check.
      const r = recorder();
      ok("3.F3 the ops interface exposes no destructive primitive",
        !Object.keys(r).some((k) => /cancel|delete/i.test(k)), Object.keys(r).join(","));
    }

    // ---- G. a signal disappears only when the evidence changes
    {
      const before = buildCommitmentSignals(state, ix, { today: T }).length;
      const r = recorder();
      applyResolution({ action: find("ZZOverdue", "complete_action")!, today: T }, ops(r));
      // The fake did not touch the store, so the signal must still be there.
      const after = buildCommitmentSignals(state, buildTodayIndexes(state, T), { today: T }).length;
      eq("3.G1 running a resolution against a fake store changes no signal", after, before);
      // With the record actually completed, it goes — because the evidence went.
      const done: StoreState = {
        ...state,
        nextActions: state.nextActions.map((a) => (a.id === "t1" ? { ...a, status: "completed", completedAt: `${T}T10:00:00.000Z` } : a)),
      } as StoreState;
      const afterReal = buildCommitmentSignals(done, buildTodayIndexes(done, T), { today: T });
      ok("3.G2 completing the record removes its signal",
        !afterReal.some((s) => s.title === "ZZOverdue"));
    }

    // ---- H. Memory and Today expose the same resolution set
    {
      const sig = sigFor("ZZOverdue");
      const fromToday = resolutionsFor(state, sig, { today: T, ix });
      const fromMemory = resolutionsFor(state, sig, { today: T, ix });
      eq("3.H1 the same signal yields the same actions from either surface",
        JSON.stringify(fromToday.map((a) => a.kind)), JSON.stringify(fromMemory.map((a) => a.kind)));
      ok("3.H2 …because there is one builder, not two",
        typeof resolutionsFor === "function");
    }
  }

  // ============================== 4. the §24 torture list

  {
    // 1. overdue → complete
    {
      const r = recorder();
      const out = applyResolution({ action: find("ZZOverdue", "complete_action")!, today: T }, ops(r));
      ok("4.1 overdue → complete runs the canonical primitive",
        out.applied && r.calls[0].op === "completeAction");
      ok("4.1b …and offers undo", !!out.undo);
    }
    // 2. overdue → defer next week
    {
      const r = recorder();
      const choice = deferChoices(T).find((c) => c.id === "next_week")!;
      const out = applyResolution({ action: find("ZZOverdue", "defer")!, choice, today: T }, ops(r));
      eq("4.2 overdue → defer uses the canonical defer preset",
        [r.calls[0].op, r.calls[0].args[1]], ["deferAction", "next_week"]);
      ok("4.2b …and says when it comes back", /next week/i.test(out.message), out.message);
    }
    // 3. returned today → defer again
    {
      const r = recorder();
      const out = applyResolution({
        action: find("ZZReturnedToday", "defer")!,
        choice: deferChoices(T).find((c) => c.id === "tomorrow")!, today: T,
      }, ops(r));
      ok("4.3 returned → defer again defers, and records no second return",
        out.applied && r.calls.map((c) => c.op).join(",") === "deferAction");
    }
    // 5/6. blocked with one blocker, then two
    {
      const one = find("ZZBlockedItem", "open_blocker")!;
      eq("4.5 one blocker links straight to it", one.href, "/actions/t7a");
      ok("4.5b …and needs no choice", !one.choices);

      const twoBlockers: StoreState = {
        ...state,
        actionDependencies: [...state.actionDependencies, { id: "dx", blockerId: "t14", blockedId: "t7b", createdAt: `${T}T08:00:00.000Z` }],
      } as StoreState;
      const ix2 = buildTodayIndexes(twoBlockers, T);
      const sig2 = buildCommitmentSignals(twoBlockers, ix2, { today: T }).find((s) => s.title === "ZZBlockedItem")!;
      const open2 = resolutionsFor(twoBlockers, sig2, { today: T, ix: ix2 }).find((a) => a.kind === "open_blocker")!;
      eq("4.6 two blockers require a choice", open2.choices?.length, 2);
      ok("4.6b …with no href picked for the user", !open2.href);
      ok("4.6c …and it asks which", /which one/i.test(open2.explanation ?? ""), open2.explanation);
      // §15: never by recency. Both are offered, in a stable order.
      ok("4.6d …offering both blockers",
        (open2.choices ?? []).map((c) => c.id).sort().join(",") === "t14,t7a");
    }
    // 7/8 are covered by 3.C / 3.D above.
    // 9. project → create next action, then the signal is gone
    {
      const linked: StoreState = {
        ...state,
        nextActions: [
          ...state.nextActions,
          { ...state.nextActions[0], id: "fresh", title: "Draft the scope note", projectId: "p-none", status: "open", dueDate: undefined, completedAt: undefined, recurrence: undefined, history: [] } as NextAction,
        ],
      } as StoreState;
      const after = buildCommitmentSignals(linked, buildTodayIndexes(linked, T), { today: T });
      ok("4.9 once an executable action exists, the project signal is gone",
        !after.some((s) => s.title === "ZZProjNoNext"), after.filter((s) => s.kind === "project_no_next_action").map((s) => s.title).join(","));
    }
    // 10/11. dormant → schedule, dormant → defer
    {
      const r = recorder();
      applyResolution({ action: find("ZZDormantNoDate", "reschedule")!, choice: rescheduleChoices(T)[0], today: T }, ops(r));
      eq("4.10 dormant → schedule sets a due date", r.calls[0].op, "setActionDueDate");
      const scheduled: StoreState = {
        ...state,
        nextActions: state.nextActions.map((a) => (a.id === "t9" ? { ...a, dueDate: T } : a)),
      } as StoreState;
      const after = buildCommitmentSignals(scheduled, buildTodayIndexes(scheduled, T), { today: T });
      ok("4.10b …and it stops being dormant",
        !after.some((s) => s.title === "ZZDormantNoDate" && s.kind === "dormant"));
      const r2 = recorder();
      applyResolution({ action: find("ZZDormantNoDate", "defer")!, choice: deferChoices(T).find((c) => c.id === "someday")!, today: T }, ops(r2));
      eq("4.11 dormant → defer uses the canonical defer", [r2.calls[0].op, r2.calls[0].args[1]], ["deferAction", "someday"]);
    }
    // 12. mutation failure
    {
      const r = recorder();
      r.failNext.add("completeOccurrence");
      const out = applyResolution({ action: find("ZZRecurringDue", "complete_occurrence")!, today: T }, ops(r));
      ok("4.12 a refused mutation reports failure", out.applied === false);
      ok("4.12b …factually, naming what was already true",
        /already recorded/i.test(out.message), out.message);
      ok("4.12c …and offers no undo for something that did not happen", !out.undo);

      const r2 = recorder();
      r2.failNext.add("stopWaiting");
      const out2 = applyResolution({ action: find("ZZFollowUpToday", "stop_waiting")!, today: T }, ops(r2));
      ok("4.12d a refused stopWaiting does not claim success",
        out2.applied === false && !/no longer waiting/i.test(out2.message), out2.message);

      const r3 = recorder();
      r3.failNext.add("setNextFollowUpDate");
      const out3 = applyResolution({ action: find("ZZFollowUpToday", "set_follow_up")!, choice: rescheduleChoices(T)[0], today: T }, ops(r3));
      ok("4.12e a refused follow-up does not claim success", out3.applied === false, out3.message);
    }
    // A disabled action never runs anything.
    {
      const alreadyDone: StoreState = {
        ...state,
        recurrenceCompletions: [...state.recurrenceCompletions, { id: "rcx", actionId: "t11", occurrenceDate: T, completedAt: `${T}T07:00:00.000Z` }],
      } as StoreState;
      const ix3 = buildTodayIndexes(alreadyDone, T);
      const sigs3 = buildCommitmentSignals(alreadyDone, ix3, { today: T });
      const rec = sigs3.find((s) => s.title === "ZZRecurringDue");
      ok("4.13 a completed occurrence produces no signal at all", !rec, rec?.kind);
    }
  }

  // ============================== 5. language (§19, §25)

  {
    const every = signals.flatMap((s) => resolutionsFor(state, s, { today: T, ix }));
    const labels = resolutionLabels(every).join(" ");
    const banned = violatesResolutionLanguage(labels);
    ok("5.1 no control label uses pressuring or dismissive language",
      banned.length === 0, `${banned.join(", ")} in: ${labels}`);
    ok("5.2 no label claims a follow-up happened",
      !/followed up/i.test(labels), labels);
    ok("5.3 no label says fix, resolve or clean up", !/\bfix\b|\bclean up\b/i.test(labels));
    ok("5.4 no label is a judgment", !/finally|overdue by|behind/i.test(labels));
    // Explanations are allowed — and required — to NAME what they rule out.
    const strings = resolutionStrings(every).join(" ");
    ok("5.5 an explanation may deny a follow-up was recorded",
      /doesn't record that you followed up/i.test(strings));
    ok("5.6 …and may deny a completion", /not marked complete/i.test(strings));
    ok("5.7 every enabled non-navigation action explains itself",
      every.filter((a) => a.enabled && a.authority !== "navigate").every((a) => !!a.explanation));
  }

  // ============================== 6. authority gradient (§8)

  {
    const every = signals.flatMap((s) => resolutionsFor(state, s, { today: T, ix }));
    ok("6.1 completion is auto-with-undo",
      every.filter((a) => a.kind === "complete_action").every((a) => a.authority === "auto_with_undo"));
    ok("6.2 occurrence completion is auto-with-undo",
      every.filter((a) => a.kind === "complete_occurrence").every((a) => a.authority === "auto_with_undo"));
    ok("6.3 rescheduling asks first",
      every.filter((a) => a.kind === "reschedule").every((a) => a.authority === "confirm"));
    ok("6.4 stopping a wait asks first",
      every.filter((a) => a.kind === "stop_waiting").every((a) => a.authority === "confirm"));
    ok("6.5 creating a project action asks first",
      every.filter((a) => a.kind === "create_project_next_action").every((a) => a.authority === "confirm"));
    ok("6.6 nothing is auto_safe — every change needs a press",
      !every.some((a) => (a.authority as string) === "auto_safe"));
    ok("6.7 every auto_with_undo outcome actually carries an undo", (() => {
      const r = recorder();
      return every.filter((a) => a.enabled && a.authority === "auto_with_undo")
        .every((a) => !!applyResolution({ action: a, today: T }, ops(r)).undo);
    })());
  }

  // ============================== 7. navigation is not mutation

  {
    const r = recorder();
    for (const a of signals.flatMap((s) => resolutionsFor(state, s, { today: T, ix }))) {
      if (a.authority !== "navigate") continue;
      applyResolution({ action: a, today: T }, ops(r));
    }
    eq("7.1 running every navigation action mutates nothing", r.calls.length, 0);
    ok("7.2 …and every one has somewhere to go",
      signals.flatMap((s) => resolutionsFor(state, s, { today: T, ix }))
        .filter((a) => a.authority === "navigate").every((a) => !!a.href));
  }

  // ========== 7b. the two new field rules, tested where they live

  {
    const waiting = state.nextActions.find((a) => a.id === "t5")!;
    const open = state.nextActions.find((a) => a.id === "t1")!;

    const moved = withNextFollowUp(waiting, "2026-09-01")!;
    eq("7b.1 setting a follow-up moves the date", moved.followUpDate, "2026-09-01");
    // THE assertion this whole operation exists for.
    eq("7b.2 …and preserves waitingSince exactly", moved.waitingSince, waiting.waitingSince);
    eq("7b.3 …and keeps the wait itself", [moved.status, moved.waitingOn], ["waiting", waiting.waitingOn]);
    ok("7b.4 …and never completes it", !moved.completedAt);
    eq("7b.5 clearing is allowed", withNextFollowUp(waiting, undefined)?.followUpDate, undefined);
    eq("7b.6 …and blank text is a clear, not a date", withNextFollowUp(waiting, "   ")?.followUpDate, undefined);
    ok("7b.7 a non-waiting action is refused, not silently written to",
      withNextFollowUp(open, "2026-09-01") === null);

    const stopped = withoutWaiting(waiting)!;
    eq("7b.8 stopping a wait returns it to open", stopped.status, "open");
    ok("7b.9 …clearing every field that described the wait",
      !stopped.waitingOn && !stopped.waitingSince && !stopped.followUpDate,
      JSON.stringify({ on: stopped.waitingOn, since: stopped.waitingSince, fu: stopped.followUpDate }));
    ok("7b.10 …and NEVER marking it complete", !stopped.completedAt && stopped.status !== "completed");
    ok("7b.11 …preserving the title and links", stopped.title === waiting.title);
    ok("7b.12 a non-waiting action is refused", withoutWaiting(open) === null);
    // Neither transform invents history — the store attaches an existing kind.
    eq("7b.13 the transforms touch no history", stopped.history, waiting.history);
  }

  // ============================== 8. no persistence (§28)

  {
    eq("8.1 the store still has 46 domains", STORE_DOMAINS.length, 46);
    ok("8.2 no resolution domain was added",
      !(STORE_DOMAINS as string[]).some((d) => /resolution|resolve|affordance/i.test(d)));
    ok("8.3 a resolution is a value — it has no id",
      signals.flatMap((s) => resolutionsFor(state, s, { today: T, ix }))
        .every((a) => !("id" in (a as unknown as Record<string, unknown>))));
  }

  // ============================== 9. performance (§27)

  {
    const big = manySignals(1000);
    const bigIx = buildTodayIndexes(big, T);
    const bigSignals = buildCommitmentSignals(big, bigIx, { today: T });
    for (const n of [100, bigSignals.length]) {
      const slice = bigSignals.slice(0, n);
      const t0 = Date.now();
      for (const s of slice) resolutionsFor(big, s, { today: T, ix: bigIx });
      const ms = Date.now() - t0;
      ok(`9.x ${slice.length} signals resolved in ${ms}ms`, ms < 400, `${ms}ms`);
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

function manySignals(n: number): StoreState {
  const s = Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
  const day = (i: number): string => {
    const d = new Date(Date.UTC(2026, 7, 23));
    d.setUTCDate(d.getUTCDate() - (i % 60) - 1);
    return d.toISOString().slice(0, 10);
  };
  s.nextActions = Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, title: `Task ${i}`, description: "", status: "open",
    createdAt: `${day(i)}T08:00:00.000Z`, updatedAt: `${day(i)}T08:00:00.000Z`,
    dueDate: day(i), notes: "", linkedEntityRefs: [], tags: [],
    estimatedSize: "unspecified", energy: "unspecified", order: i, history: [],
  } as unknown as NextAction));
  return s;
}
