/**
 * LIFEOS-106 — the day's shape, proved.
 *
 * Two halves. The first is arithmetic over intervals, asserted directly against
 * `buildDayShape` because that is where an off-by-one hides. The second is the
 * integration: the numbers Today prints must be the numbers in the lists Today
 * renders, so the surface is built from a real store and the two are compared.
 *
 * Every "it is excluded" assertion is paired with the neighbour that must still
 * be included, so a filter cannot be mistaken for an empty result.
 */

import type { StoreState, NextAction } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { emptyStoreState } from "@/lib/ux/backup";
import {
  buildDayShape, conflictFor, conflictLine, durationLabel,
  type ShapeInput,
} from "@/lib/today/shape";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayCommand, todaySurfaceStrings } from "@/lib/today/surface";
import { FORBIDDEN_TODAY_WORDS } from "@/lib/today/view";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-07" as DayKey;
const NOW = "07:00";

const C = (id: string, title: string, time?: string, endTime?: string): ShapeInput =>
  ({ id, title, time, endTime });

const store = (p: Partial<StoreState>): StoreState => ({ ...emptyStoreState(), ...p } as StoreState);
const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z", ...p,
} as NextAction);
const ev = (id: string, title: string, startTime?: string, endTime?: string, allDay = false) => ({
  id, title, date: TODAY, startTime, endTime, allDay,
  description: "", location: "", notes: "", linkedEntityRefs: [], history: [],
  createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z",
});

export function runDayShapeSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail });
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

  // ======================================================================
  // Duration arithmetic and the empty day.
  // ======================================================================
  eq("106.1 an hour and a half reads as 1h 30m", durationLabel(90), "1h 30m");
  eq("106.2 a whole hour drops the minutes", durationLabel(120), "2h");
  eq("106.3 under an hour is minutes only", durationLabel(45), "45m");
  {
    const s = buildDayShape([]);
    ok("106.4 a day with nothing timed is quiet", s.quiet);
    eq("106.5 …and says nothing rather than '0m committed'", s.line, undefined);
    eq("106.6 …and claims no span", [s.spanStart, s.spanEnd], [undefined, undefined]);
  }
  {
    // All-day events carry no time, so they occupy no part of the day.
    const s = buildDayShape([C("a", "Parents' evening")]);
    ok("106.7 an all-day commitment is not a timed one", s.quiet && s.timed === 0);
  }

  // ======================================================================
  // What contributes minutes, and what deliberately does not.
  // ======================================================================
  {
    const s = buildDayShape([C("e", "Client review", "11:00", "12:30")]);
    eq("106.8 an event with a start and an end contributes its length", s.scheduledMinutes, 90);
    eq("106.9 …and the line states it", s.line, "1h 30m in scheduled blocks between 11 AM and 12:30 PM");
    eq("106.10 …with nothing left unaccounted", s.withoutDuration, 0);
  }
  {
    // §8. A due TIME is a deadline, not a duration.
    const s = buildDayShape([C("a", "Send the contract", "14:00")]);
    eq("106.11 a timed ACTION is counted as a commitment", s.timed, 1);
    eq("106.12 …but contributes no occupied minutes", s.scheduledMinutes, 0);
    eq("106.13 …and is named as having no duration", s.withoutDuration, 1);
    ok("106.14 …so the line makes no duration claim", !(s.line ?? "").includes("scheduled blocks"));
  }
  {
    // An end at or before its start is not a span.
    const s = buildDayShape([C("e", "Broken", "11:00", "11:00"), C("f", "Also broken", "13:00", "12:00")]);
    eq("106.15 a zero-length or reversed range contributes nothing", s.scheduledMinutes, 0);
    eq("106.16 …while still being counted as a commitment", s.timed, 2);
  }

  // ======================================================================
  // Overlap: counted once, and reported.
  // ======================================================================
  {
    const s = buildDayShape([
      C("a", "Team standup", "09:00", "09:30"),
      C("b", "Client review", "09:15", "10:15"),
    ]);
    eq("106.17 overlapping time is counted ONCE, not summed", s.scheduledMinutes, 75);
    eq("106.18 …and the collision is reported", s.conflicts.length, 1);
    eq("106.19 …with the real overlap, not the shorter event's length", s.conflicts[0].minutes, 15);
    eq("106.20 …naming the earlier one first", s.conflicts[0].titles, ["Team standup", "Client review"]);
    eq("106.21 …in one sentence", conflictLine(s.conflicts[0]),
      "Team standup and Client review overlap by 15m.");
    eq("106.22 …and each row names the OTHER one", conflictFor(s, "a"), "Overlaps Client review (15m).");
    eq("106.23 …from either side", conflictFor(s, "b"), "Overlaps Team standup (15m).");
    // The neighbour: a row in no collision says nothing.
    eq("106.24 a row that collides with nothing carries no note", conflictFor(s, "zzz"), undefined);
  }
  {
    // Back-to-back is not a collision, and leaves no gap.
    const s = buildDayShape([C("a", "First", "09:00", "10:00"), C("b", "Second", "10:00", "11:00")]);
    eq("106.25 back-to-back commitments do not overlap", s.conflicts.length, 0);
    eq("106.26 …and their time adds up normally", s.scheduledMinutes, 120);
    eq("106.27 …with no gap invented between them", s.gaps.length, 0);
  }
  {
    // One meeting entirely inside another.
    const s = buildDayShape([C("a", "All-hands", "09:00", "11:00"), C("b", "Quick sync", "09:30", "10:00")]);
    eq("106.28 a contained commitment does not extend the total", s.scheduledMinutes, 120);
    eq("106.29 …and is still reported as a collision", s.conflicts.length, 1);
    eq("106.30 …for its own length", s.conflicts[0].minutes, 30);
  }
  {
    // Three mutually overlapping commitments are three PAIRS, each once.
    const s = buildDayShape([
      C("a", "A", "09:00", "10:00"), C("b", "B", "09:15", "10:15"), C("c", "C", "09:30", "10:30"),
    ]);
    eq("106.31 three overlapping commitments report three pairs", s.conflicts.length, 3);
    eq("106.32 …with no pair reported twice",
      new Set(s.conflicts.map((x) => x.ids.slice().sort().join("|"))).size, 3);
    eq("106.33 …and the union is the whole stretch", s.scheduledMinutes, 90);
    ok("106.34 …and one row can name both of its collisions",
      (conflictFor(s, "b") ?? "").includes("A") && (conflictFor(s, "b") ?? "").includes("C"));
  }
  {
    // A commitment with no end cannot collide: an instant hits nothing provable.
    const s = buildDayShape([C("a", "Meeting", "09:00", "10:00"), C("b", "Due then", "09:30")]);
    eq("106.35 a commitment with no end raises no collision", s.conflicts.length, 0);
    eq("106.36 …and the meeting's own time is unaffected", s.scheduledMinutes, 60);
  }

  // ======================================================================
  // Gaps, span and the sentence.
  // ======================================================================
  {
    const s = buildDayShape([
      C("a", "Standup", "09:00", "09:30"),
      C("b", "Review", "11:00", "12:30"),
      C("c", "Board", "16:00", "17:30"),
    ], { flexible: 3 });
    eq("106.37 the span runs from first start to last end", [s.spanStart, s.spanEnd], ["09:00", "17:30"]);
    eq("106.38 committed time is the sum of three separate blocks", s.scheduledMinutes, 210);
    eq("106.39 the gaps between them are counted", s.gaps.length, 2);
    eq("106.40 …and totalled", s.betweenMinutes, 300);
    eq("106.41 …with the longest one known", s.longestGapMinutes, 210);
    eq("106.42 the sentence states all three facts", s.line,
      "3h 30m in scheduled blocks between 9 AM and 5:30 PM · 5h between blocks · 3 to place");
  }
  {
    // Clauses with nothing to say are absent (§6's rule, applied again).
    const s = buildDayShape([C("a", "Only thing", "09:00", "10:00")], { flexible: 0 });
    eq("106.43 no gaps and no flexible work leaves one clause", s.line,
      "1h in scheduled blocks between 9 AM and 10 AM");
  }
  {
    const s = buildDayShape([C("a", "Late call", "23:00", "23:59")]);
    eq("106.44 a commitment against midnight is still measured", s.scheduledMinutes, 59);
    eq("106.45 …and formats without wrapping the day", [s.spanStart, s.spanEnd], ["23:00", "23:59"]);
  }
  {
    // Idempotence: the same input twice is the same answer twice.
    const input = [C("a", "A", "09:00", "10:00"), C("b", "B", "09:30", "11:00")];
    eq("106.46 building the shape twice gives the same shape",
      JSON.stringify(buildDayShape(input)), JSON.stringify(buildDayShape(input)));
    eq("106.47 …and does not mutate its input",
      JSON.stringify(input), JSON.stringify([C("a", "A", "09:00", "10:00"), C("b", "B", "09:30", "11:00")]));
  }

  // ======================================================================
  // Today integration — the numbers must be the page's numbers.
  // ======================================================================
  const shapeOf = (s: StoreState, now: string = NOW) => {
    // The clock belongs to the index; `buildTodayCommand` has no clock of its own.
    const ix = buildTodayIndexes(s, TODAY, now);
    return buildTodayCommand(s, ix, TODAY);
  };
  {
    const s = store({
      events: [ev("e1", "Standup", "09:00", "09:30"), ev("e2", "Review", "11:00", "12:30")],
      nextActions: [act({ id: "d1", title: "Send the contract", dueDate: TODAY })],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    eq("106.48 Today carries the day's shape", c.shape.scheduledMinutes, 120);
    eq("106.49 …counting the schedule it actually renders", c.shape.timed, c.fixed.length);
    eq("106.50 …and the work it actually renders", c.shape.flexible, c.work.length);
    ok("106.51 …and prints a line", !!c.shape.line);
  }
  {
    // §12 / LIFEOS-105: a WAIT with a time is not the person's commitment, is
    // not a fixed row, and must not appear in the day's arithmetic either.
    const s = store({
      nextActions: [
        act({ id: "w", title: "Keys from Sam", status: "waiting", waitingOn: "Sam",
          waitingSince: "2026-08-31T09:00:00.000Z", dueDate: TODAY, dueTime: "14:00" }),
        act({ id: "o", title: "Dentist", dueDate: TODAY, dueTime: "15:00" }),
      ],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    ok("106.52 a waiting commitment is not counted in the day's shape",
      !JSON.stringify(c.shape).includes("Keys from Sam"));
    // The neighbour: the person's own timed work IS counted — as a commitment
    // with no duration, because a due time is a deadline.
    eq("106.53 …while their own timed work is", c.shape.timed, 1);
    eq("106.54 …contributing no minutes", c.shape.scheduledMinutes, 0);
  }
  {
    // §24 lifts a timed suggestion out of `fixed`; it is still a commitment on
    // the day, so the arithmetic must not lose it.
    const s = store({
      events: [ev("e1", "Board call", "16:00", "17:30")],
      nextActions: [act({ id: "only", title: "Take the medication", dueDate: TODAY, dueTime: "08:00" })],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    const suggested = c.suggestedNext.recommendation?.action.id;
    ok("106.55 the timed action is the suggestion, and lifted off the schedule",
      suggested === "only" && !c.fixed.some((f) => f.id === "only"), `${suggested} ${JSON.stringify(c.fixed.map((f) => f.id))}`);
    eq("106.56 …but the day's shape still counts it", c.shape.timed, 2);
    eq("106.57 …without inventing minutes for it", c.shape.scheduledMinutes, 90);
  }
  {
    // A completed / cancelled record reaches neither the schedule nor the shape.
    const s = store({
      events: [ev("e1", "Standup", "09:00", "09:30")],
      nextActions: [
        act({ id: "done", title: "Finished thing", status: "completed", dueDate: TODAY, dueTime: "10:00" }),
        act({ id: "gone", title: "Cancelled thing", status: "cancelled", dueDate: TODAY, dueTime: "11:00" }),
      ],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    eq("106.58 finished records are not commitments on today", c.shape.timed, 1);
    eq("106.59 …and cannot collide with the live one", c.shape.conflicts.length, 0);
  }
  {
    // Recurrence: a timed standing responsibility is a commitment today.
    const s = store({
      nextActions: [act({ id: "r", title: "Take the medication", dueTime: "08:00",
        recurrence: { frequency: "daily", interval: 1 } })],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    eq("106.60 a recurring timed responsibility counts as a commitment", c.shape.timed, 1);
    eq("106.61 …and still claims no duration", c.shape.scheduledMinutes, 0);
  }
  {
    // The empty day, through the real surface.
    const c = shapeOf(store({ nextActions: [act({ id: "u", title: "Undated thing" })] } as Partial<StoreState>));
    ok("106.62 a day with nothing timed reports a quiet shape", c.shape.quiet);
    eq("106.63 …and prints no line at all", c.shape.line, undefined);
  }
  {
    // A real collision, end to end.
    const s = store({
      events: [ev("e1", "Team standup", "09:00", "09:30"), ev("e2", "Client review", "09:15", "10:15")],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    eq("106.64 Today reports a real double-booking", c.shape.conflicts.length, 1);
    ok("106.65 …on the rows themselves", !!conflictFor(c.shape, "e1") && !!conflictFor(c.shape, "e2"));
    eq("106.66 …and does not double-count the booked time", c.shape.scheduledMinutes, 75);
  }
  {
    // §44/§45. The day's arithmetic is held to the page's vocabulary.
    const s = store({
      events: [ev("e1", "Standup", "09:00", "09:30"), ev("e2", "Review", "09:15", "12:30")],
      nextActions: [act({ id: "d", title: "Send the contract", dueDate: TODAY })],
    } as Partial<StoreState>);
    const strings = todaySurfaceStrings(shapeOf(s)).join(" ").toLowerCase();
    ok("106.67 the shape line reaches the vocabulary guard", strings.includes("in scheduled blocks"));
    ok("106.68 …and says nothing the page forbids",
      !FORBIDDEN_TODAY_WORDS.some((w) => strings.includes(w)),
      FORBIDDEN_TODAY_WORDS.filter((w) => strings.includes(w)).join(", "));
    ok("106.69 …and never grades the day",
      !/\b(too much|too full|overloaded|unrealistic|impossible)\b/.test(strings), strings);
  }

  // ======================================================================
  // ADVERSARIAL REVIEW — what the first draft claimed but did not know.
  // ======================================================================
  {
    /**
     * The review's central finding. Four measurable meetings plus two timed
     * actions whose length is unknown. The first draft printed "4h 30m
     * committed between 9 AM and 5:30 PM · 4h unscheduled in between" and said
     * nothing at all about the other two — so the reader was invited to infer
     * four free hours that contained a dentist call and a form deadline.
     */
    const s = buildDayShape([
      C("e1", "Standup", "09:00", "09:30"), C("e2", "Review", "11:00", "12:30"),
      C("e3", "1:1", "14:00", "15:00"), C("e4", "Board", "16:00", "17:30"),
      C("a1", "Call dentist", "14:00"), C("a2", "Submit form", "17:00"),
    ], { flexible: 3 });
    eq("106.70 measurable time is reported as scheduled BLOCKS, not as the day",
      s.scheduledMinutes, 270);
    eq("106.71 …the commitments it cannot measure are counted", s.withoutDuration, 2);
    ok("106.72 …and DISCLOSED, not left for the reader to infer",
      (s.line ?? "").includes("2 more at a set time"), String(s.line));
    ok("106.73 …so no clause claims to describe the whole day",
      !(s.line ?? "").includes("committed") && !(s.line ?? "").includes("unscheduled"), String(s.line));
    ok("106.74 …and gap time is named for what it is: between blocks",
      (s.line ?? "").includes("4h between blocks"), String(s.line));
  }
  {
    // The gap that contains a commitment. Same two blocks, one 2 PM call
    // sitting in the middle of the eight hours between them.
    const bare = buildDayShape([C("e1", "Morning", "08:00", "09:00"), C("e2", "Evening", "17:00", "18:00")], { flexible: 2 });
    const withCall = buildDayShape([
      C("e1", "Morning", "08:00", "09:00"), C("e2", "Evening", "17:00", "18:00"),
      C("a1", "Call dentist", "14:00"),
    ], { flexible: 2 });
    eq("106.75 a durationless commitment inside a gap does not shorten it",
      withCall.betweenMinutes, bare.betweenMinutes);
    ok("106.76 …but the sentence stops implying the gap is empty",
      !bare.line?.includes("at a set time") && !!withCall.line?.includes("1 more at a set time"),
      `${bare.line} || ${withCall.line}`);
    ok("106.77 …and neither sentence ever calls that time free",
      !/\bfree\b/.test(`${bare.line} ${withCall.line}`), `${bare.line} ${withCall.line}`);
  }
  {
    // Case D. No measurable block at all — the clause with no antecedent.
    const s = buildDayShape([C("a1", "Call dentist", "14:00"), C("a2", "Submit form", "17:00")], { flexible: 3 });
    eq("106.78 a day of timed actions only still says something true",
      s.line, "2 at a set time · 3 to place");
    ok("106.79 …with no dangling 'around it' pointing at nothing",
      !(s.line ?? "").includes("around it"), String(s.line));
    ok("106.80 …and no zero-valued clause", !/\b0[hm]\b|\b0 /.test(s.line ?? ""), String(s.line));
  }
  {
    // …and when a lone timed action is ALL there is, the schedule below says it.
    const s = buildDayShape([C("a1", "Call dentist", "14:00")], { flexible: 0 });
    eq("106.81 one timed action and nothing else needs no summary at all", s.line, undefined);
  }
  {
    // Case C. A late half-hour must not imply the rest of the day is spoken for.
    const s = buildDayShape([C("e1", "Late call", "23:00", "23:30")], { flexible: 4 });
    eq("106.82 a single late block claims nothing about the rest of the day",
      s.line, "30m in scheduled blocks between 11 PM and 11:30 PM · 4 to place");
    eq("106.83 …and invents no gap around it", s.betweenMinutes, 0);
  }

  // ======================================================================
  // Identity, and records the writer cannot even create.
  // ======================================================================
  {
    // §7. One record rendered twice is not a double-booking.
    const s = buildDayShape([C("x", "Thing", "09:00", "10:00"), C("x", "Thing", "09:00", "10:00")]);
    eq("106.84 a record cannot collide with itself", s.conflicts.length, 0);
    eq("106.85 …and no row carries a note about itself", conflictFor(s, "x"), undefined);
    eq("106.86 …while its time is still counted once", s.scheduledMinutes, 60);
    // The neighbour: two DIFFERENT records sharing a title still collide.
    const twins = buildDayShape([C("p", "Review", "09:00", "10:00"), C("q", "Review", "09:30", "10:30")]);
    eq("106.87 …but two distinct records sharing a title do collide", twins.conflicts.length, 1);
  }
  {
    // A zero-length event is a record `isValidTimeRange` PERMITS (end >= start).
    const s = buildDayShape([C("z", "Instant", "10:00", "10:00"), C("e", "Real", "09:45", "10:15")]);
    eq("106.88 a zero-length event adds no minutes", s.scheduledMinutes, 30);
    eq("106.89 …and raises no phantom collision with what surrounds it", s.conflicts.length, 0);
    eq("106.90 …while still being counted as a commitment", s.timed, 2);
  }
  {
    // An event running past midnight. The writer refuses these outright, so
    // this asserts safe degradation, not a supported shape.
    const s = buildDayShape([C("m", "Overnight", "23:30", "00:30"), C("e", "Real", "09:00", "10:00")]);
    eq("106.91 an unrepresentable overnight range contributes no minutes", s.scheduledMinutes, 60);
    eq("106.92 …no negative time", s.betweenMinutes >= 0, true);
    eq("106.93 …and no phantom collision", s.conflicts.length, 0);
  }
  {
    // Unparseable times must not throw and must not fabricate anything.
    const s = buildDayShape([C("g", "Garbage", "xx:yy", "zz:ww"), C("h", "Worse", "25:99", "26:00")]);
    eq("106.94 unparseable times produce no minutes", s.scheduledMinutes, 0);
    eq("106.95 …no collisions", s.conflicts.length, 0);
    eq("106.96 …and no half-built sentence", s.line, undefined);
  }
  {
    // §9. A row in many collisions names two and counts the rest.
    const s = buildDayShape([
      C("a", "A", "09:00", "12:00"), C("b", "B", "09:30", "10:00"),
      C("c", "C", "10:15", "10:45"), C("d", "D", "11:00", "11:30"),
    ]);
    eq("106.97 a row in three collisions names two and counts the rest",
      conflictFor(s, "a"), "Overlaps B (30m), C (30m) and 1 more.");
    ok("106.98 …while a row in one collision still names it plainly",
      conflictFor(s, "b") === "Overlaps A (30m).", String(conflictFor(s, "b")));
    ok("106.99 …and nothing in the note is alarming",
      !/conflict|clash|warning|urgent|problem|!/i.test(conflictFor(s, "a") ?? ""), String(conflictFor(s, "a")));
  }

  // ======================================================================
  // §8 — "to place" is Today's own count, not a second predicate.
  // ======================================================================
  {
    const s = store({
      events: [ev("e1", "Review", "11:00", "12:30")],
      nextActions: [
        // Two live items, so one can be the suggestion and one stays in DO.
        act({ id: "due", title: "Send the contract", dueDate: TODAY }),
        act({ id: "due2", title: "Pay the invoice", dueDate: TODAY }),
        act({ id: "wait", title: "Quote", status: "waiting", waitingOn: "Priya", waitingSince: "2026-08-31T09:00:00.000Z", dueDate: TODAY }),
        act({ id: "done", title: "Finished", status: "completed", dueDate: TODAY }),
        act({ id: "gone", title: "Cancelled", status: "cancelled", dueDate: TODAY }),
        act({ id: "later", title: "Parked", status: "deferred", deferredUntil: "2026-09-20", dueDate: TODAY }),
      ],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    const placed = c.work.map((w) => w.action.id);
    eq("106.100 §8 'to place' is exactly Today's own DO list", c.shape.flexible, c.work.length);
    ok("106.101 …so waiting, finished, cancelled and parked work is excluded",
      !placed.some((id) => ["wait", "done", "gone", "later"].includes(id)), JSON.stringify(placed));
    ok("106.101b …while both live dated items are counted",
      placed.length === 2 && placed.includes("due") && placed.includes("due2"), JSON.stringify(placed));
  }
  {
    /**
     * §24 lifts the strongest next move out of `work` and into its own card, so
     * it is not in this count either. That is deliberate: the count exists to
     * agree with the orientation line and the list directly beneath it, both of
     * which are built from `work`. A separate opinion about placeable work is
     * exactly the second predicate §8 forbids.
     *
     * One item is overdue so the recommender has a reason to prefer it — two
     * items tying on every ordering fact make it decline outright (§31E), which
     * is right and would leave this assertion with nothing to measure.
     */
    const s = store({
      nextActions: [
        act({ id: "old", title: "File the claim", dueDate: "2026-09-01" }),
        act({ id: "now", title: "Send the contract", dueDate: TODAY }),
      ],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    const placed = c.work.map((w) => w.action.id);
    const suggested = c.suggestedNext.recommendation?.action.id;
    ok("106.101c the suggestion is excluded, as it is from Today's own count",
      !!suggested && !placed.includes(suggested), `${suggested} ${JSON.stringify(placed)}`);
    eq("106.101d …and the count still equals the list beneath it", c.shape.flexible, c.work.length);
  }
  {
    // Blocked work: Today deliberately keeps it in DO with a "Blocked by" note,
    // so the count keeps it too. Consistency with Today, not a new opinion.
    const s = store({
      nextActions: [
        act({ id: "b", title: "Install the desk", dueDate: TODAY }),
        act({ id: "k", title: "Get lease approval" }),
      ],
      actionDependencies: [{ id: "d1", blockedId: "b", blockerId: "k", createdAt: "2026-08-01T09:00:00.000Z" }],
    } as Partial<StoreState>);
    const c = shapeOf(s);
    eq("106.102 §8 blocked work counts exactly as Today counts it", c.shape.flexible, c.work.length);
    ok("106.103 …and Today does still list it", c.work.some((w) => w.action.id === "b"),
      JSON.stringify(c.work.map((w) => w.action.id)));
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
