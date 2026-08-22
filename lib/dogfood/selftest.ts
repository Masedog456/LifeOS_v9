/**
 * Executive-loop acceptance self-tests (LIFEOS-063 §33).
 *
 * These are not unit tests for the dogfood fixture. They are the parts of
 * `EXECUTIVE_LOOP_ACCEPTANCE_063.md` that can be made to fail on their own —
 * the invariants the report claims hold, the three repairs it claims were made,
 * and the gaps it claims are still open.
 *
 * ## Known gaps are asserted, not omitted
 *
 * Section 5 pins limitations the report documents and this sprint deliberately
 * did NOT fix (§29, §3). Each is written so it fails the day the gap closes,
 * which is the only way a "known limitation" stays honest: either the ledger is
 * updated with it, or the suite goes red. A report that describes behaviour no
 * test holds in place stops being true the moment someone touches the parser.
 *
 * ## Two halves, one of which needs a store
 *
 * Interpretation is pure and runs anywhere. The full replay mutates the store
 * singleton and so is gated on `typeof window === "undefined"` — the same fence
 * `realDogfoodOps()` enforces, for the same reason: in a browser that store
 * holds a real person's life. The skip is reported as an assertion rather than
 * silently shrinking the total.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { StoreState } from "@/types/mvp";
import { interpret } from "@/lib/capture/interpret";
import { extractRecurrence } from "@/lib/capture/schedule";
import { extractTemporal, stripResolvedTemporal } from "@/lib/capture/dates";
import { FORBIDDEN_CANDIDATE_KINDS } from "@/lib/capture/authority";
import { violatesTodayLanguage, todayStrings } from "@/lib/today/view";
import {
  SCENARIO, CAPTURE_PROBES, WEEK_QUESTIONS, WEEK_START, WEEK_END,
  CLOCK_SENSITIVE_BEHAVIOURS,
} from "@/lib/dogfood/scenario";
import { BROWSER_REFUSAL, realDogfoodOps } from "@/lib/dogfood/ops";
import { replayDogfood, sectionsOf } from "@/lib/dogfood/replay";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

/** The day the pure-interpretation assertions below resolve against. */
const DAY1 = WEEK_START;

export async function runDogfoodSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, a === b, a === b ? undefined : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

  const read = (text: string) => interpret(text, emptyState(), DAY1);
  const kinds = (text: string) => read(text).candidates.map((c) => c.kind);
  const first = (text: string) => read(text).candidates[0];

  // ==================================================== 1. the fixture itself

  eq("1.1 the script covers seven days", SCENARIO.length, 7);
  eq("1.2 days are numbered 1..7 in order", SCENARIO.map((d) => d.day).join(","), "1,2,3,4,5,6,7");
  eq("1.3 the week starts on the scripted Monday", SCENARIO[0].date, WEEK_START);
  eq("1.4 the week ends on the scripted Sunday", SCENARIO[6].date, WEEK_END);
  ok("1.5 2026-03-02 really is a Monday", new Date(`${WEEK_START}T00:00:00Z`).getUTCDay() === 1);
  eq("1.6 only the quiet day starts from an empty store", SCENARIO.filter((d) => d.freshStore).map((d) => d.day).join(","), "6");
  eq("1.7 §19 measures eight capture shapes", CAPTURE_PROBES.length, 8);
  eq("1.8 §14 asks six questions", WEEK_QUESTIONS.length, 6);
  eq("1.9 the clock-sensitive behaviours are named", CLOCK_SENSITIVE_BEHAVIOURS.length, 3);
  ok("1.10 every capture step records what the user was trying to do",
    SCENARIO.every((d) => d.steps.every((s) => s.do !== "capture" || s.intent.length > 0)));

  // The fence, exercised rather than described. `realDogfoodOps` wipes the
  // store; in a browser that is somebody's life.
  {
    const g = globalThis as unknown as { window?: unknown };
    const had = "window" in g;
    g.window = {};
    let threw = "";
    try { realDogfoodOps(); } catch (e) { threw = (e as Error).message; }
    if (!had) delete g.window;
    eq("1.11 the replay refuses to construct in a browser", threw, BROWSER_REFUSAL);
  }

  // ==================================== 2. Day 1 — one sentence, five intents

  const day1 = read(SCENARIO[0].steps[0].do === "capture" ? SCENARIO[0].steps[0].text : "");
  eq("2.1 the messy sentence decomposes into five candidates", day1.candidates.length, 5);
  eq("2.2 the appointment is an Event, not an Action", day1.candidates[0].kind, "event");
  eq("2.3 the Event carries tomorrow's date", day1.candidates[0].fields.dueDate, "2026-03-03");
  eq("2.4 the Event carries the stated time", day1.candidates[0].fields.time, "11:00");
  eq("2.5 the three errands are Actions",
    day1.candidates.slice(1, 4).map((c) => c.kind).join(","), "action,action,action");
  eq("2.6 the worry is offered as a Note, never asserted", day1.candidates[4].kind, "note");
  ok("2.7 the worry is NOT preselected — a claim about the user is confirmed, not assumed",
    !["auto", "auto_with_undo"].includes(day1.candidates[4].authority) || day1.candidates[4].confidence !== "high");
  ok("2.8 'tonight' is reported as unstorable rather than dropped",
    day1.candidates[1].unresolved.some((u) => /tonight/i.test(u.phrase)));
  eq("2.9 the whole capture needs no model", day1.escalate, false);

  // =============================================== 3. what the loop cannot do

  // §9. Recorded because the report's boundary claim depends on it: Conqify
  // hears what you intend to do and not what you did, missed, or want moved.
  eq("3.1 a completion statement does not close anything", kinds("I finished deployment")[0], "note");
  eq("3.2 a missed intention has no representation", kinds("I didn't work out")[0], "note");
  eq("3.3 a reschedule request has no representation", kinds("Move the workout forward")[0], "note");
  eq("3.4 a reminder request has no representation", kinds("Remind me to email my professor tomorrow")[0], "note");
  ok("3.5 an ordinary wait IS represented", kinds("Marcus still hasn't sent the document").includes("waiting"));

  // ==================================================== 4. the §19 acceptance

  const probe = (id: string) => CAPTURE_PROBES.find((p) => p.id === id)!.text;
  eq("4.A one obligation is an Action", kinds(probe("A"))[0], "action");
  eq("4.C one recurring item is an Action with a rule", first(probe("C")).fields.recurrence?.frequency, "weekly");
  eq("4.D one waiting item names the person", first(probe("D")).fields.waitingOn, "Marcus");
  eq("4.E a four-intent sentence yields four candidates", read(probe("E")).candidates.length, 4);
  eq("4.F a reflection is offered as a Note", kinds(probe("F"))[0], "note");
  eq("4.G ambiguous input still produces something", read(probe("G")).candidates.length, 1);
  ok("4.H an unpinnable time phrase is reported",
    first(probe("H")).unresolved.some((u) => u.reason === "vague"));
  ok("4.i the original text is never rewritten by interpretation",
    CAPTURE_PROBES.every((p) => read(p.text).raw === p.text));
  ok("4.j no capture path can express a belief or Constitution element",
    (FORBIDDEN_CANDIDATE_KINDS as readonly string[]).length > 0 &&
    CAPTURE_PROBES.every((p) => read(p.text).candidates.every(
      (c) => !(FORBIDDEN_CANDIDATE_KINDS as readonly string[]).includes(c.kind))));

  // ============================================ 5. gaps that are STILL OPEN
  //
  // Each of these fails the day the gap closes. That is intentional: when one
  // goes red, the friction ledger in EXECUTIVE_LOOP_ACCEPTANCE_063.md is out of
  // date and should be corrected in the same change.

  eq("5.1 GAP FR-4 — a verb outside ACTION_VERBS is still a Note ('Replace…')",
    kinds("Replace the kitchen tap washer")[0], "note");
  eq("5.2 GAP FR-5 — a bare appointment is still a Note ('Dentist Thursday at 2:30')",
    kinds("Dentist Thursday at 2:30")[0], "note");
  eq("5.3 GAP FR-5 — an event NOUN is still what makes it an Event",
    kinds("Dentist appointment Thursday at 2:30")[0], "event");
  eq("5.4 GAP FR-6 — a leading 'Still ' still defeats waiting detection",
    kinds("Still waiting on Priya for the quote")[0], "note");
  eq("5.5 GAP FR-6 — the same sentence without it is detected",
    kinds("Waiting on Priya for the quote")[0], "waiting");
  eq("5.6 GAP FR-12 — waitingOn still swallows the object",
    first("chase Priya about the quote").fields.waitingOn, "Priya about the quote");
  ok("5.7 GAP FR-10 — 'tonight' is still left in the title",
    /tonight/i.test(first("Dinner with Sam tonight at 7:30").fields.title ?? ""));

  // ====================================================== 6. the §19 repairs

  // R-3. An unsupported recurrence phrase is REPORTED, never swallowed. The
  // hole was that "every weekday" returned null — indistinguishable from a
  // sentence with no schedule in it at all.
  for (const phrase of ["every weekday", "every weekend", "on weekdays"]) {
    eq(`6.1 R-3 "${phrase}" is reported as unsupported`,
      extractRecurrence(phrase)?.unsupported, "unsupported_pattern");
  }
  eq("6.2 R-3 supported rules are untouched", extractRecurrence("every Wednesday")?.rule?.frequency, "weekly");
  eq("6.3 R-3 the ambiguous case keeps its own, different label",
    extractRecurrence("twice a week")?.unsupported, "ambiguous_frequency");
  {
    const standup = first("Team standup every weekday at 9:15");
    ok("6.4 R-3 a weekday-set meeting now discloses the dropped recurrence",
      standup.unresolved.some((u) => /weekday/i.test(u.phrase)), JSON.stringify(standup.unresolved));
    eq("6.5 R-3 the stated time is still kept", standup.fields.time, "09:15");
  }

  // R-4. The preposition that governed a resolved date goes with it.
  for (const [text, want] of [
    ["Return the library books by Thursday", "Return the library books"],
    ["Submit the form before Friday", "Submit the form"],
    ["Call the vet on Tuesday", "Call the vet"],
  ] as const) {
    eq(`6.6 R-4 "${text}" leaves no dangling preposition`,
      stripResolvedTemporal(text, extractTemporal(text, DAY1)), want);
  }
  // The reason it is scoped to the word before the date, and not a trailing
  // strip: a title may legitimately END in a preposition.
  {
    const t = "Turn the heating on";
    eq("6.7 R-4 a genuine trailing preposition survives",
      stripResolvedTemporal(t, extractTemporal(t, DAY1)), t);
  }

  // ================================================ 7. the replay (Node only)

  if (typeof window !== "undefined") {
    ok("7.0 replay skipped — the store here holds real data", true);
  } else {
    const run = replayDogfood(realDogfoodOps());
    const days = run.days;
    const captures = days.flatMap((d) => d.captures);

    eq("7.1 every scripted day ran", days.length, 7);
    ok("7.2 the raw sentence survived every single capture",
      captures.every((c) => c.rawPreserved), `${captures.filter((c) => !c.rawPreserved).length} lost`);
    ok("7.3 no capture produced zero candidates", captures.every((c) => c.candidates.length > 0));
    ok("7.4 nothing was ever saved without the user pressing something",
      captures.every((c) => c.interactions >= 3));

    // R-2, end to end: a recurring action captured with a time keeps it.
    const week = run.weekEnd;
    const med = (week.nextActions ?? []).find((a) => /medication/i.test(a.title));
    ok("7.5 R-2 a recurring action captured with a time still has it", !!med?.dueTime, JSON.stringify(med?.dueTime));
    eq("7.6 R-2 it is the time that was typed", med?.dueTime, "08:00");
    ok("7.7 R-2 the rule survived alongside it", med?.recurrence?.frequency === "daily");
    // …and stopping recurrence does not take the time with it.
    const gym = (week.nextActions ?? []).find((a) => /gym/i.test(a.title));
    ok("7.8 R-2 stopping recurrence keeps the time on the outstanding occurrence",
      gym?.dueTime === "18:30" && !gym?.recurrence, JSON.stringify({ t: gym?.dueTime, r: gym?.recurrence }));

    // §10 — recurrence history.
    eq("7.9 closing one occurrence records exactly one completion", (week.recurrenceCompletions ?? []).length, 1);
    ok("7.10 the source of a closed occurrence is NOT marked done",
      (week.nextActions ?? []).find((a) => /recycling/i.test(a.title))?.status === "open");

    // §11 — blocked and waiting are never offered as the next thing to do.
    // Checked against each day's OWN indexes rather than the week-end store, so
    // a suggestion made on Tuesday is judged by Tuesday's blocking state.
    const suggestedWaiting: string[] = [];
    const suggestedBlocked: string[] = [];
    for (const d of days) {
      const title = d.suggestion.title;
      if (!title) continue;
      const a = [...d.view.dueToday, ...d.view.overdue, ...d.view.alsoToday, ...(week.nextActions ?? [])]
        .find((x) => x.title === title);
      if (a?.status === "waiting") suggestedWaiting.push(`day ${d.day}: ${title}`);
      if (d.view.blocked.some((b) => b.action.title === title)) suggestedBlocked.push(`day ${d.day}: ${title}`);
    }
    eq("7.11 no waiting item was ever suggested", suggestedWaiting.join(","), "");
    eq("7.12 no blocked item was ever suggested", suggestedBlocked.join(","), "");
    ok("7.13 a suggestion always comes with at least one reason",
      days.every((d) => !d.suggestion.title || d.suggestion.reasons.length > 0));
    // The week must actually have exercised this, or the two assertions above
    // are only saying that nothing was suggested at all.
    ok("7.14 …and the week did contain waiting and blocked work to get wrong",
      days.some((d) => d.view.waiting.length > 0) && days.some((d) => d.view.blocked.length > 0),
      `waiting days=${days.filter((d) => d.view.waiting.length > 0).length}, blocked days=${days.filter((d) => d.view.blocked.length > 0).length}`);
    ok("7.15 a suggestion was actually made on most days",
      days.filter((d) => d.suggestion.title).length >= 4,
      `${days.filter((d) => d.suggestion.title).length}/7`);

    // §13 — the quiet day.
    const quiet = days[5];
    eq("7.16 the quiet day renders no sections at all", sectionsOf(quiet.view).length, 0);
    eq("7.17 the quiet day manufactures no suggestion", quiet.suggestion.title, null);
    ok("7.18 the quiet day is an empty state, not a blank page", quiet.view.empty);

    // §12 — the dense day.
    const dense = days[4];
    ok("7.19 the dense day fills most of the page", sectionsOf(dense.view).length >= 7, sectionsOf(dense.view).join(","));
    ok("7.20 the dense day still suggests exactly one thing", !!dense.suggestion.title);

    // §20 — language, across every day's projection.
    const offending = days.flatMap((d) => todayStrings(d.view)).flatMap(violatesTodayLanguage);
    eq("7.21 nothing Today says characterises the reader", offending.join(","), "");

    // §5 — the burden measure the report quotes.
    ok("7.22 most of the week happened on Capture and Today",
      run.totalAwayInteractions / run.totalInteractions < 0.25,
      `${run.totalAwayInteractions}/${run.totalInteractions}`);
    // The claim the report leads with: Today was right every day WITHOUT being
    // maintained. Measured as "no day's page was assembled by hand" — every
    // section on every day came out of the projection, and the only steps in
    // the week were captures and acts on real records.
    ok("7.23 Today was never maintained — every section came from the projection",
      days.every((d) => d.sections.length === sectionsOf(d.view).length));

    // §14 — three of six answerable, and the report says which.
    eq("7.24 six questions were asked of the existing surfaces", run.weekReview.length, 6);
    eq("7.25 GAP — 'what happened this week' is still unanswerable",
      run.weekReview.find((a) => /happened/.test(a.question))?.verdict, "unanswerable");
    eq("7.26 'what am I waiting on' is answerable",
      run.weekReview.find((a) => /waiting/.test(a.question))?.verdict, "answerable");

    // FR-4's downstream cost, pinned. See the scenario comment on this step.
    const failed = days.flatMap((d) => d.steps).filter((s) => !s.ok);
    eq("7.27 GAP FR-4 — the tap washer still cannot be deferred four days later", failed.length, 1);
    ok("7.28 …and that is the ONLY step in the week that fails",
      failed.every((s) => /kitchen tap/i.test(s.detail)), JSON.stringify(failed.map((s) => s.detail)));

    eq("7.29 three captures had to fall back to the escape hatch", run.escapeHatchCaptures, 3);
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - started,
    results,
  };
}
