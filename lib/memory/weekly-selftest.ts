/**
 * Weekly executive review self-tests (LIFEOS-084).
 *
 * ## The red proofs this suite pins
 *
 * §2's audit ran a realistic week through the real builders. Four things it
 * measured are asserted below in the form they failed:
 *
 *   1. the Deferred section was the raw event list — SIX rows for two actions,
 *      three of them a weekly recurring commitment
 *   2. the Added section's only entry was `"AI summary: you were productive."`,
 *      because `added` has no provenance filter
 *   3. seven kinds of evidence reached no weekly surface at all — moved
 *      forward, changed direction, repeated deferral, unresolved attention,
 *      waiting that ended, next week's calendar, carry-forward
 *   4. three of §36's questions did not route, and "what changed direction?"
 *      answered a question about direction with the whole week
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A weekly review earns trust by what it refuses to say: that a horizon edit is
 * progress, that a standing routine is slippage, that a model's sentence is
 * something the person wrote, that a goal should be dropped, that the week was
 * good or bad. Those are asserted as negatives, and several are proved by
 * over-supplying the fixture so a cap that silently does nothing cannot pass.
 *
 * Pure: no store, no clock, no AI.
 */

import type {
  ConstitutionElement, ConstitutionRevision, Goal, NextAction, Project,
  Reflection, StoreState,
} from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { planMemoryQuery } from "@/lib/memory/query";
import { answerMemoryQuery, answerStrings } from "@/lib/memory/answer";
import { ATTENTION_ORDER, ATTENTION_MAX_LIMIT, buildAttentionShortlist } from "@/lib/guidance/attention";
import { repeatedlyPostponed, MOVED_FORWARD_KINDS, DIRECTION_KINDS } from "@/lib/memory/changes";
import {
  buildWeeklyExecutiveReview, buildCarryForward, buildScheduledNext, buildReconsider,
  leftBehindLine, weeklyStrings, carryReasonFor,
  CARRY_ORDER, CARRY_REASON_SOURCES, CARRY_FORWARD_DEFAULT, MAX_REFLECTIONS,
  MAX_UNRESOLVED, MAX_SCHEDULED, RECONSIDER_DEFERRALS,
  WEEKLY_FORBIDDEN_WORDS, WEEKLY_HEADINGS, PARTIAL_WEEK_NOTE,
  type CarryReason,
} from "@/lib/memory/weekly";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** Thursday. The week (Monday) started 2026-09-07, so the range is Sep 7–10. */
const TODAY = "2026-09-10";

/** `o` days from TODAY. */
const D = (o = 0): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const A = (o = 0, h = 9): string => `${D(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: A(-20), updatedAt: A(-20), ...p,
} as NextAction);

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [],
  createdAt: A(-60), updatedAt: A(-60), ...p,
} as Goal);

const proj = (p: Partial<Project> & { id: string; title: string }): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Project);

const std = (p: Partial<ConstitutionElement> & { id: string; statement: string }): ConstitutionElement => ({
  kind: "standard", status: "active", adoptedAt: A(-60), linkedRefs: [],
  createdAt: A(-60), updatedAt: A(-60), ...p,
} as ConstitutionElement);

const rev = (p: Partial<ConstitutionRevision> & { id: string; elementId: string; changeKind: ConstitutionRevision["changeKind"]; at: string }): ConstitutionRevision =>
  ({ ...p } as ConstitutionRevision);

const refl = (p: Partial<Reflection> & { id: string; response: string }): Reflection =>
  ({ prompt: "", createdAt: A(-2, 20), annotations: [], ...p } as Reflection);

function stateWith(over: Partial<StoreState>): StoreState {
  return { ...emptyStoreState(), ...over };
}

/**
 * The audit's own fixture, so the report and this suite can be read together.
 *
 * Two completions (one under a goal's project, one unlinked), an action
 * deferred three times, a **weekly recurring** action also deferred three
 * times, a wait still open, a wait that ended mid-week, an overdue action, a
 * goal whose horizon moved, a goal with no project, a retired standard, a user
 * reflection, an AI-written note, and an event scheduled for next week.
 */
function world(): StoreState {
  return stateWith({
    goals: [
      goal({
        id: "g1", title: "Graduate school", horizon: "medium",
        history: [
          { id: "h1", at: A(-60, 8), kind: "created" },
          { id: "h2", at: A(-2, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
        ],
      } as Partial<Goal> & { id: string; title: string }),
      // Active, and nothing carrying it. A structural gap, never a verdict.
      goal({ id: "g2", title: "Run a marathon", horizon: "long" }),
    ],
    projects: [proj({ id: "pr1", title: "Fall applications", goalId: "g1" })],
    events: [{
      id: "ev1", title: "Dentist", date: D(4), startTime: "10:00", allDay: false,
      createdAt: A(-10), updatedAt: A(-10),
    }] as StoreState["events"],
    nextActions: [
      // Completed under the goal's project → the only kind of "moved forward".
      act({
        id: "a1", title: "Submit UH application", projectId: "pr1",
        status: "completed", completedAt: A(-2, 14),
        history: [
          { id: "e1", action: "created", at: A(-20) },
          { id: "e2", action: "completed", at: A(-2, 14) },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Completed, unlinked. Finished — but not a goal moving.
      act({
        id: "a2", title: "Buy running shoes", status: "completed", completedAt: A(-1, 15),
        history: [
          { id: "e3", action: "created", at: A(-20) },
          { id: "e4", action: "completed", at: A(-1, 15) },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Deferred three times this week.
      act({
        id: "a3", title: "Request recommendation letter", projectId: "pr1",
        history: [
          { id: "e5", action: "created", at: A(-20) },
          { id: "e6", action: "deferred", at: A(-3, 10), detail: D(-2) },
          { id: "e7", action: "deferred", at: A(-2, 10), detail: D(-1) },
          { id: "e8", action: "deferred", at: A(-1, 10), detail: D(2) },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Weekly recurring, ALSO deferred three times. Moving a standing routine
      // by a day is scheduling, not slippage.
      act({
        id: "a4", title: "Weekly lab prep",
        recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
        history: [
          { id: "e9", action: "created", at: A(-20) },
          { id: "e10", action: "deferred", at: A(-3, 12), detail: D(-2) },
          { id: "e11", action: "deferred", at: A(-2, 12), detail: D(-1) },
          { id: "e12", action: "deferred", at: A(-1, 12), detail: D(2) },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Still waiting, with a follow-up date that has arrived.
      act({
        id: "a5", title: "Transcript from registrar", status: "waiting",
        waitingOn: "the registrar", waitingSince: D(-8), followUpDate: D(0),
      } as Partial<NextAction> & { id: string; title: string }),
      // The wait ENDED mid-week.
      act({
        id: "a6", title: "Lease from Marcus", status: "open", waitingOn: "Marcus",
        history: [
          { id: "e13", action: "created", at: A(-20) },
          { id: "e14", action: "waiting", at: A(-9, 10), detail: "Marcus" },
          { id: "e15", action: "edited", at: A(-2, 16), fromStatus: "waiting", toStatus: "open" },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Overdue and unresolved → a carry-forward candidate.
      act({ id: "a7", title: "Pay the deposit", dueDate: D(-1) }),
    ],
    constitutionElements: [std({
      id: "s1", kind: "standard", status: "retired",
      statement: "Never work at weekends.", retiredAt: A(-2, 11), updatedAt: A(-2, 11),
    } as Partial<ConstitutionElement> & { id: string; statement: string })],
    constitutionRevisions: [rev({ id: "r1", elementId: "s1", changeKind: "retired", at: A(-2, 11) })],
    reflections: [refl({
      id: "rf1", prompt: "On teaching",
      response: "I care more about philosophy than teaching.",
    })],
    // The provenance trap: a model's sentence, recorded as a note.
    notes: [{
      id: "n1", body: "AI summary: you were productive.", fromAiText: true,
      archived: false, tags: [], linkedEntityRefs: [], createdAt: A(-1, 7), updatedAt: A(-1, 7),
    }] as StoreState["notes"],
    recurrenceCompletions: [],
  });
}

export function runWeeklyReviewSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const ix = buildTodayIndexes(s, TODAY, "09:00");
  const r = buildWeeklyExecutiveReview(s, ix, "this_week", TODAY);
  const titles = <T extends { title: string }>(xs: T[]) => xs.map((x) => x.title);

  // ==========================================================================
  // §2 RED 1 — the Deferred section was the raw event list.
  // ==========================================================================
  {
    // Six deferral EVENTS exist in the fixture. The audit measured six rows.
    const events = (s.nextActions ?? [])
      .flatMap((a) => (a.history ?? []).filter((h) => h.action === "deferred"));
    ok("84.1 the fixture really does contain six deferral events", events.length === 6, `${events.length}`);
    ok("84.2 the review reports ONE row per action, not one per event",
      r.repeatedDeferrals.length === 1, JSON.stringify(r.repeatedDeferrals.map((p) => [p.action.title, p.count])));
    ok("84.3 …and it carries the count rather than repeating the title",
      r.repeatedDeferrals[0]?.count === 3, `${r.repeatedDeferrals[0]?.count}`);
    // §9. The exclusion 081 established, asserted here because this is the
    // surface that was rendering it as slippage three times over.
    ok("84.4 a weekly recurring commitment is NOT repeated deferral",
      !titles(r.repeatedDeferrals.map((p) => p.action)).includes("Weekly lab prep"),
      JSON.stringify(titles(r.repeatedDeferrals.map((p) => p.action))));
    ok("84.5 …even though it was deferred exactly as often as the one that counts",
      (s.nextActions ?? []).find((a) => a.id === "a4")!.history!.filter((h) => h.action === "deferred").length === 3);
    // The same defect in one sentence. The summary counted deferral EVENTS and
    // called them "items", so a week in which two things were put off read
    // "deferred 6 items" — on the same screen as a section reporting one.
    // Nothing guarded this: changing it broke no existing assertion.
    ok("84.5b the summary counts records, not deferral events",
      /deferred 2 items/.test(r.base.summary), r.base.summary);
    ok("84.5c …and the headline cannot contradict the section beneath it",
      !/deferred [3-9] items|deferred \d\d+ items/.test(r.base.summary), r.base.summary);
  }

  // ==========================================================================
  // §2 RED 2 / §12 — machine prose is not something the person said.
  // ==========================================================================
  {
    const words = r.reflections.map((c) => c.title);
    ok("84.6 an AI-written note is not in the user's own words",
      !words.some((w) => w.includes("AI summary")), JSON.stringify(words));
    ok("84.7 …and the user's own reflection still is",
      words.some((w) => w.includes("philosophy")), JSON.stringify(words));
    // The note IS in the store and IS inside the range — the filter is
    // provenance, not absence. Without this the test above passes vacuously.
    ok("84.8 the machine note is genuinely present and in range",
      (s.notes ?? []).some((n) => n.body.includes("AI summary") && n.createdAt >= `${r.range.startKey}T00:00`));
  }

  // ==========================================================================
  // §2 RED 3 — evidence that reached no weekly surface at all.
  // ==========================================================================
  {
    ok("84.9 moved forward is present", r.movedForward.length === 1, JSON.stringify(titles(r.movedForward)));
    ok("84.10 changed direction is present", r.changedDirection.length === 2, JSON.stringify(titles(r.changedDirection)));
    ok("84.11 waiting that ENDED is present", titles(r.waitingEnded).includes("Lease from Marcus"));
    ok("84.12 unresolved attention is present", r.unresolved.length > 0, JSON.stringify(r.unresolved.map((a) => a.kind)));
    ok("84.13 carry forward is present", r.carryForward.length > 0, JSON.stringify(r.carryForward.map((c) => [c.reason, c.title])));
    ok("84.14 next week's calendar is present", titles(r.scheduledNext).includes("Dentist"));
  }

  // ==========================================================================
  // §7 — "moved forward" is completed linked work and NOTHING else.
  // ==========================================================================
  {
    ok("84.15 moved forward is the goal-linked completion", titles(r.movedForward)[0] === "Submit UH application");
    ok("84.16 an UNLINKED completion is not 'moved forward'",
      !titles(r.movedForward).includes("Buy running shoes"));
    ok("84.17 …but it is still Finished", titles(r.base.completed).includes("Buy running shoes"),
      JSON.stringify(titles(r.base.completed)));
    // §7's list of things that must never count.
    ok("84.18 a horizon edit is not moved forward",
      !r.movedForward.some((c) => c.kind === "goal_horizon_changed"));
    ok("84.19 moved-forward kinds are completions only",
      r.movedForward.every((c) => (MOVED_FORWARD_KINDS as string[]).includes(c.kind)),
      JSON.stringify(r.movedForward.map((c) => c.kind)));
    ok("84.20 moved-forward and direction kinds cannot overlap",
      !(MOVED_FORWARD_KINDS as string[]).some((k) => (DIRECTION_KINDS as string[]).includes(k)));
    // A title edit is the classic false positive. Prove it stays out.
    const edited = stateWith({
      ...world(),
      nextActions: (world().nextActions ?? []).map((a) => a.id === "a1"
        ? { ...a, title: "Submit UH application (final)", updatedAt: A(-1, 9) } : a),
    });
    const re = buildWeeklyExecutiveReview(edited, buildTodayIndexes(edited, TODAY, "09:00"), "this_week", TODAY);
    ok("84.21 retitling does not add a second 'moved forward'",
      re.movedForward.length === 1, `${re.movedForward.length}`);
  }

  // ==========================================================================
  // §11 — what stopped waiting, and what is still waiting, are different facts.
  // ==========================================================================
  {
    const ended = new Set(r.waitingEnded.map((c) => c.entity.id));
    const still = new Set(r.stillWaiting.map((w) => w.action.id));
    ok("84.22 a wait that ended is not also still waiting",
      ![...ended].some((id) => still.has(id)), `${[...ended]} / ${[...still]}`);
    ok("84.23 the open wait is reported as still waiting", still.has("a5"));
    ok("84.24 …read from present state, not from the range",
      (s.nextActions ?? []).find((a) => a.id === "a5")!.status === "waiting");
  }

  // ==========================================================================
  // §10, §12 — caps, proved with fixtures that EXCEED them.
  // ==========================================================================
  {
    // Six overdue items. A cap that did nothing would return six.
    const many = stateWith({
      ...world(),
      nextActions: [
        ...(world().nextActions ?? []),
        ...[1, 2, 3, 4, 5, 6].map((i) => act({ id: `o${i}`, title: `Overdue ${i}`, dueDate: D(-3) })),
      ],
    });
    const rm = buildWeeklyExecutiveReview(many, buildTodayIndexes(many, TODAY, "09:00"), "this_week", TODAY);
    ok("84.25 the fixture over-supplies unresolved candidates",
      buildAttentionShortlist(many, buildTodayIndexes(many, TODAY, "09:00"), TODAY, { limit: 50 }).length > MAX_UNRESOLVED);
    ok("84.26 unresolved is capped at three (§10)", rm.unresolved.length === MAX_UNRESOLVED, `${rm.unresolved.length}`);
    ok("84.27 carry forward is capped at three by default (§16)",
      rm.carryForward.length === CARRY_FORWARD_DEFAULT, `${rm.carryForward.length}`);

    // Five reflections. Same trap: a cap is invisible when the fixture has three.
    const chatty = stateWith({
      ...world(),
      reflections: [1, 2, 3, 4, 5].map((i) => refl({
        id: `rf${i}`, response: `Reflection number ${i}`, createdAt: A(-3 + (i % 3), 20),
      })),
    });
    const rc = buildWeeklyExecutiveReview(chatty, buildTodayIndexes(chatty, TODAY, "09:00"), "this_week", TODAY);
    ok("84.28 the fixture over-supplies reflections", (chatty.reflections ?? []).length > MAX_REFLECTIONS);
    ok("84.29 reflections are capped at three (§12)", rc.reflections.length === MAX_REFLECTIONS, `${rc.reflections.length}`);

    // Seven dated items next week. MAX_SCHEDULED is five.
    const busy = stateWith({
      ...world(),
      nextActions: [
        ...(world().nextActions ?? []),
        ...[1, 2, 3, 4, 5, 6, 7].map((i) => act({ id: `n${i}`, title: `Next ${i}`, dueDate: D(2) })),
      ],
    });
    const sched = buildScheduledNext(busy, r.range, TODAY);
    ok("84.30 the fixture over-supplies next week's commitments",
      (busy.nextActions ?? []).filter((a) => a.dueDate === D(2)).length > MAX_SCHEDULED);
    ok("84.31 next week's list is capped at five (§22)", sched.length === MAX_SCHEDULED, `${sched.length}`);
  }

  // ==========================================================================
  // §17 — the precedence is DERIVED from ATTENTION_ORDER, not restated.
  // ==========================================================================
  {
    const rank = (reason: CarryReason) => Math.min(
      ...CARRY_REASON_SOURCES[reason].map((k) => ATTENTION_ORDER.indexOf(k)));
    const derived = [...CARRY_ORDER].sort((a, b) => rank(a) - rank(b));
    ok("84.32 CARRY_ORDER is exactly the order ATTENTION_ORDER induces",
      JSON.stringify(CARRY_ORDER) === JSON.stringify(derived), JSON.stringify(CARRY_ORDER));
    // The specific inversion the first draft shipped, named so a reader knows
    // what this guard is for: a structural gap must not outrank a live date.
    ok("84.33 a follow-up date that has arrived outranks a goal with no project",
      CARRY_ORDER.indexOf("waiting_follow_up") < CARRY_ORDER.indexOf("goal_gap"),
      JSON.stringify(CARRY_ORDER));
    ok("84.34 a passed due date ranks first", CARRY_ORDER[0] === "dated");
    // Every carried reason must be reachable from a real signal.
    ok("84.35 every carry reason maps to a signal that exists",
      (Object.keys(CARRY_REASON_SOURCES) as CarryReason[]).every((k) =>
        CARRY_REASON_SOURCES[k].every((sig) => ATTENTION_ORDER.includes(sig))));
    // Signals deliberately NOT carried.
    ok("84.36 blocked work is not carried — it waits on its blocker",
      carryReasonFor("blocked") === null);
    ok("84.37 a project with no next action is not carried",
      carryReasonFor("project_no_next_action") === null);
    // The fixture's own ordering, end to end.
    ok("84.38 the review orders carry-forward by that precedence",
      JSON.stringify(r.carryForward.map((c) => c.reason)) === JSON.stringify(["dated", "waiting_follow_up", "repeated_deferral"]),
      JSON.stringify(r.carryForward.map((c) => [c.reason, c.title])));
  }

  // ==========================================================================
  // §15 — what carry-forward must never contain.
  // ==========================================================================
  {
    const ids = new Set(r.carryForward.map((c) => c.entity.id));
    ok("84.39 a completed action is never carried", !ids.has("a1") && !ids.has("a2"), JSON.stringify([...ids]));
    // …asserted at the FUNCTION BOUNDARY too. Reached through
    // `buildWeeklyExecutiveReview` the guard is unreachable: the shortlist is
    // built from live commitments, so a completed action never arrives at it and
    // deleting the check leaves every assertion above green. `buildCarryForward`
    // is exported and takes a shortlist it did not build, so the guard is what
    // stands between a caller and a review that carries finished work.
    const completedShortlist = [{
      id: "hand:a1", kind: "overdue" as const, entity: { kind: "action" as const, id: "a1" },
      title: "Submit UH application", explanation: "Was due earlier.", evidence: "action.dueDate",
      secondaryReasons: [], ruleContext: [], actionId: "a1",
    }];
    ok("84.39b …even when a caller hands it one directly",
      buildCarryForward(s, completedShortlist, [], TODAY).length === 0,
      JSON.stringify(buildCarryForward(s, completedShortlist, [], TODAY).map((c) => c.title)));
    // The same shortlist entry pointed at a LIVE record must be carried, or the
    // assertion above would pass simply because nothing is ever carried.
    const liveShortlist = [{ ...completedShortlist[0], id: "hand:a7", entity: { kind: "action" as const, id: "a7" }, title: "Pay the deposit", actionId: "a7" }];
    ok("84.39c …and a live record handed the same way IS carried",
      buildCarryForward(s, liveShortlist, [], TODAY).length === 1);
    ok("84.40 a wait that already ended is never carried", !ids.has("a6"));
    ok("84.41 a retired standard is never carried",
      !r.carryForward.some((c) => c.entity.kind === "rule" || c.title.includes("Never work at weekends")));
    // An abandoned goal is not unfinished business.
    const dropped = stateWith({
      ...world(),
      goals: (world().goals ?? []).map((g) => g.id === "g2" ? { ...g, status: "abandoned" as Goal["status"] } : g),
    });
    const rd = buildWeeklyExecutiveReview(dropped, buildTodayIndexes(dropped, TODAY, "09:00"), "this_week", TODAY);
    ok("84.42 an abandoned goal is never carried",
      !rd.carryForward.some((c) => c.entity.id === "g2"), JSON.stringify(rd.carryForward.map((c) => c.title)));
    // The cap can be raised to the shortlist's own ceiling, and no further.
    const many = stateWith({
      ...world(),
      nextActions: [...(world().nextActions ?? []),
        ...[1, 2, 3, 4, 5, 6, 7].map((i) => act({ id: `x${i}`, title: `Overdue ${i}`, dueDate: D(-3) }))],
    });
    const mix = buildTodayIndexes(many, TODAY, "09:00");
    const wide = buildCarryForward(many, buildAttentionShortlist(many, mix, TODAY, { limit: ATTENTION_MAX_LIMIT }),
      repeatedlyPostponed(many, r.range), TODAY, 99);
    ok("84.43 the carry cap cannot be raised past the shortlist ceiling (§16)",
      wide.length <= ATTENTION_MAX_LIMIT, `${wide.length}`);
    ok("84.44 one record is carried once, whatever it is guilty of",
      new Set(wide.map((c) => c.entity.id)).size === wide.length);
  }

  // ==========================================================================
  // §22 — carry-forward and next week's calendar stay structurally apart.
  // ==========================================================================
  {
    const carried = new Set(r.carryForward.map((c) => c.entity.id));
    ok("84.45 nothing is both carried and already scheduled",
      !r.scheduledNext.some((x) => carried.has(x.entity.id)),
      JSON.stringify(r.scheduledNext.map((x) => x.title)));
    ok("84.46 next week's window starts after the range ends",
      r.scheduledNext.every((x) => x.date > r.range.endKey), JSON.stringify(r.scheduledNext.map((x) => x.date)));
    ok("84.47 …and does not reach beyond seven days",
      r.scheduledNext.every((x) => x.date <= D(4 + 3)), JSON.stringify(r.scheduledNext.map((x) => x.date)));
    // A completed action with a date next week is not a commitment.
    const done = stateWith({
      ...world(),
      nextActions: [...(world().nextActions ?? []),
        act({ id: "z1", title: "Already done", dueDate: D(3), status: "completed", completedAt: A(-1, 9) })],
    });
    ok("84.48 a completed action is not on next week's list",
      !buildScheduledNext(done, r.range, TODAY).some((x) => x.id.includes("z1")));
  }

  // ==========================================================================
  // §18 — a second look is OFFERED. Nothing is ever recommended for the bin.
  // ==========================================================================
  {
    ok("84.49 three deferrals is below the reconsider threshold",
      r.reconsider.length === 0 && RECONSIDER_DEFERRALS > 3, `${RECONSIDER_DEFERRALS}`);
    const drifting = stateWith({
      ...world(),
      nextActions: [...(world().nextActions ?? []), act({
        id: "d1", title: "Learn Portuguese",
        history: [
          { id: "f0", action: "created", at: A(-20) },
          { id: "f1", action: "deferred", at: A(-3, 9), detail: D(-2) },
          { id: "f2", action: "deferred", at: A(-3, 10), detail: D(-1) },
          { id: "f3", action: "deferred", at: A(-2, 9), detail: D(1) },
          { id: "f4", action: "deferred", at: A(-1, 9), detail: D(3) },
        ],
      } as Partial<NextAction> & { id: string; title: string })],
    });
    const recon = buildReconsider(drifting, repeatedlyPostponed(drifting, r.range));
    ok("84.50 four deferrals and no due date is offered for a second look",
      titles(recon).includes("Learn Portuguese"), JSON.stringify(titles(recon)));
    ok("84.51 the sentence states BOTH facts and stops",
      /deferred this 4 times\.\s*It has no due date\./.test(recon[0]?.explanation ?? ""), recon[0]?.explanation);
    ok("84.52 it never tells the user to drop anything",
      !/drop|give up|abandon|delete|stop doing|not worth/i.test(recon.map((c) => c.explanation).join(" ")));
    // The same record WITH a due date has somewhere to land.
    const dated = stateWith({
      ...drifting,
      nextActions: (drifting.nextActions ?? []).map((a) => a.id === "d1" ? { ...a, dueDate: D(5) } : a),
    });
    ok("84.53 a due date removes it from the second-look list",
      buildReconsider(dated, repeatedlyPostponed(dated, r.range)).length === 0);
    // …and a schedule is not drift.
    const routine = stateWith({
      ...drifting,
      nextActions: (drifting.nextActions ?? []).map((a) => a.id === "d1"
        ? { ...a, recurrence: { frequency: "weekly" as const, interval: 1, weekdays: [2] } } : a),
    });
    ok("84.54 a recurring commitment is never offered for a second look",
      buildReconsider(routine, repeatedlyPostponed(routine, r.range)).length === 0);
    // …and again at the FUNCTION BOUNDARY, for the reason 84.39b gives:
    // `repeatedlyPostponed` already drops recurring work, so routed through it
    // this guard is never reached and deleting it changes nothing. Handed a
    // `PostponedItem` directly — which the exported signature permits — the
    // guard is the only thing that keeps a standing routine out.
    const routineAction = (routine.nextActions ?? []).find((a) => a.id === "d1")!;
    const handed = [{ action: routineAction, count: 4, at: [A(-3, 9), A(-3, 10), A(-2, 9), A(-1, 9)], lastAt: A(-1, 9) }];
    ok("84.54b …even when a caller hands it one directly",
      buildReconsider(routine, handed).length === 0,
      JSON.stringify(buildReconsider(routine, handed).map((c) => c.title)));
    // The identical item WITHOUT the schedule must be offered, or the assertion
    // above proves only that `buildReconsider` returns nothing.
    const noRule = [{ ...handed[0], action: { ...routineAction, recurrence: undefined } }];
    ok("84.54c …and the same record without a schedule IS offered",
      buildReconsider(routine, noRule).length === 1);
  }

  // ==========================================================================
  // §5, §13, §14, §19 — no score, no verdict, no psychologizing.
  // ==========================================================================
  {
    const blob = JSON.stringify(r).toLowerCase();
    for (const banned of ["momentumscore", "healthscore", "alignmentpercent", "alignmentscore", "productivityscore"]) {
      ok(`84.55 the model has no ${banned}`, !blob.includes(banned));
    }
    ok("84.56 no field is named score, grade, rating or percentage",
      !/"(?:[a-z]*score|grade|rating|percentage|momentum)":/i.test(JSON.stringify(r)),
      (JSON.stringify(r).match(/"[a-z]*(?:score|grade|rating|percentage|momentum)":/i) ?? [])[0]);
    // Goal lines are counts and recorded transitions. Nothing else.
    ok("84.57 a goal line carries only counts and transitions",
      r.goalReview.every((g) => Object.keys(g).sort().join(",")
        === "completedThisWeek,directionChanges,goal,noActiveProject,repeatedDeferrals"),
      JSON.stringify(Object.keys(r.goalReview[0] ?? {})));
    ok("84.58 the goal with no project reports the PREDICATE, not a verdict",
      r.goalReview.find((g) => g.goal.id === "g2")?.noActiveProject === true);

    const said = weeklyStrings(r).join(" ").toLowerCase();
    for (const word of WEEKLY_FORBIDDEN_WORDS) {
      ok(`84.59 the review never says "${word}"`, !said.includes(word.toLowerCase()), said.slice(0, 200));
    }
    // Every heading is a noun phrase about records, not an evaluation.
    ok("84.60 no heading evaluates the week",
      !/good|bad|great|poor|strong|weak|success|fail/i.test(Object.values(WEEKLY_HEADINGS).join(" ")));
  }

  // ==========================================================================
  // §25, §26 — the review PROPOSES. It never plans.
  // ==========================================================================
  {
    const before = JSON.stringify(s);
    buildWeeklyExecutiveReview(s, buildTodayIndexes(s, TODAY, "09:00"), "this_week", TODAY);
    buildCarryForward(s, buildAttentionShortlist(s, ix, TODAY, {}), repeatedlyPostponed(s, r.range), TODAY);
    buildScheduledNext(s, r.range, TODAY);
    buildReconsider(s, repeatedlyPostponed(s, r.range));
    ok("84.61 building the review mutates nothing", JSON.stringify(s) === before);
    // No carried row carries a date the review chose. The only dates present
    // are the record's own.
    ok("84.62 no carried row invents a date",
      r.carryForward.every((c) => !("newDate" in c) && !("scheduledFor" in c) && !("plannedFor" in c)));
    ok("84.63 the model exposes no write path",
      Object.values(r).every((v) => typeof v !== "function"));
  }

  // ==========================================================================
  // §28 — a week still running is not a finished week.
  // ==========================================================================
  {
    ok("84.64 this_week is marked partial", r.partial === true);
    const last = buildWeeklyExecutiveReview(s, ix, "last_week", TODAY);
    ok("84.65 last_week is not partial", last.partial === false);
    ok("84.66 the partial note says so without judging the week",
      /so far/i.test(PARTIAL_WEEK_NOTE) && !/behind|slow|little/i.test(PARTIAL_WEEK_NOTE), PARTIAL_WEEK_NOTE);
  }

  // ==========================================================================
  // §27, §32 — the boundary, and the two surfaces agreeing.
  // ==========================================================================
  {
    ok("84.67 the week starts on Monday", new Date(`${r.range.startKey}T12:00:00Z`).getUTCDay() === 1,
      r.range.startKey);
    ok("84.68 the range is the audit's measured window",
      r.range.startKey === "2026-09-07" && r.range.endKey === "2026-09-10",
      `${r.range.startKey} → ${r.range.endKey}`);
    // §32. Memory and the review must not contradict each other.
    const memory = answerMemoryQuery(s, "What happened this week?", { today: TODAY });
    ok("84.69 Memory resolves the same window as the review",
      memory.plan?.range?.startKey === r.range.startKey && memory.plan?.range?.endKey === r.range.endKey,
      `${memory.plan?.range?.startKey} → ${memory.plan?.range?.endKey}`);
  }

  // ==========================================================================
  // §36 — the questions the audit measured as unanswerable.
  // ==========================================================================
  {
    const plan = (q: string) => planMemoryQuery(q, { today: TODAY, projects: (s.projects ?? []).map((p) => ({ id: p.id, title: p.title })) });
    const ask = (q: string) => answerMemoryQuery(s, q, { today: TODAY });

    const carry = plan("What should I carry into next week?");
    ok("84.70 'what should I carry into next week?' routes",
      carry?.kind === "OPEN_WORK" && carry.guidanceAspect === "carry", `${carry?.kind}/${carry?.guidanceAspect}`);
    // The trap that made this answer "that period hasn't happened yet": the
    // sentence names a FUTURE period, and the period is the destination.
    ok("84.71 …and 'next week' is not read as a retrieval window",
      !(carry?.unresolved ?? []).some((u) => u.reason === "future_range"),
      JSON.stringify(carry?.unresolved));
    const carryA = ask("What should I carry into next week?");
    ok("84.72 …and it is answered from records", carryA.status === "ANSWERED", carryA.summary);
    ok("84.73 …saying explicitly that nothing was scheduled",
      /nothing has been scheduled/i.test(carryA.limitation ?? ""), carryA.limitation);

    const unres = plan("What remains unresolved?");
    ok("84.74 'what remains unresolved?' routes", unres?.kind === "OPEN_WORK", `${unres?.kind}`);
    // Two different questions must not share one heading.
    ok("84.75 …and is NOT answered under the carry-forward heading",
      !/carry/i.test(ask("What remains unresolved?").heading), ask("What remains unresolved?").heading);

    const rec = plan("What should I reconsider?");
    ok("84.76 'what should I reconsider?' routes",
      rec?.kind === "CHANGES" && rec.changeAspect === "reconsider", `${rec?.kind}/${rec?.changeAspect}`);
    const recA = ask("What should I reconsider?");
    ok("84.77 …and says what the offer is based on rather than inventing one",
      recA.status === "NO_RECORDED_EVIDENCE" && /deferred several times/i.test(recA.summary ?? ""), recA.summary);
    ok("84.78 …and states it is not suggesting anything be dropped",
      !/you should|drop it|give up/i.test(answerStrings(recA).join(" ")));

    const dir = plan("What changed direction?");
    ok("84.79 'what changed direction?' reads the direction slice",
      dir?.changeAspect === "direction", `${dir?.changeAspect}`);
    const dirA = ask("What changed direction?");
    // The measured defect: it summarised the whole week — completions,
    // additions, date moves — for a question about direction.
    ok("84.80 …and no longer reports completions and additions",
      !/completed \d+ item|added \d+ item|moved the date/i.test(dirA.summary ?? ""), dirA.summary);
    ok("84.81 …and reports the goal and the rule that actually moved",
      /changed direction on 1 goal/i.test(dirA.summary ?? "") && /rule/i.test(dirA.summary ?? ""), dirA.summary);
    // §32 again, at the level of content rather than dates.
    ok("84.82 Memory's direction answer matches the review's",
      dirA.items.length === r.changedDirection.length,
      `${dirA.items.length} vs ${r.changedDirection.length}`);
  }

  // ==========================================================================
  // §21, §23 — an empty week says so, and says nothing else.
  // ==========================================================================
  {
    const empty = emptyStoreState();
    const re = buildWeeklyExecutiveReview(empty, buildTodayIndexes(empty, TODAY, "09:00"), "this_week", TODAY);
    ok("84.83 an empty store produces an empty review",
      re.movedForward.length === 0 && re.carryForward.length === 0 && re.unresolved.length === 0);
    ok("84.84 …and does not invent a left-behind line", re.leftBehind === undefined, re.leftBehind);
    ok("84.85 …and never crashes on missing collections", re.base.empty === true);
    // §23. The calm line is said only when it is literally true.
    ok("84.86 the calm line is withheld while something is being carried",
      leftBehindLine(s, r.carryForward, r.scheduledNext, TODAY) === undefined);
    const calm = stateWith({
      ...emptyStoreState(),
      nextActions: [act({ id: "c1", title: "Water the plants", dueDate: D(20) })],
    });
    const line = leftBehindLine(calm, [], buildScheduledNext(calm, r.range, TODAY), TODAY);
    ok("84.87 …and never says anything can be ignored",
      !line || !/ignore|forget about|doesn't matter|not important/i.test(line), line);
  }

  // ==========================================================================
  // §33, §34 — limitations are stated, not papered over.
  // ==========================================================================
  {
    const lims = r.base.limitations.join(" ");
    ok("84.88 the project-history limitation survives", /project/i.test(lims), lims);
    // Protocols have no lifecycle history and the review must not pretend
    // otherwise by dating them from `updatedAt`.
    const withProto = stateWith({
      ...world(),
      protocols: [{
        id: "p1", trigger: "I am angry", response: "wait before replying",
        status: "active", createdAt: A(-60), updatedAt: A(-1),
      }] as StoreState["protocols"],
    });
    const rp = buildWeeklyExecutiveReview(withProto, buildTodayIndexes(withProto, TODAY, "09:00"), "this_week", TODAY);
    ok("84.89 a Protocol's updatedAt does not become a recorded change",
      !rp.changedDirection.some((c) => c.entity.kind === "protocol"),
      JSON.stringify(rp.changedDirection.map((c) => [c.kind, c.entity.kind])));
  }

  // ==========================================================================
  // §40 — cost, at a size a real store reaches.
  // ==========================================================================
  {
    const big = stateWith({
      ...emptyStoreState(),
      goals: Array.from({ length: 50 }, (_, i) => goal({ id: `bg${i}`, title: `Goal ${i}` })),
      projects: Array.from({ length: 100 }, (_, i) => proj({ id: `bp${i}`, title: `Project ${i}`, goalId: `bg${i % 50}` })),
      nextActions: Array.from({ length: 5000 }, (_, i) => act({
        id: `ba${i}`, title: `Action ${i}`, projectId: `bp${i % 100}`,
        dueDate: i % 7 === 0 ? D(-1) : undefined,
        status: i % 3 === 0 ? "completed" : "open",
        completedAt: i % 3 === 0 ? A(-2, 12) : undefined,
      } as Partial<NextAction> & { id: string; title: string })),
    });
    const bix = buildTodayIndexes(big, TODAY, "09:00");
    const t = Date.now();
    buildWeeklyExecutiveReview(big, bix, "this_week", TODAY);
    const ms = Date.now() - t;
    ok("84.90 the review builds over 5,000 actions in under 2000ms", ms < 2000, `${ms}ms`);
    const t2 = Date.now();
    for (let i = 0; i < 5; i++) buildWeeklyExecutiveReview(big, bix, "this_week", TODAY);
    ok("84.91 …and five rebuilds stay under 6000ms", Date.now() - t2 < 6000, `${Date.now() - t2}ms`);
  }

  const passed = results.filter((x) => x.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - t0,
    results,
  };
}
