/**
 * Executive memory self-tests (LIFEOS-081).
 *
 * ## What is proved here
 *
 * §31 asked for red proofs against current main, and the audit produced them by
 * running the real answer builder. Each is asserted below in the form it failed:
 *
 *   1. "what changed this week?" dropped `waiting_stopped` and `action_returned`
 *      entirely, reported nothing about goals, and printed one action twice
 *   2. "what do I keep putting off?" did not route at all
 *   3. "what rules changed this week?" returned the CURRENT code
 *   4. "what did I say mattered this week?" searched for the word "mattered"
 *   5. entity scope was extracted and then ignored
 *   6. an action created and completed in one minute produced two lines
 *
 * §31.7 is deliberately NOT a red proof. Nothing on main mislabelled recurring
 * work as postponement because nothing detected postponement at all — so the
 * recurring exclusion is asserted as a forward guard, not as a fix.
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A change model earns trust by what it refuses to claim: that an edit is a
 * change, that a horizon move is progress, that a weekly commitment is
 * avoidance, that a deleted record still has words.
 *
 * Pure: no store, no clock, no AI.
 */

import type {
  ConstitutionElement, ConstitutionRevision, Goal, NextAction, Reflection, StoreState,
} from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { resolveRange, type ResolvedRange } from "@/lib/insights/range";
import { planMemoryQuery } from "@/lib/memory/query";
import { answerMemoryQuery, answerStrings } from "@/lib/memory/answer";
import {
  buildExecutiveChanges, repeatedlyPostponed, postponedLine,
  MOVED_FORWARD_KINDS, DIRECTION_KINDS, CHANGE_FORBIDDEN_WORDS,
  PROTOCOL_CHANGE_LIMITATION, REPEATED_THRESHOLD,
  type ExecutiveChange,
} from "@/lib/memory/changes";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-03";
/** Sep 1–3 2026. `d` is the day of month, `h` the hour. */
const T = (d: number, h: number) => `2026-09-0${d}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: T(1, 9), updatedAt: T(1, 9), ...p,
} as NextAction);

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], createdAt: T(1, 8), updatedAt: T(1, 8),
  history: [], ...p,
} as Goal);

const std = (p: Partial<ConstitutionElement> & { id: string; statement: string }): ConstitutionElement => ({
  kind: "standard", status: "active", adoptedAt: T(1, 8), linkedRefs: [],
  createdAt: T(1, 8), updatedAt: T(1, 8), ...p,
} as ConstitutionElement);

const rev = (p: Partial<ConstitutionRevision> & { id: string; elementId: string; changeKind: ConstitutionRevision["changeKind"]; at: string }): ConstitutionRevision =>
  ({ ...p } as ConstitutionRevision);

const refl = (p: Partial<Reflection> & { id: string; response: string }): Reflection =>
  ({ prompt: "", createdAt: T(2, 20), annotations: [], ...p } as Reflection);

function stateWith(over: Partial<StoreState>): StoreState {
  return { ...emptyStoreState(), ...over };
}

const WEEK: ResolvedRange = resolveRange("custom", { today: TODAY, customStart: "2026-08-31", customEnd: TODAY });

/**
 * One week in a life, with every shape the sprint reasons about.
 *
 * Written from the audit's own fixture, so a reader can hold the report and the
 * suite side by side.
 */
function world(): StoreState {
  return stateWith({
    goals: [
      goal({
        // `updatedAt` is deliberately a DIFFERENT day from every transition —
        // a title edit made today. Without that, a mutation swapping
        // `history[].at` for `updatedAt` moved the horizon change by a few
        // hours and every assertion still passed. The dates must disagree for
        // the §8 rule to be provable.
        id: "g1", title: "Graduate school", horizon: "medium", updatedAt: T(3, 20),
        history: [
          { id: "h1", at: T(1, 8), kind: "created" },
          { id: "h2", at: T(2, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
        ],
      }),
      // NO history — a goal recorded before LIFEOS-078. It must contribute
      // nothing rather than contributing its `createdAt` as a transition.
      goal({ id: "g2", title: "Learn Portuguese", history: [] }),
    ],
    nextActions: [
      act({
        id: "a1", title: "Submit UH application", status: "completed", completedAt: T(2, 14),
        history: [{ id: "e1", action: "created", at: T(1, 9) }, { id: "e2", action: "completed", at: T(2, 14) }],
      } as Partial<NextAction> & { id: string; title: string }),
      // Deferred three times, with the returns between them.
      act({
        id: "a2", title: "Call admissions",
        history: [
          { id: "e3", action: "created", at: T(1, 9) },
          { id: "e4", action: "deferred", at: T(1, 10), detail: "2026-09-02" },
          { id: "e5", action: "returned", at: T(2, 8) },
          { id: "e6", action: "deferred", at: T(2, 9), detail: "2026-09-03" },
          { id: "e7", action: "returned", at: T(3, 8) },
          { id: "e8", action: "deferred", at: T(3, 9), detail: "2026-09-05" },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // A wait that ENDED inside the range.
      act({
        id: "a3", title: "Transcript request", waitingOn: "the registrar",
        history: [
          { id: "e9", action: "created", at: T(1, 9) },
          { id: "e10", action: "waiting", at: T(1, 10), detail: "the registrar" },
          { id: "e11", action: "edited", at: T(2, 16), fromStatus: "waiting", toStatus: "open" },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // WEEKLY RECURRING, and deferred three times. §15's guard.
      act({
        id: "a4", title: "Weekly lab meeting prep",
        // `weekdays`, not `daysOfWeek` — the first draft used the wrong field name,
        // `readRule` rejected it, and the §15 guard silently did not apply. The
        // assertion caught it, which is the point of asserting the negative.
        recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
        history: [
          { id: "e12", action: "created", at: T(1, 9) },
          { id: "e13", action: "deferred", at: T(1, 12), detail: "2026-09-02" },
          { id: "e14", action: "deferred", at: T(2, 12), detail: "2026-09-03" },
          { id: "e15", action: "deferred", at: T(3, 12), detail: "2026-09-04" },
        ],
      } as Partial<NextAction> & { id: string; title: string }),
      // Created AND completed in the same minute — §23's case.
      act({
        id: "a5", title: "Email the department", status: "completed",
        createdAt: T(3, 15), completedAt: T(3, 15),
        history: [{ id: "e16", action: "created", at: T(3, 15) }, { id: "e17", action: "completed", at: T(3, 15) }],
      } as Partial<NextAction> & { id: string; title: string }),
      // An OLD due date and no deferral at all. §13: not postponement.
      act({ id: "a6", title: "Renew passport", dueDate: "2026-07-01", history: [{ id: "e18", action: "created", at: T(1, 9) }] } as Partial<NextAction> & { id: string; title: string }),
    ],
    constitutionElements: [
      std({ id: "s1", statement: "Protect sleep before optional work.", adoptedAt: T(2, 12) }),
      std({ id: "s2", statement: "Never work at weekends.", status: "retired", retiredAt: T(3, 10) }),
      std({ id: "s3", statement: "Tell the truth even when it costs me." }),
      // A VALUE, not a rule. Personal Code is standards; this must not appear.
      std({ id: "v1", kind: "value", statement: "Truth matters more than image." }),
    ],
    constitutionRevisions: [
      rev({ id: "r1", elementId: "s1", changeKind: "adopted", at: T(2, 12) }),
      rev({ id: "r2", elementId: "s2", changeKind: "retired", at: T(3, 10) }),
      // An EDIT — wording corrected, position unchanged. Must never be a change.
      rev({ id: "r3", elementId: "s3", changeKind: "edited", at: T(2, 13) }),
      // A REVISION — the position itself moved, and both wordings are recorded.
      rev({
        id: "r4", elementId: "s3", changeKind: "revised", at: T(3, 11),
        previousStatement: "Tell the truth when it is easy.",
        newStatement: "Tell the truth even when it costs me.",
      }),
      rev({ id: "r5", elementId: "v1", changeKind: "adopted", at: T(2, 14) }),
      // A revision whose element was DELETED. §26.
      rev({ id: "r6", elementId: "gone", changeKind: "retired", at: T(2, 15) }),
    ],
    protocols: [{ id: "p1", trigger: "I am angry", response: "wait before replying", status: "active", createdAt: T(1, 8), updatedAt: T(3, 11) }],
    reflections: [refl({ id: "rf1", response: "I think I care more about philosophy than teaching." })],
    notes: [{
      id: "n1", body: "AI summary of your week: you were productive.", fromAiText: true,
      archived: false, tags: [], linkedEntityRefs: [], createdAt: T(3, 7), updatedAt: T(3, 7),
    }] as StoreState["notes"],
    recurrenceCompletions: [],
  });
}

export function runExecutiveMemorySelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  // `detail` accepts undefined because half of what is worth printing on a
  // failure — a summary, a limitation — is optional on `MemoryAnswer`.
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const changes = buildExecutiveChanges(s, WEEK);
  const kinds = (cs: ExecutiveChange[]) => cs.map((c) => c.kind);
  const of = (kind: string) => changes.filter((c) => c.kind === kind);
  const ask = (q: string) => answerMemoryQuery(s, q, { today: TODAY });

  // ------------------------------------------------------------------------
  // §31.1 RED — recorded changes that were dropped entirely.
  // ------------------------------------------------------------------------

  ok("81.1 a wait ending is a change", of("waiting_ended").length === 1, JSON.stringify(kinds(changes)));
  ok("81.2 …naming the record", of("waiting_ended")[0]?.title === "Transcript request");
  ok("81.3 a deferral coming back is a change", of("returned").length === 2);
  ok("81.4 a goal horizon move is a change", of("goal_horizon_changed").length === 1);
  ok("81.5 …with both ends of the transition", of("goal_horizon_changed")[0]?.from === "Near" && of("goal_horizon_changed")[0]?.to === "Medium",
    JSON.stringify([of("goal_horizon_changed")[0]?.from, of("goal_horizon_changed")[0]?.to]));
  ok("81.6 …traced to the history entry", of("goal_horizon_changed")[0]?.evidence === "goal.history[].toHorizon");
  // §8. THE rule of this sprint: the transition is dated by the recorded event,
  // never by `updatedAt`. The goal was edited on the 3rd and its horizon moved
  // on the 2nd, so the two dates disagree and only one of them is right.
  ok("81.6b …and dated by the transition, not by updatedAt",
    of("goal_horizon_changed")[0]?.occurredAt === T(2, 10), String(of("goal_horizon_changed")[0]?.occurredAt));
  ok("81.6c …on the day it actually happened",
    of("goal_horizon_changed")[0]?.day === "2026-09-02", String(of("goal_horizon_changed")[0]?.day));
  {
    // A range covering only the day the goal was EDITED must not contain it.
    const editDay = resolveRange("custom", { today: TODAY, customStart: "2026-09-03", customEnd: "2026-09-03" });
    ok("81.6d …and absent from a range covering only the edit",
      !buildExecutiveChanges(s, editDay).some((c) => c.kind === "goal_horizon_changed"));
    const moveDay = resolveRange("custom", { today: TODAY, customStart: "2026-09-02", customEnd: "2026-09-02" });
    ok("81.6e …and present in a range covering the transition",
      buildExecutiveChanges(s, moveDay).some((c) => c.kind === "goal_horizon_changed"));
  }
  ok("81.7 a rule adoption is a change", of("rule_adopted").length === 1);
  ok("81.8 a rule retirement is a change", of("rule_retired").length === 1);
  ok("81.9 a rule revision is a change", of("rule_revised").length === 1);

  // ------------------------------------------------------------------------
  // §9, §4 — an edit is not a change, and direction is not progress.
  // ------------------------------------------------------------------------

  ok("81.10 an `edited` revision is not a change",
    !changes.some((c) => c.evidence === "constitutionRevisions[].edited"),
    JSON.stringify(changes.map((c) => c.evidence).filter((e) => e.startsWith("constitution"))));
  ok("81.11 a goal with no history contributes nothing",
    !changes.some((c) => c.entity.id === "g2"), JSON.stringify(changes.filter((c) => c.entity.id === "g2")));
  ok("81.12 …so createdAt is never used as a transition",
    !changes.some((c) => c.entity.kind === "goal" && c.evidence.includes("createdAt")));
  ok("81.13 a horizon change is NOT moved-forward",
    !(MOVED_FORWARD_KINDS as string[]).includes("goal_horizon_changed"));
  ok("81.14 …it is a change of direction", (DIRECTION_KINDS as string[]).includes("goal_horizon_changed"));
  ok("81.15 the two sets never overlap",
    !MOVED_FORWARD_KINDS.some((k) => (DIRECTION_KINDS as string[]).includes(k)));
  ok("81.16 nothing traces to updatedAt",
    !changes.some((c) => c.evidence.toLowerCase().includes("updatedat")),
    JSON.stringify(changes.map((c) => c.evidence)));

  // ------------------------------------------------------------------------
  // §16, §25, §26 — Personal Code.
  // ------------------------------------------------------------------------

  ok("81.17 a VALUE is not a Personal Code change",
    !changes.some((c) => c.entity.id === "v1"), JSON.stringify(changes.filter((c) => c.entity.id === "v1")));
  // §25: the words as they were, not as they are now.
  ok("81.18 a revision shows the wording at the time",
    of("rule_revised")[0]?.title === "Tell the truth when it is easy.", String(of("rule_revised")[0]?.title));
  ok("81.19 …and names what it became",
    of("rule_revised")[0]?.to === "Tell the truth even when it costs me.");
  // §26: a deleted element has no words to show and no id to print.
  const deleted = changes.filter((c) => c.entity.id === "gone");
  ok("81.20 a deleted rule degrades gracefully", deleted.length === 0 || !/gone/.test(deleted[0].title), JSON.stringify(deleted.map((c) => c.title)));
  ok("81.21 no raw id appears in any title",
    !changes.some((c) => /^[0-9a-f]{8}-|^(a|g|s|r|e|v)\d+$/.test(c.title)),
    JSON.stringify(changes.map((c) => c.title)));

  // ------------------------------------------------------------------------
  // §23 — deduplication, the rule Week Review had and Memory did not.
  // ------------------------------------------------------------------------

  const a5 = changes.filter((c) => c.entity.id === "a5");
  ok("81.22 created and completed in one minute is ONE change", a5.length === 1, JSON.stringify(kinds(a5)));
  ok("81.23 …and it is the completion", a5[0]?.kind === "completed");
  const a1 = changes.filter((c) => c.entity.id === "a1");
  ok("81.24 created one day and completed the next is TWO", a1.length === 2, JSON.stringify(kinds(a1)));
  ok("81.25 …because they are two real days",
    new Set(a1.map((c) => c.day)).size === 2);

  // ------------------------------------------------------------------------
  // §7 — bounded range.
  // ------------------------------------------------------------------------

  const narrow = resolveRange("custom", { today: TODAY, customStart: "2026-09-03", customEnd: "2026-09-03" });
  const day3 = buildExecutiveChanges(s, narrow);
  ok("81.26 a bounded range excludes earlier changes",
    day3.every((c) => c.day === "2026-09-03"), JSON.stringify(day3.map((c) => c.day)));
  ok("81.27 …and it is not empty", day3.length > 0);
  ok("81.28 the goal horizon move is outside a day-3 range",
    !day3.some((c) => c.kind === "goal_horizon_changed"));
  ok("81.29 the rule retirement is inside it", day3.some((c) => c.kind === "rule_retired"));

  // ------------------------------------------------------------------------
  // §24 — ordering.
  // ------------------------------------------------------------------------

  ok("81.30 changes are ordered by when they happened",
    changes.every((c, i) => i === 0 || changes[i - 1].occurredAt <= c.occurredAt));
  const twice = buildExecutiveChanges(s, WEEK);
  ok("81.31 …and the order is stable across builds",
    twice.map((c) => c.id).join("|") === changes.map((c) => c.id).join("|"));
  ok("81.32 ids are stable derived keys, not random",
    twice.every((c, i) => c.id === changes[i].id));

  // ------------------------------------------------------------------------
  // §14, §15 — repeated postponement.
  // ------------------------------------------------------------------------

  const postponed = repeatedlyPostponed(s, WEEK);
  ok("81.33 repeated deferral is detected", postponed.length === 1, JSON.stringify(postponed.map((p) => p.action.title)));
  ok("81.34 …on the right record", postponed[0]?.action.id === "a2");
  ok("81.35 …with the recorded count", postponed[0]?.count === 3, String(postponed[0]?.count));
  ok("81.36 …and the instants behind it", postponed[0]?.at.length === 3);

  // THE §15 guard. The recurring action was deferred three times too.
  ok("81.37 recurring work is never repeated postponement",
    !postponed.some((p) => p.action.id === "a4"), JSON.stringify(postponed.map((p) => p.action.id)));
  ok("81.38 …even though it has the same deferral count",
    (world().nextActions.find((a) => a.id === "a4")?.history ?? []).filter((h) => h.action === "deferred").length === 3);

  // §13: an old due date is not a deferral.
  ok("81.39 an overdue task was never deferred", !postponed.some((p) => p.action.id === "a6"));
  ok("81.40 the threshold needs more than one", REPEATED_THRESHOLD === 2);
  ok("81.41 a single deferral is not repeated", repeatedlyPostponed(s, WEEK, 4).length === 0);
  ok("81.42 the wording is a count, not a verdict", postponedLine(postponed[0]) === "You deferred this 3 times.");
  ok("81.43 …and says nothing about the person",
    !CHANGE_FORBIDDEN_WORDS.some((w) => postponedLine(postponed[0]).toLowerCase().includes(w)));

  // ------------------------------------------------------------------------
  // §18 — routing. Each was measured returning the wrong class, or none.
  // ------------------------------------------------------------------------

  const plan = (q: string) => planMemoryQuery(q, { today: TODAY, projects: [] });

  ok("81.44 'what changed this week' routes to CHANGES", plan("What changed this week?")?.kind === "CHANGES");
  ok("81.45 …with the plain aspect", plan("What changed this week?")?.changeAspect === "all");
  ok("81.46 'what do I keep putting off' routes", plan("What do I keep putting off?")?.kind === "CHANGES");
  ok("81.47 …as a postponement question", plan("What do I keep putting off?")?.changeAspect === "postponed");
  ok("81.48 'what did I defer this week' routes", plan("What did I defer this week?")?.kind === "CHANGES");
  ok("81.49 …as a deferral question", plan("What did I defer this week?")?.changeAspect === "deferred");
  ok("81.50 'what did I stop waiting on' routes to CHANGES", plan("What did I stop waiting on this week?")?.kind === "CHANGES");
  ok("81.51 …as a historical waiting question", plan("What did I stop waiting on this week?")?.changeAspect === "waiting_ended");
  ok("81.52 'what rules changed' routes to CHANGES", plan("What rules changed this week?")?.kind === "CHANGES");
  ok("81.53 …as a rules question", plan("What rules changed this week?")?.changeAspect === "rules");
  ok("81.54 'what did I move forward' routes", plan("What did I move forward this week?")?.changeAspect === "forward");
  ok("81.55 'what keeps coming back' routes", plan("What keeps coming back?")?.changeAspect === "postponed");

  // The classes these must NOT steal. §12's distinction, and 079's RULES class.
  ok("81.56 'what am I waiting on' is still current state", plan("What am I waiting on?")?.kind === "WAITING");
  ok("81.57 'what rules do I live by' is still RULES", plan("What rules do I live by?")?.kind === "RULES");
  ok("81.58 'what standards have I chosen' is still RULES", plan("What standards have I chosen for myself?")?.kind === "RULES");
  ok("81.59 'what did I finish' is still COMPLETION", plan("What did I finish last week?")?.kind === "COMPLETION");
  ok("81.60 'what am I working toward' is still GOALS", plan("What am I working toward?")?.kind === "GOALS");

  // ------------------------------------------------------------------------
  // §20 — the answer.
  // ------------------------------------------------------------------------

  {
    const a = ask("What changed this week?");
    ok("81.61 the week question is answered", a.status === "ANSWERED", a.status);
    const texts = a.items.map((i) => i.text);
    ok("81.62 …and reports the wait that ended", texts.includes("Transcript request"));
    ok("81.63 …and the goal that changed direction", texts.includes("Graduate school"));
    ok("81.64 …and the rules that changed", texts.includes("Protect sleep before optional work."));
    ok("81.65 …without listing one action twice",
      texts.filter((t) => t === "Email the department").length === 1,
      JSON.stringify(texts));
    ok("81.66 …and the summary names the direction change",
      /changed direction on 1 goal/.test(a.summary ?? ""), a.summary);
    ok("81.67 …and never calls it progress",
      !/moved forward.*goal|progress/i.test(a.summary ?? ""), a.summary);
  }

  {
    const a = ask("What rules changed this week?");
    ok("81.68 the rules question answers about CHANGES, not the current code",
      a.status === "ANSWERED" && a.items.length === 3, `${a.status} ${a.items.length}`);
    ok("81.69 …naming the adoption", a.items.some((i) => i.evidence === "constitutionRevisions[].adopted"));
    ok("81.70 …the retirement", a.items.some((i) => i.evidence === "constitutionRevisions[].retired"));
    ok("81.71 …the revision", a.items.some((i) => i.evidence === "constitutionRevisions[].revised"));
    ok("81.72 …and carrying the Protocol limitation",
      (a.limitation ?? "").includes(PROTOCOL_CHANGE_LIMITATION), a.limitation ?? "");
    ok("81.73 …and no rule count from current state", !/in force/.test(a.summary ?? ""), a.summary);
  }

  {
    const a = ask("What did I stop waiting on this week?");
    ok("81.74 the historical waiting question is answered", a.status === "ANSWERED", a.status);
    ok("81.75 …with the episode, not the current state",
      a.items.length === 1 && a.items[0].text === "Transcript request", JSON.stringify(a.items.map((i) => i.text)));
    ok("81.76 …headed as the question was asked", /stopped waiting/i.test(a.heading ?? ""), a.heading);
  }

  {
    const a = ask("What did I defer this week?");
    ok("81.77 the deferral question is answered", a.status === "ANSWERED");
    ok("81.78 …and does not count returns as deferrals",
      a.items.every((i) => !i.evidence.includes("returned")), JSON.stringify(a.items.map((i) => i.evidence)));
    // TWO records were deferred — "Call admissions" and the recurring "Weekly
    // lab meeting prep". A recurring item IS deferrable and its deferrals are
    // real; what §15 forbids is calling them repeated postponement, which is a
    // different question and asserted separately at 81.83.
    ok("81.79 …counting records, not events, in the summary",
      /on 2 items/.test(a.summary ?? ""), a.summary);
    ok("81.79b …though six deferral events lie behind them",
      a.items.length === 6, String(a.items.length));
  }

  {
    const a = ask("What do I keep putting off?");
    ok("81.80 the postponement question is answered", a.status === "ANSWERED", a.status);
    ok("81.81 …naming the deferred item", a.items.some((i) => i.text === "Call admissions"));
    ok("81.82 …with the factual count", a.items.some((i) => i.detail === "You deferred this 3 times."));
    ok("81.83 …never the recurring one", !a.items.some((i) => i.text === "Weekly lab meeting prep"));
    ok("81.84 …and saying recurring work is excluded",
      /repeating schedule/i.test(a.limitation ?? ""), a.limitation ?? "");
  }

  // §19 — entity scope.
  {
    const a = ask("What changed with my graduate school goal?");
    ok("81.85 an entity-scoped question is scoped", a.status === "ANSWERED", a.status);
    ok("81.86 …to that record only",
      a.items.every((i) => i.ref?.id === "g1"), JSON.stringify(a.items.map((i) => [i.ref?.kind, i.ref?.id])));
    ok("81.87 …and says which one", /Graduate school/.test(a.heading ?? ""), a.heading);
  }
  {
    // Neither title matches exactly, so the person picks. §19.
    const ambiguous = stateWith({
      goals: [
        goal({ id: "x1", title: "Graduate school applications", history: [{ id: "hx", at: T(2, 10), kind: "created" }] }),
        goal({ id: "x2", title: "Graduate school funding", history: [{ id: "hy", at: T(2, 11), kind: "created" }] }),
      ],
    });
    const a = answerMemoryQuery(ambiguous, "What changed with graduate school this week?", { today: TODAY });
    ok("81.88 an ambiguous entity asks rather than picks", a.status === "NEEDS_CHOICE", a.status);
    ok("81.89 …offering both", (a.choices ?? []).length === 2, JSON.stringify((a.choices ?? []).map((c) => c.title)));
  }

  // §20 — no empty sections, and moved-forward holds only completions.
  {
    const a = ask("What did I move forward this week?");
    ok("81.90 moved-forward holds only completions",
      a.items.every((i) => /completedAt|occurrenceDate/.test(i.evidence)), JSON.stringify(a.items.map((i) => i.evidence)));
    ok("81.91 …and no goal edit", !a.items.some((i) => i.evidence.includes("toHorizon")));
  }

  // ------------------------------------------------------------------------
  // §17 — reflections and provenance.
  // ------------------------------------------------------------------------

  {
    const a = ask("What did I say mattered this week?");
    ok("81.92 a topicless question is answered by range", a.items.length > 0, a.status);
    ok("81.93 …finding the reflection that never says 'mattered'",
      a.items.some((i) => i.text.includes("philosophy")), JSON.stringify(a.items.map((i) => i.text)));
    const said = a.items.filter((i) => i.attribution === "You said");
    ok("81.94 …attributed to the user", said.length === 1, JSON.stringify(a.items.map((i) => i.attribution)));
    // THE provenance boundary. An AI note is in range and must not be "you said".
    ok("81.95 …and never says 'you said' about AI text",
      !said.some((i) => i.text.includes("AI summary")), JSON.stringify(said.map((i) => i.text)));
    ok("81.96 …the AI note is listed as machine-written",
      a.items.some((i) => i.text.includes("AI summary") && i.attribution !== "You said"));
    ok("81.97 …and the heading does not claim a topic",
      !/mattered/.test(a.heading ?? ""), a.heading);
    ok("81.98 …nor the summary", !/mattered/.test(a.summary ?? ""), a.summary);
  }
  {
    // A real topic still searches. The topicless path must not swallow it.
    const a = ask("What did I say about philosophy this week?");
    ok("81.99 a real topic is still searched",
      a.items.some((i) => i.text.includes("philosophy")), JSON.stringify(a.items.map((i) => i.text)));
    ok("81.100 …and the heading names it", /philosophy/.test(a.heading ?? ""), a.heading);
  }

  // ------------------------------------------------------------------------
  // §21, §22 — facts, never interpretation.
  // ------------------------------------------------------------------------

  {
    const strings = [
      ...["What changed this week?", "What do I keep putting off?", "What rules changed this week?",
        "What did I defer this week?", "What did I stop waiting on this week?"]
        .flatMap((q) => answerStrings(ask(q))),
    ].join(" ").toLowerCase();
    ok("81.101 nothing psychologizes the user",
      !CHANGE_FORBIDDEN_WORDS.some((w) => strings.includes(w)),
      CHANGE_FORBIDDEN_WORDS.filter((w) => strings.includes(w)).join(", "));
    ok("81.102 …and no week is narrated as a story",
      !/transformative|remarkable|great week|tough week/i.test(strings));
  }

  // ------------------------------------------------------------------------
  // §29 — performance. Bounded ranges over realistic sizes.
  // ------------------------------------------------------------------------

  for (const n of [100, 1000, 5000]) {
    const big = stateWith({
      nextActions: Array.from({ length: n }, (_, i) => act({
        id: `b${i}`, title: `Task ${i}`,
        createdAt: T(1, 9), updatedAt: T(1, 9),
        history: [
          { id: `bc${i}`, action: "created", at: T(1, 9) },
          { id: `bd${i}`, action: "deferred", at: T(2, 9), detail: "2026-09-04" },
          { id: `be${i}`, action: "deferred", at: T(3, 9), detail: "2026-09-05" },
        ],
      } as Partial<NextAction> & { id: string; title: string })),
      goals: Array.from({ length: Math.floor(n / 10) }, (_, i) => goal({
        id: `bg${i}`, title: `Goal ${i}`,
        history: [{ id: `bgh${i}`, at: T(2, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" }],
      })),
    });
    const t = Date.now();
    const built = buildExecutiveChanges(big, WEEK);
    const post = repeatedlyPostponed(big, WEEK);
    const ms = Date.now() - t;
    ok(`81.103.${n} ${n} entities: changes + postponement under 2500ms`, ms < 2500, `${ms}ms, ${built.length} changes, ${post.length} postponed`);
    ok(`81.104.${n} …and the range still bounds it`, built.every((c) => c.day >= "2026-08-31" && c.day <= TODAY));
  }
  {
    // Entity scope must not cost a full scan per query.
    const big = stateWith({
      goals: Array.from({ length: 500 }, (_, i) => goal({
        id: `s${i}`, title: `Goal ${i}`,
        history: [{ id: `sh${i}`, at: T(2, 10), kind: "created" }],
      })),
    });
    const t = Date.now();
    for (let i = 0; i < 50; i++) buildExecutiveChanges(big, WEEK, { entity: { kind: "goal", id: `s${i}` } });
    const ms = Date.now() - t;
    ok("81.105 50 entity-scoped builds over 500 goals under 2000ms", ms < 2000, `${ms}ms`);
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
