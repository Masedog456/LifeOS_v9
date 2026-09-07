/**
 * LIFEOS-104 — the Today surface, asserted.
 *
 * Organised by the reds the audit measured rather than by the functions that
 * fix them, because a red that comes back will come back as a state, not as a
 * function call. Each block names the world it was found in and pairs the
 * record that must produce the behaviour with the near neighbour that must not
 * — a suppression that fires for both is not a rule, it is a deletion.
 *
 * The FIXTURES ARE THE AUDIT'S. `scripts/fixtures/lifeos-104-worlds.cjs` is a
 * CommonJS module the browser suite and the probe both read, so the worlds are
 * rebuilt here in TypeScript rather than imported. They are deliberately the
 * smallest store that reaches each state; where a world here differs from the
 * fixture, the assertion says so.
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import {
  buildTodayCommand, todaySurfaceStrings, openWorkDetail,
  JUDGMENT_KINDS, NOTHING_PRESSING, OPEN_WORK_LIMIT,
} from "@/lib/today/surface";
import { buildTodayView, violatesTodayLanguage } from "@/lib/today/view";
import { buildDecisionInbox } from "@/lib/guidance/decisions";
import { buildDailyExecutiveView, orientationLine } from "@/lib/today/daily";
import { goalPathState, goalsWithoutAnyPath } from "@/lib/execution/alignment";
import { violatesCommitmentLanguage } from "@/lib/commitment/signals";

const TODAY = "2026-09-07" as DayKey;
const NOW = "10:30";

/** TODAY + n days. The audit's anchor, so the two agree about every date. */
function dk(n = 0): DayKey {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10) as DayKey;
}
const at = (n = 0, h = 9) => `${dk(n)}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

let hn = 0;
const H = (action: string, when: string, x: Record<string, unknown> = {}) =>
  ({ id: `h${++hn}`, action, at: when, ...x }) as NextAction["history"][number];

type A = StoreState["nextActions"][number];
const act = (p: Partial<A> & { id: string; title: string }): A => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-20), updatedAt: at(-20), ...p,
} as A);

const goal = (id: string, title: string) => ({
  id, title, description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
  createdAt: at(-60), updatedAt: at(-60),
}) as StoreState["goals"][number];

const project = (id: string, title: string, goalId?: string) => ({
  id, title, description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [], goalId,
  createdAt: at(-60), updatedAt: at(-60),
}) as StoreState["projects"][number];

const waiting = (id: string, title: string, on: string, followUpDate?: string, since = at(-7)) =>
  act({ id, title, status: "waiting", waitingOn: on, waitingSince: since, followUpDate,
    history: [H("waiting", since, { detail: on, fromStatus: "open", toStatus: "waiting" })] } as Partial<A> & { id: string; title: string });

/** An action with `times` recorded deferrals, the last landing on `until`. */
const deferred = (id: string, title: string, times: number, until?: string) =>
  act({ id, title, status: "deferred", deferredUntil: until,
    history: Array.from({ length: times }, (_, i) =>
      H("deferred", at(-14 + i * 3, 10), { fromStatus: "open", toStatus: "deferred", detail: until })),
  } as Partial<A> & { id: string; title: string });

function store(p: Partial<StoreState>): StoreState {
  return { ...emptyStoreState(), ...p } as StoreState;
}
function surface(s: StoreState, today: DayKey = TODAY, now = NOW) {
  return buildTodayCommand(s, buildTodayIndexes(s, today, now), today);
}

export function runTodaySurfaceSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

  // ======================================================================
  // RED A (§9, §38) — a store with live work is not an empty store.
  //
  // Four of the audit's twenty worlds rendered "Tell Conqify what's going on."
  // over live records, because `view.empty` ANDed every section and undated
  // open work belonged to no section at all.
  // ======================================================================
  {
    // World A. Two open actions, no dates, no grounding.
    const quiet = store({ nextActions: [
      act({ id: "a1", title: "Sort the bookshelf" }),
      act({ id: "a2", title: "Look into a new bike lock" }),
    ] });
    const c = surface(quiet);
    ok("104.1 §9 a quiet day with live work is not empty", !c.empty);
    ok("104.2 §9 …and the OLD check said it was",
      buildTodayView(quiet, buildTodayIndexes(quiet, TODAY, NOW)).empty);
    eq("104.3 §8 the open work is named", c.openWork.map((a) => a.id), ["a1", "a2"]);
    eq("104.4 §8 …under a line that invents no urgency", c.suggestedNote, NOTHING_PRESSING);

    // World P. Dated, but a month out — outside the recommender's horizon AND
    // outside Upcoming's window, so it belonged to no section either.
    const future = store({ nextActions: [
      act({ id: "p1", title: "Submit the Oregon application", dueDate: dk(24) }),
      act({ id: "p2", title: "Renew the passport", dueDate: dk(40) }),
    ] });
    ok("104.5 §37 work dated next month is not an empty day", !surface(future).empty);
    eq("104.6 §37 …and the list says what date it carries",
      surface(future).openWork.map((a) => openWorkDetail(a, TODAY)), [`Due ${dk(24)}`, `Due ${dk(40)}`]);

    // World N. Nothing dated at all, but three things moved yesterday.
    const changed = store({ nextActions: [
      act({ id: "n1", title: "Book the venue", status: "completed", completedAt: at(-1, 15), updatedAt: at(-1, 15),
        history: [H("created", at(-9)), H("completed", at(-1, 15), { fromStatus: "open", toStatus: "completed" })] }),
      act({ id: "n4", title: "Chase the surveyor" }),
    ] });
    const cn = surface(changed);
    ok("104.7 §26 a day whose news is yesterday's is not empty", !cn.empty);
    ok("104.8 §26 …and the change is actually carried", cn.sinceYesterday.length > 0,
      JSON.stringify(cn.sinceYesterday.map((x) => x.title)));

    // THE NEIGHBOUR. An empty store is still empty, and a store whose only
    // records are FINISHED or deferred beyond today is still empty of work.
    ok("104.9 §9 an empty store is empty", surface(store({})).empty);
    const doneOnly = store({ nextActions: [
      act({ id: "d1", title: "Book the venue", status: "completed", completedAt: at(-40, 15), updatedAt: at(-40, 15) }),
    ] });
    ok("104.10 §39 …and so is a store holding only long-finished work", surface(doneOnly).empty,
      JSON.stringify(surface(doneOnly).openWork.map((a) => a.id)));

    // §40. Not Today holds: a deferral ahead of today is not open work.
    const parked = store({ nextActions: [deferred("x", "Sort the loft", 1, dk(9))] });
    eq("104.11 §40 work deferred beyond today is not offered as open work",
      surface(parked).openWork.map((a) => a.id), []);
    ok("104.12 §40 …and the page says so by being empty", surface(parked).empty);

    // §36. Blocked and waiting are not executable, so neither is open work.
    const notReady = store({
      nextActions: [
        act({ id: "b", title: "Install the desk" }),
        act({ id: "k", title: "Get lease approval" }),
        waiting("w", "Transcript", "Maria"),
      ],
      actionDependencies: [{ id: "d", blockedId: "b", blockerId: "k", createdAt: at(-10) }],
    } as Partial<StoreState>);
    // The blocker is grounded ("Unlocks …"), so this world gets a
    // recommendation rather than the quiet list — which is the point: neither
    // the blocked action nor the wait is offered as executable ANYWHERE.
    const cn2 = surface(notReady);
    eq("104.13 §43 the blocker is what is recommended", cn2.suggestedNext.recommendation?.action.id, "k");
    ok("104.13b §36, §42 and neither the blocked action nor the wait is offered as executable",
      !cn2.openWork.some((a) => a.id === "b" || a.id === "w")
      && cn2.suggestedNext.recommendation?.action.id !== "b"
      && cn2.suggestedNext.recommendation?.action.id !== "w",
      JSON.stringify(cn2.openWork.map((a) => a.id)));

    // §8's cap. A list, not a backlog.
    const many = store({ nextActions: Array.from({ length: 9 }, (_, i) =>
      act({ id: `m${i}`, title: `Thing ${i}` })) });
    eq("104.14 §8 the open-work list is capped", surface(many).openWork.length, OPEN_WORK_LIMIT);
  }

  // ======================================================================
  // RED B (§17, §48) — goal judgment is not attention, and fires falsely.
  //
  // World J. `goal_path_missing` asks only whether a PROJECT links to the goal,
  // so a goal carried by a live action tripped it — and Today rendered it in
  // the section that means "you can act on this".
  // ======================================================================
  {
    const s = store({
      goals: [goal("j-none", "Learn to sail"), goal("j-path", "Apply to graduate school")],
      nextActions: [act({ id: "j1", title: "Request the recommendation", goalId: "j-path" })],
    });
    const c = surface(s);
    eq("104.15 §17 no goal renders as attention", c.attention.filter((a) => a.entity.kind === "goal"), []);
    ok("104.16 §17 …and the judgment reaches the decision queue instead",
      c.decisions.total === 1 && c.decisions.top?.entity.id === "j-none",
      JSON.stringify([c.decisions.total, c.decisions.top?.entity.id]));
    // The false positive itself, stated as the disagreement it was.
    eq("104.17 §17 the truthful predicate names ONE path-less goal",
      goalsWithoutAnyPath(s).map((g) => g.id), ["j-none"]);
    eq("104.18 §17 …because a live action IS a path", goalPathState(s, s.goals[1]), "actions");
    ok("104.19 §17 …while the raw signal layer still flags both — unchanged, just not rendered",
      buildDailyExecutiveView(s, buildTodayIndexes(s, TODAY, NOW), TODAY)
        .attention.filter((x) => x.kind === "goal_path_missing").length === 2);
    eq("104.20 §18 project-no-next is judgment too", JUDGMENT_KINDS.slice().sort(),
      ["goal_path_missing", "project_no_next_action"]);

    // THE NEIGHBOUR. Removing judgment must not remove ACTION attention.
    const overdue = store({ nextActions: [
      act({ id: "o", title: "File the claim", dueDate: dk(-4) }),
      act({ id: "o2", title: "Tidy the garage", dueDate: dk(-4) }),
    ] });
    ok("104.21 §47 an overdue action still reaches Needs attention",
      surface(overdue).attention.some((a) => a.kind === "overdue"),
      JSON.stringify(surface(overdue).attention.map((a) => a.kind)));
  }

  // ======================================================================
  // RED C (§51) — the orientation line counts what the page renders.
  //
  // Worlds D, G and H said "1 item needing attention" above a page with no
  // attention section; the 120-record world said sixteen and rendered three.
  // ======================================================================
  {
    // World D. One overdue action — which becomes the recommendation, so its
    // attention card is suppressed and there is no attention section at all.
    const d = store({ nextActions: [
      act({ id: "d1", title: "File the insurance claim", dueDate: dk(-4) }),
      act({ id: "d2", title: "Tidy the garage" }),
    ] });
    const c = surface(d);
    eq("104.22 §51 no attention rows render", c.attention.length, 0);
    ok("104.23 §51 …so the line does not promise one",
      !/needing attention/.test(c.orientation), JSON.stringify(c.orientation));
    ok("104.24 §51 …and with no counts at all it says nothing rather than something false",
      c.orientation === "", JSON.stringify(c.orientation));
    ok("104.25 §51 …while the OLD line claimed an item", /1 item needing attention/.test(
      orientationLine(buildDailyExecutiveView(d, buildTodayIndexes(d, TODAY, NOW), TODAY), 0)));

    // The general invariant, over a world where attention DOES render.
    const m = store({
      goals: [goal("g1", "Learn to sail")],
      nextActions: [
        deferred("m1", "Do the tax return", 3, dk(0)),
        waiting("m2", "Signed lease", "Ana", dk(-2), at(-30)),
        act({ id: "m3", title: "Draft the personal statement" }),
      ],
    });
    const cm = surface(m);
    const claimed = Number((cm.orientation.match(/(\d+) items? needing attention/) ?? [0, "0"])[1]);
    eq("104.26 §51 the claimed count IS the rendered count", claimed, cm.attention.length);
    // …and the two numbers are not equal by accident. The shortlist caps at
    // three; the signal layer does not cap at all, which is how the 120-record
    // world came to claim sixteen above three rendered rows.
    const five = store({ nextActions: Array.from({ length: 5 }, (_, i) =>
      act({ id: `v${i}`, title: `Overdue ${i}`, dueDate: dk(-(i + 1)) })) });
    const cf = surface(five);
    const rawFive = buildDailyExecutiveView(five, buildTodayIndexes(five, TODAY, NOW), TODAY).attention.length;
    const claimedFive = Number((cf.orientation.match(/(\d+) items? needing attention/) ?? [0, "0"])[1]);
    ok("104.27 §51 …and where the two differ, the line follows the RENDERED one",
      rawFive > cf.attention.length && claimedFive === cf.attention.length,
      `raw ${rawFive} · rendered ${cf.attention.length} · claimed ${claimedFive}`);
    const decClaim = Number((cm.orientation.match(/(\d+) needing your decision/) ?? [0, "0"])[1]);
    eq("104.28 §51 the decision count is the queue's own total", decClaim, cm.decisions.total);

    // "N to fit in" counts the DO list, not the builder's flexible list — the
    // suggestion is no longer in it.
    const c3 = store({ nextActions: [
      act({ id: "c1", title: "Send the invoice", dueDate: dk(0) }),
      act({ id: "c3", title: "Confirm the caterer", dueDate: dk(0), dueTime: "16:00" }),
    ] });
    const cc = surface(c3);
    const fit = Number((cc.orientation.match(/(\d+) to fit in/) ?? [0, "0"])[1]);
    eq("104.29 §51 …and 'to fit in' counts the rows below it", fit, cc.work.length);
    ok("104.30 §51 …not the timed commitment that became the suggestion",
      !/timed commitment/.test(cc.orientation), JSON.stringify(cc.orientation));
  }

  // ======================================================================
  // RED D (§24) — the suggestion is not repeated underneath itself.
  // ======================================================================
  {
    // World B. One dated action. It was Suggested next, a Today row AND the
    // orientation's "Yours to place" — three times in eleven rows.
    const b = store({ nextActions: [act({ id: "b1", title: "Call the dentist", dueDate: dk(0) })] });
    const cb = surface(b);
    eq("104.31 §24 the suggested action is not a Today row", cb.work.map((w) => w.action.id), []);
    ok("104.32 §24 …and not in the orientation line either",
      !/to fit in/.test(cb.orientation), JSON.stringify(cb.orientation));
    eq("104.33 §24 …while still being the suggestion", cb.suggestedNext.recommendation?.action.id, "b1");

    // World C. A TIMED action wins; the schedule row goes with it, the others stay.
    const c = store({ nextActions: [
      act({ id: "c1", title: "Send the invoice", dueDate: dk(0) }),
      act({ id: "c3", title: "Confirm the caterer", dueDate: dk(0), dueTime: "16:00" }),
    ] });
    const cc = surface(c);
    eq("104.34 §24 a timed suggestion is not also a BE THERE row", cc.fixed.map((f) => f.id), []);
    eq("104.35 §24 …and the rest of the day survives", cc.work.map((w) => w.action.id), ["c1"]);
    ok("104.36 §5 …with the time stated in the reason instead",
      /4 PM/.test(cc.suggestedNext.recommendation!.reasons.map((r) => r.text).join(" ")),
      JSON.stringify(cc.suggestedNext.recommendation!.reasons.map((r) => r.text)));

    // World H. A recurring suggestion loses its duplicate row and keeps its
    // occurrence control, because the recommendation row offers the same one.
    const h = store({ nextActions: [
      act({ id: "h1", title: "Take the medication", dueTime: "08:00", recurrence: { frequency: "daily", interval: 1 } } as Partial<A> & { id: string; title: string }),
    ] });
    const ch = surface(h);
    eq("104.37 §23, §24 a recurring suggestion appears once", [...ch.fixed.map((f) => f.id), ...ch.work.map((w) => w.action.id)], []);

    // THE NEIGHBOUR — this must be suppression, not deletion. An EVENT can
    // never be the suggestion, so no event is ever suppressed.
    const i = store({
      events: [{ id: "e1", title: "Advisor meeting", date: dk(0), startTime: "11:00", endTime: "12:00",
        allDay: false, createdAt: at(-10), updatedAt: at(-10) }],
      nextActions: [act({ id: "i5", title: "Print the consent form", dueDate: dk(0) })],
    } as Partial<StoreState>);
    const ci = surface(i);
    eq("104.38 §21 the event is a BE THERE row", ci.fixed.map((f) => f.id), ["e1"]);
    eq("104.39 §24 …and the action that beat it is not repeated", ci.work.map((w) => w.action.id), []);
    eq("104.40 §21 …and it is not classified as an Action", ci.fixed[0].kind, "event");

    // The NOW/NEXT card is a marker on the row now, not a third mention.
    ok("104.41 §21 the next event is MARKED rather than given a section of its own",
      ci.fixed[0].isNext && !ci.fixed[0].isNow);
  }

  // ======================================================================
  // RED E (§14) — blocked work is never "yours to place".
  // ======================================================================
  {
    const g = store({
      projects: [project("pg", "Clinic launch")],
      nextActions: [
        act({ id: "g-blocked", title: "Install the reception desk", projectId: "pg", dueDate: dk(0) }),
        act({ id: "g-blocker", title: "Get lease approval", projectId: "pg" }),
      ],
      actionDependencies: [{ id: "dg", blockedId: "g-blocked", blockerId: "g-blocker", createdAt: at(-10) }],
    } as Partial<StoreState>);
    const flexible = buildDailyExecutiveView(g, buildTodayIndexes(g, TODAY, NOW), TODAY).flexibleToday;
    eq("104.42 §14 the blocked action is not flexible work", flexible.map((f) => f.action.id), []);
    const c = surface(g);
    eq("104.43 §43 the BLOCKER is what gets recommended", c.suggestedNext.recommendation?.action.id, "g-blocker");
    // …and the blocked row still appears, with its date and its reason.
    const row = c.work.find((w) => w.action.id === "g-blocked");
    ok("104.44 §14 the blocked action keeps its place on today", !!row);
    ok("104.45 §14 …and says what is holding it",
      !!(row?.inlineReason ?? row?.blockedBy), JSON.stringify([row?.inlineReason, row?.blockedBy]));

    // The neighbour: an UNBLOCKED dated action is flexible, and carries no
    // blocked note. Otherwise 104.42 would pass on an empty list.
    const clear = store({ nextActions: [act({ id: "x", title: "Send the quote", dueDate: dk(0) })] });
    eq("104.46 §14 …while ordinary dated work still is flexible",
      buildDailyExecutiveView(clear, buildTodayIndexes(clear, TODAY, NOW), TODAY)
        .flexibleToday.map((f) => f.action.id), ["x"]);
  }

  // ======================================================================
  // RED F (§33) — the two silences are two sentences.
  //
  // 072 §31E's refusal is UNCHANGED and asserted here as unchanged: what the
  // audit found wrong was one sentence covering both a genuinely quiet day and
  // a day with twelve dated items where several tie.
  // ======================================================================
  {
    const q = store({
      events: [{ id: "qe", title: "Sports day", date: dk(0), startTime: "13:30", endTime: "15:00",
        allDay: false, createdAt: at(-10), updatedAt: at(-10) }],
      nextActions: [
        act({ id: "q1", title: "Send the contractor quote", dueDate: dk(0) }),
        act({ id: "q2", title: "Buy a birthday present", dueDate: dk(0) }),
      ],
    } as Partial<StoreState>);
    const cq = surface(q);
    eq("104.47 §31E the recommender still refuses a genuine tie", cq.suggestedNext.recommendation, null);
    ok("104.48 §33 …and the page says how many are on today rather than 'nothing'",
      /3 things on today/.test(cq.suggestedNote ?? ""), JSON.stringify(cq.suggestedNote));
    ok("104.49 §33 …and never says nothing stands out while things are dated",
      !/^No single next action/.test(cq.suggestedNote ?? ""), JSON.stringify(cq.suggestedNote));
    eq("104.50 §33 …and offers no fallback pick", cq.openWork, []);
    ok("104.51 §33 the count is arithmetic over the rendered rows",
      cq.suggestedNote!.startsWith(`${cq.fixed.length + cq.work.length} things`), cq.suggestedNote);

    // The quiet neighbour: no dated work at all gets the OTHER sentence.
    const quiet = store({ nextActions: [
      act({ id: "a1", title: "Sort the bookshelf" }), act({ id: "a2", title: "Read the guidance" }),
    ] });
    eq("104.52 §8 a genuinely quiet day gets the quiet sentence", surface(quiet).suggestedNote, NOTHING_PRESSING);
  }

  // ======================================================================
  // §19, §25 — the decision preview does not duplicate a row on screen.
  // ======================================================================
  {
    // World E. `follow_up_due` and `WAITING_FOLLOW_UP` are one fact with two
    // names; as a section that put the same record two rows above itself.
    const e = store({ nextActions: [
      waiting("e1", "Transcript", "Maria", dk(0)),
      act({ id: "e2", title: "Draft the personal statement" }),
    ] });
    const ce = surface(e);
    eq("104.53 §19 the count is still stated", ce.decisions.total, 1);
    ok("104.54 §25 …but the one question already answered on screen is not previewed",
      ce.decisions.top === undefined, JSON.stringify(ce.decisions.top?.question));
    ok("104.55 §25 …because that record IS the attention row",
      ce.attention.some((a) => (a.actionId ?? a.entity.id) === "e1"));

    // The neighbour: a question NOT on screen is previewed.
    const j = store({
      goals: [goal("j-none", "Learn to sail")],
      nextActions: [act({ id: "j1", title: "Request the recommendation" })],
    });
    const cj = surface(j);
    eq("104.56 §19 a boundary the page does not otherwise show IS previewed",
      cj.decisions.top?.entity.id, "j-none");
    ok("104.57 §19 …with the question and the evidence, and no options",
      !!cj.decisions.top?.question && !!cj.decisions.top?.reason);
    // §19: the count/preview only. The full queue lives at /today/decisions.
    ok("104.58 §19 the surface carries ONE decision, never the queue",
      buildDecisionInbox(j, buildTodayIndexes(j, TODAY, NOW), { today: TODAY }).items.length >= 1
      && Object.keys(cj.decisions).length === 2, JSON.stringify(Object.keys(cj.decisions)));
  }

  // ======================================================================
  // §26, §29, §49 — context is context.
  // ======================================================================
  {
    const r = store({ nextActions: [
      act({ id: "r1", title: "Book the venue", status: "completed", completedAt: at(-1, 15), updatedAt: at(-1, 15),
        history: [H("created", at(-6)), H("completed", at(-1, 15), { fromStatus: "open", toStatus: "completed" })] }),
      act({ id: "r3", title: "Send the thank-you note" }),
    ] });
    const c = surface(r);
    ok("104.59 §26 Since yesterday is carried", c.sinceYesterday.length > 0);
    ok("104.60 §39 …and the finished work is in NO actionable list",
      !c.work.some((w) => w.action.id === "r1") && !c.openWork.some((a) => a.id === "r1")
      && c.suggestedNext.recommendation?.action.id !== "r1");
    // §49: waiting, pulse, returns and upcoming all live in one place now.
    eq("104.61 §49, §50 context has one home", Object.keys(c.later).sort(),
      ["pulse", "returnItem", "returns", "upcoming", "waiting"]);
  }

  // ======================================================================
  // §53 — store truth. Every change reflows the surface.
  // ======================================================================
  {
    const base = () => store({ nextActions: [
      act({ id: "s1", title: "Send the invoice", dueDate: dk(0) }),
      act({ id: "s2", title: "Tidy the garage" }),
    ] });
    eq("104.62 §53 the dated action is the suggestion", surface(base()).suggestedNext.recommendation?.action.id, "s1");

    const completed = base();
    completed.nextActions = completed.nextActions.map((a) =>
      a.id === "s1" ? { ...a, status: "completed", completedAt: at(0, 11) } : a) as StoreState["nextActions"];
    ok("104.63 §53 completing it removes it from every actionable list",
      surface(completed).suggestedNext.recommendation?.action.id !== "s1"
      && !surface(completed).work.some((w) => w.action.id === "s1"));

    const rescheduled = base();
    rescheduled.nextActions = rescheduled.nextActions.map((a) =>
      a.id === "s1" ? { ...a, dueDate: dk(6) } : a) as StoreState["nextActions"];
    eq("104.64 §53 rescheduling it clears today", surface(rescheduled).work.map((w) => w.action.id), []);

    const parked = base();
    parked.nextActions = parked.nextActions.map((a) =>
      a.id === "s1" ? { ...a, status: "deferred", deferredUntil: dk(4), dueDate: undefined } : a) as StoreState["nextActions"];
    ok("104.65 §40, §53 deferring it past today removes it from suggested work",
      surface(parked).suggestedNext.recommendation?.action.id !== "s1"
      && !surface(parked).openWork.some((a) => a.id === "s1"));

    const waited = base();
    waited.nextActions = waited.nextActions.map((a) =>
      a.id === "s1" ? { ...a, status: "waiting", waitingOn: "Ana", waitingSince: at(0, 9) } : a) as StoreState["nextActions"];
    ok("104.66 §42, §53 marking it waiting moves it off executable work",
      surface(waited).suggestedNext.recommendation?.action.id !== "s1"
      && surface(waited).later.waiting.some((w) => w.action.id === "s1"));
  }

  // ======================================================================
  // §44, §45, §54 — no scores, no percentages, no persistence.
  // ======================================================================
  {
    const torture = store({
      goals: [goal("g-nopath", "Learn to sail"), goal("g-path", "Open the clinic")],
      projects: [project("p-next", "Clinic launch", "g-path"), project("p-nonext", "Clinic lease", "g-path")],
      nextActions: [
        act({ id: "t-overdue", title: "File the insurance claim", projectId: "p-next", dueDate: dk(-4) }),
        act({ id: "t-duetoday", title: "Send the contractor quote", projectId: "p-next", dueDate: dk(0) }),
        act({ id: "t-timed", title: "Confirm the caterer", dueDate: dk(0), dueTime: "16:00" }),
        waiting("t-wait-due", "Transcript", "Maria", dk(0)),
        waiting("t-wait-none", "Quote", "Priya", undefined, at(-21)),
        act({ id: "t-blocked", title: "Install the reception desk", projectId: "p-next", dueDate: dk(0) }),
        act({ id: "t-blocker", title: "Get lease approval", projectId: "p-next" }),
        deferred("t-repeated", "Do the tax return", 3, dk(0)),
      ],
      actionDependencies: [{ id: "td", blockedId: "t-blocked", blockerId: "t-blocker", createdAt: at(-10) }],
      events: [{ id: "t-ev", title: "Advisor meeting", date: dk(0), startTime: "11:00", endTime: "12:00",
        allDay: false, createdAt: at(-10), updatedAt: at(-10) }],
    } as Partial<StoreState>);
    const c = surface(torture);
    const strings = todaySurfaceStrings(c);

    const scored = strings.filter((t) => /\d{1,3}\s?%|\b0\.\d{2}\b|score|confidence|priority level/i.test(t));
    eq("104.67 §44, §45 no percentage, score or confidence anywhere", scored, []);
    const shaming = strings.filter((t) => violatesTodayLanguage(t).length > 0 || violatesCommitmentLanguage(t).length > 0);
    eq("104.68 §20 nothing characterises the reader", shaming, []);
    // §22. A stored clock reading must never leave the model as text.
    const raw = strings.filter((t) => /\b[0-2]\d:[0-5]\d\b/.test(t));
    eq("104.69 §22 no raw 24-hour time is rendered as prose", raw, []);
    ok("104.70 §22 …and the times that DO travel are unformatted fields, not strings",
      c.fixed.every((f) => !f.time || /^\d{2}:\d{2}$/.test(f.time)));

    // §54: derived, twice, identically. Nothing is cached or written.
    const again = surface(torture);
    eq("104.71 §54 the same state gives the same surface",
      JSON.stringify(again.work.map((w) => w.action.id)), JSON.stringify(c.work.map((w) => w.action.id)));
    eq("104.72 §54 …including the orientation line", again.orientation, c.orientation);
    eq("104.73 §54 …and the store is untouched by being viewed",
      torture.nextActions.length, 8);

    // §20. The deferral count is the claim; nothing is added to it.
    const deferral = c.decisions.top?.kind === "REPEATED_DEFERRAL_REVIEW" ? c.decisions.top : undefined;
    ok("104.74 §20 a repeated deferral is stated as a count, never a verdict",
      !deferral || /^You deferred this 3 times\.$/.test(deferral.reason), JSON.stringify(deferral?.reason));

    // §50. The torture world is the densest thing the audit could build.
    const sectionCount = [
      c.suggestedNext.recommendation || c.suggestedNote,
      c.fixed.length + c.work.length,
      c.decisions.total,
      c.attention.length,
      c.sinceYesterday.length + c.later.waiting.length + c.later.pulse.length
        + c.later.returns.length + c.later.upcoming.length,
    ].filter(Boolean).length;
    ok("104.75 §50 at most five sections, on the worst day the audit could build",
      sectionCount <= 5, `${sectionCount} sections`);
  }

  // ======================================================================
  // §13 — waiting without a follow-up date is NOT redefined.
  // ======================================================================
  {
    const s = store({ nextActions: [
      waiting("w-none", "Quote", "Priya", undefined, at(-21)),
      waiting("w-due", "Transcript", "Maria", dk(0)),
      act({ id: "a", title: "Draft the statement" }),
    ] });
    const c = surface(s);
    ok("104.76 §13 a dateless wait is on the roster", c.later.waiting.some((w) => w.action.id === "w-none"));
    ok("104.77 §13 …and NOT treated as due", !c.later.waiting.find((w) => w.action.id === "w-none")!.followUpDue);
    ok("104.78 §13 …and raises no attention row", !c.attention.some((a) => (a.actionId ?? a.entity.id) === "w-none"));
    ok("104.79 §12 …while the one whose date arrived does", c.attention.some((a) => (a.actionId ?? a.entity.id) === "w-due"));
    ok("104.80 §42 neither is ever executable",
      c.suggestedNext.recommendation?.action.status !== "waiting");
    /**
     * …and the same thing on the QUIET path, which is where it can go wrong.
     *
     * `openWork` is empty whenever a recommendation exists, so asserting "no
     * wait is in openWork" against a world that produces one is vacuous — a
     * mutant that dropped the `status !== "waiting"` filter passed all 81
     * assertions. This world has two undated open actions, so nothing is
     * grounded, the quiet list is what renders, and both waits are candidates
     * for it if the filter is not there.
     */
    const q = store({ nextActions: [
      waiting("q-none", "Quote", "Priya", undefined, at(-21)),
      waiting("q-due", "Transcript", "Maria", dk(0)),
      act({ id: "q-a", title: "Draft the statement" }),
      act({ id: "q-b", title: "Read the guidance" }),
    ] });
    const cq2 = surface(q);
    eq("104.80b §42 the quiet list is what renders here", cq2.suggestedNote, NOTHING_PRESSING);
    eq("104.80c §42 …and it holds only work that can actually be started",
      cq2.openWork.map((a) => a.id), ["q-a", "q-b"]);
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
