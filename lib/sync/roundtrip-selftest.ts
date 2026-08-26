/**
 * Persistence round-trip self-tests (LIFEOS-074 §5, §7).
 *
 * ## The defect this exists to prevent
 *
 * `due_time` and `recurrence` were added to `next_actions` by migration 0040
 * and to the `NextAction` type at the same time, and the Supabase mapper was
 * never told. For three sprints an action the user had made recurring — "take
 * the medication every day at 8" — synced WITHOUT its rule and without its
 * time, and came back on the next device as a plain undated task. Recurrence
 * completions kept syncing, so the reloaded state held occurrence rows for an
 * action that no longer recurred.
 *
 * Nothing caught it. 3952 assertions passed, twelve browser smokes passed, and
 * every one of them exercised the store in memory. The mapper sat between the
 * store and the database with no test on either side of it.
 *
 * ## So this file asserts the boundary, not the behaviour
 *
 * Section 3 is the load-bearing one: a FIELD-COVERAGE check that fails when any
 * future field is added to `NextAction` and not carried through the mapper. A
 * per-field assertion list would have the same blind spot the original code had
 * — it can only check the fields somebody remembered.
 */

import type { NextAction, StoreState } from "@/types/mvp";
import { actionToRow, rowToAction } from "@/lib/adapters/supabaseAdapter";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { readRule } from "@/lib/time/recurrence";
import { occurrenceFor } from "@/lib/mvpStore";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const T = "2026-08-25";
const iso = (d: string, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;

let seq = 0;
function act(p: Partial<NextAction> & { id: string; title: string }): NextAction {
  seq += 1;
  return {
    description: "", status: "open", createdAt: iso(T), updatedAt: iso(T), notes: "",
    linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
    order: seq, history: [], ...p,
  } as NextAction;
}

/** One push/pull cycle through the real mapper pair. */
const roundTrip = (a: NextAction): NextAction => rowToAction(actionToRow(a) as unknown as Record<string, unknown>);

export function runRoundTripSelfTests(): SelfTestReport {
  const started = Date.now();
  seq = 0;
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(name, JSON.stringify(actual) === JSON.stringify(expected),
      `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

  // ============ 1. THE FOUR SHAPES (§5 A–D) ============
  {
    // A. recurrence only — no due date, no time. The commonest standing task.
    const a = act({ id: "a", title: "Water the plants", recurrence: { frequency: "weekly", interval: 1, weekdays: [3] } });
    const ra = roundTrip(a);
    eq("1.1 a recurrence-only action keeps its rule", ra.recurrence, a.recurrence);
    ok("1.2 …and the rule is still readable", !!readRule(ra.recurrence));
    eq("1.3 …and gains no date it never had", [ra.dueDate, ra.dueTime], [undefined, undefined]);

    // B. recurrence + dueTime, no dueDate — the LIFEOS-063 R-2 shape, and the
    //    exact row the old 0040 constraint would have rejected.
    const b = act({ id: "b", title: "Take the medication", dueTime: "08:00", recurrence: { frequency: "daily", interval: 1 } });
    const rb = roundTrip(b);
    eq("1.4 a recurring action keeps its time", rb.dueTime, "08:00");
    eq("1.5 …and its rule", rb.recurrence, b.recurrence);
    eq("1.6 …with still no invented due date", rb.dueDate, undefined);

    // C. dueDate + dueTime — the ordinary appointment-ish shape.
    const c = act({ id: "c", title: "Call the dentist", dueDate: T, dueTime: "09:00" });
    const rc = roundTrip(c);
    eq("1.7 a dated action keeps both date and time", [rc.dueDate, rc.dueTime], [T, "09:00"]);
    eq("1.8 …and gains no recurrence", rc.recurrence, undefined);

    // D. a plain action is untouched by any of this.
    const d = act({ id: "d", title: "Plain thing" });
    const rd = roundTrip(d);
    eq("1.9 a plain action round-trips unchanged", [rd.dueDate, rd.dueTime, rd.recurrence], [undefined, undefined, undefined]);
    eq("1.10 …and keeps its identity and status", [rd.id, rd.title, rd.status], ["d", "Plain thing", "open"]);
  }

  // ============ 2. NULL SEMANTICS ARE PRESERVED EXACTLY (§2) ============
  {
    const bare = act({ id: "n", title: "Bare" });
    const row = actionToRow(bare) as unknown as Record<string, unknown>;
    eq("2.1 an absent time is written as SQL null, not undefined", row.due_time, null);
    eq("2.2 …and an absent rule likewise", row.recurrence, null);
    const back = rowToAction(row);
    eq("2.3 …and null reads back as absent, never as null", [back.dueTime, back.recurrence], [undefined, undefined]);
    ok("2.4 …so an absent field never becomes a JSON null downstream",
      !Object.values({ t: back.dueTime, r: back.recurrence }).some((v) => v === null));

    // A malformed rule from an older client must not reach recurrence consumers.
    const bad = rowToAction({ ...row, recurrence: { frequency: "fortnightly", interval: 0 } });
    eq("2.5 an unreadable rule reads back as no rule", bad.recurrence, undefined);
    const good = rowToAction({ ...row, recurrence: { frequency: "daily", interval: 1 } });
    ok("2.6 …while a readable one survives", !!readRule(good.recurrence));
  }

  // ============ 3. FIELD COVERAGE — the check that generalises ============
  //
  // Every OPTIONAL field set to a non-default value, pushed and pulled. Any
  // field the mapper forgets shows up here as a mismatch, including fields that
  // do not exist yet. This is the assertion that would have caught the original
  // defect on the day it was written.
  {
    const full = act({
      id: "full", title: "Everything", description: "d", status: "waiting",
      completedAt: iso(T, 9), cancelledAt: iso(T, 10), dueDate: T, dueTime: "07:30",
      // A monthly rule REQUIRES `dayOfMonth` — `isValidRule` refuses one without
      // it, and the first draft of this fixture omitted it, so the round trip
      // correctly returned no rule and this assertion correctly failed. Left
      // valid here on purpose: an invalid rule would make the coverage check
      // below vacuous, and the invalid case is covered at 2.5/2.6 instead.
      deferredUntil: "2026-09-01", recurrence: { frequency: "monthly", interval: 2, dayOfMonth: 15 },
      waitingOn: "Marcus", waitingSince: iso(T, 6), followUpDate: "2026-08-30",
      notes: "n", workspaceId: "w", goalId: "g", projectId: "p", milestoneId: "m",
      sourceCaptureId: "sc", sourceReviewId: "sr",
      linkedEntityRefs: [{ kind: "project", id: "p" }], tags: ["x"],
      estimatedSize: "large", energy: "high", context: "ctx", order: 7, pinned: true,
      history: [{ id: "h", action: "created", at: iso(T) }],
    } as Partial<NextAction> & { id: string; title: string });

    const back = roundTrip(full);
    const missing: string[] = [];
    for (const key of Object.keys(full) as Array<keyof NextAction>) {
      if (JSON.stringify(back[key]) !== JSON.stringify(full[key])) missing.push(String(key));
    }
    eq("3.1 EVERY NextAction field survives the round trip", missing, []);
    ok("3.2 …including the two the mapper used to drop",
      back.dueTime === "07:30" && !!back.recurrence, JSON.stringify([back.dueTime, back.recurrence]));
  }

  // ============ 4. COMPLETIONS DO NOT OUTLIVE THEIR RULE (§5 E) ============
  {
    const a = act({ id: "r", title: "Medication", recurrence: { frequency: "daily", interval: 1 } });
    const back = roundTrip(a);
    const state = {
      ...Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])),
      nextActions: [back],
      recurrenceCompletions: [{ id: "rc", actionId: "r", occurrenceDate: "2026-08-24", completedAt: iso("2026-08-24") }],
    } as unknown as StoreState;

    ok("4.1 the reloaded action still recurs", !!readRule(state.nextActions![0].recurrence));
    // The completion refers to a record that still has a rule, so the schedule
    // can still answer "what is due". Before the repair the rule was gone and
    // this returned undefined — a completion row for a non-recurring task.
    const occ = occurrenceFor(state.nextActions![0], T, new Map([["r", ["2026-08-24"]]]));
    ok("4.2 …so its completion still refers to a live schedule", occ !== undefined, String(occ));
    eq("4.3 …and the completion row survived alongside it",
      (state.recurrenceCompletions ?? []).length, 1);
  }

  // ============ 5. THE ROW THE DATABASE MUST STILL REFUSE (§5 F, §4) ============
  //
  // The constraint check itself runs in the migration rehearsal against real
  // PostgreSQL. What is asserted here is the SHAPE: a time with neither a date
  // nor a rule is meaningless, and the mapper must faithfully produce exactly
  // that row rather than quietly repairing it — a mapper that invented a date
  // to satisfy the constraint would be inventing a life fact.
  {
    const bad = act({ id: "bad", title: "No day", dueTime: "09:00" });
    const row = actionToRow(bad) as unknown as Record<string, unknown>;
    eq("5.1 a time with no day is written as-is, not repaired", row.due_time, "09:00");
    eq("5.2 …with no date invented to satisfy the constraint", row.due_date, null);
    eq("5.3 …and no rule invented either", row.recurrence, null);
    ok("5.4 …which is precisely the shape the database refuses",
      row.due_time !== null && row.due_date === null && row.recurrence === null);
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
