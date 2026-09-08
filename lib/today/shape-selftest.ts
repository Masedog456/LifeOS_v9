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
    eq("106.8 an event with a start and an end contributes its length", s.committedMinutes, 90);
    eq("106.9 …and the line states it", s.line, "1h 30m committed between 11 AM and 12:30 PM");
    eq("106.10 …with nothing left unaccounted", s.withoutDuration, 0);
  }
  {
    // §8. A due TIME is a deadline, not a duration.
    const s = buildDayShape([C("a", "Send the contract", "14:00")]);
    eq("106.11 a timed ACTION is counted as a commitment", s.timed, 1);
    eq("106.12 …but contributes no occupied minutes", s.committedMinutes, 0);
    eq("106.13 …and is named as having no duration", s.withoutDuration, 1);
    ok("106.14 …so the line makes no duration claim", !(s.line ?? "").includes("committed"));
  }
  {
    // An end at or before its start is not a span.
    const s = buildDayShape([C("e", "Broken", "11:00", "11:00"), C("f", "Also broken", "13:00", "12:00")]);
    eq("106.15 a zero-length or reversed range contributes nothing", s.committedMinutes, 0);
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
    eq("106.17 overlapping time is counted ONCE, not summed", s.committedMinutes, 75);
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
    eq("106.26 …and their time adds up normally", s.committedMinutes, 120);
    eq("106.27 …with no gap invented between them", s.gaps.length, 0);
  }
  {
    // One meeting entirely inside another.
    const s = buildDayShape([C("a", "All-hands", "09:00", "11:00"), C("b", "Quick sync", "09:30", "10:00")]);
    eq("106.28 a contained commitment does not extend the total", s.committedMinutes, 120);
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
    eq("106.33 …and the union is the whole stretch", s.committedMinutes, 90);
    ok("106.34 …and one row can name both of its collisions",
      (conflictFor(s, "b") ?? "").includes("A") && (conflictFor(s, "b") ?? "").includes("C"));
  }
  {
    // A commitment with no end cannot collide: an instant hits nothing provable.
    const s = buildDayShape([C("a", "Meeting", "09:00", "10:00"), C("b", "Due then", "09:30")]);
    eq("106.35 a commitment with no end raises no collision", s.conflicts.length, 0);
    eq("106.36 …and the meeting's own time is unaffected", s.committedMinutes, 60);
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
    eq("106.38 committed time is the sum of three separate blocks", s.committedMinutes, 210);
    eq("106.39 the gaps between them are counted", s.gaps.length, 2);
    eq("106.40 …and totalled", s.freeMinutes, 300);
    eq("106.41 …with the longest one known", s.longestGapMinutes, 210);
    eq("106.42 the sentence states all three facts", s.line,
      "3h 30m committed between 9 AM and 5:30 PM · 5h unscheduled in between · 3 to place around it");
  }
  {
    // Clauses with nothing to say are absent (§6's rule, applied again).
    const s = buildDayShape([C("a", "Only thing", "09:00", "10:00")], { flexible: 0 });
    eq("106.43 no gaps and no flexible work leaves one clause", s.line,
      "1h committed between 9 AM and 10 AM");
  }
  {
    const s = buildDayShape([C("a", "Late call", "23:00", "23:59")]);
    eq("106.44 a commitment against midnight is still measured", s.committedMinutes, 59);
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
    eq("106.48 Today carries the day's shape", c.shape.committedMinutes, 120);
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
    eq("106.54 …contributing no minutes", c.shape.committedMinutes, 0);
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
    eq("106.57 …without inventing minutes for it", c.shape.committedMinutes, 90);
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
    eq("106.61 …and still claims no duration", c.shape.committedMinutes, 0);
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
    eq("106.66 …and does not double-count the booked time", c.shape.committedMinutes, 75);
  }
  {
    // §44/§45. The day's arithmetic is held to the page's vocabulary.
    const s = store({
      events: [ev("e1", "Standup", "09:00", "09:30"), ev("e2", "Review", "09:15", "12:30")],
      nextActions: [act({ id: "d", title: "Send the contract", dueDate: TODAY })],
    } as Partial<StoreState>);
    const strings = todaySurfaceStrings(shapeOf(s)).join(" ").toLowerCase();
    ok("106.67 the shape line reaches the vocabulary guard", strings.includes("committed"));
    ok("106.68 …and says nothing the page forbids",
      !FORBIDDEN_TODAY_WORDS.some((w) => strings.includes(w)),
      FORBIDDEN_TODAY_WORDS.filter((w) => strings.includes(w)).join(", "));
    ok("106.69 …and never grades the day",
      !/\b(too much|too full|overloaded|unrealistic|impossible)\b/.test(strings), strings);
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
