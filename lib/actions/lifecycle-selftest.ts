/**
 * LIFEOS-105 — commitment lifecycle, asserted.
 *
 * Organised by the six reds the audit measured, because a lifecycle bug comes
 * back as a state a record can reach, not as a function call. Each block pairs
 * the transition that must produce the behaviour with the near neighbour that
 * must not — a rule that fires for both is not a rule, it is a deletion.
 *
 * ## Why this drives the real store
 *
 * Three of the six live in writers (`commitCapture`, `setActionDueDate`,
 * `completeAction`), and the audit's whole method was to stop trusting
 * re-implementations: a probe that reimplements a writer tests the probe.
 * `withIsolatedStore` runs the singleton for real with nothing leaving the
 * module — no local write, no remote push, no subscriber render — which is what
 * it was built for (LIFEOS-076 §26).
 *
 * ## §48's invariant checker
 *
 * The last block is a checker rather than a list of cases: it walks a store and
 * reports every combination current semantics say cannot be true at once. It is
 * run over the torture world after each chain, so a future writer that
 * reintroduces any of these fails here rather than in a browser six sprints
 * later.
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { emptyStoreState } from "@/lib/ux/backup";
import {
  withIsolatedStore, replaceState, getSnapshot,
  completeAction, cancelAction, deferAction, setActionDueDate,
  markActionWaiting, setNextFollowUpDate, stopWaiting, commitCapture, completeOccurrence,
} from "@/lib/mvpStore";
import { isOwnMoveNow, ownsTheNextMove, shedStatusFields } from "@/lib/actions/lifecycle";
import { isLive, dueKeyOf } from "@/lib/actions/due";
import { isDeferredAhead } from "@/lib/actions/defer";
import { isFollowUpDue } from "@/lib/actions/waiting";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView } from "@/lib/today/view";
import { buildTodayCommand } from "@/lib/today/surface";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { buildDecisionInbox } from "@/lib/guidance/decisions";
import { buildProjectContext } from "@/lib/execution/context";
import { buildRangeReview } from "@/lib/memory/week";
import { resolveRange } from "@/lib/insights/range";
import { readRule } from "@/lib/time/recurrence";

const TODAY = "2026-09-07" as DayKey;
const NOW = "10:30";

function dk(n = 0): DayKey {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10) as DayKey;
}
const at = (n = 0, h = 9) => `${dk(n)}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

let hn = 0;
const H = (action: string, when: string, x: Record<string, unknown> = {}) =>
  ({ id: `lc${++hn}`, action, at: when, ...x }) as NextAction["history"][number];

type A = StoreState["nextActions"][number];
const act = (p: Partial<A> & { id: string; title: string }): A => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1,
  history: [H("created", at(-20))],
  createdAt: at(-20), updatedAt: at(-20), ...p,
} as A);

const waiting = (id: string, title: string, on: string, extra: Partial<A> = {}) =>
  act({ id, title, status: "waiting", waitingOn: on, waitingSince: at(-7),
    history: [H("created", at(-20)), H("waiting", at(-7), { detail: on, fromStatus: "open", toStatus: "waiting" })],
    ...extra } as Partial<A> & { id: string; title: string });

const store = (p: Partial<StoreState>): StoreState => ({ ...emptyStoreState(), ...p } as StoreState);
const ixOf = (s: StoreState) => buildTodayIndexes(s, TODAY, NOW);
const find = (id: string) => (getSnapshot().nextActions ?? []).find((a) => a.id === id);

/** Every Today surface an action can reach, asked one at a time. */
function whereOnToday(s: StoreState, id: string): string[] {
  const cmd = buildTodayCommand(s, ixOf(s), TODAY);
  const out: string[] = [];
  if (cmd.suggestedNext.recommendation?.action.id === id) out.push("suggested");
  if (cmd.work.some((w) => w.action.id === id)) out.push("do");
  if (cmd.fixed.some((f) => f.id === id)) out.push("fixed");
  if (cmd.attention.some((x) => (x.actionId ?? x.entity.id) === id)) out.push("attention");
  if (cmd.openWork.some((x) => x.id === id)) out.push("open");
  if (cmd.later.waiting.some((w) => w.action.id === id)) out.push("waiting");
  return out;
}

/**
 * §48. Combinations current semantics say cannot both be true.
 *
 * Only invariants the product already supports — no aspiration, or the checker
 * becomes a wish list that never goes green.
 */
export function lifecycleViolations(s: StoreState, today: DayKey = TODAY): string[] {
  const bad: string[] = [];
  const ix = buildTodayIndexes(s, today, NOW);
  const cmd = buildTodayCommand(s, ix, today);
  const sigs = buildCommitmentSignals(s, ix, { today });
  const byId = new Map((s.nextActions ?? []).map((a) => [a.id, a]));

  for (const a of s.nextActions ?? []) {
    if (!isLive(a)) {
      if (a.waitingOn || a.waitingSince || a.followUpDate) bad.push(`${a.id}: finished, still carries waiting fields`);
      if (a.deferredUntil) bad.push(`${a.id}: finished, still carries deferredUntil`);
    }
    if (a.status === "waiting" && isOwnMoveNow(a, today)) bad.push(`${a.id}: waiting AND own move now`);
    if (a.status !== "waiting" && (a.followUpDate || a.waitingOn)) bad.push(`${a.id}: not waiting, carries wait fields`);
    if (a.status !== "deferred" && a.deferredUntil) bad.push(`${a.id}: not deferred, carries deferredUntil`);
    // A dependency pointing at a record that no longer exists must not hide work.
    for (const d of s.actionDependencies ?? []) {
      if (d.blockedId === a.id && !byId.has(d.blockerId) && ix.blockedActionIds.has(a.id)) {
        bad.push(`${a.id}: blocked by a record that does not exist`);
      }
    }
  }
  for (const sig of sigs) {
    const a = byId.get(sig.recordRef.id);
    if (!a) continue;
    if (!isLive(a)) bad.push(`${a.id}: finished, still raises ${sig.kind}`);
    if (a.status === "waiting" && (sig.kind === "overdue" || sig.kind === "due_soon")) {
      bad.push(`${a.id}: waiting, raises a deadline signal (${sig.kind})`);
    }
    if (isDeferredAhead(a, today) && sig.kind !== "dormant") bad.push(`${a.id}: deferred ahead, raises ${sig.kind}`);
  }
  for (const w of cmd.work) {
    const a = w.action;
    if (a.status === "waiting") bad.push(`${a.id}: waiting, rendered as work to do`);
    if (isDeferredAhead(a, today)) bad.push(`${a.id}: deferred ahead, rendered as work to do`);
    if (!isLive(a)) bad.push(`${a.id}: finished, rendered as work to do`);
  }
  const rec = cmd.suggestedNext.recommendation?.action;
  if (rec) {
    if (rec.status === "waiting") bad.push(`${rec.id}: waiting, recommended`);
    if (ix.blockedActionIds.has(rec.id)) bad.push(`${rec.id}: blocked, recommended`);
    if (isDeferredAhead(rec, today)) bad.push(`${rec.id}: deferred ahead, recommended`);
    if (!isLive(rec)) bad.push(`${rec.id}: finished, recommended`);
  }
  for (const p of s.projects ?? []) {
    const ctx = buildProjectContext(s, p.id, ix, today);
    const n = ctx?.next?.action;
    if (!n) continue;
    if (!isLive(n)) bad.push(`${p.id}: next action is finished`);
    if (n.status === "waiting") bad.push(`${p.id}: next action is waiting`);
    if (isDeferredAhead(n, today)) bad.push(`${p.id}: next action is deferred ahead`);
    if (ix.blockedActionIds.has(n.id)) bad.push(`${p.id}: next action is blocked`);
  }
  for (const it of buildDecisionInbox(s, ix, { today }).items) {
    const a = byId.get(it.entity.id);
    if (a && !isLive(a)) bad.push(`${a.id}: finished, still a decision (${it.kind})`);
    if (a && it.kind === "WAITING_FOLLOW_UP" && !isFollowUpDue(a, today)) {
      bad.push(`${a.id}: WAITING_FOLLOW_UP without a due follow-up`);
    }
  }
  return bad;
}

/**
 * §6. Live records that reach NO surface and have no semantic reason to.
 *
 * An audit probe, not a product feature (§6 is explicit). Exported so the
 * assertion below can pin exactly WHICH class of record is allowed to be here.
 */
export function invisibleCommitments(s: StoreState, today: DayKey = TODAY): string[] {
  const ix = buildTodayIndexes(s, today, NOW);
  const out: string[] = [];
  for (const a of s.nextActions ?? []) {
    if (!isLive(a)) continue;
    if (a.status === "waiting") continue;
    if (isDeferredAhead(a, today)) continue;
    if (ix.blockedActionIds.has(a.id)) continue;
    if (readRule(a.recurrence)) continue;
    const due = dueKeyOf(a);
    if (due && due > today) continue;
    if (a.projectId || a.goalId) continue;
    if (whereOnToday(s, a.id).length === 0) out.push(a.id);
  }
  return out;
}

export function runCommitmentLifecycleSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

  // ======================================================================
  // §47 — the one predicate, and what each clause is for.
  // ======================================================================
  {
    const plain = act({ id: "p", title: "P" });
    ok("105.1 §47 ordinary live work is the person's own move", isOwnMoveNow(plain, TODAY));
    ok("105.2 §8, §12 a wait is not — its next move belongs to someone else",
      !isOwnMoveNow(waiting("w", "W", "Ana"), TODAY) && !ownsTheNextMove(waiting("w", "W", "Ana")));
    ok("105.3 §40 nor is work parked until a later day",
      !isOwnMoveNow(act({ id: "d", title: "D", status: "deferred", deferredUntil: dk(4) }), TODAY));
    ok("105.4 §40 …but a deferral whose day has ARRIVED is available again",
      isOwnMoveNow(act({ id: "d2", title: "D", status: "deferred", deferredUntil: dk(0) }), TODAY));
    ok("105.5 finished work is nobody's move", !isOwnMoveNow(act({ id: "c", title: "C", status: "completed", completedAt: at(-1) }), TODAY));
    /**
     * The clause deliberately NOT in the predicate. A blocked action's next move
     * is still the person's — it is the blocker — which is why LIFEOS-070 raises
     * `overdue` on blocked work and attaches the blocker as the reason.
     */
    ok("105.6 §18 blocked work is still the person's own move", isOwnMoveNow(act({ id: "b", title: "B" }), TODAY));
  }

  // ======================================================================
  // RED 1 (§9) — on a wait, the date the person said is a FOLLOW-UP.
  // ======================================================================
  withIsolatedStore(() => {
    replaceState(store({}));
    commitCapture("Waiting on Sam for the keys by Friday", [
      { kind: "waiting", title: "Keys from Sam", waitingOn: "Sam", dueDate: dk(4) },
    ] as never);
    const a = (getSnapshot().nextActions ?? [])[0];
    eq("105.7 §9 a dated wait carries the date as a follow-up", a?.followUpDate, dk(4));
    eq("105.8 §9 …and NOT as a due date", a?.dueDate, undefined);
    eq("105.9 §9 …and it is waiting", a?.status, "waiting");
    // The neighbour: an ordinary Action's date is still a due date.
    replaceState(store({}));
    commitCapture("Call the dentist Friday", [
      { kind: "action", title: "Call the dentist", dueDate: dk(4) },
    ] as never);
    const b = (getSnapshot().nextActions ?? [])[0];
    eq("105.10 §9 an ordinary action's date is still a due date", b?.dueDate, dk(4));
    eq("105.11 §9 …and it carries no follow-up", b?.followUpDate, undefined);
  });

  // ======================================================================
  // RED 2 (§12, §48) — a wait raises no deadline claim, however it got a date.
  // ======================================================================
  {
    for (const [label, due] of [["overdue", dk(-3)], ["due today", dk(0)], ["due soon", dk(2)]] as const) {
      const s = store({ nextActions: [waiting("w", "Keys", "Sam", { dueDate: due } as Partial<A>)] });
      const sigs = buildCommitmentSignals(s, ixOf(s), { today: TODAY }).map((x) => x.kind);
      eq(`105.12 §12 a wait dated ${label} raises no deadline signal`,
        sigs.filter((k) => k === "overdue" || k === "due_soon"), []);
      eq(`105.13 §12 …and is not work to do`, whereOnToday(s, "w").filter((x) => x !== "waiting"), []);
    }
    // The neighbour — the SAME dates on an ordinary action still speak.
    const open = store({ nextActions: [act({ id: "o", title: "Keys", dueDate: dk(-3) })] });
    ok("105.14 §12 …while an ordinary overdue action still raises overdue",
      buildCommitmentSignals(open, ixOf(open), { today: TODAY }).some((x) => x.kind === "overdue"));
    // And a due follow-up still reaches attention: §12 keeps the distinction.
    const fu = store({ nextActions: [waiting("f", "Transcript", "Maria", { followUpDate: dk(0) } as Partial<A>)] });
    ok("105.15 §12 a DUE FOLLOW-UP is still surfaced",
      buildCommitmentSignals(fu, ixOf(fu), { today: TODAY }).some((x) => x.kind === "follow_up_due")
      && whereOnToday(fu, "f").includes("attention"));
    ok("105.16 §12 …while the wait itself stays un-executable",
      !whereOnToday(fu, "f").includes("do") && !whereOnToday(fu, "f").includes("suggested"));
  }

  // ======================================================================
  // RED 3 (§16) — naming a day for parked work brings it back.
  // ======================================================================
  withIsolatedStore(() => {
    const world = () => store({ nextActions: [
      act({ id: "x", title: "Send the invoice", dueDate: dk(0) }),
      act({ id: "y", title: "Something else" }),
    ] });
    replaceState(world());
    deferAction("x", "next_week");
    eq("105.17 §40 deferring parks it", find("x")?.status, "deferred");
    eq("105.18 §40 …and Not Today holds even though its date is today",
      whereOnToday(getSnapshot(), "x"), []);
    setActionDueDate("x", dk(2));
    eq("105.19 §16 a new date brings it back to open", find("x")?.status, "open");
    eq("105.20 §16 …with the deferral gone, not merely overridden", find("x")?.deferredUntil, undefined);
    eq("105.21 §16 …and the new date kept", find("x")?.dueDate, dk(2));
    eq("105.22 §41 …recorded as due_set with the transition on it",
      (find("x")?.history ?? []).slice(-1).map((h) => [h.action, h.fromStatus, h.toStatus]),
      [["due_set", "deferred", "open"]]);
    ok("105.23 §16 …and it is visible again", !isDeferredAhead(find("x")!, TODAY) && isOwnMoveNow(find("x")!, TODAY));

    // THE NEIGHBOURS. This must be recovery, not an accidental un-defer.
    replaceState(world());
    deferAction("x", "next_week");
    setActionDueDate("x", undefined);
    eq("105.24 §16 CLEARING a date is not a decision to start", find("x")?.status, "deferred");
    eq("105.25 §16 …and the deferral survives it", find("x")?.deferredUntil, dk(7));
    replaceState(world());
    setActionDueDate("y", dk(3));
    eq("105.26 §15 …and dating ordinary work changes no status", find("y")?.status, "open");
    ok("105.27 §15 …writing due_set, never deferred",
      (find("y")?.history ?? []).slice(-1)[0]?.action === "due_set");
    // §14, §40: deferring again re-parks it. Recovery is not a one-way door.
    replaceState(world());
    deferAction("x", "next_week");
    setActionDueDate("x", dk(2));
    deferAction("x", "next_week");
    eq("105.28 §14 deferring again re-parks it", find("x")?.status, "deferred");
    eq("105.29 §14 …and Today lets it go", whereOnToday(getSnapshot(), "x"), []);
  });

  // ======================================================================
  // RED 5 (§11) — a status that ends takes its fields with it.
  // ======================================================================
  {
    eq("105.30 §11 leaving a wait sheds the wait",
      shedStatusFields("waiting", "completed"),
      { waitingOn: undefined, waitingSince: undefined, followUpDate: undefined });
    eq("105.31 §11 leaving a deferral sheds the deferral",
      shedStatusFields("deferred", "open"), { deferredUntil: undefined });
    eq("105.32 §11 staying put sheds nothing", shedStatusFields("waiting", "waiting"), {});
    eq("105.33 §11 …and an unrelated transition sheds nothing", shedStatusFields("open", "completed"), {});
  }
  withIsolatedStore(() => {
    const w = () => store({ nextActions: [waiting("w", "Transcript", "Maria", { followUpDate: dk(0) } as Partial<A>)] });
    replaceState(w());
    completeAction("w");
    const a = find("w")!;
    eq("105.34 §11 completing a wait clears waitingOn", a.waitingOn, undefined);
    eq("105.35 §11 …and waitingSince", a.waitingSince, undefined);
    eq("105.36 §11 …and the follow-up date", a.followUpDate, undefined);
    eq("105.37 §11 …while the completion itself stands", a.status, "completed");
    ok("105.38 §46 …and the wait survives in history, which is where it belongs",
      (a.history ?? []).some((h) => h.action === "waiting" && h.detail === "Maria"),
      JSON.stringify((a.history ?? []).map((h) => [h.action, h.detail])));
    // The same door, the other way out.
    replaceState(w());
    cancelAction("w");
    eq("105.39 §11 cancelling sheds it too", find("w")?.followUpDate, undefined);
    // The neighbour: stopping the wait already did this, and still does — and
    // it keeps the due date, which was never about the wait. The fixture has to
    // CARRY one for that second half to mean anything.
    replaceState(store({ nextActions: [
      waiting("w", "Transcript", "Maria", { followUpDate: dk(0), dueDate: dk(3) } as Partial<A>),
    ] }));
    stopWaiting("w");
    eq("105.40 §10 stopping a wait clears the wait", find("w")?.waitingOn, undefined);
    eq("105.41 §10 …and keeps the due date, which was never about the wait",
      find("w")?.dueDate, dk(3));
    eq("105.41b §10 …returning it to open", find("w")?.status, "open");
    ok("105.41c §10 …and it is work to do again", isOwnMoveNow(find("w")!, TODAY));
    replaceState(w());
    // …and moving a follow-up date still preserves the wait itself (LIFEOS-071 §13).
    replaceState(w());
    const since = find("w")?.waitingSince;
    setNextFollowUpDate("w", dk(5));
    eq("105.42 §13 moving a follow-up date does not restart the wait", find("w")?.waitingSince, since);
    eq("105.43 §13 …and does not count as a deferral",
      (find("w")?.history ?? []).filter((h) => h.action === "deferred").length, 0);
  });

  // ======================================================================
  // RED 4 (§40) — Not Today holds for every shape.
  // ======================================================================
  {
    const dated = store({ nextActions: [act({ id: "x", title: "X", dueDate: dk(0), status: "deferred", deferredUntil: dk(7) })] });
    eq("105.44 §40 a deferred action due TODAY is not in Today's work", whereOnToday(dated, "x"), []);
    const series = store({ nextActions: [act({ id: "r", title: "R", status: "deferred", deferredUntil: dk(3),
      recurrence: { frequency: "daily", interval: 1 } } as Partial<A> & { id: string; title: string })] });
    eq("105.45 §23, §40 a deferred recurring series is not in Today's work", whereOnToday(series, "r"), []);
    const v = buildTodayView(dated, ixOf(dated));
    eq("105.46 §40 …and the projection agrees, not just the surface",
      [...v.dueToday, ...v.alsoToday].map((a) => a.id), []);
    // The neighbour: the same records, NOT deferred, do appear.
    const live = store({ nextActions: [act({ id: "x", title: "X", dueDate: dk(0) })] });
    ok("105.47 §40 …while the same action undeferred is work to do",
      whereOnToday(live, "x").length > 0, JSON.stringify(whereOnToday(live, "x")));
  }

  // ======================================================================
  // RED 6 (§42) — a historical line reads history, not a cleared field.
  // ======================================================================
  withIsolatedStore(() => {
    replaceState(store({ nextActions: [waiting("w", "Transcript", "Maria", { followUpDate: dk(0) } as Partial<A>)] }));
    stopWaiting("w");
    const s = getSnapshot();
    const rr = buildRangeReview(s, resolveRange("today", { today: TODAY }), { today: TODAY, index: ixOf(s).activity });
    const line = rr.timeline.find((e) => e.recordRef.id === "w" && e.kind === "waiting_stopped");
    ok("105.48 §42 the stopped wait is on the timeline", !!line);
    eq("105.49 §42 …and names the person, from the event that recorded the wait",
      line?.detail, "on Maria");
    ok("105.50 §42 …which the CURRENT field could not supply", find("w")?.waitingOn === undefined);
  });

  // ======================================================================
  // §4 — the end-to-end chains, and the invariant checker over each.
  // ======================================================================
  withIsolatedStore(() => {
    const world = () => store({
      goals: [{ id: "g", title: "Open the clinic", description: "", status: "active", priority: "medium",
        notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
        createdAt: at(-60), updatedAt: at(-60) }] as StoreState["goals"],
      projects: [{ id: "p", title: "Clinic launch", goalId: "g", description: "", status: "active",
        priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
        createdAt: at(-60), updatedAt: at(-60) }] as StoreState["projects"],
      nextActions: [
        act({ id: "a", title: "Send the invoice", projectId: "p", dueDate: dk(0) }),
        act({ id: "blocked", title: "Install the desk", projectId: "p", dueDate: dk(0) }),
        act({ id: "blocker", title: "Get lease approval", projectId: "p" }),
        waiting("wait", "Transcript", "Maria", { projectId: "p", followUpDate: dk(0) } as Partial<A>),
        act({ id: "rec", title: "Take the medication", dueTime: "08:00",
          recurrence: { frequency: "daily", interval: 1 } } as Partial<A> & { id: string; title: string }),
      ],
      actionDependencies: [{ id: "d", blockedId: "blocked", blockerId: "blocker", createdAt: at(-10) }],
    });
    const clean = (label: string) => {
      const v = lifecycleViolations(getSnapshot());
      eq(label, v, []);
    };

    // A. dated → defer → reschedule → complete
    replaceState(world());
    clean("105.51 §48 the world starts consistent");
    deferAction("a", "next_week"); clean("105.52 §48 …after a deferral");
    setActionDueDate("a", dk(2)); clean("105.53 §48 …after a reschedule");
    completeAction("a"); clean("105.54 §48 …after a completion");

    // B. waiting → follow-up → returned → complete
    replaceState(world());
    markActionWaiting("a", "Ana"); clean("105.55 §48 …after marking a wait");
    setNextFollowUpDate("a", dk(0)); clean("105.56 §48 …after a follow-up date");
    stopWaiting("a"); clean("105.57 §48 …after the wait ends");
    completeAction("a"); clean("105.58 §48 …after completing what was waited on");

    // C. blocker resolves
    replaceState(world());
    // The CONTROL first: something IS recommended here, so 105.59 is about the
    // choice rather than about an absent recommendation.
    const pick = () => buildTodayCommand(getSnapshot(), ixOf(getSnapshot()), TODAY).suggestedNext.recommendation?.action.id;
    ok("105.59pre §4 the world does produce a recommendation", !!pick(), String(pick()));
    ok("105.59 §18 …and it is not the blocked work", pick() !== "blocked", String(pick()));
    eq("105.59b §31 …nor is the blocked work the project's next",
      buildProjectContext(getSnapshot(), "p", ixOf(getSnapshot()), TODAY)?.next?.action?.id === "blocked", false);
    completeAction("blocker");
    clean("105.60 §48 …after the blocker completes");
    ok("105.61 §19 …and the blocked work is executable again",
      !ixOf(getSnapshot()).blockedActionIds.has("blocked"));

    // D. recurring occurrence — §21, §22. The series must survive its own
    // occurrence being closed, which is the transition that could end it.
    replaceState(world());
    ok("105.62pre §22 today's occurrence is on the schedule",
      whereOnToday(getSnapshot(), "rec").length > 0, JSON.stringify(whereOnToday(getSnapshot(), "rec")));
    completeOccurrence("rec", TODAY);
    eq("105.62 §21 closing an occurrence does not complete the series", find("rec")?.status, "open");
    ok("105.62b §21 …the series is still live", isLive(find("rec")!));
    eq("105.62c §22 …the row leaves Today for today", whereOnToday(getSnapshot(), "rec"), []);
    eq("105.62d §22 …and the completion is recorded once",
      (getSnapshot().recurrenceCompletions ?? []).filter((c) => c.actionId === "rec").length, 1);
    clean("105.63 §48 …and the world is still consistent");

    // §11 completion clears the wait, then the checker agrees.
    replaceState(world());
    completeAction("wait");
    clean("105.64 §48 …after completing a waiting record");
  });

  // ======================================================================
  // §6 — the invisible-commitment probe, pinned to ONE class.
  // ======================================================================
  {
    const s = store({ nextActions: [
      act({ id: "orphan", title: "Read the licensing guidance" }),
      act({ id: "dated", title: "Send the invoice", dueDate: dk(0) }),
      act({ id: "later", title: "Renew the passport", dueDate: dk(30) }),
      act({ id: "parked", title: "Sort the loft", status: "deferred", deferredUntil: dk(9) }),
      waiting("held", "Quote", "Priya"),
    ] });
    eq("105.65 §6 exactly one class of record reaches no surface", invisibleCommitments(s), ["orphan"]);
    ok("105.66 §6 …and it is reachable everywhere else a record lives",
      (s.nextActions ?? []).some((a) => a.id === "orphan"));
    // The neighbours: each of the others has a stated reason to be quiet.
    ok("105.67 §5 dated work is visible", whereOnToday(s, "dated").length > 0);
    ok("105.68 §5 a wait is on its roster", whereOnToday(s, "held").includes("waiting"));
    ok("105.69 §40 parked work is quiet BY the user's decision", isDeferredAhead(s.nextActions[3], TODAY));
    ok("105.70 §37 future work is quiet because its date has not come", dueKeyOf(s.nextActions[2])! > TODAY);
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
