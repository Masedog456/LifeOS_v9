/**
 * Today Intelligence self-tests (LIFEOS-062 §35).
 *
 * Section 3 is the load-bearing one: the exact ordering rules, each isolated so
 * a change to any step of the lexicographic sequence breaks a named assertion
 * rather than a vague total.
 *
 * Section 8 replays all ten torture scenarios from §31.
 */

import {
  recommendNextAction, minutesUntil, NO_STANDOUT, type Reason,
} from "@/lib/today/recommend";
import { buildTodayIndexes } from "@/lib/today/indexes";
import {
  buildTodayView, waitingDays, violatesTodayLanguage, todayStrings,
  COVERAGE_NOTE, EMPTY_PROMPT, FORBIDDEN_TODAY_WORDS,
} from "@/lib/today/view";
import { dueLabel } from "@/lib/actions/due";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { LifeEvent, NextAction, StoreState } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** A fixed Wednesday. Every date below is relative to it. */
const TODAY = "2026-08-19";
const YESTERDAY = "2026-08-18";
const TWO_AGO = "2026-08-17";
const TOMORROW = "2026-08-20";
const IN_TWO = "2026-08-21";
const AT = "2026-08-19T00:00:00.000Z";
const NOON = "12:00";

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { title: string }): NextAction {
  seq += 1;
  return {
    id: `a${seq}`, description: "", status: "open",
    createdAt: `2026-08-0${(seq % 9) + 1}T00:00:00.000Z`, updatedAt: AT,
    notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
    energy: "unspecified", order: seq, history: [],
    ...p,
  } as NextAction;
}

function ev(p: Partial<LifeEvent> & { id: string; title: string; date: string }): LifeEvent {
  return {
    id: p.id, title: p.title, date: p.date, startTime: p.startTime, endTime: p.endTime,
    allDay: p.allDay, notes: "", recurrence: p.recurrence, linkedEntityRefs: [],
    createdAt: AT, updatedAt: AT,
  };
}

function stateWith(parts: Partial<StoreState>): StoreState {
  return { ...emptyState(), ...parts } as StoreState;
}

const ix = (s: StoreState, now = NOON) => buildTodayIndexes(s, TODAY, now);
const view = (s: StoreState, now = NOON) => buildTodayView(s, ix(s, now));
const rec = (s: StoreState, now = NOON) => recommendNextAction(s, ix(s, now), TODAY);
const codesOf = (rs: Reason[]) => rs.map((r) => r.code);

export function runTodaySelfTests(): SelfTestReport {
  const started = Date.now();
  seq = 0;
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

  // ============ 1. SECTIONS ============
  {
    const s = stateWith({
      events: [
        ev({ id: "e1", title: "Dentist", date: TODAY, startTime: "14:30" }),
        ev({ id: "e2", title: "Class", date: TODAY, startTime: "09:00", endTime: "10:15" }),
        ev({ id: "e3", title: "Holiday", date: TODAY, allDay: true }),
        ev({ id: "e4", title: "Next week", date: "2026-08-24", startTime: "10:00" }),
      ],
      nextActions: [
        act({ id: "due", title: "Submit the form", dueDate: TODAY }),
        act({ id: "over", title: "Renew registration", dueDate: TWO_AGO }),
        act({ id: "wait", title: "Dealership document", status: "waiting", waitingOn: "Marcus", waitingSince: `${YESTERDAY}T09:00:00.000Z` }),
      ],
    });
    const v = view(s);
    eq("1.1 events are chronological, all-day first",
      v.occurrences.map((o) => o.event.title), ["Holiday", "Class", "Dentist"]);
    eq("1.2 due today", v.dueToday.map((a) => a.id), ["due"]);
    eq("1.3 overdue", v.overdue.map((a) => a.id), ["over"]);
    eq("1.4 waiting", v.waiting.map((w) => w.action.id), ["wait"]);
    eq("1.5 waiting names the person string", v.waiting[0].waitingOn, "Marcus");
    eq("1.6 upcoming excludes today", v.upcoming.map((u) => u.id), ["e4"]);
    eq("1.7 the next event at noon is the dentist", v.nextEvent?.event.title, "Dentist");
    eq("1.8 nothing is happening at noon", v.nowEvent, undefined);
    // 09:00-10:15 is in progress at 09:30.
    eq("1.9 an in-progress event is NOW", view(s, "09:30").nowEvent?.event.title, "Class");
    ok("1.10 the view is not empty", !v.empty);
    // An action captured today with no due date still has somewhere to land —
    // otherwise the thing you typed thirty seconds ago is invisible.
    const fresh = stateWith({ nextActions: [act({ id: "fresh", title: "Buy dog food", createdAt: `${TODAY}T10:00:00.000Z` })] });
    eq("1.10a a just-captured undated action appears under Today",
      view(fresh).alsoToday.map((a) => a.id), ["fresh"]);
    const old = stateWith({ nextActions: [act({ id: "old", title: "Someday thing", createdAt: "2025-01-01T00:00:00.000Z" })] });
    eq("1.10b but an old undated action does NOT become Today backlog",
      view(old).alsoToday.length, 0);
    const started = stateWith({ nextActions: [act({ id: "wip", title: "Started", status: "in_progress", createdAt: "2025-01-01T00:00:00.000Z" })] });
    eq("1.10c in-progress work does appear", view(started).alsoToday.map((a) => a.id), ["wip"]);
    const blockedFresh = stateWith({
      nextActions: [act({ id: "b0", title: "Blocker" }), act({ id: "b1", title: "Blocked", createdAt: `${TODAY}T10:00:00.000Z` })],
      actionDependencies: [{ id: "d", blockerId: "b0", blockedId: "b1", createdAt: AT }],
    });
    ok("1.10d and a blocked one does not, because it cannot be started",
      !view(blockedFresh).alsoToday.some((a) => a.id === "b1"));
    eq("1.11 waiting days are counted from waitingSince", waitingDays(v.waiting[0], TODAY), 1);
  }

  // ============ 2. NO PERSON MODEL, NO NEW DOMAIN (§9, §34) ============
  {
    ok("2.1 no people domain exists", !(STORE_DOMAINS as string[]).includes("people"));
    ok("2.2 no recommendations domain exists", !(STORE_DOMAINS as string[]).includes("recommendationsNext"));
    ok("2.3 no todayView domain exists", !(STORE_DOMAINS as string[]).includes("todayViews"));
    // 46 since LIFEOS-061. This sprint adds none.
    eq("2.4 the store still has 46 domains", STORE_DOMAINS.length, 46);
  }

  // ============ 3. THE ORDERING RULES (§20) ============
  {
    // 1. Overdue beats due-today.
    const r1 = rec(stateWith({ nextActions: [
      act({ id: "today", title: "Due today", dueDate: TODAY }),
      act({ id: "over", title: "Overdue", dueDate: YESTERDAY }),
    ] }));
    eq("3.1 more overdue wins", r1.recommendation?.action.id, "over");

    // More overdue beats less overdue.
    const r1b = rec(stateWith({ nextActions: [
      act({ id: "one", title: "One day", dueDate: YESTERDAY }),
      act({ id: "two", title: "Two days", dueDate: TWO_AGO }),
    ] }));
    eq("3.1b the MORE overdue of two wins", r1b.recommendation?.action.id, "two");

    // 2. Due-today beats a follow-up with no date.
    const r2 = rec(stateWith({ nextActions: [
      act({ id: "fu", title: "Follow-up", followUpDate: TODAY }),
      act({ id: "today", title: "Due today", dueDate: TODAY }),
    ] }));
    eq("3.2 due today beats a follow-up", r2.recommendation?.action.id, "today");

    // 5. Blocks-other beats a plain due-soon.
    const r5 = rec(stateWith({
      nextActions: [
        act({ id: "blocker", title: "Authentication" }),
        act({ id: "blocked", title: "Dashboard" }),
        act({ id: "soon", title: "Something soon", dueDate: TOMORROW }),
      ],
      actionDependencies: [{ id: "d1", blockerId: "blocker", blockedId: "blocked", createdAt: AT }],
    }));
    eq("3.5 blocking other work beats a near due date", r5.recommendation?.action.id, "blocker");
    ok("3.5b and the reason says so", codesOf(r5.recommendation?.reasons ?? []).includes("blocks_other"));

    // 6. Sooner due date wins, and "no due date" sorts LAST rather than first.
    const r6 = rec(stateWith({ nextActions: [
      act({ id: "later", title: "Later", dueDate: IN_TWO }),
      act({ id: "sooner", title: "Sooner", dueDate: TOMORROW }),
    ] }));
    eq("3.6 the sooner due date wins", r6.recommendation?.action.id, "sooner");

    // 9. Stable tie-breaker: created earlier, and it is NOT offered as a reason.
    const early = act({ id: "early", title: "Early", dueDate: TODAY, createdAt: "2026-01-01T00:00:00.000Z" });
    const late = act({ id: "late", title: "Late", dueDate: TODAY, createdAt: "2026-06-01T00:00:00.000Z" });
    const tie = recommendNextAction(
      stateWith({ nextActions: [late, early] }),
      buildTodayIndexes(stateWith({ nextActions: [late, early] }), TODAY, NOON),
      TODAY,
    );
    // §31E: two due-today actions with nothing else separating them is a genuine
    // tie, and inventing a winner would present an arbitrary pick as a judgment.
    eq("3.9 an indistinguishable pair yields NO recommendation", tie.recommendation, null);
    eq("3.9b and says so in the standard words", tie.note, NO_STANDOUT);
    eq("3.9c while still reporting how many were considered", tie.consideredCount, 2);
  }

  // ============ 4. EXPLANATION CONTRACT (§19) ============
  {
    const r = rec(stateWith({ nextActions: [act({ id: "over", title: "Overdue", dueDate: TWO_AGO })] }));
    ok("4.1 a recommendation always has at least one reason", (r.recommendation?.reasons.length ?? 0) > 0);
    eq("4.2 and the reason is the observable fact", codesOf(r.recommendation!.reasons), ["overdue"]);
    // LIFEOS-070 §6 TRANSITION. These two assertions used to pin "Overdue by 2
    // days" / "Overdue by 1 day" — a day COUNT, which is the framing
    // `DUE_BUCKET_LABEL` was written to avoid and which the §4 audit found to be
    // a THIRD wording for a fact Today already stated two other ways. The count
    // is gone; the recommender now uses the one shared neutral label. The
    // assertions are replaced by affirmative ones proving the new behaviour
    // rather than relaxed to accommodate it.
    eq("4.3 stated plainly, in the shared neutral wording",
      r.recommendation!.reasons[0].text, dueLabel(act({ id: "over", title: "Overdue", dueDate: TWO_AGO }), TODAY));
    ok("4.3b …which names the date rather than counting days",
      /^Was due /.test(r.recommendation!.reasons[0].text), r.recommendation!.reasons[0].text);
    ok("4.4 a single overdue day is worded identically — there is no count to pluralise",
      /^Was due /.test(rec(stateWith({ nextActions: [act({ title: "x", dueDate: YESTERDAY })] }))
        .recommendation!.reasons[0].text));
    ok("4.4b …and no reason anywhere says “overdue by”",
      !/overdue by/i.test((r.recommendation?.reasons ?? []).map((x) => x.text).join(" ")));
    // No reason text is a score, a percentage, or an opaque appeal to AI.
    const allTexts = (r.recommendation?.reasons ?? []).map((x) => x.text).join(" ");
    ok("4.5 no percentage in any reason", !/%/.test(allTexts));
    ok("4.6 no appeal to AI judgment", !/ai (thinks|says|suggests|recommends)/i.test(allTexts));
    ok("4.7 no score language", !/score|rating|rank/i.test(allTexts));
  }

  // ============ 5. DEPENDENCY AND WAITING AWARENESS (§16, §17) ============
  {
    const s = stateWith({
      nextActions: [
        act({ id: "auth", title: "Finish authentication", dueDate: TODAY }),
        act({ id: "dash", title: "Finish dashboard", dueDate: TODAY }),
      ],
      actionDependencies: [{ id: "d1", blockerId: "auth", blockedId: "dash", createdAt: AT }],
    });
    const r = rec(s);
    eq("5.1 the BLOCKER is recommended, never the blocked item", r.recommendation?.action.id, "auth");
    eq("5.2 and only one action was considered executable", r.consideredCount, 1);

    // A waiting item is never executable, even when its follow-up is due.
    const w = stateWith({ nextActions: [
      act({ id: "w", title: "Dealership document", status: "waiting", waitingOn: "Marcus", followUpDate: TODAY }),
    ] });
    eq("5.3 a waiting item is never recommended", rec(w).recommendation, null);
    eq("5.4 and nothing is fabricated in its place", rec(w).note, NO_STANDOUT);
    eq("5.5 but it IS surfaced in Waiting", view(w).waiting.length, 1);
    ok("5.6 with its due follow-up flagged", view(w).waiting[0].followUpDue);

    // A recurring source is handled by the schedule, not the recommender.
    const rc = stateWith({ nextActions: [
      act({ id: "r", title: "Refill medication", dueDate: TODAY, recurrence: { frequency: "weekly", interval: 1, weekdays: [3] } }),
    ] });
    eq("5.7 a recurring source is not a next-action candidate", rec(rc).recommendation, null);
    eq("5.8 it appears under today's schedule instead", view(rc).recurringToday.length, 1);
  }

  // ============ 6. EVENT AWARENESS (§15) ============
  {
    // 20 minutes to the next event; a `large` action is 120 minutes.
    const big = stateWith({
      events: [ev({ id: "e", title: "Standup", date: TODAY, startTime: "12:20" })],
      nextActions: [act({ id: "big", title: "Big thing", estimatedSize: "large" })],
    });
    const rb = rec(big);
    ok("6.1 an over-long SIZED action gets no fits-before-event reason",
      !codesOf(rb.recommendation?.reasons ?? []).includes("fits_before_event"));

    const small = stateWith({
      events: [ev({ id: "e", title: "Standup", date: TODAY, startTime: "12:20" })],
      nextActions: [act({ id: "small", title: "Small thing", estimatedSize: "tiny", dueDate: TODAY })],
    });
    ok("6.2 a SIZED action that fits says so",
      codesOf(rec(small).recommendation?.reasons ?? []).includes("fits_before_event"));

    // Unknown size makes NO duration claim in either direction.
    const unknown = stateWith({
      events: [ev({ id: "e", title: "Standup", date: TODAY, startTime: "12:20" })],
      nextActions: [act({ id: "u", title: "Unknown size", dueDate: TODAY })],
    });
    const ru = rec(unknown);
    ok("6.3 an UNSIZED action makes no duration claim",
      !codesOf(ru.recommendation?.reasons ?? []).includes("fits_before_event"));
    ok("6.4 and is still recommended on its own merits", ru.recommendation?.action.id === "u");
    eq("6.5 minutesUntil is integer minutes", minutesUntil("12:00", "12:20"), 20);
    eq("6.6 a past time yields no window", minutesUntil("12:00", "09:00"), undefined);
    eq("6.7 no next event yields no window", minutesUntil("12:00", undefined), undefined);
  }

  // ============ 7. LANGUAGE AND SHAPE (§3, §12, §21) ============
  {
    const s = stateWith({
      nextActions: [act({ id: "o", title: "Overdue", dueDate: TWO_AGO })],
      events: [ev({ id: "e", title: "Class", date: TODAY, startTime: "09:00" })],
    });
    const v = view(s);
    const strings = todayStrings(v);
    const offences = strings.flatMap((t) => violatesTodayLanguage(t));
    eq("7.1 no Today string characterises the reader", offences, []);
    ok("7.2 the forbidden list is actually enforced",
      violatesTodayLanguage("You are behind schedule").length > 0);
    ok("7.3 the coverage note is present", strings.includes(COVERAGE_NOTE));
    ok("7.4 and says Conqify only knows what was recorded", /recorded in Conqify/i.test(COVERAGE_NOTE));
    ok("7.5 the forbidden list names the specific failures",
      FORBIDDEN_TODAY_WORDS.includes("off track") && FORBIDDEN_TODAY_WORDS.includes("streak"));
    // No score, percentage or rating anywhere in the projection.
    const blob = JSON.stringify(v);
    ok("7.6 no percentage anywhere in the view", !/\d+\s*%/.test(blob));
    ok("7.7 no health/score field", !/"(health|score|rating|grade)"/i.test(blob));
  }

  // ============ 8. TORTURE SCENARIOS (§31) ============
  {
    // A. one overdue action.
    const a = rec(stateWith({ nextActions: [act({ id: "a", title: "Renew", dueDate: YESTERDAY })] }));
    eq("8.A an overdue action is recommended", a.recommendation?.action.id, "a");

    // B. due-today blocked by another — recommend the blocker.
    const b = rec(stateWith({
      nextActions: [act({ id: "auth", title: "Auth" }), act({ id: "dash", title: "Dash", dueDate: TODAY })],
      actionDependencies: [{ id: "d", blockerId: "auth", blockedId: "dash", createdAt: AT }],
    }));
    eq("8.B the blocker is recommended, not the blocked", b.recommendation?.action.id, "auth");

    // C. waiting only.
    const c = stateWith({ nextActions: [act({ title: "Doc", status: "waiting", waitingOn: "Marcus" })] });
    eq("8.C waiting only yields no executable recommendation", rec(c).recommendation, null);

    // D. event in 20 min + explicitly-large action.
    const d = rec(stateWith({
      events: [ev({ id: "e", title: "Meeting", date: TODAY, startTime: "12:20" })],
      nextActions: [act({ id: "l", title: "Long", estimatedSize: "large", dueDate: TODAY })],
    }));
    ok("8.D an over-long sized action claims no fit",
      !codesOf(d.recommendation?.reasons ?? []).includes("fits_before_event"));

    // E. several due-today with nothing to separate them.
    const e = rec(stateWith({ nextActions: [
      act({ id: "e1", title: "One", dueDate: TODAY, createdAt: "2026-01-01T00:00:00.000Z" }),
      act({ id: "e2", title: "Two", dueDate: TODAY, createdAt: "2026-01-02T00:00:00.000Z" }),
      act({ id: "e3", title: "Three", dueDate: TODAY, createdAt: "2026-01-03T00:00:00.000Z" }),
    ] }));
    eq("8.E an undiscriminated tie yields no recommendation", e.recommendation, null);
    eq("8.E2 and the standard sentence", e.note, NO_STANDOUT);

    // F. no actions, three events.
    const f = stateWith({ events: [
      ev({ id: "f1", title: "A", date: TODAY, startTime: "09:00" }),
      ev({ id: "f2", title: "B", date: TODAY, startTime: "11:00" }),
      ev({ id: "f3", title: "C", date: TODAY, startTime: "15:00" }),
    ] });
    const fv = view(f);
    eq("8.F Today is still useful with events only", fv.occurrences.length, 3);
    eq("8.F2 and no recommendation is fabricated", fv.suggestion.recommendation, null);
    ok("8.F3 and the view is not empty", !fv.empty);

    // G. recurring action completed today.
    const rule = { frequency: "weekly" as const, interval: 1, weekdays: [3] };
    const gBefore = stateWith({ nextActions: [act({ id: "g", title: "Refill", dueDate: TODAY, recurrence: rule })] });
    eq("8.G before completion it is asking for today", view(gBefore).recurringToday.length, 1);
    const gAfter = stateWith({
      nextActions: [act({ id: "g", title: "Refill", dueDate: TODAY, recurrence: rule })],
      recurrenceCompletions: [{ id: "c", actionId: "g", occurrenceDate: TODAY, completedAt: AT }],
    });
    eq("8.G2 after completion it is gone from today", view(gAfter).recurringToday.length, 0);
    ok("8.G3 and the SOURCE is still open and still recurring",
      gAfter.nextActions[0].status === "open" && !!gAfter.nextActions[0].recurrence);

    // H. malformed recurrence must not take Today down.
    let threw = false;
    let hv;
    try {
      hv = view(stateWith({
        events: [ev({ id: "h", title: "Broken", date: TODAY, recurrence: { frequency: "fortnightly" } as never })],
        nextActions: [act({ id: "hb", title: "Broken rule", recurrence: { weekdays: "monday" } as never, dueDate: TODAY })],
      }));
    } catch { threw = true; }
    ok("8.H malformed recurrence does not throw", !threw);
    ok("8.H2 and the event still appears on its own date", (hv?.occurrences.length ?? 0) === 1);
    ok("8.H3 and the action falls back to its plain due date", (hv?.dueToday.length ?? 0) === 1);

    // I. no data.
    const i = view(emptyState());
    ok("8.I an empty store yields an empty view", i.empty);
    ok("8.I2 with a capture-focused prompt", EMPTY_PROMPT.length > 0 && /tell conqify/i.test(EMPTY_PROMPT));

    // J. past event + upcoming event.
    const j = view(stateWith({ events: [
      ev({ id: "past", title: "Morning", date: TODAY, startTime: "08:00" }),
      ev({ id: "next", title: "Afternoon", date: TODAY, startTime: "15:00" }),
    ] }), "12:00");
    eq("8.J the NEXT event is the one still ahead", j.nextEvent?.event.title, "Afternoon");
    eq("8.J2 both remain listed", j.occurrences.length, 2);
  }

  // ============ 9. PROJECT PULSE (§12, §27) ============
  {
    const s = stateWith({
      projects: [
        { id: "p1", title: "LotPilot", description: "", status: "active", priority: "medium", notes: "", tags: [], milestones: [], linkedWorkspaces: [], linkedKnowledge: [], createdAt: AT, updatedAt: AT },
        { id: "p2", title: "Quiet project", description: "", status: "active", priority: "medium", notes: "", tags: [], milestones: [], linkedWorkspaces: [], linkedKnowledge: [], createdAt: AT, updatedAt: AT },
      ] as unknown as StoreState["projects"],
      nextActions: [
        act({ id: "n1", title: "Finish dashboard", projectId: "p1", dueDate: TOMORROW }),
        act({ id: "n2", title: "Waiting thing", projectId: "p1", status: "waiting", waitingOn: "Marcus" }),
      ],
    });
    const v = view(s);
    eq("9.1 only projects with something to say appear", v.pulse.map((p) => p.project.id), ["p1"]);
    eq("9.2 the next action is named", v.pulse[0].nextAction?.id, "n1");
    eq("9.3 waiting items are counted", v.pulse[0].waitingCount, 1);
    eq("9.4 the nearest due date is reported", v.pulse[0].nearestDue, TOMORROW);
    // No health score, no percentage, no "at risk".
    const keys = Object.keys(v.pulse[0]);
    ok("9.5 pulse carries no health field", !keys.some((k) => /health|score|risk|progress/i.test(k)));
    ok("9.6 pulse is derived, not stored", !(STORE_DOMAINS as string[]).includes("projectPulse"));

    // A project whose only action is blocked still reports — that IS the signal.
    const blockedOnly = stateWith({
      projects: s.projects,
      nextActions: [act({ id: "b1", title: "Blocked", projectId: "p1" }), act({ id: "b0", title: "Blocker", projectId: "p2" })],
      actionDependencies: [{ id: "d", blockerId: "b0", blockedId: "b1", createdAt: AT }],
    });
    const bv = view(blockedOnly);
    ok("9.7 a project with only blocked work still reports",
      bv.pulse.some((p) => p.project.id === "p1" && p.blockedCount === 1), JSON.stringify(bv.pulse.map((p) => [p.project.id, p.blockedCount])));
  }

  // ============ 10. RECOMPUTATION AND NON-PERSISTENCE (§25, §26) ============
  {
    const base = stateWith({ nextActions: [
      act({ id: "one", title: "First", dueDate: TWO_AGO }),
      act({ id: "two", title: "Second", dueDate: YESTERDAY }),
    ] });
    eq("10.1 the more overdue one is recommended", rec(base).recommendation?.action.id, "one");
    // Completing it changes the STATE; the recommendation is recomputed, not cached.
    const after = stateWith({ nextActions: [
      { ...base.nextActions[0], status: "completed" as const },
      base.nextActions[1],
    ] });
    eq("10.2 after completion the next one is recommended", rec(after).recommendation?.action.id, "two");
    // Same state in, same recommendation out — it is a projection.
    ok("10.3 the recommendation is pure",
      JSON.stringify(rec(base)) === JSON.stringify(rec(base)));
    // Nothing about it is written anywhere.
    const v = view(base);
    ok("10.4 the recommendation carries no id of its own",
      !("id" in (v.suggestion.recommendation ?? {})));
    ok("10.5 and no store domain holds one", !(STORE_DOMAINS as string[]).some((d) => /suggest|recommendationNext/i.test(d)));
  }

  // ============ 11. CONSTITUTION AS CONTEXT ONLY (§18) ============
  {
    const withEl = stateWith({
      nextActions: [act({ id: "focus", title: "Deep work block", dueDate: TODAY })],
      constitutionElements: [{
        id: "c1", kind: "principle", statement: "Protect focused work", status: "active",
        adoptedAt: AT, linkedRefs: [{ kind: "action", id: "focus" }], createdAt: AT, updatedAt: AT,
      }] as unknown as StoreState["constitutionElements"],
    });
    const r = rec(withEl);
    ok("11.1 an adopted, explicitly-linked element appears as context",
      codesOf(r.recommendation?.reasons ?? []).includes("linked_constitution"));
    ok("11.2 and names the kind and the statement",
      /Guiding Principle: Protect focused work/.test(
        (r.recommendation?.reasons ?? []).find((x) => x.code === "linked_constitution")?.text ?? ""));

    // A DRAFT element is not adopted, so it contributes nothing.
    const draft = stateWith({
      nextActions: [act({ id: "focus", title: "Deep work block", dueDate: TODAY })],
      constitutionElements: [{
        id: "c1", kind: "principle", statement: "Protect focused work", status: "draft",
        linkedRefs: [{ kind: "action", id: "focus" }], createdAt: AT, updatedAt: AT,
      }] as unknown as StoreState["constitutionElements"],
    });
    ok("11.3 a DRAFT element contributes nothing",
      !codesOf(rec(draft).recommendation?.reasons ?? []).includes("linked_constitution"));

    // And it never changes the ORDER — context, never rank.
    const twoActions = stateWith({
      nextActions: [
        act({ id: "plain", title: "Plain", dueDate: TWO_AGO }),
        act({ id: "linked", title: "Linked", dueDate: TODAY }),
      ],
      constitutionElements: withEl.constitutionElements,
    });
    eq("11.4 a Constitution link never outranks an observable fact",
      rec(twoActions).recommendation?.action.id, "plain");
  }

  const failed = results.filter((r) => !r.pass).length;
  return {
    pass: failed === 0,
    total: results.length,
    passed: results.length - failed,
    failed,
    ms: Date.now() - started,
    results,
  };
}
