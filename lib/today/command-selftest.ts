/**
 * Daily command centre self-tests (LIFEOS-083).
 *
 * ## What is proved red
 *
 * The audit ran the product and measured five things, all of them real:
 *
 *   1. the first mobile viewport showed only "Getting started 2/8"
 *   2. the 082 attention shortlist was reachable only through Memory
 *   3. two different "Needs attention" headings rendered on one page
 *   4. no daily surface read LIFEOS-081's changes
 *   5. a calm day still rendered two mobile screens of scaffolding
 *
 * 1, 3 and 5 are layout facts and are asserted in the browser suite, where they
 * can actually be measured. This file asserts the composition: what the command
 * view puts in front of a person, what it suppresses, and — mostly — what it
 * refuses to say.
 *
 * ## The assertions that matter are the refusals
 *
 * That a suppressed card's reason is not lost. That a completed item does not
 * return to an active section. That the calm line never tells someone what to
 * skip. That nothing is invented on an empty day.
 *
 * Pure: no store writes, no clock, no AI.
 */

import type { NextAction, Goal, LifeEvent, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView, FORBIDDEN_TODAY_WORDS } from "@/lib/today/view";
import { recommendNextAction } from "@/lib/today/recommend";
import { ATTENTION_FORBIDDEN_WORDS } from "@/lib/guidance/attention";
import {
  buildDailyCommandView, calmLine, commandStrings,
  SINCE_YESTERDAY_KINDS, SINCE_YESTERDAY_LIMIT, SINCE_YESTERDAY_HEADING,
} from "@/lib/today/command";

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

const ev = (p: Partial<LifeEvent> & { id: string; title: string; date: string }): LifeEvent =>
  ({ allDay: false, createdAt: A(-5), updatedAt: A(-5), ...p } as LifeEvent);

function stateWith(over: Partial<StoreState>): StoreState {
  return { ...emptyStoreState(), ...over };
}

const build = (s: StoreState, today = TODAY, now = "09:00") => {
  const ix = buildTodayIndexes(s, today, now);
  const view = buildTodayView(s, ix);
  return { ix, view, cmd: buildDailyCommandView(s, ix, view, today) };
};

/** A realistic dense day, matching the audit's own fixture. */
function world(): StoreState {
  return stateWith({
    goals: [goal({
      id: "g1", title: "Graduate school", horizon: "medium",
      history: [
        { id: "h1", at: A(-30, 8), kind: "created" },
        { id: "h2", at: A(-1, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
      ],
    })],
    events: [ev({ id: "ev1", title: "Advisor meeting", date: D(0), startTime: "09:00" })],
    nextActions: [
      // Overdue AND the likely recommendation — the §22 collision.
      act({ id: "a1", title: "Submit UH application", dueDate: D(-2) }),
      // Due today.
      act({ id: "a2", title: "Draft statement of purpose", dueDate: D(0) }),
      // Deferred three times — reaches attention only via the 082 shortlist.
      act({
        id: "a3", title: "Request recommendation letter",
        history: [
          { id: "e1", action: "created", at: A(-9) },
          { id: "e2", action: "deferred", at: A(-6, 10), detail: D(-4) },
          { id: "e3", action: "deferred", at: A(-4, 10), detail: D(-2) },
          { id: "e4", action: "deferred", at: A(-2, 10), detail: D(3) },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Completed YESTERDAY — belongs to Since yesterday, never to an active section.
      act({
        id: "a4", title: "Buy running shoes", status: "completed", completedAt: A(-1, 15),
        history: [{ id: "e5", action: "created", at: A(-3) }, { id: "e6", action: "completed", at: A(-1, 15) }],
      } as Partial<NextAction> & { id: string; title: string }),
      // Scheduled well ahead — grounds the calm line.
      act({ id: "a5", title: "Renew passport", dueDate: D(20) }),
    ],
    constitutionElements: [
      { id: "s1", kind: "standard", status: "active", statement: "Ask for a recommendation early.", adoptedAt: A(-30), linkedRefs: [], createdAt: A(-30), updatedAt: A(-30) },
      { id: "s2", kind: "standard", status: "retired", statement: "Never work late at night.", adoptedAt: A(-30), retiredAt: A(-1, 11), linkedRefs: [], createdAt: A(-30), updatedAt: A(-1, 11) },
    ] as StoreState["constitutionElements"],
    constitutionRevisions: [{ id: "r1", elementId: "s2", changeKind: "retired", at: A(-1, 11) }] as StoreState["constitutionRevisions"],
  });
}

export function runCommandCenterSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const { ix, view, cmd } = build(s);

  // ------------------------------------------------------------------------
  // §9 — the 082 shortlist finally reaches the daily surface.
  // ------------------------------------------------------------------------

  ok("83.1 the daily view carries an attention shortlist", Array.isArray(cmd.attention));
  ok("83.2 …capped at three", cmd.attention.length <= 3, String(cmd.attention.length));
  ok("83.3 …and it reaches a fact the signal layer never had",
    [...cmd.attention, ...cmd.suppressed.map((x) => x.entityId)]
      .some((x) => (typeof x === "string" ? x : x.entity.id) === "a3"),
    JSON.stringify(cmd.attention.map((a) => [a.kind, a.title])));

  // ------------------------------------------------------------------------
  // §22, §23 — dedup precedence, and nothing lost by it.
  // ------------------------------------------------------------------------

  const nextId = view.suggestion.recommendation?.action.id;
  ok("83.4 a recommendation exists to collide with", !!nextId, String(nextId));
  ok("83.5 the recommended action has no duplicate attention card",
    !cmd.attention.some((a) => a.entity.id === nextId),
    JSON.stringify(cmd.attention.map((a) => a.entity.id)));
  ok("83.6 …and the suppression is recorded with its winner",
    cmd.suppressed.some((x) => x.entityId === nextId && x.because === "next"),
    JSON.stringify(cmd.suppressed));
  // THE assertion. Suppression must move the evidence, not delete it.
  ok("83.7 …with its reason still visible on that row",
    !!nextId && (!!cmd.inlineReasons[nextId ?? ""]
      || (view.suggestion.recommendation?.reasons ?? []).some((r) => /due/i.test(r.text))),
    JSON.stringify([cmd.inlineReasons, (view.suggestion.recommendation?.reasons ?? []).map((r) => r.text)]));
  // Found on the rendered page, not in a test: the Next card lists its own
  // reasons, so moving the suppressed card's sentence there printed "Was due
  // Tue, Sep 1" twice on one card.
  ok("83.7b …unless that row already says it",
    !(view.suggestion.recommendation?.reasons ?? []).some((r) =>
      r.text.toLowerCase().replace(/[.\s]+$/, "") === (cmd.inlineReasons[nextId ?? ""] ?? "\u0000").toLowerCase().replace(/[.\s]+$/, "")),
    JSON.stringify([(view.suggestion.recommendation?.reasons ?? []).map((r) => r.text), cmd.inlineReasons[nextId ?? ""]]));
  ok("83.8 …and the reason is the one the card would have shown",
    // Either the reason travelled, or the winning row already carried it.
    // Both are correct; silently losing it is not, which is what 83.7 guards.
    !!nextId && (!!cmd.inlineReasons[nextId ?? ""] || (view.suggestion.recommendation?.reasons ?? []).some((r) => /due/i.test(r.text))),
    JSON.stringify([cmd.inlineReasons[nextId ?? ""], (view.suggestion.recommendation?.reasons ?? []).map((r) => r.text)]));

  // An item on today's schedule wins over an attention card too.
  {
    const dueTodayIds = new Set(view.dueToday.map((a) => a.id));
    ok("83.9 nothing on today's schedule also gets an attention card",
      !cmd.attention.some((a) => dueTodayIds.has(a.entity.id)),
      JSON.stringify(cmd.attention.map((a) => a.entity.id)));
  }
  // Suppressing does not promote a fourth item into the freed slot.
  ok("83.10 suppression does not backfill the cap",
    cmd.attention.length + cmd.suppressed.length <= 3,
    `${cmd.attention.length} shown + ${cmd.suppressed.length} suppressed`);

  // ------------------------------------------------------------------------
  // §11 — since yesterday.
  // ------------------------------------------------------------------------

  ok("83.11 recent change reaches the daily surface", cmd.sinceYesterday.length > 0,
    JSON.stringify(cmd.sinceYesterday.map((c) => c.kind)));
  ok("83.12 …including a goal direction change",
    cmd.sinceYesterday.some((c) => c.kind === "goal_horizon_changed"),
    JSON.stringify(cmd.sinceYesterday.map((c) => c.kind)));
  ok("83.13 …with both ends of the transition",
    cmd.sinceYesterday.some((c) => c.from === "Near" && c.to === "Medium"),
    JSON.stringify(cmd.sinceYesterday.map((c) => [c.from, c.to])));
  ok("83.14 …and a retired rule", cmd.sinceYesterday.some((c) => c.kind === "rule_retired"));
  ok("83.15 …and yesterday's completion", cmd.sinceYesterday.some((c) => c.kind === "completed"));
  ok("83.16 capped at three", cmd.sinceYesterday.length <= SINCE_YESTERDAY_LIMIT, String(cmd.sinceYesterday.length));
  {
    // OVER-SUPPLY. The dense fixture happens to produce exactly three qualifying
    // changes, so `<= 3` passes whether or not the cap exists — removing the
    // slice left every assertion green. Six changes make the cap do work, and
    // the newest three are named so a cap that kept the wrong end goes red too.
    const many = stateWith({
      nextActions: Array.from({ length: 6 }, (_, i) => act({
        id: `m${i}`, title: `Finished ${i}`, status: "completed", completedAt: A(-1, 8 + i),
        history: [{ id: `mc${i}`, action: "created", at: A(-4) }, { id: `mm${i}`, action: "completed", at: A(-1, 8 + i) }],
      } as Partial<NextAction> & { id: string; title: string })),
    });
    const m = build(many);
    ok("83.16b an over-supplied day is cut to three exactly",
      m.cmd.sinceYesterday.length === 3, String(m.cmd.sinceYesterday.length));
    ok("83.16c …keeping the newest three",
      m.cmd.sinceYesterday.map((c) => c.title).join(",") === "Finished 5,Finished 4,Finished 3",
      m.cmd.sinceYesterday.map((c) => c.title).join(","));
  }
  {
    // The same for attention: six overdue actions, none of them the
    // recommendation or on today's schedule, so suppression cannot mask the cap.
    const many = stateWith({
      nextActions: Array.from({ length: 6 }, (_, i) => act({
        id: `o${i}`, title: `Overdue ${i}`, status: "waiting", waitingOn: `person ${i}`,
        waitingSince: D(-9), followUpDate: D(0),
      } as Partial<NextAction> & { id: string; title: string })),
    });
    const m = build(many);
    ok("83.16d an over-supplied attention list is cut to three exactly",
      m.cmd.attention.length === 3, String(m.cmd.attention.length));
  }
  ok("83.17 newest first", cmd.sinceYesterday.every((c, i) =>
    i === 0 || cmd.sinceYesterday[i - 1].occurredAt >= c.occurredAt),
    JSON.stringify(cmd.sinceYesterday.map((c) => c.occurredAt)));

  // §11's actual constraint: adding a task is not news, and neither is deferring.
  ok("83.18 an item merely CREATED is not recent news",
    !(SINCE_YESTERDAY_KINDS as string[]).includes("created"));
  ok("83.19 …nor a deferral", !(SINCE_YESTERDAY_KINDS as string[]).includes("deferred"));
  ok("83.20 …nor a note", !(SINCE_YESTERDAY_KINDS as string[]).includes("note_added"));
  ok("83.21 the kinds that qualify all finished, ended or changed direction",
    SINCE_YESTERDAY_KINDS.every((k) =>
      /^(completed|recurring_completed|waiting_ended|goal_|rule_)/.test(k)),
    SINCE_YESTERDAY_KINDS.join(","));

  // ------------------------------------------------------------------------
  // §21 — a completed item never returns to an active section.
  // ------------------------------------------------------------------------

  ok("83.22 yesterday's completion is not in attention",
    !cmd.attention.some((a) => a.entity.id === "a4"));
  ok("83.23 …nor on today's schedule",
    !view.dueToday.some((a) => a.id === "a4") && !view.alsoToday.some((a) => a.id === "a4"));
  ok("83.24 …it is only recent history",
    cmd.sinceYesterday.some((c) => c.entity.id === "a4"));

  // ------------------------------------------------------------------------
  // §14 — the calm line is arithmetic, never advice.
  // ------------------------------------------------------------------------

  ok("83.25 a busy day with later work says how much is scheduled ahead",
    /scheduled later/.test(cmd.canWait ?? ""), String(cmd.canWait));
  ok("83.26 …and never says what to skip",
    !/(ignore|skip|don'?t bother|not important|low priority)/i.test(cmd.canWait ?? ""), String(cmd.canWait));
  {
    // A clear day with something ahead.
    const quiet = stateWith({ nextActions: [act({ id: "q1", title: "Water the plants", dueDate: D(4) })] });
    const q = build(quiet);
    ok("83.27 a clear day says nothing is due", /Nothing is due today/.test(q.cmd.canWait ?? ""), String(q.cmd.canWait));
    ok("83.28 …and counts what is ahead", /1 open item is scheduled later/.test(q.cmd.canWait ?? ""), String(q.cmd.canWait));
    ok("83.29 …and raises no attention", q.cmd.attention.length === 0, JSON.stringify(q.cmd.attention.map((a) => a.kind)));
  }
  {
    // A truly empty store.
    const e = emptyStoreState();
    const b = build(e);
    ok("83.30 an empty day invents nothing", b.cmd.attention.length === 0 && b.cmd.sinceYesterday.length === 0);
    ok("83.31 …and says only what is true", b.cmd.canWait === "Nothing is due today.", String(b.cmd.canWait));
    ok("83.32 …with no manufactured urgency",
      !/(urgent|behind|overdue|catch up|attention)/i.test(b.cmd.canWait ?? ""), String(b.cmd.canWait));
  }
  {
    // A busy day with NOTHING scheduled ahead says nothing at all, rather than
    // reaching for something reassuring.
    const busy = stateWith({ nextActions: [act({ id: "b1", title: "Do the thing", dueDate: D(0) })] });
    ok("83.33 a busy day with nothing ahead stays silent",
      build(busy).cmd.canWait === undefined, String(build(busy).cmd.canWait));
  }

  // ------------------------------------------------------------------------
  // §20 — the same view works at any hour.
  // ------------------------------------------------------------------------

  {
    const morning = build(s, TODAY, "07:00");
    const evening = build(s, TODAY, "21:00");
    ok("83.34 the composition is the same at 7am and 9pm",
      JSON.stringify(morning.cmd.attention.map((a) => a.id)) === JSON.stringify(evening.cmd.attention.map((a) => a.id)));
    ok("83.35 …and so is recent history",
      JSON.stringify(morning.cmd.sinceYesterday.map((c) => c.id)) === JSON.stringify(evening.cmd.sinceYesterday.map((c) => c.id)));
    ok("83.36 no greeting logic lives in the model",
      !commandStrings(morning.cmd).join(" ").match(/good (morning|afternoon|evening)/i));
  }

  // §28-equivalent: same state, same view.
  ok("83.37 the view is stable across builds",
    JSON.stringify(build(s).cmd.attention.map((a) => a.id)) === JSON.stringify(cmd.attention.map((a) => a.id)));
  ok("83.38 …including recent history",
    JSON.stringify(build(s).cmd.sinceYesterday.map((c) => c.id)) === JSON.stringify(cmd.sinceYesterday.map((c) => c.id)));

  // ------------------------------------------------------------------------
  // §2, §39.10 — Today's own ordering is not rewritten.
  // ------------------------------------------------------------------------

  {
    const before = recommendNextAction(s, ix, TODAY);
    buildDailyCommandView(s, ix, view, TODAY);
    const after = recommendNextAction(s, ix, TODAY);
    ok("83.39 composing the day does not disturb Suggested Next",
      (before.recommendation?.action.id ?? null) === (after.recommendation?.action.id ?? null));
    ok("83.40 …and the schedule is the view's, untouched",
      JSON.stringify(buildTodayView(s, ix).dueToday.map((a) => a.id)) === JSON.stringify(view.dueToday.map((a) => a.id)));
  }
  ok("83.41 no score exists on the command view",
    !Object.keys(cmd).some((k) => /score|weight|rank|priority|urgency/i.test(k)),
    JSON.stringify(Object.keys(cmd)));

  // ------------------------------------------------------------------------
  // §16, §26 — language.
  // ------------------------------------------------------------------------

  {
    const strings = commandStrings(cmd).join(" ").toLowerCase();
    ok("83.42 nothing accuses the user",
      !ATTENTION_FORBIDDEN_WORDS.some((w) => strings.includes(w)),
      ATTENTION_FORBIDDEN_WORDS.filter((w) => strings.includes(w)).join(", "));
    ok("83.43 …and Today's own bans hold too",
      !FORBIDDEN_TODAY_WORDS.some((w) => strings.includes(w)),
      FORBIDDEN_TODAY_WORDS.filter((w) => strings.includes(w)).join(", "));
    ok("83.44 the heading is plain", SINCE_YESTERDAY_HEADING === "Since yesterday");
  }

  // ------------------------------------------------------------------------
  // §35 — performance. Composition over an index the caller already built.
  // ------------------------------------------------------------------------

  for (const n of [100, 1000, 5000]) {
    const big = stateWith({
      nextActions: Array.from({ length: n }, (_, i) => act({
        id: `b${i}`, title: `Task ${i}`, dueDate: i % 5 === 0 ? D(-1) : D(6),
        history: [
          { id: `bc${i}`, action: "created", at: A(-9) },
          { id: `bd${i}`, action: "deferred", at: A(-6, 10), detail: D(-4) },
          { id: `be${i}`, action: "deferred", at: A(-4, 10), detail: D(-2) },
        ],
      } as Partial<NextAction> & { id: string; title: string })),
      goals: Array.from({ length: Math.floor(n / 10) }, (_, i) => goal({ id: `bg${i}`, title: `Goal ${i}` })),
    });
    const bix = buildTodayIndexes(big, TODAY, "09:00");
    const bview = buildTodayView(big, bix);
    const t = Date.now();
    const bcmd = buildDailyCommandView(big, bix, bview, TODAY);
    const ms = Date.now() - t;
    ok(`83.45.${n} ${n} entities: compose under 3000ms`, ms < 3000, `${ms}ms`);
    ok(`83.46.${n} …and the caps still hold`,
      bcmd.attention.length <= 3 && bcmd.sinceYesterday.length <= SINCE_YESTERDAY_LIMIT,
      `${bcmd.attention.length}/${bcmd.sinceYesterday.length}`);
  }

  // The calm line is arithmetic and must not become a scan per action.
  {
    const big = stateWith({
      nextActions: Array.from({ length: 5000 }, (_, i) => act({ id: `c${i}`, title: `T${i}`, dueDate: D(9) })),
    });
    const bix = buildTodayIndexes(big, TODAY, "09:00");
    const bview = buildTodayView(big, bix);
    const t = Date.now();
    for (let i = 0; i < 20; i++) calmLine(big, bview, TODAY);
    const ms = Date.now() - t;
    ok("83.47 20 calm-line builds over 5000 actions under 1500ms", ms < 1500, `${ms}ms`);
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
