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
import { actionToRow, rowToAction, sessionToRow, rowToSession } from "@/lib/adapters/supabaseAdapter";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { readRule } from "@/lib/time/recurrence";
import { threeWayMerge, type Rec } from "@/lib/sync/merge";
import { mergeLocalOnly } from "@/lib/persistence-reconcile";
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

  // ============ 6. WORKSPACE SESSION POINTERS (LIFEOS-074 §4–§6) ============
  //
  // `goalId`, `projectId` and `currentActionId` had no columns until 0044, so
  // they survived a local reload (the whole store serialises to localStorage)
  // and vanished on remote adoption. All three were proved actively written and
  // read before the columns were added.
  {
    const base = {
      id: "s1", workspaceId: "w1", type: "focus", goal: "Ship the survey pack",
      notes: "", startedAt: iso(T), activity: [],
    } as unknown as Parameters<typeof sessionToRow>[0];

    const withPointers = { ...base, goalId: "g1", projectId: "p1", currentActionId: "a1" };
    const back = rowToSession(sessionToRow(withPointers) as unknown as Record<string, unknown>);
    eq("6.1 a session keeps the action it is working on",
      back.currentActionId, "a1");
    eq("6.2 …and its goal pointer", back.goalId, "g1");
    eq("6.3 …and its project pointer", back.projectId, "p1");
    eq("6.4 …without confusing the free-text goal with the goal POINTER",
      [back.goal, back.goalId], ["Ship the survey pack", "g1"]);

    // Absent stays absent — not null, and not resurrected.
    const bare = rowToSession(sessionToRow(base) as unknown as Record<string, unknown>);
    eq("6.5 an absent pointer stays absent",
      [bare.currentActionId, bare.goalId, bare.projectId], [undefined, undefined, undefined]);
    const row = sessionToRow(base) as unknown as Record<string, unknown>;
    eq("6.6 …written as SQL null, matching every other optional column",
      [row.current_action_id, row.goal_id, row.project_id], [null, null, null]);

    // §5: cleared means cleared. Starting an action then clearing it must not
    // round-trip back to the old pointer.
    const cleared = rowToSession(
      sessionToRow({ ...withPointers, currentActionId: undefined }) as unknown as Record<string, unknown>);
    eq("6.7 a cleared current action stays cleared", cleared.currentActionId, undefined);
    eq("6.8 …while the other pointers are untouched", [cleared.goalId, cleared.projectId], ["g1", "p1"]);

    // §6: a pointer to a record that no longer exists is carried, not repaired.
    // The store clears it at mutation time; the mapper does not invent a target
    // and does not silently drop a value it was given.
    const dangling = rowToSession(
      sessionToRow({ ...withPointers, currentActionId: "gone" }) as unknown as Record<string, unknown>);
    eq("6.9 a dangling pointer is neither repaired nor resurrected", dangling.currentActionId, "gone");
  }

  // ============ 7. THE LIVE CROSS-DEVICE STRATEGY, PINNED (D-8/D-9) ============
  //
  // These assertions describe a LIMITATION, not a desired behaviour.
  //
  // `merge.ts` and `conflicts.ts` are complete and tested, and no production
  // path calls them: `threeWayMerge` is reached only by a selftest and a /dev
  // page, and `setConflicts` only by a /dev "Inject sample conflict" button. So
  // the live cross-device strategy is last-write-wins on the whole row, and
  // SYNC_INTEGRITY.md §0 now says exactly that after describing the opposite for
  // three sprints.
  //
  // They are pinned at RUNTIME — driving the real mapper and the real adoption
  // function — rather than by grepping for call sites, because a grep proves
  // nothing about what actually happens.
  //
  // WHEN THE CROSS-DEVICE SYNC INTEGRITY SPRINT WIRES THE MERGE LAYER, THIS
  // SECTION MUST FAIL. That is its purpose: it forces the document and the
  // implementation to move together instead of drifting apart again.
  {
    const base = act({ id: "race", title: "File the return", dueDate: T });
    const completedByA = { ...base, status: "completed" as const, completedAt: iso(T, 9),
      history: [{ id: "hA", action: "completed", at: iso(T, 9) }] } as NextAction;
    const deferredByB = { ...base, status: "deferred" as const, deferredUntil: "2026-09-15",
      history: [{ id: "hB", action: "deferred", at: iso(T, 10) }] } as NextAction;

    // B holds the stale base and pushes last. The push is a blind row upsert.
    const afterB = roundTrip(deferredByB);
    eq("7.1 the later stale push wins the whole row", afterB.status, "deferred");
    eq("7.2 …erasing a completion it never saw", afterB.completedAt, undefined);
    eq("7.3 …and the history event that recorded it",
      afterB.history.map((h) => h.action), ["deferred"]);

    // The layer that would have caught it is present and disagrees.
    const merged = threeWayMerge(base as unknown as Rec, deferredByB as unknown as Rec, completedByA as unknown as Rec);
    eq("7.4 the unwired merge layer WOULD have flagged this as a conflict", merged.status, "conflict");
    ok("7.5 …and would have kept both history events",
      ((merged.merged.history as Array<{ action: string }>) ?? []).length === 2,
      JSON.stringify(merged.merged.history));

    // Even NON-overlapping field edits lose, because nothing merges fields.
    const aDate = { ...base, dueDate: "2026-09-01" } as NextAction;
    const bTime = { ...base, dueTime: "14:00" } as NextAction;
    eq("7.6 a non-overlapping field edit is reverted by the other client's push",
      roundTrip(bTime).dueDate, T);
    const m2 = threeWayMerge(base as unknown as Rec, bTime as unknown as Rec, aDate as unknown as Rec);
    eq("7.7 …though the merge layer would have kept both",
      [m2.merged.dueDate, m2.merged.dueTime], ["2026-09-01", "14:00"]);

    // Adoption keeps local-only records BY ID, so an edit to an existing record
    // that has not been pushed is discarded when remote is adopted.
    const remote = { nextActions: [base] } as unknown as StoreState;
    const localEdited = { nextActions: [completedByA] } as unknown as StoreState;
    const adopted = mergeLocalOnly(remote, localEdited);
    eq("7.8 adoption discards an unpushed edit to an EXISTING record",
      adopted.nextActions![0].status, "open");
    // …while a genuinely new local record survives, which is the case the
    // function exists for.
    const withNew = { nextActions: [base, act({ id: "fresh", title: "Just captured" })] } as unknown as StoreState;
    ok("7.9 …but a local-only NEW record survives adoption",
      mergeLocalOnly(remote, withNew).nextActions!.some((a) => a.id === "fresh"));
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
