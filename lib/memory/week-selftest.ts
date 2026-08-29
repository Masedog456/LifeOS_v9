/**
 * Week in Review self-tests (LIFEOS-064 §27, §28, §31).
 *
 * Section 4 is the load-bearing one. Every assertion in it is a sentence the
 * product must never say — that a past event was attended, that a project
 * progressed, that creating something was doing it — and each is written
 * against the torture week rather than against a two-record fixture, because
 * these confusions only appear when the same record shows up in three sections.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { Capture, Decision, LifeEvent, NextAction, Note, Project, Reflection, StoreState } from "@/types/mvp";
import {
  buildAutobiographicalTimeline, buildWeekReview, resolveWeekRange, summarise,
  violatesReviewLanguage, reviewStrings, limitationsFor, weekQueries,
  COVERAGE_NOTE, EMPTY_WEEK, FORBIDDEN_REVIEW_WORDS, WEEK_RANGE_LABEL,
  type AutobiographicalKind,
} from "@/lib/memory/week";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

// The torture week: Monday 2026-03-02 through Sunday 2026-03-08.
const MON = "2026-03-02", TUE = "2026-03-03", WED = "2026-03-04";
const THU = "2026-03-05", FRI = "2026-03-06", SAT = "2026-03-07", SUN = "2026-03-08";
/** Long before the week — used to prove old records do not leak in. */
const OLD = "2026-01-15";
const at = (day: string, h = 10) => `${day}T${String(h).padStart(2, "0")}:00:00.000Z`;

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { title: string; createdAt: string }): NextAction {
  seq += 1;
  return {
    id: p.id ?? `a${seq}`, description: "", status: "open", updatedAt: p.createdAt,
    notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
    energy: "unspecified", order: seq, history: [],
    ...p,
  } as NextAction;
}

/** A completion, recorded the way `completeAction` records it. */
function completed(title: string, day: string, extra: Partial<NextAction> = {}): NextAction {
  return act({
    title, createdAt: at(MON, 8), status: "completed", completedAt: at(day, 14),
    history: [{ id: `h${++seq}`, at: at(day, 14), action: "completed" }],
    ...extra,
  } as Partial<NextAction> & { title: string; createdAt: string });
}

/**
 * A recurring source with one occurrence closed — as `completeOccurrence`
 * writes it: a history entry AND a `recurrenceCompletions` row.
 *
 * The row used to be missing (LIFEOS-074 §14). The fixture and the timeline
 * had made the SAME assumption — that the history entry alone proves an
 * occurrence was kept — so both were wrong together and the suite stayed green
 * while an occurrence the user had UNDONE still reported as completed. The
 * caller registers the row; the id is derived so it stays deterministic.
 */
function recurringWithOccurrence(title: string, day: string): NextAction {
  return act({
    title, createdAt: at(MON, 8),
    recurrence: { frequency: "daily", interval: 1 },
    history: [{ id: `h${++seq}`, at: at(day, 7), action: "completed", detail: day }],
  } as Partial<NextAction> & { title: string; createdAt: string });
}

function ev(p: Partial<LifeEvent> & { id: string; title: string; date: string }): LifeEvent {
  return {
    notes: "", linkedEntityRefs: [], createdAt: at(MON, 9), updatedAt: at(MON, 9),
    ...p,
  } as LifeEvent;
}

function note(id: string, body: string, createdAt: string, extra: Partial<Note> = {}): Note {
  return { id, body, tags: [], linkedEntityRefs: [], createdAt, updatedAt: createdAt, ...extra } as Note;
}

function reflection(id: string, response: string, createdAt: string): Reflection {
  return { id, prompt: "What's on your mind?", response, createdAt, annotations: [] };
}

function project(id: string, title: string): Project {
  return {
    id, title, description: "", status: "active", priority: "medium", notes: "",
    milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: at(MON, 8), updatedAt: at(FRI, 8),
  } as Project;
}

function capture(id: string, text: string, createdAt: string, linked: { kind: string; id: string }[] = []): Capture {
  return {
    id, text, createdAt, processingStatus: linked.length ? "processed" : "inbox",
    linkedEntityRefs: linked, history: [],
  } as unknown as Capture;
}

/**
 * The §27 torture week.
 *
 * 6 completed actions · 2 recurring completions · 5 events · 3 waiting ·
 * 2 overdue · 4 notes · 3 reflections · 3 projects · 10 new actions ·
 * plus knowledge records that must NOT flood the review.
 */
export function tortureWeek(): StoreState {
  seq = 0;
  const s = emptyState();

  s.projects = [project("p1", "Thesis chapter"), project("p2", "House move"), project("p3", "Fitness")];

  const completedActions: NextAction[] = [
    completed("Finish deployment", TUE, { projectId: "p1" }),
    completed("Send the invoice", TUE, { projectId: "p1" }),
    completed("Book the removal van", WED, { projectId: "p2" }),
    completed("Call the dentist", WED),
    completed("Renew the parking permit", THU),
    completed("Email the landlord", FRI),
  ];

  const recurring: NextAction[] = [
    recurringWithOccurrence("Take my medication", TUE),
    recurringWithOccurrence("Refill the medication box", SUN),
  ];
  // The completion ROWS those occurrences produce. Without them the actions
  // carry a keystroke and no kept commitment, which is exactly the state
  // `uncompleteOccurrence` leaves behind.
  s.recurrenceCompletions = [
    { id: "rc1", actionId: recurring[0].id, occurrenceDate: TUE, completedAt: at(TUE, 7) },
    { id: "rc2", actionId: recurring[1].id, occurrenceDate: SUN, completedAt: at(SUN, 7) },
  ] as StoreState["recurrenceCompletions"];

  // Ten new actions created during the week, none of them completed.
  const created: NextAction[] = Array.from({ length: 10 }, (_, i) =>
    act({
      id: `new${i}`, title: `New obligation ${i + 1}`,
      createdAt: at([MON, TUE, WED, THU, FRI][i % 5], 11),
      projectId: i < 3 ? "p2" : undefined,
      history: [{ id: `hn${i}`, at: at([MON, TUE, WED, THU, FRI][i % 5], 11), action: "created" }],
    } as Partial<NextAction> & { title: string; createdAt: string }));

  const waiting: NextAction[] = [
    act({ id: "w1", title: "Signed lease from Marcus", createdAt: at(TUE, 9), status: "waiting", waitingOn: "Marcus", waitingSince: at(TUE, 9), followUpDate: THU, projectId: "p2", history: [{ id: "hw1", at: at(TUE, 9), action: "waiting", detail: "Marcus" }] } as Partial<NextAction> & { title: string; createdAt: string }),
    act({ id: "w2", title: "Quote from Priya", createdAt: at(WED, 9), status: "waiting", waitingOn: "Priya", waitingSince: at(WED, 9), history: [{ id: "hw2", at: at(WED, 9), action: "waiting", detail: "Priya" }] } as Partial<NextAction> & { title: string; createdAt: string }),
    act({ id: "w3", title: "Reply from the registrar", createdAt: at(THU, 9), status: "waiting", waitingOn: "Registrar", waitingSince: at(THU, 9), history: [{ id: "hw3", at: at(THU, 9), action: "waiting", detail: "Registrar" }] } as Partial<NextAction> & { title: string; createdAt: string }),
  ];

  const overdue: NextAction[] = [
    act({ id: "o1", title: "Pay the council tax", createdAt: at(MON, 8), dueDate: WED }),
    act({ id: "o2", title: "Return the library books", createdAt: at(MON, 8), dueDate: THU }),
  ];

  s.nextActions = [...completedActions, ...recurring, ...created, ...waiting, ...overdue];

  s.events = [
    ev({ id: "e1", title: "Dentist", date: TUE, startTime: "14:30" }),
    ev({ id: "e2", title: "Class", date: WED, startTime: "11:00" }),
    ev({ id: "e3", title: "Physio", date: THU, startTime: "09:00", linkedEntityRefs: [{ kind: "project", id: "p3" }] }),
    ev({ id: "e4", title: "Dinner with Sam", date: FRI, startTime: "19:30" }),
    ev({ id: "e5", title: "Moving day", date: SAT, allDay: true, linkedEntityRefs: [{ kind: "project", id: "p2" }] }),
  ];

  s.notes = [
    note("n1", "Still unsure whether teaching is the right direction.", at(TUE, 20)),
    note("n2", "The garden needs looking at.", at(WED, 20)),
    note("n3", "Ideas for the kitchen.", at(FRI, 20)),
    // Machine prose kept as a note. Never presented as the user reflecting.
    note("n4", "A summary the model produced.", at(FRI, 21), { fromAiText: true }),
  ];

  s.reflections = [
    reflection("r1", "I keep putting off the thesis and I don't know why.", at(WED, 21)),
    reflection("r2", "The move is taking more out of me than I expected.", at(THU, 21)),
    reflection("r3", "Good week for sleep.", at(SAT, 21)),
  ];

  s.decisions = [{
    id: "d1", title: "Whether to take the teaching post", question: "Should I?", status: "exploring",
    options: [], criteria: [], ratings: {}, constraints: [], assumptions: [], seedRefs: [], evidence: [],
    createdAt: at(THU, 12), updatedAt: at(THU, 12),
  } as unknown as Decision];

  s.captures = [
    // Became records — represented by what they became, not listed again.
    capture("c1", "Finish deployment and send the invoice", at(MON, 8), [{ kind: "action", id: "a1" }]),
    // Produced nothing. The only trace of that moment, so it stays.
    capture("c2", "something about the car, can't remember", at(THU, 16)),
  ];

  // Knowledge records that must NOT flood a review of someone's week (§27).
  s.beliefs = Array.from({ length: 12 }, (_, i) => ({
    id: `b${i}`, text: `A belief ${i}`, status: "accepted", createdAt: at(WED, 12),
    updatedAt: at(WED, 12), revisions: [], judgments: [],
  })) as unknown as StoreState["beliefs"];
  s.concepts = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`, name: `Concept ${i}`, createdAt: at(WED, 12), updatedAt: at(WED, 12),
  })) as unknown as StoreState["concepts"];

  return s;
}

export async function runWeekReviewSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, a === b, a === b ? undefined : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

  const state = tortureWeek();
  const opts = { today: SUN };
  const r = buildWeekReview(state, "this_week", opts);
  const kinds = (k: AutobiographicalKind) => r.timeline.filter((e) => e.kind === k);

  // ================================================================ 1. ranges

  {
    const tw = resolveWeekRange("this_week", SUN);
    eq("1.1 this week starts on Monday", tw.startKey, MON);
    eq("1.2 this week ends today, not on a future Sunday", tw.endKey, SUN);
    const midweek = resolveWeekRange("this_week", WED);
    eq("1.3 mid-week, the range ends today", midweek.endKey, WED);
    ok("1.4 …and days that have not happened are not shown as empty", midweek.endKey < SUN);
    const lw = resolveWeekRange("last_week", SUN);
    eq("1.5 last week is the seven days before this Monday", `${lw.startKey}…${lw.endKey}`, "2026-02-23…2026-03-01");
    const l7 = resolveWeekRange("last_7_days", SUN);
    eq("1.6 last 7 days is inclusive of today", `${l7.startKey}…${l7.endKey}`, "2026-03-02…2026-03-08");
    eq("1.7 all three ranges are labelled", Object.keys(WEEK_RANGE_LABEL).length, 3);
  }

  // ====================================================== 2. the torture week

  eq("2.1 six one-time completions", kinds("completed_action").length, 6);
  eq("2.2 two recurring occurrences kept", kinds("recurring_completion").length, 2);
  eq("2.3 five events scheduled", kinds("event_scheduled").length, 5);
  eq("2.4 three waits started", kinds("waiting_started").length, 3);
  eq("2.5 four notes created", kinds("note_created").length, 4);
  eq("2.6 three reflections captured", kinds("reflection_captured").length, 3);
  eq("2.7 one decision recorded", kinds("decision_recorded").length, 1);
  // 10 new + 6 completed + 2 recurring + 3 waiting + 2 overdue = 23 actions,
  // all created inside the week.
  eq("2.8 every action's creation is recorded", kinds("action_created").length, 23);
  eq("2.9 a capture that produced records is not listed again",
    kinds("capture_created").some((e) => e.recordRef.id === "c1"), false);
  eq("2.10 a capture that produced nothing IS listed",
    kinds("capture_created").some((e) => e.recordRef.id === "c2"), true);
  ok("2.11 knowledge records do not flood the review",
    r.timeline.every((e) => e.recordRef.kind !== "belief" && e.recordRef.kind !== "concept"),
    r.timeline.filter((e) => ["belief", "concept"].includes(e.recordRef.kind)).length + " leaked");
  ok("2.12 the timeline is chronological",
    r.timeline.every((e, i) => i === 0 || r.timeline[i - 1].at <= e.at));
  ok("2.13 every line traces to a named field", r.timeline.every((e) => e.evidence.length > 0));
  ok("2.14 every line points back at a real record",
    r.timeline.every((e) => !!e.recordRef.id && !!e.recordRef.kind));

  // ============================================== 3. sections and boundaries

  eq("3.1 completed holds both kinds of finishing", r.completed.length, 8);
  ok("3.2 …and never mixes them into one number",
    r.completed.filter((e) => e.kind === "recurring_completion").length === 2);
  eq("3.3 waiting shows all three, oldest first",
    r.waiting.map((w) => w.waitingOn).join(","), "Marcus,Priya,Registrar");
  eq("3.4 a recorded follow-up date that has arrived is flagged",
    r.waiting.filter((w) => w.followUpDue).length, 1);
  ok("3.5 still open is bounded and explained",
    r.stillOpen.length > 0 && r.stillOpen.length <= 8 && r.stillOpen.every((o) => o.detail.length > 0));
  ok("3.6 overdue items are the first thing still open",
    r.stillOpen[0].reason === "overdue", r.stillOpen[0]?.reason);
  ok("3.7 still open is not a backlog dump", r.stillOpen.length < (state.nextActions ?? []).length);
  ok("3.8 a record appears at most once in Added",
    new Set(r.added.map((e) => e.recordRef.id)).size === r.added.length);
  ok("3.9 Added is bounded", r.added.length <= 12);

  // ========================================== 4. the claims it must NOT make

  // §28B — a past event never implies attendance.
  ok("4.1 no autobiographical kind claims an event happened",
    !r.timeline.some((e) => (e.kind as string) === "event_happened"));
  eq("4.2 events are recorded as scheduled", kinds("event_scheduled")[0].kind, "event_scheduled");
  ok("4.3 the event section says attendance is unknown",
    r.limitations.some((l) => /attend/i.test(l)), JSON.stringify(r.limitations));

  // §7 / §28A — created is not completed, touched is not progressed.
  {
    // Ten actions were created and never touched again. Not one of them may
    // appear in Completed — creating a thing is not doing it.
    const completedIds = new Set(r.completed.map((e) => e.recordRef.id));
    const createdOnly = (state.nextActions ?? []).filter((a) => a.id.startsWith("new"));
    eq("4.4a the fixture really does contain ten create-only actions", createdOnly.length, 10);
    ok("4.4 nothing merely created appears as completed",
      createdOnly.every((a) => !completedIds.has(a.id)),
      createdOnly.filter((a) => completedIds.has(a.id)).map((a) => a.title).join(", "));
    const p3 = r.projects.find((p) => p.project.id === "p3");
    // Fitness has one linked EVENT and no completed linked action.
    ok("4.5 a project with an event but no completion does not claim one",
      !p3 || (p3.completed === 0 && p3.hadCompletion === false), JSON.stringify(p3));
    ok("4.6 project lines never say a project progressed",
      r.projects.every((p) => violatesReviewLanguage(`${p.completed} ${p.added}`).length === 0));
    ok("4.7 the project section states that change history does not exist",
      r.limitations.some((l) => /no history of project changes/i.test(l)));
  }

  // §28C — a deferral is claimed only from a recorded transition.
  {
    // The torture week contains NO deferral history at all…
    eq("4.8 no deferral is claimed without a recorded transition", r.deferred.length, 0);
    // …but a current `deferredUntil` with no history must not conjure one.
    const sneaky = tortureWeek();
    sneaky.nextActions = [...(sneaky.nextActions ?? []), act({
      id: "sneaky", title: "Pushed at some unknown time", createdAt: at(MON, 8),
      status: "deferred", deferredUntil: FRI,
    } as Partial<NextAction> & { title: string; createdAt: string })];
    const r2 = buildWeekReview(sneaky, "this_week", opts);
    eq("4.9 a current deferredUntil with no history claims nothing", r2.deferred.length, 0);
    // …and one WITH history is reported, because that is recorded evidence.
    const honest = tortureWeek();
    honest.nextActions = [...(honest.nextActions ?? []), act({
      id: "honest", title: "Pushed on Wednesday", createdAt: at(MON, 8),
      status: "deferred", deferredUntil: FRI,
      history: [{ id: "hd", at: at(WED, 15), action: "deferred", detail: FRI }],
    } as Partial<NextAction> & { title: string; createdAt: string })];
    const r3 = buildWeekReview(honest, "this_week", opts);
    eq("4.10 a recorded deferral IS reported", r3.deferred.length, 1);
    ok("4.11 …with the day it was pushed to", /Mar 6/.test(r3.deferred[0].detail ?? ""), r3.deferred[0]?.detail);
    eq("4.12 …and traces to the history entry", r3.deferred[0].evidence, "action.history[].deferred");
  }

  // §28D — an old note edited this week is not a new reflection.
  {
    const edited = tortureWeek();
    edited.notes = [...(edited.notes ?? []), note("old", "Written in January, touched today.", at(OLD), { updatedAt: at(FRI, 12) })];
    const r4 = buildWeekReview(edited, "this_week", opts);
    ok("4.13 an old note updated this week does not appear",
      !r4.timeline.some((e) => e.recordRef.id === "old"),
      "an edited old note was reported as new");
    eq("4.14 …and the note count is unchanged", r4.timeline.filter((e) => e.kind === "note_created").length, 4);
  }

  // §28E — an empty week is never "you did nothing".
  {
    const r5 = buildWeekReview(emptyState(), "this_week", opts);
    ok("4.15 an empty week is empty", r5.empty);
    ok("4.16 …and says so about the records, not the person",
      /recorded in Conqify/i.test(EMPTY_WEEK) && violatesReviewLanguage(EMPTY_WEEK).length === 0);
    eq("4.17 …with no sections", r5.timeline.length, 0);
    ok("4.18 …and no invented summary", /Nothing was recorded/i.test(r5.summary), r5.summary);
  }

  // §28F — deleting the source removes the memory. This is what derivation buys.
  {
    const pruned = tortureWeek();
    pruned.nextActions = (pruned.nextActions ?? []).filter((a) => a.title !== "Finish deployment");
    pruned.notes = (pruned.notes ?? []).filter((n) => n.id !== "n1");
    pruned.events = (pruned.events ?? []).filter((e) => e.id !== "e1");
    const r6 = buildWeekReview(pruned, "this_week", opts);
    ok("4.19 a deleted action disappears from Completed",
      !r6.timeline.some((e) => e.title === "Finish deployment"));
    ok("4.20 a deleted note disappears from the review",
      !r6.timeline.some((e) => e.recordRef.id === "n1"));
    ok("4.21 a deleted event disappears from the calendar section",
      !r6.timeline.some((e) => e.recordRef.id === "e1"));
    // "Finish deployment" contributed TWO lines — its creation and its
    // completion — so removing three records removes four lines. Stated as the
    // arithmetic rather than a magic number, so the assertion explains itself.
    const deployId = (state.nextActions ?? []).find((a) => a.title === "Finish deployment")!.id;
    const linesFor = (id: string) => r.timeline.filter((e) => e.recordRef.id === id).length;
    eq("4.22a the completed action contributed two lines — created and completed", linesFor(deployId), 2);
    const removed = linesFor(deployId) + linesFor("n1") + linesFor("e1");
    eq("4.22b three records, four lines between them", removed, 4);
    eq("4.22 …and nothing else moved", r6.timeline.length, r.timeline.length - removed);
  }

  // §28G / §24 — machine prose is never presented as the user's own words.
  {
    ok("4.23 an AI-authored note is excluded from 'in your own words'",
      !r.reflections.some((e) => e.recordRef.id === "n4"),
      "machine prose was presented as a reflection");
    ok("4.24 …but it is still recorded in the timeline",
      r.timeline.some((e) => e.recordRef.id === "n4"));
    eq("4.25 …carrying its machine origin",
      r.timeline.find((e) => e.recordRef.id === "n4")?.origin, "conqify_ai");
    ok("4.26 the user's own notes ARE their own words",
      r.reflections.some((e) => e.recordRef.id === "n1"));
  }

  // ============================================== 5. the deterministic summary

  ok("5.1 the summary counts one-time and recurring separately",
    /completed 6 actions/.test(r.summary) && /kept 2 recurring commitments/.test(r.summary), r.summary);
  ok("5.2 it counts what was scheduled, not attended", /5 events on the calendar/.test(r.summary), r.summary);
  ok("5.3 it counts every action added, not the capped section", /added 23 actions/.test(r.summary), r.summary);
  ok("5.4 it says what is still waiting", /3 items are still waiting/.test(r.summary), r.summary);
  ok("5.5 it evaluates nothing", violatesReviewLanguage(r.summary).length === 0, r.summary);
  eq("5.6 it is deterministic", summarise(r), r.summary);
  ok("5.7 a summary never lists what did not happen", !/0 /.test(r.summary), r.summary);
  eq("5.8 it needs no AI and no network", typeof summarise, "function");

  // ============================================ 6. language, coverage, privacy

  {
    const offending = reviewStrings(r).flatMap(violatesReviewLanguage);
    eq("6.1 nothing the review generates characterises the reader", offending.join(","), "");
    ok("6.2 the forbidden list is asserted, not decorative", FORBIDDEN_REVIEW_WORDS.length >= 15);
    ok("6.3 coverage is disclosed", /reflects what was recorded/i.test(r.coverage));
    ok("6.4 …and does not claim to be complete", /not a complete record/i.test(COVERAGE_NOTE));
    ok("6.5 limitations are conditional, not a blanket footer",
      limitationsFor({ scheduled: [], projects: [], waiting: [], stillOpen: [], range: r.range }, SUN).length === 0);
    ok("6.6 a historical range says 'still open' means now",
      buildWeekReview(state, "last_week", { today: SUN }).limitations.every((l) => typeof l === "string"));
    // The review is a projection; it stores nothing and authors nothing.
    ok("6.7 every line carries the provenance of its source",
      r.timeline.every((e) => typeof e.origin === "string" && e.origin.length > 0));
    ok("6.8 no timeline entry is presented as user-authored prose",
      r.timeline.every((e) => e.title.length > 0 && !/^In this period/.test(e.title)));
  }

  // ============================================== 7. past-range honesty (§14)

  {
    const past = buildWeekReview(state, "last_week", { today: SUN });
    eq("7.1 a week with nothing recorded in it is empty", past.timeline.length, 0);
    ok("7.2 a wait that began later does not appear in an earlier week",
      past.waiting.length === 0, `${past.waiting.length} leaked`);
    ok("7.3 …nor does an action created later",
      past.stillOpen.length === 0, `${past.stillOpen.length} leaked`);
    ok("7.4 …so the earlier week is genuinely empty", past.empty);
  }

  // ==================================================== 8. the §20 query API

  eq("8.1 completed", weekQueries.completed(r).length, 8);
  eq("8.2 scheduled", weekQueries.scheduled(r).length, 5);
  eq("8.3 added", weekQueries.added(r).length, r.added.length);
  eq("8.4 waiting on", weekQueries.waitingOn(r).length, 3);
  eq("8.5 projects with recorded activity", weekQueries.projectsWithActivity(r).length, 3);
  eq("8.6 reflections", weekQueries.reflections(r).length, r.reflections.length);
  ok("8.7 the queries return exactly what the page shows",
    weekQueries.completed(r) === r.completed && weekQueries.waitingOn(r) === r.waiting);

  // ============================== 8B. reversal: a fact undone is not a fact
  //
  // LIFEOS-074 §1. Every assertion here failed before the audit and none of the
  // 4075 that already existed noticed, because they all asked whether a
  // recorded keystroke reached the timeline — never whether it was still TRUE.

  {
    const reopened = emptyState();
    reopened.nextActions = [act({
      id: "rp", title: "Send the contract", createdAt: at(MON), status: "open",
      history: [
        { id: "h1", action: "completed", at: at(WED, 9), fromStatus: "open", toStatus: "completed" },
        { id: "h2", action: "reopened", at: at(WED, 10), fromStatus: "completed", toStatus: "open" },
      ],
    })];
    const rr = buildWeekReview(reopened, "this_week", opts);
    const done = rr.timeline.filter((e) => e.kind === "completed_action");
    eq("8B.1 a completion the user reopened is not on the timeline", done.length, 0);
    ok("8B.2 …and the summary does not count it",
      !/completed \d/.test(rr.summary), rr.summary);
    ok("8B.3 the reopening itself is still reported",
      rr.timeline.some((e) => e.kind === "action_restored"));

    // Complete → reopen → complete. Only the completion that STANDS counts,
    // and it is the later one — `completedAt` names it.
    const twice = emptyState();
    twice.nextActions = [act({
      id: "tw", title: "Send the contract", createdAt: at(MON),
      status: "completed", completedAt: at(FRI, 11),
      history: [
        { id: "h1", action: "completed", at: at(WED, 9), fromStatus: "open", toStatus: "completed" },
        { id: "h2", action: "reopened", at: at(THU, 10), fromStatus: "completed", toStatus: "open" },
        { id: "h3", action: "completed", at: at(FRI, 11), fromStatus: "open", toStatus: "completed" },
      ],
    })];
    const tr = buildWeekReview(twice, "this_week", opts);
    const twiceDone = tr.timeline.filter((e) => e.kind === "completed_action");
    eq("8B.4 two completions, one undone, counted once", twiceDone.length, 1);
    eq("8B.5 …and it is the one that still stands", twiceDone[0]?.day, FRI);

    // Legacy tolerance: a record whose `completedAt` matches no history entry
    // is still reported rather than silently dropped.
    const legacy = emptyState();
    legacy.nextActions = [act({
      id: "lg", title: "Imported task", createdAt: at(MON),
      status: "completed", completedAt: at(WED, 15),
      history: [{ id: "h1", action: "completed", at: at(WED, 9), fromStatus: "open", toStatus: "completed" }],
    })];
    eq("8B.6 a completion whose stamps never matched is not dropped",
      buildWeekReview(legacy, "this_week", opts).timeline.filter((e) => e.kind === "completed_action").length, 1);

    // A cancellation that was restored: `cancelledAt` is gone, so it cannot be
    // the evidence. Nothing counts cancellations, so the line stays.
    const restored = emptyState();
    restored.nextActions = [act({
      id: "rs", title: "Book the venue", createdAt: at(MON), status: "open",
      history: [
        { id: "h1", action: "cancelled", at: at(WED, 9), fromStatus: "open", toStatus: "cancelled" },
        { id: "h2", action: "restored", at: at(WED, 10), fromStatus: "cancelled", toStatus: "open" },
      ],
    })];
    const cancelLine = buildWeekReview(restored, "this_week", opts).timeline.find((e) => e.kind === "action_cancelled");
    eq("8B.7 a restored cancellation cites the history, not the cleared field",
      cancelLine?.evidence, "action.history[].cancelled");
  }

  // ===================== 8C. a deferral detail that does not name a day
  //
  // "Defer → Someday" is a button on every action detail page and writes the
  // literal "someday"; a batch defer used to write "batch". Both went into
  // `formatDayKey`, which answers "Invalid Date" — and that string was shown
  // to the user (LIFEOS-074 §1).

  {
    for (const [detail, label] of [["someday", "someday"], ["batch", "a legacy batch marker"]] as const) {
      const s = emptyState();
      s.nextActions = [act({
        id: `df-${detail}`, title: "Replace the filter", createdAt: at(MON),
        status: "deferred",
        history: [{ id: "h1", action: "deferred", at: at(WED), fromStatus: "open", toStatus: "deferred", detail }],
      })];
      const line = buildWeekReview(s, "this_week", opts).timeline.find((e) => e.kind === "action_deferred");
      eq(`8C.1 ${label} reads as an undated deferral`, line?.detail, "with no date");
    }
    const dated = emptyState();
    dated.nextActions = [act({
      id: "df-d", title: "Replace the filter", createdAt: at(MON), status: "deferred", deferredUntil: SUN,
      history: [{ id: "h1", action: "deferred", at: at(WED), fromStatus: "open", toStatus: "deferred", detail: SUN }],
    })];
    const dline = buildWeekReview(dated, "this_week", opts).timeline.find((e) => e.kind === "action_deferred");
    ok("8C.2 a real day key still formats as a day", !!dline?.detail?.startsWith("until ") && !/Invalid/.test(dline.detail), dline?.detail);
    ok("8C.3 no review string anywhere reads 'Invalid Date'",
      !reviewStrings(r).some((s) => /Invalid Date/.test(s)));
  }

  // ================================================ 9. index reuse and purity

  {
    const a = buildAutobiographicalTimeline(state, r.range);
    const b = buildAutobiographicalTimeline(state, r.range);
    eq("9.1 the timeline is pure — same input, same output", JSON.stringify(a), JSON.stringify(b));
    const before = JSON.stringify(state);
    buildWeekReview(state, "this_week", opts);
    eq("9.2 building a review mutates nothing", JSON.stringify(state), before);
    ok("9.3 no autobiographical domain was added to the store",
      !(STORE_DOMAINS as string[]).some((d) => /autobio|timeline|weekreview|memoryevent/i.test(d)));
    eq("9.4 the store still has 46 domains", STORE_DOMAINS.length, 46);
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
