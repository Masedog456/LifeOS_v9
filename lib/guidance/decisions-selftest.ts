/**
 * Decision inbox self-tests (LIFEOS-094).
 *
 * ## The reds this suite pins
 *
 *   1. nothing answered "what needs my decision?" — two phrasings fell through
 *      to the capability line and the third answered CONFIDENTLY from the
 *      attention model, about a different question
 *   2. a due follow-up, a three-times deferral and a goal with no path lived in
 *      three places and nowhere together
 *   3. worse, a decision could be hidden entirely: the attention shortlist
 *      collapses one record to one kind and picks attention over judgment, so
 *      an action both overdue and thrice-deferred came back as `["overdue"]`
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * This queue earns its place by what it refuses to contain. Nearly every
 * assertion below is an exclusion: a plain overdue action, a wait whose
 * follow-up is three weeks out, an achieved goal, a goal that already has work,
 * a blocked action with no choice in it, a single deferral, a processed
 * capture. A decision queue that fills up with ordinary work is just a backlog
 * with a more anxious name.
 *
 * Pure: no store, no clock, no AI.
 */

import type { NextAction, StoreState, Goal } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { goalsMissingPath } from "@/lib/execution/alignment";
import { buildAttentionShortlist, ATTENTION_MAX_LIMIT } from "@/lib/guidance/attention";
import { REPEATED_THRESHOLD } from "@/lib/memory/changes";
import {
  buildDecisionInbox, decisionCountLine, decisionStillStands, decisionStrings,
  DECISION_ORDER, DECISION_EMPTY, DECISION_HEADING, MAX_DECISIONS,
  DECISION_FORBIDDEN_WORDS,
  type DecisionInbox,
} from "@/lib/guidance/decisions";

const T = "2026-09-09";
const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: D("2026-08-01"), updatedAt: D(T, 18), ...p,
} as NextAction);

const h = (action: string, at: string, x: Record<string, unknown> = {}) =>
  ({ action, at, ...x }) as NextAction["history"][number];

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
  createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"), ...p,
} as Goal);

/** One of everything the queue must include, and one of everything it must not. */
function world(): StoreState {
  const s = emptyStoreState();
  s.goals = [
    goal({ id: "g-none", title: "Learn to sail" }),
    goal({ id: "g-ok", title: "Graduate school", priority: "high" }),
    goal({ id: "g-done", title: "Move out of the flat", status: "completed", horizon: "near" }),
  ];
  s.projects = [
    { id: "p-apps", title: "Graduate applications", goalId: "g-ok", description: "", status: "active",
      priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: D("2026-06-01"), updatedAt: D("2026-06-01") },
    { id: "p-teach", title: "Teaching portfolio", description: "", status: "active",
      priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: D("2026-06-01"), updatedAt: D("2026-06-01") },
  ] as StoreState["projects"];
  s.nextActions = [
    act({ id: "a-direct", title: "Draft the personal statement", goalId: "g-ok", dueDate: T }),
    // ---- must NOT be decisions --------------------------------------------
    act({ id: "a-overdue", title: "Pay the application fee", projectId: "p-apps", dueDate: "2026-09-05" }),
    act({ id: "a-wait-future", title: "Lease approval", status: "waiting", waitingOn: "Marcus",
      waitingSince: D("2026-09-01"), followUpDate: "2026-09-20",
      history: [h("waiting", D("2026-09-01"), { detail: "Marcus", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-once", title: "Book the hall",
      history: [h("created", D("2026-08-01")), h("deferred", D(T, 19))] }),
    act({ id: "a-blocked", title: "Send final draft", projectId: "p-apps", dueDate: T }),
    act({ id: "a-blocker", title: "Need legal review" }),
    // ---- must BE decisions -------------------------------------------------
    act({ id: "a-wait-due", title: "Transcript from Maria", projectId: "p-apps", status: "waiting",
      waitingOn: "Maria", waitingSince: D("2026-08-27"), followUpDate: T,
      history: [h("waiting", D("2026-08-27"), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-thrice", title: "Request recommendation", projectId: "p-apps", status: "deferred",
      deferredUntil: "2026-09-10",
      history: [h("created", D("2026-08-01")), h("deferred", D("2026-09-02", 17)), h("returned", D("2026-09-03", 6)),
        h("deferred", D("2026-09-05", 17)), h("returned", D("2026-09-06", 6)), h("deferred", D(T, 19))] }),
  ];
  s.actionDependencies = [{ id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: D("2026-08-01") }];
  s.captures = [
    // Unprocessed, and its text names two projects materially.
    { id: "c1", text: "Follow up on the applications and the portfolio review",
      createdAt: D(T, 10), processingStatus: "inbox", linkedEntityRefs: [] },
    // Already processed — nothing unresolved about it.
    { id: "c2", text: "Follow up on the applications and the portfolio review",
      createdAt: D(T, 9), processingStatus: "processed", processedAt: D(T, 9), linkedEntityRefs: [] },
  ] as StoreState["captures"];
  return s;
}

const build = (s: StoreState, limit?: number): DecisionInbox =>
  buildDecisionInbox(s, buildTodayIndexes(s, T), { today: T, offsetMinutes: 0, limit });

export function runDecisionInboxSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  const s = world();
  const inbox = build(s, 20);
  const ids = inbox.items.map((i) => i.entity.id);
  const kinds = inbox.items.map((i) => i.kind);

  // ---- §3, §6. What the queue contains -----------------------------------
  ok("94.1 §11 a wait whose follow-up has arrived is a decision",
    ids.includes("a-wait-due"), ids.join(","));
  ok("94.2 §13 an active goal with no path is a decision",
    ids.includes("g-none"), ids.join(","));
  ok("94.3 §10 work deferred past the threshold is a decision",
    ids.includes("a-thrice"), ids.join(","));
  ok("94.4 §8, §30 an unprocessed capture with contested context is a decision",
    ids.includes("c1"), ids.join(","));
  ok("94.5 §6 …and those are the only kinds",
    kinds.every((k) => (DECISION_ORDER as readonly string[]).includes(k)), kinds.join(","));

  // ---- §17. What it must NEVER contain -----------------------------------
  //
  // These are the assertions the sprint exists for. A decision queue that fills
  // with ordinary work is a backlog with a more anxious name.
  for (const [id, why] of [
    ["a-overdue", "plain overdue — the answer is to do it"],
    ["a-wait-future", "a follow-up three weeks out is a plan, not a question"],
    ["g-done", "an achieved goal"],
    ["g-ok", "a goal that already has work"],
    ["a-blocked", "blocked, whose only options are navigation"],
    ["a-once", "one deferral, below the threshold"],
    ["a-blocker", "an ordinary open action"],
    ["a-direct", "an action due today"],
    ["c2", "a capture already processed"],
  ] as const) {
    ok(`94.6 §17 ${id} is not a decision — ${why}`, !ids.includes(id), ids.join(","));
  }
  {
    // §13's harder case. `goalsMissingPath` asks only about PROJECTS, so a goal
    // carried by a live action linked straight to it is still on that list —
    // and asking "what should carry this goal?" there would be asking about a
    // decision the user already made. The queue reads `goalsWithoutAnyPath`.
    const carried = world();
    carried.nextActions.push(act({ id: "a-hobby", title: "Book a taster lesson", goalId: "g-none" }));
    const cIds = build(carried, 20).items.map((i) => i.entity.id);
    ok("94.6b §13 a goal carried by a directly-linked live action is not a decision",
      !cIds.includes("g-none"), cIds.join(","));
    ok("94.6c §13 …and the project-only predicate would still have listed it",
      goalsMissingPath(carried).some((g) => g.id === "g-none"),
      goalsMissingPath(carried).map((g) => g.id).join(","));
    const dropped = world();
    dropped.nextActions.push(act({ id: "a-hobby", title: "Book a taster lesson",
      goalId: "g-none", status: "completed" }));
    ok("94.6d §13 …but a completed one carries nothing, so the question returns",
      build(dropped, 20).items.some((i) => i.entity.id === "g-none"));
  }

  // ---- §18. Attention is not decision ------------------------------------
  {
    const short = buildAttentionShortlist(s, buildTodayIndexes(s, T), T, { limit: ATTENTION_MAX_LIMIT });
    const attentionIds = short.map((a) => a.entity.id);
    ok("94.7 §18 the shortlist raises things the queue does not",
      attentionIds.includes("a-overdue") && !ids.includes("a-overdue"),
      `${attentionIds.join(",")} vs ${ids.join(",")}`);
    ok("94.8 §18 …and the two models are not the same list",
      JSON.stringify(attentionIds.sort()) !== JSON.stringify([...ids].sort()));
  }

  // ---- §19. One record, one row ------------------------------------------
  {
    ok("94.9 §19 no record appears twice",
      new Set(ids).size === ids.length, ids.join(","));
    // An action that is BOTH a due follow-up and thrice deferred asks once —
    // as the follow-up, because a date that has arrived outranks a pattern.
    const both = world();
    const w = both.nextActions.find((a) => a.id === "a-wait-due")!;
    w.history = [...w.history,
      h("deferred", D("2026-09-02", 17)), h("returned", D("2026-09-03", 6)),
      h("deferred", D("2026-09-05", 17)), h("returned", D("2026-09-06", 6)),
      h("deferred", D(T, 8))];
    const cb = build(both, 20);
    const rows = cb.items.filter((i) => i.entity.id === "a-wait-due");
    ok("94.10 §19 …even when two sources both produce it", rows.length === 1,
      JSON.stringify(rows.map((r) => r.kind)));
    ok("94.11 §19, §37 …and the higher-precedence kind wins",
      rows[0]?.kind === "WAITING_FOLLOW_UP", String(rows[0]?.kind));
  }
  {
    // The measurement that shaped the design: the shortlist would have HIDDEN
    // this decision behind an attention signal on the same record.
    const both = world();
    both.nextActions.push(act({ id: "a-both", title: "Request the transcript",
      projectId: "p-apps", dueDate: "2026-09-01",
      history: [h("created", D("2026-08-01")), h("deferred", D("2026-09-02", 17)),
        h("returned", D("2026-09-03", 6)), h("deferred", D("2026-09-05", 17)),
        h("returned", D("2026-09-06", 6)), h("deferred", D(T, 19))] }));
    const short = buildAttentionShortlist(both, buildTodayIndexes(both, T), T, { limit: ATTENTION_MAX_LIMIT });
    const asAttention = short.filter((a) => a.entity.id === "a-both").map((a) => a.kind);
    ok("94.12 §19 the shortlist reports that record as attention only",
      asAttention.length === 1 && asAttention[0] === "overdue", asAttention.join(","));
    ok("94.13 §19 …and the queue still finds the decision underneath it",
      build(both, 20).items.some((i) => i.entity.id === "a-both"
        && i.kind === "REPEATED_DEFERRAL_REVIEW"),
      build(both, 20).items.map((i) => `${i.entity.id}:${i.kind}`).join(","));
  }

  // ---- §37. The ordering --------------------------------------------------
  ok("94.14 §37 items come in the documented precedence",
    kinds.map((k) => DECISION_ORDER.indexOf(k))
      .every((r, i, a) => i === 0 || a[i - 1] <= r), kinds.join(","));
  ok("94.15 §37 …and the order is a list of words, not a score",
    DECISION_ORDER.length === 4 && !decisionStrings(inbox).some((x) => /\b\d+(\.\d+)?\s*(pts?|score)\b/i.test(x)));
  ok("94.16 §5 the same state produces the same keys",
    JSON.stringify(build(world(), 20).items.map((i) => i.key))
      === JSON.stringify(build(world(), 20).items.map((i) => i.key)));

  // ---- §20, §21, §38. Question, options, reason ---------------------------
  ok("94.17 §20 every row asks an actual question",
    inbox.items.every((i) => i.question.trim().endsWith("?")),
    inbox.items.map((i) => i.question).join(" | "));
  ok("94.18 §20 …in words, never a kind name",
    !inbox.items.some((i) => /^[A-Z_]+$/.test(i.question) || /AMBIGUOUS|REPEATED_/.test(i.question)));
  ok("94.19 §38 every row says why Conqify needs the user",
    inbox.items.every((i) => i.reason.trim().length > 0 && !/needs attention/i.test(i.reason)),
    inbox.items.map((i) => i.reason).join(" | "));
  ok("94.20 §38 …and names the field it traces to",
    inbox.items.every((i) => i.evidence.trim().length > 0),
    inbox.items.map((i) => i.evidence).join(", "));
  ok("94.21 §21 every row offers two to four options",
    inbox.items.every((i) => i.options.length >= 2 && i.options.length <= 4),
    inbox.items.map((i) => i.options.length).join(","));
  ok("94.22 §21 …each mapping to a resolution or a real destination",
    inbox.items.every((i) => i.options.every((o) => !!o.resolution || !!o.href)),
    "");
  ok("94.23 §22 nothing is preselected",
    !JSON.stringify(inbox.items).includes('"selected"')
    && !JSON.stringify(inbox.items).includes('"default"'));
  ok("94.24 §21 …and every row has somewhere to look when in doubt",
    inbox.items.every((i) => !!i.href), "");

  // ---- §35, §36. Empty, and the cap --------------------------------------
  {
    const cq = build(emptyStoreState(), 20);
    ok("94.25 §35 an empty world produces no decisions", cq.items.length === 0 && cq.total === 0);
    ok("94.26 §35 …and zero is a success sentence, not a prompt to do more",
      /nothing needs your decision/i.test(DECISION_EMPTY)
      && !/but|however|meanwhile|instead/i.test(DECISION_EMPTY), DECISION_EMPTY);
    ok("94.27 §26 …and the count line is absent rather than zero",
      decisionCountLine(cq) === null, String(decisionCountLine(cq)));
  }
  ok("94.28 §26 a non-empty queue has a compact count line",
    decisionCountLine(inbox) === `${DECISION_HEADING} · ${inbox.total}`,
    String(decisionCountLine(inbox)));
  {
    const many = world();
    for (let i = 0; i < 12; i += 1) {
      many.goals.push(goal({ id: `g-x${i}`, title: `Goal number ${i}` }));
    }
    const capped = build(many);
    ok("94.29 §36 the queue is capped", capped.items.length <= MAX_DECISIONS, String(capped.items.length));
    ok("94.30 §36 …and the remainder is counted, never dropped silently",
      capped.total > capped.items.length, `${capped.items.length} of ${capped.total}`);
  }

  // ---- §39, §40. Resolution and staleness ---------------------------------
  {
    const resolved = world();
    const w = resolved.nextActions.find((a) => a.id === "a-wait-due")!;
    w.status = "open"; w.waitingOn = undefined; w.followUpDate = undefined;
    ok("94.31 §39 stopping a wait removes its decision, with no bookkeeping",
      !build(resolved, 20).items.some((i) => i.entity.id === "a-wait-due"),
      build(resolved, 20).items.map((i) => i.entity.id).join(","));
  }
  {
    const pathed = world();
    pathed.nextActions.push(act({ id: "a-sail", title: "Book a taster lesson", goalId: "g-none" }));
    ok("94.32 §39 giving a goal live work removes its decision",
      !build(pathed, 20).items.some((i) => i.entity.id === "g-none"),
      build(pathed, 20).items.map((i) => i.entity.id).join(","));
  }
  {
    const stopped = world();
    stopped.nextActions.find((a) => a.id === "a-thrice")!.status = "cancelled";
    ok("94.33 §39 stopping deferred work removes its decision",
      !build(stopped, 20).items.some((i) => i.entity.id === "a-thrice"));
  }
  {
    const filed = world();
    filed.captures[0].processingStatus = "processed";
    ok("94.34 §39 filing a capture removes its decision",
      !build(filed, 20).items.some((i) => i.entity.id === "c1"),
      build(filed, 20).items.map((i) => i.entity.id).join(","));
  }
  {
    // §40. The row was rendered; the record changed underneath it.
    const stale = world();
    stale.nextActions.find((a) => a.id === "a-wait-due")!.status = "completed";
    const item = inbox.items.find((i) => i.entity.id === "a-wait-due")!;
    ok("94.35 §40 a stale row is detected before anything runs",
      decisionStillStands(stale, item) === false, String(decisionStillStands(stale, item)));
    ok("94.36 §40 …and a fresh one still stands",
      decisionStillStands(s, item) === true);
    const goalItem = inbox.items.find((i) => i.entity.id === "g-none")!;
    const gained = world();
    gained.nextActions.push(act({ id: "a-sail", title: "Book a taster lesson", goalId: "g-none" }));
    ok("94.37 §40 …for a goal that gained a path in another tab",
      decisionStillStands(gained, goalItem) === false);
    const filed = world();
    filed.captures[0].processingStatus = "processed";
    ok("94.38 §40 …and for a capture filed in another tab",
      decisionStillStands(filed, inbox.items.find((i) => i.entity.id === "c1")!) === false);
  }

  // ---- §10, §44. Neutral about a person -----------------------------------
  ok("94.39 §10 the deferral row states the count and stops",
    /deferred this 3 times/.test(inbox.items.find((i) => i.entity.id === "a-thrice")?.reason ?? ""),
    inbox.items.find((i) => i.entity.id === "a-thrice")?.reason ?? "");
  {
    const bad = decisionStrings(inbox).filter((x) =>
      DECISION_FORBIDDEN_WORDS.some((w) => (x || "").toLowerCase().includes(w)));
    ok("94.40 §44 nothing interprets the person", bad.length === 0, bad.slice(0, 3).join(" | "));
  }
  ok("94.41 §13 the goal row implies no failure",
    !/should|failing|neglect|behind/i.test(inbox.items.find((i) => i.entity.id === "g-none")?.reason ?? ""),
    inbox.items.find((i) => i.entity.id === "g-none")?.reason ?? "");
  ok("94.42 §11 the follow-up row names the person without claiming they owe anything",
    /Follow up with Maria\?/.test(inbox.items.find((i) => i.entity.id === "a-wait-due")?.question ?? "")
    && !/owes|chasing|ignoring/i.test(decisionStrings(inbox).join(" ")),
    inbox.items.find((i) => i.entity.id === "a-wait-due")?.question ?? "");

  // ---- §10. The threshold is LIFEOS-081's ---------------------------------
  {
    const two = world();
    two.nextActions.push(act({ id: "a-twice", title: "Email the registrar",
      history: [h("created", D("2026-08-01")), h("deferred", D("2026-09-02", 17)),
        h("deferred", D(T, 19))] }));
    ok("94.43 §10 the threshold is the one LIFEOS-081 already set",
      REPEATED_THRESHOLD === 2 && build(two, 20).items.some((i) => i.entity.id === "a-twice"),
      String(REPEATED_THRESHOLD));
    const recurring = world();
    recurring.nextActions.push(act({ id: "a-recur", title: "Water the plants",
      recurrence: { frequency: "weekly", interval: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      history: [h("created", D("2026-07-01")), h("deferred", D("2026-09-02", 17)),
        h("deferred", D("2026-09-05", 17)), h("deferred", D(T, 19))] } as Partial<NextAction> & { id: string; title: string }));
    ok("94.44 §10, §44 …and a standing schedule is never called avoidance",
      !build(recurring, 20).items.some((i) => i.entity.id === "a-recur"),
      build(recurring, 20).items.map((i) => i.entity.id).join(","));
  }

  // ---- §24, §41. Nothing is stored ---------------------------------------
  {
    const before = JSON.stringify(s);
    build(s, 20);
    build(s, 20);
    ok("94.45 §24 building the queue writes nothing", JSON.stringify(s) === before);
    ok("94.46 §24 …and no queue domain exists to write to",
      !Object.keys(emptyStoreState()).some((k) => /decisionInbox|decisionQueue|dismiss/i.test(k)),
      Object.keys(emptyStoreState()).filter((k) => /decision/i.test(k)).join(","));
  }

  // ---- §49. Bounded work at scale ----------------------------------------
  for (const n of [100, 1000]) {
    const big = emptyStoreState();
    for (let i = 0; i < n; i += 1) {
      big.nextActions.push(act({ id: `b${i}`, title: `Action ${i}`,
        dueDate: i % 3 === 0 ? "2026-09-05" : undefined,
        status: i % 7 === 0 ? "waiting" : "open",
        waitingOn: i % 7 === 0 ? "Someone" : undefined,
        followUpDate: i % 7 === 0 ? T : undefined,
        history: [h("created", D("2026-08-01"))] }));
    }
    const bix = buildTodayIndexes(big, T);
    const t = Date.now();
    const q = buildDecisionInbox(big, bix, { today: T, offsetMinutes: 0 });
    const ms = Date.now() - t;
    ok(`94.47.${n} §49 the queue over ${n} actions builds in under 400ms`, ms < 400, `${ms}ms`);
    ok(`94.48.${n} §36 …and stays capped however much is open`,
      q.items.length <= MAX_DECISIONS, `${q.items.length} of ${q.total}`);
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
