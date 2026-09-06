/**
 * LIFEOS-098 — one record, one truth. Asserted across surfaces.
 *
 * ## What these proofs are for
 *
 * Not "does the vocabulary map compile". Every assertion below renders ONE
 * fixture through TWO OR MORE real builders and compares what they say about
 * the same record. That is the only shape of test that can catch surface drift,
 * because drift is never wrong on one surface — it is two surfaces each being
 * locally reasonable about one fact.
 *
 * ## The fixture (§47)
 *
 * One world with one of everything the sprint distinguishes: an ordinary open
 * action, one due today WITH a time, an overdue one, a genuinely DEFERRED one,
 * a neutrally RESCHEDULED one (§9 — the date moved and nothing was deferred), a
 * wait with no follow-up, a wait whose follow-up is today, a blocked item and
 * its blocker, a recurring commitment, a goal-linked action, a completed one and
 * a cancelled one — plus an event, a project, a goal, a reflection and the
 * capture one of the waits came from.
 *
 * ## What was measured before any of this was written
 *
 * Six of the ten drifts the sprint brief anticipated did not exist: titles,
 * `dueLabel`, Home's two creation paths, waiting repetition, correction
 * propagation and the complete control were already coherent. Those six are
 * asserted here anyway — as REGRESSION guards, which is what a measurement that
 * came back clean is worth keeping as.
 *
 * The four that did exist are asserted as fixes, each next to the surface pair
 * that disagreed.
 */

import type { NextAction, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { buildAttentionShortlist } from "@/lib/guidance/attention";
import { buildProjectContext } from "@/lib/execution/context";
import { buildGoalContext } from "@/lib/execution/goal-context";
import { buildSearchEntries } from "@/lib/command/records";
import { buildExecutiveChanges } from "@/lib/memory/changes";
import { buildRangeReview, resolveWeekRange } from "@/lib/memory/week";
import { resolveRange } from "@/lib/insights/range";
import { recommendNextAction } from "@/lib/today/recommend";
import { describeCreated } from "@/lib/capture/home";
import { CHANGE_LABEL, CHANGE_KINDS } from "@/lib/today/daily";
import { dueLabel, followUpPhrase } from "@/lib/actions/due";
import { formatLocalTime } from "@/lib/time/localtime";
import {
  changeWord, changeSubject, timelineChangeWord,
  CHANGE_KIND_VOCABULARY, CHANGE_KIND_FOR_TIMELINE,
} from "@/lib/changes/vocabulary";

const T = "2026-09-09"; // a Wednesday
const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p: Partial<NextAction> & { id: string; title: string }) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: D("2026-09-01"), updatedAt: D("2026-09-01"), ...p,
}) as unknown as NextAction;

let histSeq = 0;
const hist = (action: string, at: string, x: Record<string, unknown> = {}) =>
  ({ id: `h${++histSeq}`, action, at, ...x } as unknown as import("@/types/mvp").ActionHistoryEvent);

interface Result { name: string; pass: boolean; detail?: string }

/** §47. One world, read by every surface below. */
function fixture(): StoreState {
  const s = emptyStoreState();
  s.goals = [{
    id: "g1", title: "Graduate school", description: "", status: "active", priority: "high",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  }] as unknown as StoreState["goals"];
  s.projects = [{
    id: "p1", title: "Clinic launch", goalId: "g1", description: "", status: "active",
    priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  }] as unknown as StoreState["projects"];
  s.nextActions = [
    act({ id: "a-plain", title: "Draft the clinic brochure", projectId: "p1" }),
    act({ id: "a-today", title: "Call the dentist", projectId: "p1", dueDate: T, dueTime: "14:00" }),
    act({ id: "a-over", title: "Pay the application fee", projectId: "p1", dueDate: "2026-09-04" }),
    // §9. A REAL deferral — the history says so.
    act({ id: "a-defer", title: "Request recommendation", projectId: "p1", status: "deferred",
      deferredUntil: "2026-09-14",
      history: [hist("created", D("2026-09-01")), hist("deferred", D("2026-09-08", 17))] }),
    // §9. A date that moved and NOTHING deferred. Different fact, different word.
    act({ id: "a-resched", title: "Send the lease", projectId: "p1", dueDate: "2026-09-11",
      history: [hist("created", D("2026-09-01")),
        hist("due_set", D("2026-09-08", 10), { detail: "2026-09-11" })] }),
    act({ id: "a-wait", title: "Signed form from Ana", status: "waiting", waitingOn: "Ana",
      waitingSince: D("2026-09-03"),
      history: [hist("waiting", D("2026-09-03"), { detail: "Ana", fromStatus: "open", toStatus: "waiting" })] }),
    // §13. A follow-up date, which is not a due date.
    act({ id: "a-wait-fu", title: "Transcript from Maria", projectId: "p1", status: "waiting",
      waitingOn: "Maria", waitingSince: D("2026-09-02"), followUpDate: T,
      history: [hist("waiting", D("2026-09-02"), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-blocked", title: "Open the clinic doors", projectId: "p1", dueDate: T }),
    act({ id: "a-blocker", title: "Lease approval", projectId: "p1" }),
    act({ id: "a-recur", title: "Water the plants", dueDate: T,
      recurrence: { frequency: "weekly", interval: 1, weekdays: [3] } }),
    act({ id: "a-goal", title: "Draft the personal statement", goalId: "g1", dueDate: "2026-09-11" }),
    act({ id: "a-done", title: "Book the venue", projectId: "p1", status: "completed",
      completedAt: D(T, 11),
      history: [hist("created", D("2026-09-01")),
        hist("completed", D(T, 11), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "a-stop", title: "Order the banner", projectId: "p1", status: "cancelled",
      history: [hist("created", D("2026-09-01")),
        hist("cancelled", D("2026-09-08", 9), { fromStatus: "open", toStatus: "cancelled" })] }),
  ];
  s.actionDependencies = [
    { id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: D("2026-09-01") },
  ] as unknown as StoreState["actionDependencies"];
  s.events = [{
    id: "e1", title: "Interview", date: "2026-09-11", startTime: "14:00", allDay: false,
    createdAt: D("2026-09-01"), updatedAt: D("2026-09-01"),
  }] as unknown as StoreState["events"];
  s.reflections = [{
    id: "r1", prompt: "What mattered today?", response: "The clinic finally felt real.",
    context: T, createdAt: D(T, 20), updatedAt: D(T, 20),
  }] as unknown as StoreState["reflections"];
  s.captures = [{
    id: "c1", text: "I'm waiting on Maria for the transcript", createdAt: D("2026-09-02", 10),
    processingStatus: "processed", processedAt: D("2026-09-02", 10),
    linkedEntityRefs: [{ kind: "action", id: "a-wait-fu" }],
  }] as unknown as StoreState["captures"];
  return s;
}

export function runOutcomeCoherenceSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
      `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

  const s = fixture();
  const ix = buildTodayIndexes(s, T, "09:00");
  const find = (id: string) => s.nextActions.find((a) => a.id === id)!;

  // =========================================================== §7, §33-36 ===
  // ONE VOCABULARY. The five tables, and what having five of them cost.
  {
    const kinds = Object.keys(CHANGE_KIND_VOCABULARY);
    ok("98.1 §7 every kind the engine can emit has a word",
      kinds.length >= 26, String(kinds.length));

    /**
     * The measured defect the five tables hid.
     *
     * `ProjectWorkingState` and `GoalCommandView` each carried a
     * `Record<string, string>` with eight entries and a `?? "Changed"` fallback.
     * Six real kinds had no entry, so the pages described them as "Changed"
     * while Today and the evening close named them — and both tables carried a
     * key `added` that `buildExecutiveChanges` has never emitted, which is how
     * the gap survived review. A `Record<ExecutiveChangeKind, …>` cannot have
     * either problem.
     */
    for (const k of ["created", "cancelled", "restored", "due_cleared", "planned",
      "prerequisite_removed"] as const) {
      ok(`98.2 §32 …including "${k}", which two surfaces used to call "Changed"`,
        changeWord(k) !== "Changed", changeWord(k));
    }
    ok("98.3 the dead key the old tables carried is not in the vocabulary",
      !("added" in CHANGE_KIND_VOCABULARY), Object.keys(CHANGE_KIND_VOCABULARY).join(","));
    ok("98.4 §32 an unknown kind is not guessed at, and not blanked",
      changeWord("something_new_and_unmapped") === "Changed",
      changeWord("something_new_and_unmapped"));
    ok("98.5 §22 …and a raw enum never reaches a person",
      !Object.values(CHANGE_KIND_VOCABULARY).some((e) => /_/.test(e.word)),
      Object.values(CHANGE_KIND_VOCABULARY).map((e) => e.word).join("|"));
  }

  // ---- the specific disagreements, named ----------------------------------
  {
    /**
     * These four are the audit's table, turned into assertions. Each pair of
     * words was in the product at the same time, about the same recorded fact,
     * on two pages a person moves between in one session.
     */
    eq("98.6 §3 recurring completion — was 'Kept' on a Project, 'Done for the day' on Today",
      changeWord("recurring_completed"), "Done for the day");
    eq("98.7 §3 a moved date — was 'Date moved' on a Goal, 'Date changed' in the evening",
      changeWord("rescheduled"), "Date changed");
    eq("98.8 §3, §9 a returned deferral — was 'Came back' on a Project",
      changeWord("returned"), "Came back from a deferral");
    eq("98.9 §37 a rule — was 'Standard adopted' in the evening, 'Rule adopted' on Today",
      changeWord("rule_adopted"), "Rule adopted");
    /**
     * The tie-break is not taste. LIFEOS-095 §32 already decided this product
     * calls a `constitution_element` a "Rule", in the composer's own labels,
     * with a comment saying a kind named twice is two products. The vocabulary
     * follows the decision that was already made rather than making a new one.
     */
    ok("98.10 §37 …matching the word the capture composer uses for the same kind",
      /^Rule /.test(changeWord("rule_revised")) && /^Rule /.test(changeWord("rule_retired")),
      `${changeWord("rule_revised")} / ${changeWord("rule_retired")}`);
  }

  // ---- §4. The one difference that is NOT drift ---------------------------
  {
    /**
     * §4 protects contextual difference and this is the only one the audit
     * found: a Goal page has already named the goal, so "Horizon changed" is
     * unambiguous there, while Today mixes goals, rules and actions in one list
     * and must say whose horizon moved. One rule, not four tables.
     */
    eq("98.11 §4 a mixed list names the subject", changeWord("goal_horizon_changed"), "Goal horizon changed");
    eq("98.12 §4 …and a Goal page, already scoped to it, does not",
      changeWord("goal_horizon_changed", "goal"), "Horizon changed");
    eq("98.13 §4 the same rule for a rule", changeWord("rule_adopted", "rule"), "Adopted");
    ok("98.14 §4 …and a scope that does not match the subject changes nothing",
      changeWord("goal_horizon_changed", "rule") === "Goal horizon changed"
      && changeWord("rule_adopted", "goal") === "Rule adopted",
      `${changeWord("goal_horizon_changed", "rule")} / ${changeWord("rule_adopted", "goal")}`);
    /**
     * The safe direction to fail in. Forgetting to pass a scope produces a
     * redundant noun; there is no way to accidentally produce an ambiguous one.
     */
    ok("98.15 §4 the unambiguous form is the default for every kind",
      Object.values(CHANGE_KIND_VOCABULARY).every((e) => !e.scoped || e.scoped.length < e.word.length),
      Object.entries(CHANGE_KIND_VOCABULARY).filter(([, e]) => e.scoped)
        .map(([k, e]) => `${k}:${e.word}/${e.scoped}`).join(" "));
    ok("98.16 §4 …and an action word never carries a subject noun to strip",
      Object.values(CHANGE_KIND_VOCABULARY)
        .filter((e) => e.subject === "action").every((e) => !e.scoped));
    eq("98.17 a kind's subject is what decides the prefix",
      [changeSubject("completed"), changeSubject("goal_replaced"), changeSubject("rule_retired")],
      ["action", "goal", "rule"]);
  }

  // ---- §43. Both key spaces, one table ------------------------------------
  {
    /**
     * `CHANGE_LABEL` (autobiographical kinds) and the evening's table
     * (`ExecutiveChangeKind`) agreed with each other and BOTH disagreed with the
     * four component copies. Deriving the first through the timeline map is what
     * makes "agreed with each other" a guarantee rather than a coincidence that
     * held for two sprints.
     */
    for (const k of CHANGE_KINDS) {
      const mapped = CHANGE_KIND_FOR_TIMELINE[k];
      ok(`98.18 §43 timeline kind "${k}" reaches the shared word`,
        !!mapped && CHANGE_LABEL[k] === changeWord(mapped!),
        `${CHANGE_LABEL[k]} vs ${mapped ? changeWord(mapped) : "(unmapped)"}`);
    }
    eq("98.19 §43 …by the same route the executive changes take",
      timelineChangeWord("recurring_completion"), changeWord("recurring_completed"));
    ok("98.20 §43 an unmapped timeline kind claims nothing",
      timelineChangeWord("action_started") === "Changed", timelineChangeWord("action_started"));
    /**
     * The rename LIFEOS-081 §12 made, still holding: the historical EPISODE
     * ("Stopped waiting") is nameable apart from the current waiting STATE.
     */
    eq("98.21 §12 the waiting episode keeps its own name",
      timelineChangeWord("waiting_stopped"), "Stopped waiting");
  }

  // ---- §9. Deferred is not rescheduled ------------------------------------
  {
    ok("98.22 §9 a deferral and a moved date are different words",
      changeWord("deferred") !== changeWord("rescheduled"),
      `${changeWord("deferred")} / ${changeWord("rescheduled")}`);
    ok("98.23 §9 …and coming back from one says which one it was",
      /deferral/i.test(changeWord("returned")), changeWord("returned"));
    /**
     * Proved on the records, not only on the words: `a-resched` moved its date
     * and was never deferred, `a-defer` was. LIFEOS-090's distinction survives
     * this sprint's canonicalization.
     */
    const changes = buildExecutiveChanges(s, resolveRange("last_30_days", { today: T }));
    const kindsFor = (id: string) => changes.filter((c) => c.entity.id === id).map((c) => c.kind);
    ok("98.24 §9 …and the engine still tells the two records apart",
      kindsFor("a-defer").includes("deferred") && !kindsFor("a-resched").includes("deferred"),
      `defer=${kindsFor("a-defer").join(",")} resched=${kindsFor("a-resched").join(",")}`);
  }

  // =============================================================== §3, §16 ===
  // THE SAME DATE AND THE SAME TIME, ON EVERY SURFACE.
  {
    const a = find("a-today");
    const home = describeCreated(s, [{ kind: "action", id: "a-today" }], T)[0];

    /**
     * The measured drift. Home printed `formatDayKey(a.dueDate)` — "Sun, Sep 6"
     * for a capture saved on its due date — while Today, the shortlist, the
     * project page and the evening close all said "Due today" about the same
     * record. Both accurate; only one of them the product's answer.
     */
    ok("98.25 §3 Home says the due date in the shared phrase",
      (home?.detail ?? "").includes(dueLabel(a, T)), `${home?.detail} · ${dueLabel(a, T)}`);
    eq("98.26 §3 …which for this record is what every signal surface says",
      dueLabel(a, T), "Due today");
    ok("98.27 §3 …and Home no longer prints the absolute day beside it",
      !/Sep 9|Wed/.test(home?.detail ?? ""), String(home?.detail));

    /**
     * The time half. Exactly three sites interpolated the stored `LocalTime`
     * into prose, all in `recommend.ts`, so Suggested Next said "14:00" about
     * an action Home described as "2 PM".
     */
    const rec = recommendNextAction(s, ix, T);
    const prose = [
      ...(rec.recommendation?.reasons ?? []).map((r) => r.text),
      rec.recommendation?.counterfactual ?? "",
    ].join(" | ");
    ok("98.28 §16 the recommendation says the time the way the product says it",
      prose.includes(formatLocalTime("14:00")), prose);
    ok("98.29 §16 …and never the stored 24-hour value",
      !/\b14:00\b/.test(prose), prose);
    ok("98.30 §16 …which is the same string Home uses",
      (home?.detail ?? "").includes(formatLocalTime("14:00")), String(home?.detail));
    /**
     * §16 asked for no second date library, and there is none: one formatter
     * for a time, one for a day key, both pre-existing.
     */
    eq("98.31 §16 the one time formatter, unchanged", formatLocalTime("14:00"), "2 PM");
  }

  // ============================================================ §11-13, §14 ===
  // WAITING, FOLLOW-UPS AND BLOCKING ARE THREE DIFFERENT FACTS.
  {
    const home = describeCreated(s, [{ kind: "action", id: "a-wait-fu" }], T)[0];
    /**
     * §13's gap, which the brief did not number and the audit found: Home
     * ignored `followUpDate` entirely. A wait whose follow-up had arrived showed
     * only its project, while Today said "Follow-up date is today". Dropping a
     * fact is the same defect as describing it differently, reached by omission.
     */
    ok("98.32 §13 Home shows a follow-up that has arrived",
      /Follow up today/.test(home?.detail ?? ""), String(home?.detail));
    const sig = buildCommitmentSignals(s, ix, { today: T }).find((x) => x.recordRef.id === "a-wait-fu");
    ok("98.33 §13 …the same day Today says it is",
      sig?.kind === "follow_up_due" && /today/i.test(sig.explanation), JSON.stringify(sig));

    /** §13. A follow-up date is not a due date, and the words say so. */
    ok("98.34 §13 the follow-up phrase never borrows the due phrase",
      !/due/i.test(followUpPhrase(T, T) ?? ""), String(followUpPhrase(T, T)));
    eq("98.35 §13 today", followUpPhrase(T, T), "Follow up today");
    eq("98.36 §13 tomorrow", followUpPhrase("2026-09-10", T), "Follow up tomorrow");
    eq("98.37 §13 a future date states the date", followUpPhrase("2026-09-20", T), "Follow up Sun, Sep 20");
    /**
     * The correction that travelled with the shared phrase. Both component
     * copies said "Follow up today" whenever the date had merely ARRIVED —
     * including a week late — while `buildCommitmentSignals` said "Follow-up
     * date was Fri, Sep 4." about the same record. §3: the facts have to agree.
     */
    eq("98.38 §3 a follow-up that already passed says so, as the signals do",
      followUpPhrase("2026-09-04", T), "Follow up was Fri, Sep 4");
    eq("98.39 §32 no follow-up date produces no chip, not an empty one",
      followUpPhrase(undefined, T), undefined);

    /** §14. Blocked is a dependency fact and is not filed under waiting. */
    const blocked = buildCommitmentSignals(s, ix, { today: T }).find((x) => x.recordRef.id === "a-blocked");
    ok("98.40 §14 a blocked item is blocked, not waiting",
      blocked?.kind === "blocked" && /blocked by/i.test(blocked.explanation), JSON.stringify(blocked));
    const wait = buildCommitmentSignals(s, ix, { today: T }).find((x) => x.recordRef.id === "a-wait");
    ok("98.41 §14 …and a wait with no follow-up is not reported as needing one",
      wait?.kind !== "follow_up_due", JSON.stringify(wait));
  }

  // ============================================================== §4, §17 ===
  // A RELATIVE WORD IS ONLY TRUE ABOUT THE DAY IT IS SAID ON.
  {
    /**
     * `buildRangeReview` wrote the due phrase inline three times, and the
     * "due today" one printed the absolute date — so a review of THIS week
     * listed "Due Wed, Sep 9" beside a Today page saying "Due today" about the
     * same record, on Wednesday the 9th.
     *
     * The reason those literals existed is real, and §4 protects it: the same
     * review can be built for LAST week, where "Due today" would not be a
     * different phrasing but a false one. So the rule is named once, in
     * `dueLabel`, instead of four surfaces each keeping their own phrase to
     * avoid it.
     */
    const thisWeek = buildRangeReview(s, resolveWeekRange("this_week", T), { today: T });
    const lastWeek = buildRangeReview(s, resolveWeekRange("last_week", T), { today: T });
    const detailIn = (r: { stillOpen: { action: { id: string }; detail: string }[] }, id: string) =>
      r.stillOpen.find((o) => o.action.id === id)?.detail;

    eq("98.42 §3 a review whose range ends today speaks in today's words",
      detailIn(thisWeek, "a-today"), "Due today");
    eq("98.43 §3 …the same words Today and Home use for that record",
      detailIn(thisWeek, "a-today"), dueLabel(find("a-today"), T));
    eq("98.44 §4 …while a review of a PAST range states the date instead",
      detailIn(lastWeek, "a-today"), "Due Wed, Sep 9");
    ok("98.45 §4 …because 'today' would be false there, not merely different",
      !/today|tomorrow/i.test(JSON.stringify(lastWeek.stillOpen.map((o) => o.detail))),
      JSON.stringify(lastWeek.stillOpen.map((o) => o.detail)));
    eq("98.46 §3 and a passed deadline is past tense in both",
      [detailIn(thisWeek, "a-over"), detailIn(lastWeek, "a-over")],
      ["Was due Fri, Sep 4", "Was due Fri, Sep 4"]);
  }

  // ==================================================================== §28 ===
  // SEARCH DOES NOT PUT A DATE IN A STATUS FIELD.
  {
    const entries = buildSearchEntries(s);
    const ev = entries.find((e) => e.kind === "event")!;
    /**
     * Reported by the audit as LATENT and fixed as latent: `inStatus` compares
     * `e.status === filters.status`, so a date could never match a status word,
     * and no surface renders `status`. Nothing a person could see was wrong. It
     * was still a category error, and this file already knew the right shape —
     * `daily_review` puts its date in `aliases` and its status in `status`.
     */
    ok("98.51 §28 an Event's date is not its status", ev.status === undefined, String(ev.status));
    ok("98.52 §28 …it is searchable as an alias instead",
      ev.aliasesLower.includes("2026-09-11"), ev.aliasesLower.join(","));
    ok("98.53 §32 …and an Event is not given a status it does not have",
      !entries.some((e) => e.kind === "event" && !!e.status));
  }

  // ============================================== the six that were clean ===
  // REGRESSION GUARDS. Measured coherent before the sprint; kept that way.
  {
    /**
     * §6. One title, from the stored record, never re-cleaned per surface.
     * Every builder below reads `action.title`, and the proof is that they agree
     * on a record whose title contains a person's name — the exact case
     * LIFEOS-096 rewrote and could have rewritten twice.
     */
    const id = "a-wait-fu";
    const stored = find(id).title;
    const titles: Record<string, string | undefined> = {
      signals: buildCommitmentSignals(s, ix, { today: T }).find((x) => x.recordRef.id === id)?.title,
      shortlist: buildAttentionShortlist(s, ix, T).find((x) => x.entity.id === id)?.title,
      project: buildProjectContext(s, "p1", ix, T)?.waiting.find((r) => r.action.id === id)?.action.title,
      search: buildSearchEntries(s).find((e) => e.kind === "action" && e.id === id)?.title,
      home: describeCreated(s, [{ kind: "action", id }], T)[0]?.title,
    };
    for (const [surface, got] of Object.entries(titles)) {
      eq(`98.54 §6 ${surface} prints the stored title`, got, stored);
    }

    /** §3. And the due phrase is one function's output, verbatim, everywhere. */
    const over = find("a-over");
    const oSig = buildCommitmentSignals(s, ix, { today: T }).find((x) => x.recordRef.id === "a-over");
    ok("98.55 §3 the overdue phrase is `dueLabel`, not a second opinion",
      (oSig?.explanation ?? "").startsWith(dueLabel(over, T)),
      `${oSig?.explanation} · ${dueLabel(over, T)}`);
    /**
     * The drift this suite found that the audit had missed, and the only one in
     * the sprint that was a different CLAIM rather than a different word.
     *
     * `ProjectContext` hands the component the RECORD and its raw `dueDate`; the
     * component wrote its own `` `Due ${formatDayKey(r.dueDate)}` ``, which has
     * no past tense. So an overdue action read "Due Fri, Sep 4" on a project
     * page and "Was due Fri, Sep 4" on Today — the project page saying a passed
     * deadline was still ahead. Both pages now call `dueLabel`.
     *
     * What is asserted here is the half a deterministic test can hold: the row
     * carries no pre-formatted phrase for a surface to disagree with (§44), and
     * the shared function reaches the same answer the signals do. The rendered
     * string is asserted in the browser suite, where the component runs.
     */
    const pRow = buildProjectContext(s, "p1", ix, T)?.openRows.find((r) => r.action.id === "a-over");
    ok("98.56 §44 the project row caches no due phrase for a surface to drift from",
      !!pRow && !JSON.stringify(pRow).includes("Due ") && !JSON.stringify(pRow).includes("Was due"),
      JSON.stringify(pRow ?? {}));
    ok("98.57 §3 …and the phrase it hands the page is the one Today uses",
      !!pRow && dueLabel(pRow.action, T) === dueLabel(over, T)
      && (oSig?.explanation ?? "").startsWith(dueLabel(pRow.action, T)),
      `${pRow ? dueLabel(pRow.action, T) : "?"} · ${oSig?.explanation}`);
    ok("98.58 §3 …which is past tense, because the date has passed",
      dueLabel(over, T).startsWith("Was due"), dueLabel(over, T));

    /**
     * §8. A completed commitment reads as completed on every surface. The
     * grammatical difference between a status word and a historical one is
     * explicitly allowed — what is not allowed is a third word.
     */
    eq("98.59 §8 one completion word for the record's history",
      changeWord("completed"), "Completed");
    ok("98.60 §8 …and the recurring case is a different FACT, not a different word for it",
      changeWord("recurring_completed") !== changeWord("completed"),
      `${changeWord("recurring_completed")} / ${changeWord("completed")}`);

    /**
     * §19-§21. Project and Goal come from the current relationship. `a-goal` is
     * linked straight to the goal with no project, and no surface invents one.
     */
    const g = buildGoalContext(s, "g1", ix, T)!;
    /**
     * §21. `a-goal` is linked straight to the goal and has no project. The goal
     * page must not fill that blank in from the goal's OTHER work — §32 says an
     * unknown stays unknown rather than becoming a plausible guess.
     */
    const direct = JSON.stringify((g.support ?? []).filter(
      (r: { action?: { id?: string } }) => r.action?.id === "a-goal"));
    ok("98.61 §21, §32 a directly-linked action is not given a project it does not have",
      !direct.includes("Clinic launch") && !direct.includes("p1"), direct);
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    name: "changes/coherence",
    total: results.length,
    passed,
    ms: Date.now() - t0,
    results,
  };
}
