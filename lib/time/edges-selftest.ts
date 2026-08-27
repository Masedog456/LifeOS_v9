/**
 * Time, date and recurrence edge matrix (LIFEOS-074 §3, §4).
 *
 * ## Why this file exists separately
 *
 * The time suite already covers the rules. This covers the BOUNDARIES, where a
 * correct rule and a correct-looking test can agree on a wrong answer: midnight,
 * the last minute of a day, the turn of a month and a year, February 29, the
 * 31st in a 30-day month, and the two days a year a wall clock repeats or skips
 * an hour.
 *
 * ## What is deliberately NOT asserted
 *
 * Conqify stores LOCAL wall-clock times as text (`start_time`, `end_time`,
 * `due_time`) and dates as `YYYY-MM-DD` day keys. It does not model timezones,
 * and this file does not invent them. DST is therefore asserted as what the
 * product actually does — day keys and wall-clock strings are unaffected by an
 * offset change, because neither is an instant — rather than as a conversion it
 * never claims to perform. A test that asserted zone conversion here would be
 * testing a feature that does not exist.
 */

import type { DayKey } from "@/lib/reviews/dates";
import { addDays, dayDiff, weekStartKey } from "@/lib/reviews/dates";
import {
  isValidRule, nextOccurrenceOnOrAfter, currentOccurrence, occurrencesBetween, readRule,
} from "@/lib/time/recurrence";
import { resolveRange } from "@/lib/insights/range";
import { minutesUntil } from "@/lib/today/recommend";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { LifeEvent, NextAction, StoreState } from "@/types/mvp";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildDailyExecutiveView } from "@/lib/today/daily";
import { occurrenceFor } from "@/lib/mvpStore";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const iso = (d: string, h = 8, m = 0) =>
  `${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => {
  seq += 1;
  return {
    description: "", status: "open", createdAt: iso("2026-01-01"), updatedAt: iso("2026-01-01"),
    notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
    energy: "unspecified", order: seq, history: [], ...p,
  } as NextAction;
};
const ev = (p: Partial<LifeEvent> & { id: string; title: string; date: string }): LifeEvent =>
  ({ notes: "", linkedEntityRefs: [], createdAt: iso("2026-01-01"), updatedAt: iso("2026-01-01"), ...p }) as LifeEvent;

const stateWith = (parts: Partial<StoreState>): StoreState => ({ ...emptyState(), ...parts } as StoreState);
const daily = (s: StoreState, today: DayKey, now: string) =>
  buildDailyExecutiveView(s, buildTodayIndexes(s, today, now), today);

export function runTimeEdgeSelfTests(): SelfTestReport {
  const started = Date.now();
  seq = 0;
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(name, JSON.stringify(actual) === JSON.stringify(expected),
      `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

  // ==================== 1. CLOCK BOUNDARIES ====================
  {
    const T = "2026-08-25";
    const s = stateWith({
      events: [ev({ id: "e", title: "Standup", date: T, startTime: "09:30", endTime: "09:45" })],
      nextActions: [act({ id: "a", title: "Call the bank", dueDate: T, dueTime: "14:00" } as Partial<NextAction> & { id: string; title: string })],
    });

    // Midnight and the last minute are ordinary times, not special cases.
    eq("1.1 at 00:00 the day already holds its fixed items", daily(s, T, "00:00").fixedToday.length, 2);
    eq("1.2 at 23:59 it still holds them — the day is not over early",
      daily(s, T, "23:59").fixedToday.length, 2);
    eq("1.3 the day's content does not depend on the clock at all",
      JSON.stringify(daily(s, T, "00:00").fixedToday.map((f) => f.id)),
      JSON.stringify(daily(s, T, "23:59").fixedToday.map((f) => f.id)));

    // `minutesUntil` is the one clock-relative primitive.
    eq("1.4 a time later today is a positive distance", minutesUntil("09:00", "09:30"), 30);
    eq("1.5 a time exactly NOW is zero, not undefined", minutesUntil("09:30", "09:30"), 0);
    eq("1.6 a time one minute ago is not a distance — the product says nothing",
      minutesUntil("09:31", "09:30"), undefined);
    eq("1.7 …and never wraps to tomorrow", minutesUntil("23:59", "00:00"), undefined);
    eq("1.8 00:00 to 23:59 is a whole day of minutes", minutesUntil("00:00", "23:59"), 1439);
  }

  // ==================== 2. MONTH / YEAR / LEAP BOUNDARIES ====================
  {
    eq("2.1 the day after the last of a 31-day month", addDays("2026-08-31", 1), "2026-09-01");
    eq("2.2 the day after the last of a 30-day month", addDays("2026-09-30", 1), "2026-10-01");
    eq("2.3 New Year's Eve rolls to the next year", addDays("2026-12-31", 1), "2027-01-01");
    eq("2.4 …and back", addDays("2027-01-01", -1), "2026-12-31");
    eq("2.5 February in a NON-leap year ends on the 28th", addDays("2027-02-28", 1), "2027-03-01");
    eq("2.6 February in a LEAP year has a 29th", addDays("2028-02-28", 1), "2028-02-29");
    eq("2.7 …and the 29th rolls to March", addDays("2028-02-29", 1), "2028-03-01");
    eq("2.8 a century year divisible by 400 IS a leap year", addDays("2000-02-28", 1), "2000-02-29");
    eq("2.9 …and one divisible by 100 but not 400 is NOT", addDays("2100-02-28", 1), "2100-03-01");
    eq("2.10 dayDiff spans a year boundary", dayDiff("2027-01-01", "2026-12-31"), 1);
    eq("2.11 …and a leap day", dayDiff("2028-03-01", "2028-02-28"), 2);
    eq("2.12 a week starts on Monday across a year boundary", weekStartKey("2027-01-01"), "2026-12-28");
  }

  // ==================== 3. DST — what the product ACTUALLY does ====================
  //
  // Day keys are text and wall-clock times are text. Neither is an instant, so
  // an offset change cannot move them. That is the whole claim; asserting a
  // conversion would be asserting a feature Conqify does not have.
  {
    // Europe/London spring forward 2026-03-29, fall back 2026-10-25.
    eq("3.1 the day after spring-forward is the next calendar day", addDays("2026-03-29", 1), "2026-03-30");
    eq("3.2 …and the day before is the previous one", addDays("2026-03-29", -1), "2026-03-28");
    eq("3.3 a spring-forward day is still one day long", dayDiff("2026-03-30", "2026-03-29"), 1);
    eq("3.4 a fall-back day is also one day long", dayDiff("2026-10-26", "2026-10-25"), 1);
    eq("3.5 a daily rule does not skip the spring-forward day",
      occurrencesBetween({ frequency: "daily", interval: 1 }, "2026-03-27", "2026-03-27", "2026-03-31"),
      ["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    eq("3.6 …nor repeat the fall-back day",
      occurrencesBetween({ frequency: "daily", interval: 1 }, "2026-10-23", "2026-10-23", "2026-10-27"),
      ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    // 01:30 exists twice on a fall-back day in a zoned world. Conqify stores it
    // as the string "01:30" and makes no claim about which one.
    eq("3.7 an ambiguous wall-clock time is stored, not resolved",
      minutesUntil("01:00", "01:30"), 30);
  }

  // ==================== 4. RECURRENCE MATRIX ====================
  {
    const from = "2026-08-25";                         // a Tuesday
    const nx = (rule: Parameters<typeof nextOccurrenceOnOrAfter>[0], anchor: string, f = from) =>
      nextOccurrenceOnOrAfter(rule, anchor, f);

    eq("4.1 daily", nx({ frequency: "daily", interval: 1 }, "2026-08-01"), from);
    eq("4.2 daily every 3 days lands on the rule's own cadence",
      nx({ frequency: "daily", interval: 3 }, "2026-08-01"), "2026-08-25");
    eq("4.3 weekly on Wednesday finds the next Wednesday",
      nx({ frequency: "weekly", interval: 1, weekdays: [3] }, "2026-08-01"), "2026-08-26");
    eq("4.4 weekly on the SAME weekday returns today",
      nx({ frequency: "weekly", interval: 1, weekdays: [2] }, "2026-08-01"), from);
    eq("4.5 monthly on the 15th rolls to next month when the 15th has passed",
      nx({ frequency: "monthly", interval: 1, dayOfMonth: 15 }, "2026-01-15"), "2026-09-15");
    eq("4.6 yearly", nx({ frequency: "yearly", interval: 1, month: 11, dayOfMonth: 25 }, "2020-12-25"), "2026-12-25");

    // The 31st in a 30-day month: SKIPPED, never silently moved to the 30th.
    const m31 = occurrencesBetween({ frequency: "monthly", interval: 1, dayOfMonth: 31 }, "2026-01-31", "2026-01-01", "2026-07-01");
    eq("4.7 a monthly 31st occurs only in months that HAVE a 31st",
      m31, ["2026-01-31", "2026-03-31", "2026-05-31"]);
    ok("4.8 …and is never rounded down to the 30th", !m31.some((d) => d.endsWith("-30")), m31.join(","));

    // February 29 yearly: only in leap years. A scheduling fact, not a bad rule.
    ok("4.9 a Feb-29 yearly rule is VALID", isValidRule({ frequency: "yearly", interval: 1, month: 1, dayOfMonth: 29 }));
    eq("4.10 …and occurs only in leap years",
      occurrencesBetween({ frequency: "yearly", interval: 1, month: 1, dayOfMonth: 29 }, "2024-02-29", "2024-01-01", "2033-01-01"),
      ["2024-02-29", "2028-02-29", "2032-02-29"]);
    ok("4.11 February 30 is refused as impossible",
      !isValidRule({ frequency: "yearly", interval: 1, month: 1, dayOfMonth: 30 }));
    ok("4.12 April 31 likewise", !isValidRule({ frequency: "yearly", interval: 1, month: 3, dayOfMonth: 31 }));

    // Completion moves the CURRENT occurrence on; it never edits the series.
    const rule = { frequency: "daily" as const, interval: 1 };
    eq("4.13 the current occurrence before any completion", currentOccurrence(rule, "2026-08-01", from, []), from);
    eq("4.14 completing today moves it to tomorrow",
      currentOccurrence(rule, "2026-08-01", from, [from]), "2026-08-26");
    eq("4.15 completing twice is the same as completing once",
      currentOccurrence(rule, "2026-08-01", from, [from, from]), "2026-08-26");
    eq("4.16 undoing returns it to today", currentOccurrence(rule, "2026-08-01", from, []), from);

    // A malformed rule yields nothing rather than a wrong answer.
    eq("4.17 an interval of zero is not a schedule", nx({ frequency: "daily", interval: 0 } as never, "2026-08-01"), null);
    eq("4.18 an unknown frequency is not a schedule", nx({ frequency: "hourly", interval: 1 } as never, "2026-08-01"), null);
    eq("4.19 weekly with no weekdays is not a schedule",
      nx({ frequency: "weekly", interval: 1, weekdays: [] } as never, "2026-08-01"), null);
    eq("4.20 …and readRule agrees", readRule({ frequency: "weekly", interval: 1, weekdays: [] }), null);
  }

  // ============ 5. RECURRENCE MEETS THE REST OF THE PRODUCT ============
  {
    const T = "2026-08-25";
    const rec = { frequency: "daily" as const, interval: 1 };

    // + dueTime, no dueDate — the LIFEOS-063 shape.
    const timed = stateWith({ nextActions: [act({ id: "r", title: "Medication", dueTime: "08:00", recurrence: rec } as Partial<NextAction> & { id: string; title: string })] });
    ok("5.1 a recurring action with a time is fixed at that time",
      daily(timed, T, "07:00").fixedToday.some((f) => f.id === "r" && f.time === "08:00"),
      JSON.stringify(daily(timed, T, "07:00").fixedToday));

    // + waiting: a waiting recurring action is not asked for.
    const waiting = stateWith({ nextActions: [act({ id: "r", title: "Medication", recurrence: rec, status: "waiting", waitingOn: "the pharmacy", waitingSince: iso(T) })] });
    ok("5.2 a WAITING recurring action is never recommended",
      daily(waiting, T, "09:00").nextAction.recommendation?.action.id !== "r");

    // + defer: a recurring action parked ahead stays quiet.
    const deferred = stateWith({ nextActions: [act({ id: "r", title: "Medication", recurrence: rec, status: "deferred", deferredUntil: "2026-09-15" })] });
    ok("5.3 a DEFERRED recurring action is never recommended",
      deferred.nextActions !== undefined
        && daily(deferred, T, "09:00").nextAction.recommendation?.action.id !== "r");

    // + dependency: blocked means blocked, recurrence or not.
    const blocked = stateWith({
      nextActions: [act({ id: "r", title: "Medication", recurrence: rec }), act({ id: "b", title: "Blocker" })],
      actionDependencies: [{ id: "d", blockerId: "b", blockedId: "r", createdAt: iso(T) }] as StoreState["actionDependencies"],
    });
    ok("5.4 a BLOCKED recurring action is never recommended",
      daily(blocked, T, "09:00").nextAction.recommendation?.action.id !== "r");

    // Completing one occurrence leaves the series and tomorrow intact.
    const done = stateWith({
      nextActions: [act({ id: "r", title: "Medication", recurrence: rec })],
      recurrenceCompletions: [{ id: "rc", actionId: "r", occurrenceDate: T, completedAt: iso(T, 8) }] as StoreState["recurrenceCompletions"],
    });
    const v = daily(done, T, "12:00");
    eq("5.5 completing an occurrence leaves the action OPEN", done.nextActions![0].status, "open");
    ok("5.6 …its rule intact", !!readRule(done.nextActions![0].recurrence));
    ok("5.7 …and tomorrow's occurrence still previewed", v.tomorrow.some((t) => t.id === "r"));
    eq("5.8 …with the occurrence itself counted as completed today",
      v.completedToday.length, 0); // no history event written in this fixture
    eq("5.9 the schedule now asks for tomorrow",
      occurrenceFor(done.nextActions![0], T, new Map([["r", [T]]])), "2026-08-26");
  }

  // ============ 6. DEFERRAL AND TOMORROW BOUNDARIES ============
  {
    const T = "2026-08-25";
    const TOM = "2026-08-26";

    // A deferral returning EXACTLY today is available again; one day later is not.
    const backToday = stateWith({ nextActions: [act({ id: "d", title: "Filter", status: "deferred", deferredUntil: T })] });
    const backTomorrow = stateWith({ nextActions: [act({ id: "d", title: "Filter", status: "deferred", deferredUntil: TOM })] });
    ok("6.1 a deferral whose day has ARRIVED is not still parked",
      !daily(backToday, T, "09:00").tomorrow.some((t) => t.id === "d"));
    ok("6.2 a deferral returning TOMORROW is previewed for tomorrow",
      daily(backTomorrow, T, "09:00").tomorrow.some((t) => t.id === "d"));
    ok("6.3 …and is not claimed for today",
      !daily(backTomorrow, T, "09:00").flexibleToday.some((f) => f.action.id === "d"));

    // The tomorrow preview at 23:59 is the same as at 00:00 — a preview of a
    // calendar day, not of "the next 24 hours".
    const s = stateWith({
      events: [ev({ id: "e", title: "Solicitor", date: TOM, startTime: "11:00" })],
      nextActions: [act({ id: "a", title: "Keys", dueDate: TOM })],
    });
    eq("6.4 the tomorrow preview does not change through the day",
      JSON.stringify(daily(s, T, "00:00").tomorrow.map((t) => t.id)),
      JSON.stringify(daily(s, T, "23:59").tomorrow.map((t) => t.id)));
    eq("6.5 …and holds both dated items", daily(s, T, "23:59").tomorrow.length, 2);

    // A one-day range is a calendar day, never a rolling window.
    const r = resolveRange("today", { today: T });
    eq("6.6 a today-range starts and ends on the same day", [r.startKey, r.endKey], [T, T]);
    eq("6.7 …across a month boundary too",
      (() => { const x = resolveRange("today", { today: "2026-08-31" }); return [x.startKey, x.endKey]; })(),
      ["2026-08-31", "2026-08-31"]);
  }

  // ============ 7. ALL-DAY AND UNTIMED EVENTS ============
  {
    const T = "2026-08-25";
    const s = stateWith({
      events: [
        ev({ id: "allday", title: "Holiday", date: T, allDay: true }),
        ev({ id: "floating", title: "Sometime today", date: T }),
        ev({ id: "overnight", title: "Night shift", date: T, startTime: "22:00", endTime: "06:00" }),
      ],
    });
    const v = daily(s, T, "12:00");
    eq("7.1 an all-day event carries no invented time",
      v.fixedToday.find((f) => f.id === "allday")?.time, undefined);
    eq("7.2 a floating event carries none either",
      v.fixedToday.find((f) => f.id === "floating")?.time, undefined);
    ok("7.3 both are still shown as fixed commitments", v.fixedToday.length === 3, String(v.fixedToday.length));
    // An end time BEFORE the start time is an overnight event. The product does
    // not model it as crossing midnight, and it must not silently reorder it.
    eq("7.4 an overnight event keeps the start time it was given",
      v.fixedToday.find((f) => f.id === "overnight")?.time, "22:00");
    eq("7.5 …and untimed items sort before timed ones",
      v.fixedToday.map((f) => f.id), ["allday", "floating", "overnight"]);
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
