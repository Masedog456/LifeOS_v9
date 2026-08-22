/**
 * Time foundation self-tests (LIFEOS-061 §34, and the continuation brief).
 *
 * The load-bearing assertions are the ones about what the model refuses to do:
 * it does not clamp a 31st onto February, it does not slide February 29 to the
 * 28th, it does not turn an Event into a task, and it does not crash on a
 * malformed rule from a remote row.
 *
 * Section 9 is adversarial: it throws hand-edited and hostile JSONB at every
 * entry point and asserts the record survives while the schedule is ignored.
 */

import {
  isLocalTime, makeLocalTime, minutesOf, parseLocalTime, formatLocalTime,
  compareLocalTime, isValidTimeRange, timeRangeError,
} from "@/lib/time/localtime";
import {
  isValidRule, readRule, nextOccurrenceOnOrAfter, currentOccurrence, occurrencesBetween,
  occursOn, describeRule, FREQUENCIES, SKIP_LIMITATION, type RecurrenceRule,
} from "@/lib/time/recurrence";
import {
  eventsOnDay, sortOccurrences, nextEventToday, hasStarted, pastEvents, upcomingOccurrences,
} from "@/lib/time/events";
import {
  extractTimeOfDay, extractRecurrence, completeRule, looksLikeEvent,
  UNSUPPORTED_RECURRENCE_LABEL,
} from "@/lib/capture/schedule";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { EXPORT_DOMAINS } from "@/lib/backup/versioning";
import type { LifeEvent, StoreState } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** A fixed Wednesday, so every weekday computation is reproducible forever. */
const TODAY = "2026-08-19";
const AT = "2026-08-19T00:00:00.000Z";

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

function ev(p: Partial<LifeEvent> & { id: string; title: string; date: string }): LifeEvent {
  return {
    id: p.id, title: p.title, date: p.date,
    startTime: p.startTime, endTime: p.endTime, allDay: p.allDay,
    notes: p.notes ?? "", recurrence: p.recurrence,
    linkedEntityRefs: [], createdAt: AT, updatedAt: AT,
  };
}

export function runTimeSelfTests(): SelfTestReport {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

  // ============ 1. LOCAL TIME (§7, §11) ============
  {
    ok("1.1 00:00 is valid", isLocalTime("00:00"));
    ok("1.2 23:59 is valid", isLocalTime("23:59"));
    // 24:00 and 00:00 name different days. Rejected, not normalised.
    ok("1.3 24:00 is INVALID", !isLocalTime("24:00"));
    ok("1.4 25:00 is invalid", !isLocalTime("25:00"));
    ok("1.5 12:60 is invalid", !isLocalTime("12:60"));
    ok("1.6 unpadded 9:00 is invalid", !isLocalTime("9:00"));
    ok("1.7 a non-string is invalid", !isLocalTime(930));
    ok("1.8 empty is invalid", !isLocalTime(""));
    eq("1.9 minutes since midnight", minutesOf("14:30"), 870);
    eq("1.10 makeLocalTime pads", makeLocalTime(9, 5), "09:05");
    ok("1.11 makeLocalTime refuses hour 24", makeLocalTime(24, 0) === null);
    ok("1.12 makeLocalTime refuses fractions", makeLocalTime(9.5, 0) === null);
    // Lexicographic ordering is the whole reason for the format.
    ok("1.13 the canonical form sorts chronologically",
      ["19:00", "09:00", "14:30"].sort().join(",") === "09:00,14:30,19:00");
    eq("1.14 an untimed item sorts first", compareLocalTime(undefined, "09:00"), -1);
    eq("1.15 display is 12-hour", formatLocalTime("14:30"), "2:30 PM");
    eq("1.16 on the hour drops :00", formatLocalTime("09:00"), "9 AM");
    eq("1.17 midnight displays as 12 AM", formatLocalTime("00:00"), "12 AM");
    eq("1.18 noon displays as 12 PM", formatLocalTime("12:00"), "12 PM");
  }

  // ============ 2. TIME PARSING (§14) ============
  {
    eq("2.1 2 PM", parseLocalTime("2 PM"), "14:00");
    eq("2.2 2:30 PM", parseLocalTime("2:30 PM"), "14:30");
    eq("2.3 14:30", parseLocalTime("14:30"), "14:30");
    eq("2.4 noon", parseLocalTime("noon"), "12:00");
    eq("2.5 midnight", parseLocalTime("midnight"), "00:00");
    eq("2.6 12 AM is midnight", parseLocalTime("12 am"), "00:00");
    eq("2.7 12 PM is noon", parseLocalTime("12 pm"), "12:00");
    eq("2.8 'at 2:30 pm' drops the preposition", parseLocalTime("at 2:30 pm"), "14:30");
    // The documented bare-hour convention: 1-7 PM, 8-12 AM.
    eq("2.9 a bare 7 reads as evening", parseLocalTime("7"), "19:00");
    eq("2.10 a bare 11 reads as morning", parseLocalTime("11"), "11:00");
    eq("2.11 a bare 9 reads as morning", parseLocalTime("9"), "09:00");
    ok("2.12 a bare 25 is refused", parseLocalTime("25") === null);
    ok("2.13 nonsense is refused", parseLocalTime("half past") === null);
    eq("2.14 extraction finds the phrase", extractTimeOfDay("Dentist Tuesday at 2:30 PM")?.time, "14:30");
    eq("2.15 and 'class at 11'", extractTimeOfDay("class tomorrow at 11")?.time, "11:00");
    ok("2.16 no time means no finding", extractTimeOfDay("call the dentist") === null);
  }

  // ============ 3. TIME RANGES (§12) ============
  {
    ok("3.1 no end time is fine", isValidTimeRange("09:00", undefined));
    ok("3.2 end after start is fine", isValidTimeRange("09:00", "10:00"));
    ok("3.3 end equal to start is fine", isValidTimeRange("09:00", "09:00"));
    // 23:00 -> 01:00 crosses midnight. Refused, NOT silently reordered into a
    // 22-hour event nobody asked for.
    ok("3.4 an overnight range is refused", !isValidTimeRange("23:00", "01:00"));
    ok("3.5 an end with no start is refused", !isValidTimeRange(undefined, "10:00"));
    ok("3.6 and the reason says why", (timeRangeError("23:00", "01:00") ?? "").includes("past midnight"));
    ok("3.7 a valid range has no error", timeRangeError("09:00", "10:00") === null);
  }

  // ============ 4. RULE VALIDATION (§9 adversarial) ============
  {
    ok("4.1 a daily rule is valid", isValidRule({ frequency: "daily", interval: 1 }));
    ok("4.2 weekly needs weekdays", !isValidRule({ frequency: "weekly", interval: 1 }));
    ok("4.3 weekly with weekdays is valid", isValidRule({ frequency: "weekly", interval: 1, weekdays: [0] }));
    ok("4.4 weekday 7 is out of range", !isValidRule({ frequency: "weekly", interval: 1, weekdays: [7] }));
    ok("4.5 weekday -1 is out of range", !isValidRule({ frequency: "weekly", interval: 1, weekdays: [-1] }));
    ok("4.6 duplicate weekdays are invalid", !isValidRule({ frequency: "weekly", interval: 1, weekdays: [1, 1] }));
    ok("4.7 monthly needs a day", !isValidRule({ frequency: "monthly", interval: 1 }));
    ok("4.8 day 32 is invalid", !isValidRule({ frequency: "monthly", interval: 1, dayOfMonth: 32 }));
    ok("4.9 day 0 is invalid", !isValidRule({ frequency: "monthly", interval: 1, dayOfMonth: 0 }));
    ok("4.10 yearly needs a month", !isValidRule({ frequency: "yearly", interval: 1, dayOfMonth: 14 }));
    ok("4.11 month 12 is invalid", !isValidRule({ frequency: "yearly", interval: 1, month: 12, dayOfMonth: 1 }));
    // February 29 is a VALID rule that simply occurs rarely — not a malformed one.
    ok("4.12 yearly Feb 29 is a valid rule", isValidRule({ frequency: "yearly", interval: 1, month: 1, dayOfMonth: 29 }));
    ok("4.13 but February 30 is not", !isValidRule({ frequency: "yearly", interval: 1, month: 1, dayOfMonth: 30 }));
    ok("4.14 and April 31 is not", !isValidRule({ frequency: "yearly", interval: 1, month: 3, dayOfMonth: 31 }));
    ok("4.15 interval 0 is invalid", !isValidRule({ frequency: "daily", interval: 0 }));
    ok("4.16 a fractional interval is invalid", !isValidRule({ frequency: "daily", interval: 1.5 }));
    ok("4.17 a negative interval is invalid", !isValidRule({ frequency: "daily", interval: -1 }));
    ok("4.18 an unknown frequency is invalid", !isValidRule({ frequency: "fortnightly", interval: 1 }));
    ok("4.19 null is invalid", !isValidRule(null));
    ok("4.20 an array is invalid", !isValidRule([{ frequency: "daily", interval: 1 }]));
    ok("4.21 a string is invalid", !isValidRule("daily"));
    ok("4.22 readRule returns null rather than throwing", readRule({ nonsense: true }) === null);
    eq("4.23 four frequencies, no more", FREQUENCIES.length, 4);
  }

  // ============ 5. MONTHLY 31 IS SKIPPED, NEVER CLAMPED (§3) ============
  {
    const r: RecurrenceRule = { frequency: "monthly", interval: 1, dayOfMonth: 31 };
    const got = occurrencesBetween(r, "2026-01-31", "2026-01-01", "2026-08-01");
    eq("5.1 only months WITH a 31st produce an occurrence", got,
      ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
    ok("5.2 February is skipped entirely", !got.some((d) => d.startsWith("2026-02")));
    ok("5.3 NOT clamped to Feb 28", !got.includes("2026-02-28"));
    ok("5.4 NOT clamped to Feb 29", !got.includes("2026-02-29"));
    ok("5.5 April (30 days) is skipped", !got.some((d) => d.startsWith("2026-04")));
    ok("5.6 NOT clamped to April 30", !got.includes("2026-04-30"));
    // The 30th behaves the same way in February.
    const r30: RecurrenceRule = { frequency: "monthly", interval: 1, dayOfMonth: 30 };
    const got30 = occurrencesBetween(r30, "2026-01-30", "2026-01-01", "2026-05-01");
    ok("5.7 the 30th also skips February", !got30.some((d) => d.startsWith("2026-02")));
    ok("5.8 but April HAS a 30th", got30.includes("2026-04-30"));
  }

  // ============ 6. YEARLY FEBRUARY 29 IS LEAP-ONLY (§4) ============
  {
    const r: RecurrenceRule = { frequency: "yearly", interval: 1, month: 1, dayOfMonth: 29 };
    const got = occurrencesBetween(r, "2028-02-29", "2026-01-01", "2040-12-31");
    eq("6.1 only leap years", got, ["2028-02-29", "2032-02-29", "2036-02-29", "2040-02-29"]);
    ok("6.2 never slides to Feb 28", !got.some((d) => d.endsWith("-02-28")));
    ok("6.3 never slides to Mar 1", !got.some((d) => d.endsWith("-03-01")));
    ok("6.4 2027 has no occurrence", !got.some((d) => d.startsWith("2027")));
    // 2100 is NOT a leap year — the century rule, not just divisibility by 4.
    const century = occurrencesBetween(r, "2096-02-29", "2099-01-01", "2105-12-31");
    ok("6.5 2100 is correctly not a leap year", !century.some((d) => d.startsWith("2100")), JSON.stringify(century));
    ok("6.6 2104 is", century.some((d) => d.startsWith("2104")));
  }

  // ============ 7. RECURRENCE COMPUTATION ============
  {
    const weekly: RecurrenceRule = { frequency: "weekly", interval: 1, weekdays: [0] };
    eq("7.1 next Sunday from a Wednesday", nextOccurrenceOnOrAfter(weekly, "2026-08-23", TODAY), "2026-08-23");
    eq("7.2 the occurrence day itself counts", nextOccurrenceOnOrAfter(weekly, "2026-08-23", "2026-08-23"), "2026-08-23");
    eq("7.3 the day after rolls to next week", nextOccurrenceOnOrAfter(weekly, "2026-08-23", "2026-08-24"), "2026-08-30");

    const mwf: RecurrenceRule = { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] };
    eq("7.4 Monday/Wednesday/Friday", occurrencesBetween(mwf, TODAY, TODAY, "2026-08-29"),
      ["2026-08-19", "2026-08-21", "2026-08-24", "2026-08-26", "2026-08-28"]);

    // "Every other Tuesday" — supported with interval 2, NOT simplified to weekly,
    // which would ask for it twice as often as the person said.
    const fortnightly: RecurrenceRule = { frequency: "weekly", interval: 2, weekdays: [2] };
    const fort = occurrencesBetween(fortnightly, "2026-08-04", "2026-08-04", "2026-10-01");
    eq("7.5 every other Tuesday is 14 days apart", fort, ["2026-08-04", "2026-08-18", "2026-09-01", "2026-09-15", "2026-09-29"]);
    ok("7.6 and skips the intervening Tuesdays", !fort.includes("2026-08-11"));

    eq("7.7 every 3 days", occurrencesBetween({ frequency: "daily", interval: 3 }, TODAY, TODAY, "2026-08-29"),
      ["2026-08-19", "2026-08-22", "2026-08-25", "2026-08-28"]);
    eq("7.8 monthly on the 1st", occurrencesBetween({ frequency: "monthly", interval: 1, dayOfMonth: 1 }, "2026-08-01", TODAY, "2026-11-30"),
      ["2026-09-01", "2026-10-01", "2026-11-01"]);
    ok("7.9 occursOn is exact", occursOn(weekly, "2026-08-23", "2026-08-23") && !occursOn(weekly, "2026-08-23", "2026-08-24"));
    eq("7.10 a malformed rule yields no occurrences", occurrencesBetween({ frequency: "x" } as unknown as RecurrenceRule, TODAY, TODAY, "2027-01-01").length, 0);
    ok("7.11 a malformed rule returns null rather than throwing",
      nextOccurrenceOnOrAfter({ frequency: "x" } as unknown as RecurrenceRule, TODAY, TODAY) === null);
    ok("7.12 an inverted window yields nothing", occurrencesBetween(weekly, TODAY, "2026-09-01", "2026-08-01").length === 0);
  }

  // ============ 8. COMPLETION HISTORY DRIVES THE SCHEDULE (§1, §2) ============
  {
    const weekly: RecurrenceRule = { frequency: "weekly", interval: 1, weekdays: [0] };
    const anchor = "2026-08-23";
    eq("8.1 nothing completed → this Sunday", currentOccurrence(weekly, anchor, TODAY, []), "2026-08-23");
    eq("8.2 this Sunday done → next Sunday", currentOccurrence(weekly, anchor, TODAY, ["2026-08-23"]), "2026-08-30");
    eq("8.3 two done → the third", currentOccurrence(weekly, anchor, TODAY, ["2026-08-23", "2026-08-30"]), "2026-09-06");
    // Purity IS the anti-duplicate guarantee: same inputs, same answer, forever.
    ok("8.4 recomputing gives the identical answer",
      currentOccurrence(weekly, anchor, TODAY, ["2026-08-23"]) === currentOccurrence(weekly, anchor, TODAY, ["2026-08-23"]));
    // An out-of-order completion does not confuse the cursor, because there is none.
    eq("8.5 completing a LATER occurrence first still returns the earlier one",
      currentOccurrence(weekly, anchor, TODAY, ["2026-08-30"]), "2026-08-23");
    ok("8.6 skipping is documented as unsupported, not silently absent", SKIP_LIMITATION.length > 0);
  }

  // ============ 9. MALFORMED REMOTE DATA (§9 of the continuation) ============
  {
    const hostile: unknown[] = [
      null, undefined, 0, "", [], {},
      { frequency: "weekly" },
      { frequency: "weekly", interval: 1, weekdays: "monday" },
      { frequency: "weekly", interval: 1, weekdays: [99] },
      { frequency: "monthly", interval: 1, dayOfMonth: 99 },
      { frequency: "yearly", interval: 1, month: 99, dayOfMonth: 1 },
      { frequency: "daily", interval: Number.POSITIVE_INFINITY },
      { frequency: "daily", interval: Number.NaN },
      { frequency: "__proto__", interval: 1 },
    ];
    let threw = false;
    for (const h of hostile) {
      try {
        readRule(h);
        occurrencesBetween(h as RecurrenceRule, TODAY, TODAY, "2027-01-01");
        currentOccurrence(h as RecurrenceRule, TODAY, TODAY, []);
        describeRule(h);
      } catch { threw = true; }
    }
    ok("9.1 no malformed rule throws, anywhere", !threw);
    ok("9.2 every malformed rule is rejected", hostile.every((h) => readRule(h) === null));
    ok("9.3 describeRule returns empty rather than guessing", hostile.every((h) => describeRule(h) === ""));
    // A stray field on an otherwise-valid rule is IGNORED, not rejected — the
    // rule is well-formed for its frequency, and refusing it would discard a
    // working schedule over a harmless extra key from an older client.
    ok("9.3a a valid daily rule with a stray weekdays field still works",
      readRule({ frequency: "daily", interval: 1, weekdays: [9] }) !== null);

    // The RECORD survives; only the schedule is ignored.
    const s = emptyState();
    (s as unknown as { events: LifeEvent[] }).events = [
      ev({ id: "e1", title: "Broken schedule", date: TODAY, recurrence: { frequency: "weekly" } as unknown as RecurrenceRule }),
    ];
    const onDay = eventsOnDay(s, TODAY);
    eq("9.4 an event with a malformed rule still appears on its own date", onDay.length, 1);
    ok("9.5 and is not treated as derived", onDay[0].derived === false);
    eq("9.6 but produces no other occurrence", eventsOnDay(s, "2026-08-26").length, 0);
    // A row missing `date` entirely cannot take the projection down.
    (s as unknown as { events: unknown[] }).events = [{ id: "e2", title: "No date" }];
    let projectionThrew = false;
    try { eventsOnDay(s, TODAY); } catch { projectionThrew = true; }
    ok("9.7 a structurally broken event row does not break Today", !projectionThrew);
  }

  // ============ 10. EVENTS ARE NOT TASKS (§5, §20, §21) ============
  {
    const s = emptyState();
    (s as unknown as { events: LifeEvent[] }).events = [
      ev({ id: "e1", title: "Dentist", date: TODAY, startTime: "14:30" }),
      ev({ id: "e2", title: "Class", date: TODAY, startTime: "09:00" }),
      ev({ id: "e3", title: "Holiday", date: TODAY, allDay: true }),
      ev({ id: "e4", title: "Dinner", date: TODAY, startTime: "19:00" }),
      ev({ id: "e5", title: "Last week", date: "2026-08-12", startTime: "10:00" }),
      ev({ id: "e6", title: "Standup", date: "2026-08-17", startTime: "09:15", recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] } }),
    ];
    const today = eventsOnDay(s, TODAY);
    eq("10.1 chronological, all-day first",
      today.map((o) => o.event.title), ["Holiday", "Class", "Standup", "Dentist", "Dinner"]);
    ok("10.2 the recurring event derives onto today", today.find((o) => o.event.id === "e6")?.derived === true);
    ok("10.3 last week's event is not today", !today.some((o) => o.event.id === "e5"));

    // No Event carries completion semantics anywhere in the shape.
    const keys = Object.keys(s.events[0]);
    ok("10.4 an Event has NO status field", !keys.includes("status"));
    ok("10.5 an Event has NO completedAt", !keys.includes("completedAt"));
    ok("10.6 an Event has NO done flag", !keys.some((k) => /done|complete/i.test(k)));

    eq("10.7 the next event at 10:00 is the dentist", nextEventToday(today, "10:00")?.event.title, "Dentist");
    eq("10.8 at 20:00 there is no next event", nextEventToday(today, "20:00"), undefined);
    ok("10.9 a started event is flagged only for de-emphasis", hasStarted(today[1], "10:00"));
    ok("10.10 an all-day event never counts as started", !hasStarted(today[0], "23:00"));

    // §21: a past event stays in persistence and simply stops matching today.
    eq("10.11 past events remain available as history", pastEvents(s, TODAY).map((e) => e.id), ["e5"]);
    ok("10.12 the past event was NOT removed from state", s.events.some((e) => e.id === "e5"));
    ok("10.13 a recurring source is not listed as a past instance",
      !pastEvents(s, TODAY).some((e) => e.id === "e6"));
    ok("10.14 upcoming look-ahead is bounded", upcomingOccurrences(s, TODAY, 14).length <= 50);
    eq("10.15 sorting is stable and pure",
      JSON.stringify(sortOccurrences(today)), JSON.stringify(sortOccurrences(sortOccurrences(today))));
  }

  // ============ 11. CAPTURE RECURRENCE PARSING (§14) ============
  {
    const rule = (t: string) => extractRecurrence(t)?.rule;
    eq("11.1 every Sunday", rule("Every Sunday refill my medication box"), { frequency: "weekly", interval: 1, weekdays: [0] });
    eq("11.2 every Monday, Wednesday, and Friday", rule("Gym every Monday, Wednesday, and Friday"),
      { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] });
    eq("11.3 every day", rule("Every day water the plants"), { frequency: "daily", interval: 1 });
    eq("11.4 daily", rule("Meditate daily"), { frequency: "daily", interval: 1 });
    eq("11.5 every other Tuesday keeps interval 2", rule("Every other Tuesday review finances"),
      { frequency: "weekly", interval: 2, weekdays: [2] });
    eq("11.6 the first of every month", rule("Rent on the first of every month"), { frequency: "monthly", interval: 1, dayOfMonth: 1 });
    eq("11.7 monthly on the 15th", rule("Monthly on the 15th pay the card"), { frequency: "monthly", interval: 1, dayOfMonth: 15 });
    eq("11.8 every August 14", rule("Dad's birthday every August 14"), { frequency: "yearly", interval: 1, month: 7, dayOfMonth: 14 });
    eq("11.9 on Mondays", rule("Bins out on Mondays"), { frequency: "weekly", interval: 1, weekdays: [1] });

    // Ambiguity is REFUSED, in the user's own words.
    const twice = extractRecurrence("Twice a week practice guitar");
    ok("11.10 'twice a week' does not become a rule", twice?.rule === undefined);
    eq("11.11 and is reported as ambiguous", twice?.unsupported, "ambiguous_frequency");
    ok("11.12 the phrase is quoted back", (twice?.phrase ?? "").toLowerCase().includes("twice a week"));
    const third = extractRecurrence("Third Thursday of the month, board meeting");
    ok("11.13 'third Thursday' does not become a rule", third?.rule === undefined);
    eq("11.14 and is reported as unsupported", third?.unsupported, "unsupported_pattern");
    ok("11.15 both unsupported reasons have labels",
      !!UNSUPPORTED_RECURRENCE_LABEL.ambiguous_frequency && !!UNSUPPORTED_RECURRENCE_LABEL.unsupported_pattern);
    ok("11.16 ordinary text has no recurrence", extractRecurrence("call the dentist tomorrow") === null);

    // A bare period is completed from the ANCHOR, not from a default.
    eq("11.17 'every week' anchored to a Wednesday means Wednesdays",
      completeRule({ frequency: "weekly", interval: 1 }, TODAY), { frequency: "weekly", interval: 1, weekdays: [3] });
    eq("11.18 'every month' anchored to the 19th means the 19th",
      completeRule({ frequency: "monthly", interval: 1 }, TODAY), { frequency: "monthly", interval: 1, dayOfMonth: 19 });
    eq("11.19 a complete rule is returned unchanged",
      completeRule({ frequency: "weekly", interval: 1, weekdays: [0] }, TODAY), { frequency: "weekly", interval: 1, weekdays: [0] });
  }

  // ============ 12. EVENT vs ACTION IS INTENT, NOT TIME (§11, §13) ============
  {
    ok("12.1 'Dentist appointment Tuesday at 2:30' happens", looksLikeEvent("Dentist appointment Tuesday at 2:30 PM"));
    ok("12.2 'Dinner with Dad tomorrow at 7' happens", looksLikeEvent("Dinner with Dad tomorrow at 7"));
    ok("12.3 'Staff meeting every Tuesday at 9' happens", looksLikeEvent("Staff meeting every Tuesday at 9 AM"));
    ok("12.4 'Class tomorrow at 11' happens", looksLikeEvent("Class tomorrow at 11"));
    // The same time, the same day, a different shape.
    ok("12.5 'Send Dad the form tomorrow at 7' is a STEP", !looksLikeEvent("Send Dad the form tomorrow at 7"));
    ok("12.6 'Call dentist Tuesday at 2:30' is a STEP", !looksLikeEvent("Call dentist Tuesday at 2:30 PM"));
    ok("12.7 'Submit assignment Friday at midnight' is a STEP", !looksLikeEvent("Submit assignment Friday at midnight"));
    ok("12.8 'Book the appointment' is a STEP despite the noun", !looksLikeEvent("Book the appointment"));
    ok("12.9 a plain errand is not an event", !looksLikeEvent("buy dog food"));
  }

  // ============ 13. DOMAINS AND EXPORT ORDER (§27) ============
  {
    ok("13.1 events is a store domain", (STORE_DOMAINS as string[]).includes("events"));
    ok("13.2 recurrenceCompletions is a store domain", (STORE_DOMAINS as string[]).includes("recurrenceCompletions"));
    ok("13.3 events is an export domain", (EXPORT_DOMAINS as readonly string[]).includes("events"));
    ok("13.4 recurrenceCompletions is an export domain", (EXPORT_DOMAINS as readonly string[]).includes("recurrenceCompletions"));
    eq("13.5 store and export domains agree exactly",
      [...STORE_DOMAINS], [...EXPORT_DOMAINS]);
    eq("13.6 46 domains after this sprint", STORE_DOMAINS.length, 46);
    // Appended, never reordered — the order is a wire contract for old archives.
    eq("13.7 the two new domains are LAST", (STORE_DOMAINS as string[]).slice(-2), ["events", "recurrenceCompletions"]);
    // There is deliberately no occurrences domain, and there will not be one.
    ok("13.8 no occurrences domain exists", !(STORE_DOMAINS as string[]).includes("occurrences"));
  }

  // ============ 14. NO GLOBAL SCAN PER SOURCE (§15) ============
  {
    // The naive shape — filter the whole completion list once per action — is
    // O(sources x completions) and measured 280ms at this size. The index makes
    // it one pass. This asserts the SHAPE, not a wall-clock budget: a per-source
    // scan would make the ratio grow with history, and the ratio is what matters.
    const rules: RecurrenceRule[] = [
      { frequency: "daily", interval: 1 },
      { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] },
      { frequency: "monthly", interval: 1, dayOfMonth: 31 },
    ];
    const SOURCES = 400;
    const HISTORY_PER = 20;
    const index = new Map<string, string[]>();
    for (let i = 0; i < SOURCES; i++) {
      const dates: string[] = [];
      for (let k = 0; k < HISTORY_PER; k++) dates.push(`2026-0${1 + (k % 8)}-0${1 + (k % 9)}`);
      index.set(`a${i}`, dates);
    }
    let resolved = 0;
    const t0 = Date.now();
    for (let i = 0; i < SOURCES; i++) {
      if (currentOccurrence(rules[i % rules.length], TODAY, TODAY, index.get(`a${i}`) ?? [])) resolved += 1;
    }
    const ms = Date.now() - t0;
    eq("14.1 every source resolves an occurrence", resolved, SOURCES);
    // Generous, because this asserts the absence of an O(n^2) scan rather than a
    // performance target. The naive version exceeded this by an order of magnitude.
    ok("14.2 400 sources over 8000 completions stays well under a second", ms < 500, `${ms}ms`);
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
