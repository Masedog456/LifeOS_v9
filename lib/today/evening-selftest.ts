/**
 * Evening close self-tests (LIFEOS-091).
 *
 * ## The reds this suite pins
 *
 * §2's audit ran the real builders over a realistic full day and found the day
 * running behind the week:
 *
 *   1. every completion printed TWICE — once under Done, once under Changed,
 *      because `COMPLETION_KINDS` and `CHANGE_KINDS` overlap
 *   2. no Goal or Project movement anywhere, though 081 already derives it
 *   3. no carry-forward at all — and 084's version, reused naively, proposes
 *      carrying work that is ALREADY dated tomorrow
 *   4. the repeated-deferral sentence needs two windows and had neither
 *   5. a resolved wait filed as a "change" rather than as something done
 *   6. Still open ran to eight rows on a dense day against a budget of three
 *   7. goal horizon changes, achieved goals and adopted rules were invisible —
 *      twelve provable changes, six shown
 *   8. the whole surface spoke in weeks on a page about one day
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A review earns trust by what it refuses to claim: that changing your mind is
 * progress, that a rescheduled deadline is a deferral, that a machine's
 * sentence is something you said, that work already on tomorrow needs carrying
 * there, that a quiet day is a shortfall — and above all, that it may move
 * anything at all without being asked.
 *
 * Pure: no store, no clock, no AI.
 */

import type { NextAction, StoreState, Goal } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildExecutiveChanges, MOVED_FORWARD_KINDS, DIRECTION_KINDS } from "@/lib/memory/changes";
import { buildAttentionShortlist } from "@/lib/guidance/attention";
import { resolveRange } from "@/lib/insights/range";
import { isMachineProduced } from "@/lib/provenance";
import { addDays } from "@/lib/reviews/dates";
import {
  buildEveningClose, calmSummaryLine, deferralLine, movementLine,
  eveningHeading, eveningStrings, previousDay,
  QUIET_DAY, MEMORY_PROMPT, MEMORY_PROMPT_HINT, CARRY_FORWARD_NOTE,
  TOMORROW_SCHEDULED_HEADING, CARRY_FORWARD_HEADING, EVENING_FORBIDDEN_WORDS,
  type EveningClose,
} from "@/lib/today/evening";

// A Wednesday, so "the rest of the week" and "tomorrow" are both non-trivial.
const TODAY = "2026-09-09";
const TOMORROW = "2026-09-10";
const FRIDAY = "2026-09-11";

const D = (k: string, h = 9, m = 0) =>
  `${k}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: D("2026-09-08"), updatedAt: D(TODAY, 18), ...p,
} as NextAction);

const h = (action: string, at: string, extra: Record<string, unknown> = {}) =>
  ({ action, at, ...extra }) as NextAction["history"][number];

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
  createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"), ...p,
} as Goal);

/**
 * The audit's day, as a fixture.
 *
 * Every field name here was checked against the schema first: `goal.history[]`
 * uses `kind`/`fromHorizon`/`toHorizon` (not `action`/`from`/`to`), leaving a
 * wait is an `edited` event carrying `fromStatus: "waiting"` (there is no
 * `waiting_ended` action), and a revision uses `changeKind`. The first draft of
 * the audit used the plausible names instead and reported three product defects
 * that did not exist.
 */
function world(): StoreState {
  const s = emptyStoreState();
  s.goals = [
    goal({ id: "g-grad", title: "Graduate school", priority: "high" }),
    goal({ id: "g-clinic", title: "Open the clinic", horizon: "long",
      history: [{ id: "gh1", kind: "horizon", at: D(TODAY, 11), fromHorizon: "medium", toHorizon: "long" }] }),
    goal({ id: "g-move", title: "Move out of the flat", status: "completed", horizon: "near",
      history: [{ id: "gh2", kind: "status", at: D(TODAY, 16), fromStatus: "active", toStatus: "completed" }] }),
  ];
  s.projects = [{
    id: "p-apps", title: "Graduate applications", goalId: "g-grad", description: "",
    status: "active", priority: "high", notes: "", milestones: [],
    relatedDocuments: [], relatedEntities: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  } as StoreState["projects"][number]];

  s.nextActions = [
    act({ id: "a-send", title: "Send application", projectId: "p-apps", status: "completed",
      completedAt: D(TODAY, 14), dueDate: TODAY,
      history: [h("created", D("2026-09-08")), h("completed", D(TODAY, 14), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "a-stmt", title: "Draft personal statement", projectId: "p-apps", status: "completed",
      completedAt: D(TODAY, 10),
      history: [h("created", D("2026-09-01")), h("completed", D(TODAY, 10), { fromStatus: "in_progress", toStatus: "completed" })] }),
    act({ id: "a-rec", title: "Request recommendation", projectId: "p-apps", status: "deferred",
      deferredUntil: TOMORROW,
      history: [h("created", D("2026-08-20")), h("deferred", D("2026-09-04", 17)),
        h("returned", D("2026-09-05", 6)), h("deferred", D("2026-09-07", 18)),
        h("returned", D("2026-09-08", 6)), h("deferred", D(TODAY, 19))] }),
    act({ id: "a-dentist", title: "Dentist", dueDate: FRIDAY,
      history: [h("created", D("2026-09-02")), h("due_set", D(TODAY, 12), { detail: FRIDAY })] }),
    act({ id: "a-transcript", title: "Transcript from Maria", projectId: "p-apps",
      history: [h("created", D("2026-08-25")),
        h("waiting", D("2026-08-27", 9), { detail: "Maria", fromStatus: "open", toStatus: "waiting" }),
        h("edited", D(TODAY, 15), { detail: "Maria", fromStatus: "waiting", toStatus: "open" })] }),
    act({ id: "a-lease", title: "Lease approval", status: "waiting", waitingOn: "Marcus",
      waitingSince: D("2026-09-01"), followUpDate: FRIDAY,
      history: [h("created", D("2026-09-01")),
        h("waiting", D("2026-09-01", 9), { detail: "Marcus", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-final", title: "Send final draft", projectId: "p-apps", dueDate: TODAY,
      history: [h("created", D("2026-09-03"))] }),
    act({ id: "a-legal", title: "Need legal review", history: [h("created", D("2026-09-03"))] }),
    act({ id: "a-fee", title: "Pay the application fee", projectId: "p-apps", dueDate: "2026-09-06",
      history: [h("created", D("2026-08-30"))] }),
    act({ id: "a-submit", title: "Submit the second application", projectId: "p-apps", dueDate: TOMORROW,
      history: [h("created", D("2026-09-05"))] }),
    act({ id: "a-plants", title: "Water the plants", dueDate: TODAY,
      recurrence: { frequency: "weekly", interval: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      history: [h("created", D("2026-07-01"))] }),
    act({ id: "a-someday", title: "Read the funding guide", history: [h("created", D("2026-08-15"))] }),
    // Completed today and linked to NOTHING. §7 says movement is completed
    // LINKED work; without an unlinked completion in the day, dropping the link
    // test changes no output and the mutation walks straight through.
    act({ id: "a-loose", title: "Cancel the gym membership", status: "completed",
      completedAt: D(TODAY, 9),
      history: [h("created", D("2026-09-02")), h("completed", D(TODAY, 9), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "a-drop", title: "Apply to the fifth school", projectId: "p-apps", status: "cancelled",
      history: [h("created", D("2026-08-10")), h("cancelled", D(TODAY, 13), { fromStatus: "open", toStatus: "cancelled" })] }),
  ];
  s.actionDependencies = [{ id: "dep1", blockedId: "a-final", blockerId: "a-legal", createdAt: D("2026-09-03") }];
  s.recurrenceCompletions = [{ id: "rc1", actionId: "a-plants", occurrenceDate: TODAY, completedAt: D(TODAY, 8) }];
  s.events = [
    { id: "e-dentist", title: "Dentist", date: TOMORROW, startTime: "10:00", allDay: false,
      createdAt: D("2026-09-02"), updatedAt: D("2026-09-02") } as StoreState["events"][number],
  ];
  s.reflections = [{
    id: "r1", prompt: "What stood out today?",
    response: "The statement finally sounds like me rather than a form.",
    createdAt: D(TODAY, 21), annotations: [],
  } as StoreState["reflections"][number]];
  s.notes = [
    { id: "n1", title: "Fee waiver", body: "Ask the department whether the fee waiver still applies.",
      createdAt: D(TODAY, 17), updatedAt: D(TODAY, 17), tags: [], linkedEntityRefs: [] } as StoreState["notes"][number],
    // Machine prose, attributed in its own text — which is how the marker
    // survives export, re-import and sync (LIFEOS-050A).
    { id: "n2", title: "Summary",
      body: "_AI-generated — Summary of this project:_\n\nGenerated overview of the application timeline.",
      createdAt: D(TODAY, 17, 30), updatedAt: D(TODAY, 17, 30), tags: [], linkedEntityRefs: [] } as StoreState["notes"][number],
  ];
  s.constitutionElements = [{
    id: "c1", kind: "standard", statement: "I send one application per week.",
    status: "active", createdAt: D(TODAY, 20), updatedAt: D(TODAY, 20),
  } as StoreState["constitutionElements"][number]];
  s.constitutionRevisions = [{
    id: "cr1", elementId: "c1", changeKind: "adopted", at: D(TODAY, 20),
    newStatement: "I send one application per week.", evidenceRefs: [],
  } as StoreState["constitutionRevisions"][number]];
  return s;
}

function close(s: StoreState, date = TODAY, today = TODAY): EveningClose {
  return buildEveningClose(s, buildTodayIndexes(s, date), { date, today, offsetMinutes: 0 });
}

export function runEveningCloseSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  const s = world();
  const c = close(s);
  const ids = (xs: { entity?: { id: string }; recordRef?: { id: string } }[]) =>
    xs.map((x) => x.entity?.id ?? x.recordRef?.id ?? "");

  // ---- §6. DONE is completion, and nothing else -------------------------
  ok("91.1 §6 completed work is listed",
    ids(c.completed).sort().join(",") === "a-loose,a-send,a-stmt", ids(c.completed).join(","));
  ok("91.2 §6 …and a created record is not a completion",
    !ids(c.completed).includes("a-fee"));
  ok("91.3 §6 …nor a cancelled one",
    !ids(c.completed).includes("a-drop"));
  ok("91.4 §6 …nor a rescheduled one",
    !ids(c.completed).includes("a-dentist"));
  ok("91.5 §6, §12 a wait that ENDED today is done, not merely changed",
    ids(c.waitingResolved).includes("a-transcript"), ids(c.waitingResolved).join(","));
  ok("91.6 §6 …and it is not ALSO filed as a change",
    !ids(c.changed).includes("a-transcript"), ids(c.changed).join(","));

  // ---- RED 1. One fact, one row -----------------------------------------
  //
  // The measured defect: `COMPLETION_KINDS ⊂ CHANGE_KINDS`, so the old surface
  // printed "Send application — Completed" under Done and again under Changed.
  ok("91.7 RED 1 a completion is never repeated under Changed",
    !ids(c.changed).includes("a-send") && !ids(c.changed).includes("a-stmt"),
    ids(c.changed).join(","));
  {
    const buckets: Record<string, string[]> = {
      done: ids(c.completed).concat(ids(c.waitingResolved)),
      changed: ids(c.changed),
      deferred: c.deferred.map((d) => d.change.entity.id),
      rescheduled: ids(c.rescheduled),
      direction: ids(c.changedDirection),
      words: ids(c.reflections),
    };
    const seen = new Map<string, string[]>();
    for (const [b, list] of Object.entries(buckets)) {
      for (const id of list) seen.set(id, [...(seen.get(id) ?? []), b]);
    }
    const dupes = [...seen.entries()].filter(([, bs]) => bs.length > 1);
    ok("91.8 RED 1 no record appears in two historical sections at once",
      dupes.length === 0, dupes.map(([id, bs]) => `${id}:${bs.join("+")}`).join(" | "));
  }

  // ---- §7, §28. Movement is completed linked work, and nothing else ------
  ok("91.9 §28 a goal with completed linked work is named",
    c.movedForward.some((m) => m.goal.id === "g-grad"),
    c.movedForward.map((m) => m.goal.id).join(","));
  ok("91.10 §28 …with the count of linked completions",
    c.movedForward.find((m) => m.goal.id === "g-grad")?.completed === 2,
    String(c.movedForward.find((m) => m.goal.id === "g-grad")?.completed));
  ok("91.11 §28 …stated as records, never as a percentage or a score",
    movementLine({ goal: s.goals[0], completed: 2, changes: [] }) === "2 linked actions completed",
    movementLine({ goal: s.goals[0], completed: 2, changes: [] }));
  ok("91.12 §7 a HORIZON change is never movement",
    !c.movedForward.some((m) => m.goal.id === "g-clinic"),
    c.movedForward.map((m) => m.goal.id).join(","));
  ok("91.13 §7 …and no goal moved forward without a completion behind it",
    c.movedForward.every((m) => m.changes.length === m.completed && m.completed > 0));
  ok("91.14 §7 …every underlying change is a completion kind",
    c.movedForward.every((m) => m.changes.every((x) => (MOVED_FORWARD_KINDS as string[]).includes(x.kind))));
  ok("91.14a §7 a completion linked to NOTHING is not goal movement",
    !c.movedForward.some((m) => m.changes.some((x) => x.entity.id === "a-loose")),
    c.movedForward.map((m) => `${m.goal.id}:${m.changes.map((x) => x.entity.id).join("+")}`).join(" | "));
  ok("91.14b §7 …though it is still listed as done",
    ids(c.completed).includes("a-loose"), ids(c.completed).join(","));
  ok("91.14c §7 …and every movement traces to work under that goal",
    c.movedForward.every((m) => m.changes.every((x) => {
      const a = s.nextActions.find((y) => y.id === x.entity.id);
      const p = s.projects.find((y) => y.id === a?.projectId);
      return a?.goalId === m.goal.id || p?.goalId === m.goal.id;
    })));

  // ---- §8. Direction is recorded, and never called progress -------------
  ok("91.15 §8 a goal horizon change is shown",
    ids(c.changedDirection).includes("g-clinic"), ids(c.changedDirection).join(","));
  ok("91.16 §8 …with both ends of the transition",
    c.changedDirection.some((x) => x.entity.id === "g-clinic" && !!x.from && !!x.to),
    JSON.stringify(c.changedDirection.find((x) => x.entity.id === "g-clinic")));
  ok("91.17 §8 an achieved goal is a recorded change",
    ids(c.changedDirection).includes("g-move"));
  ok("91.18 §8 a rule adopted today is shown",
    c.changedDirection.some((x) => x.kind === "rule_adopted"),
    c.changedDirection.map((x) => x.kind).join(","));
  ok("91.19 §8 …and direction is never mixed into plain changes",
    !c.changed.some((x) => (DIRECTION_KINDS as string[]).includes(x.kind)
      || x.kind === "rule_adopted" || x.kind === "rule_revised" || x.kind === "rule_retired"),
    c.changed.map((x) => x.kind).join(","));
  {
    // The audit's own measurement: 081 proves twelve changes for this day and
    // the old surface showed six. Whatever the split, nothing may be lost.
    const all = buildExecutiveChanges(s, resolveRange("custom",
      { customStart: TODAY, customEnd: TODAY, offsetMinutes: 0 }));
    const shown = new Set([
      ...ids(c.completed), ...ids(c.waitingResolved), ...ids(c.changed),
      ...c.deferred.map((d) => d.change.entity.id), ...ids(c.rescheduled),
      ...ids(c.changedDirection), ...ids(c.reflections),
    ]);
    const missing = all.filter((x) => !shown.has(x.entity.id));
    // §19 drops machine prose ON PURPOSE, so the expectation is "everything
    // except that" — and the exception is guarded below rather than being
    // quietly absorbed by a looser assertion.
    const droppedForProvenance = missing.filter((x) => isMachineProduced(x.origin));
    ok("91.20 §8 every provable change for the day reaches some section",
      missing.length === droppedForProvenance.length,
      missing.map((x) => `${x.kind}:${x.entity.id}`).join(" | "));
    ok("91.20a §19, §22 …and the ONLY thing dropped is machine prose",
      droppedForProvenance.length === 1 && droppedForProvenance[0].entity.id === "n2",
      droppedForProvenance.map((x) => `${x.kind}:${x.entity.id}`).join(" | "));
  }

  // ---- §9. Defer and reschedule stay apart (LIFEOS-090's line) ----------
  ok("91.21 §9 a deferral is listed as a deferral",
    c.deferred.some((d) => d.change.entity.id === "a-rec"),
    c.deferred.map((d) => d.change.entity.id).join(","));
  ok("91.22 §9 a neutral date change is listed as a reschedule",
    ids(c.rescheduled).includes("a-dentist"), ids(c.rescheduled).join(","));
  ok("91.23 §9 …and never as a deferral",
    !c.deferred.some((d) => d.change.entity.id === "a-dentist"));
  ok("91.24 §9 …nor the deferral as a reschedule",
    !ids(c.rescheduled).includes("a-rec"));
  ok("91.25 §9 the two lists never intersect",
    c.deferred.every((d) => !ids(c.rescheduled).includes(d.change.entity.id)));

  // ---- §10. The count needs two windows ---------------------------------
  ok("91.26 §10 a repeated deferral carries the record's whole-life count",
    c.deferred.find((d) => d.change.entity.id === "a-rec")?.totalDeferrals === 3,
    String(c.deferred.find((d) => d.change.entity.id === "a-rec")?.totalDeferrals));
  ok("91.27 §10 …and the sentence says 'again' with the count",
    deferralLine(c.deferred.find((d) => d.change.entity.id === "a-rec")!)
      === "Deferred again today — 3 recorded deferrals.",
    deferralLine(c.deferred.find((d) => d.change.entity.id === "a-rec")!));
  {
    // A first deferral must NOT be dressed up as a pattern.
    const one = world();
    one.nextActions.push(act({ id: "a-once", title: "Book the hall",
      history: [h("created", D("2026-09-01")), h("deferred", D(TODAY, 20))] }));
    const c2 = close(one);
    const d = c2.deferred.find((x) => x.change.entity.id === "a-once");
    ok("91.28 §10 a FIRST deferral is not called repeated", d?.repeated === false, JSON.stringify(d?.totalDeferrals));
    ok("91.29 §10 …and its sentence says only what happened",
      d ? deferralLine(d) === "Deferred today." : false, d ? deferralLine(d) : "-");
  }
  ok("91.30 §10 the deferral wording is neutral — no warning vocabulary",
    !EVENING_FORBIDDEN_WORDS.some((w) =>
      c.deferred.map((d) => deferralLine(d)).join(" ").toLowerCase().includes(w)));

  // ---- §11. Still open is bounded, and is not the backlog ---------------
  ok("91.31 §11 still open is capped at three", c.stillOpen.length <= 3, String(c.stillOpen.length));
  {
    const dense = world();
    for (let i = 0; i < 40; i += 1) {
      dense.nextActions.push(act({ id: `bulk${i}`, title: `Overdue chore ${i}`, dueDate: "2026-09-02",
        history: [h("created", D("2026-08-01"))] }));
    }
    const cd = close(dense);
    ok("91.32 §11 forty overdue chores do not become forty rows",
      cd.stillOpen.length <= 3, String(cd.stillOpen.length));
    ok("91.33 §11 …and the carry list stays bounded too",
      cd.carryForward.length <= 3, String(cd.carryForward.length));
    ok("91.34 §11 …and the words stay bounded",
      cd.reflections.length <= 3, String(cd.reflections.length));
  }
  ok("91.35 §11 a completed record is never still open",
    !ids(c.stillOpen).includes("a-send") && !ids(c.stillOpen).includes("a-stmt"),
    ids(c.stillOpen).join(","));
  ok("91.35a §11 …and every still-open action is genuinely live",
    c.stillOpen.filter((a) => a.entity.kind === "action").every((a) => {
      const rec = s.nextActions.find((x) => x.id === a.entity.id);
      return !!rec && rec.status !== "completed" && rec.status !== "cancelled";
    }),
    c.stillOpen.map((a) => `${a.entity.id}:${s.nextActions.find((x) => x.id === a.entity.id)?.status}`).join(","));
  ok("91.36 §13 blocked work names its blocker when it is shown",
    c.stillOpen.filter((a) => a.kind === "blocked").every((a) => /Need legal review/.test(a.explanation)),
    c.stillOpen.map((a) => `${a.kind}:${a.explanation}`).join(" | "));

  // ---- §12. Waiting, split ----------------------------------------------
  ok("91.37 §12 a wait still open tonight is listed",
    c.waitingOpen.some((w) => w.action.id === "a-lease"),
    c.waitingOpen.map((w) => w.action.id).join(","));
  ok("91.38 §12 …naming the person it is on",
    c.waitingOpen.find((w) => w.action.id === "a-lease")?.waitingOn === "Marcus");
  ok("91.39 §12 …and carrying the recorded follow-up date",
    c.waitingOpen.find((w) => w.action.id === "a-lease")?.followUpDate === FRIDAY);
  ok("91.40 §12 a RESOLVED wait is not also still waiting",
    !c.waitingOpen.some((w) => w.action.id === "a-transcript"));
  ok("91.41 §12 the two waiting lists never intersect",
    c.waitingOpen.every((w) => !ids(c.waitingResolved).includes(w.action.id)));

  // ---- §14, §15, §16. Tomorrow vs carry-forward -------------------------
  ok("91.42 §14 work already dated tomorrow is SCHEDULED",
    c.tomorrowScheduled.some((t) => t.id === "a-submit"),
    c.tomorrowScheduled.map((t) => t.id).join(","));
  ok("91.43 §14, §16 …and is therefore NOT offered as a carry candidate",
    !c.carryForward.some((f) => f.item.entity.id === "a-submit"),
    c.carryForward.map((f) => f.item.entity.id).join(","));
  ok("91.44 §16 a deferral returning tomorrow is already scheduled",
    c.tomorrowScheduled.some((t) => t.id === "a-rec"));
  ok("91.45 §16 …and is not a candidate either",
    !c.carryForward.some((f) => f.item.entity.id === "a-rec"));
  ok("91.46 §15 work dated LATER than tomorrow is not carried",
    !c.carryForward.some((f) => f.item.entity.id === "a-dentist"),
    c.carryForward.map((f) => f.item.entity.id).join(","));
  ok("91.47 §15 genuinely unresolved work IS offered",
    c.carryForward.some((f) => f.item.entity.id === "a-fee"),
    c.carryForward.map((f) => f.item.entity.id).join(","));
  ok("91.48 §15 completed work is never a candidate",
    !c.carryForward.some((f) => ["a-send", "a-stmt"].includes(f.item.entity.id)));
  ok("91.49 §15 cancelled work is never a candidate",
    !c.carryForward.some((f) => f.item.entity.id === "a-drop"));
  ok("91.50 §15 a resolved wait is never a candidate",
    !c.carryForward.some((f) => f.item.entity.id === "a-transcript"));
  ok("91.51 §15 open undated work is not invented into tomorrow",
    !c.carryForward.some((f) => f.item.entity.id === "a-someday")
    && !c.tomorrowScheduled.some((t) => t.id === "a-someday"));
  ok("91.51a §15 only WORK is offered — never a goal or a rule",
    c.carryForward.every((f) => f.item.entity.kind === "action"
      && s.nextActions.some((a) => a.id === f.item.entity.id)),
    c.carryForward.map((f) => `${f.item.entity.kind}:${f.item.entity.id}`).join(","));
  ok("91.52 §13 blocked work is not carried — it waits on its blocker",
    !c.carryForward.some((f) => f.item.entity.id === "a-final"),
    c.carryForward.map((f) => f.item.entity.id).join(","));
  ok("91.53 §41 a candidate already explained above does not repeat its reason",
    c.carryForward.filter((f) => f.echoesStillOpen).length > 0
    && c.carryForward.every((f) => !f.echoesStillOpen || ids(c.stillOpen).includes(f.item.entity.id)),
    c.carryForward.map((f) => `${f.item.entity.id}:${f.echoesStillOpen}`).join(","));
  ok("91.54 §14 the two tomorrow lists never share a record",
    c.carryForward.every((f) => !c.tomorrowScheduled.some((t) => t.id === f.item.entity.id)));
  ok("91.55 §16 the model proposes and never schedules",
    typeof (buildEveningClose as unknown as { length: number }).length === "number"
    && JSON.stringify(close(s)) === JSON.stringify(close(world())),
    "building twice yields the same close");

  {
    // A day with a goal that has no active project and NO competing action
    // candidates — the only state in which LIFEOS-084's `goal_gap` reason
    // reaches the front of the carry list. Without it the cap hid the case, and
    // a mutation removing the "actions only" filter walked straight through
    // while the browser was catching it.
    const bare = emptyStoreState();
    bare.goals = [goal({ id: "g-lonely", title: "Learn to sail" })];
    const cb = close(bare);
    ok("91.55a §15 a goal with no project is never offered as carry-forward",
      cb.carryForward.every((f) => f.item.entity.kind === "action"),
      cb.carryForward.map((f) => `${f.item.entity.kind}:${f.item.entity.id}`).join(","));
    ok("91.55b §15 …even though it IS something the shortlist raises",
      buildAttentionShortlist(bare, buildTodayIndexes(bare, TODAY), TODAY, { limit: 10 })
        .some((a) => a.entity.kind === "goal"),
      "the goal gap is a real signal — it is just not a thing you carry to a day");
  }

  // ---- §19. The user's own words ----------------------------------------
  ok("91.56 §19 a user reflection is shown",
    ids(c.reflections).includes("r1"), ids(c.reflections).join(","));
  ok("91.57 §19 a user note is shown", ids(c.reflections).includes("n1"));
  ok("91.58 §19, §22 an ATTRIBUTED machine note is never 'in your own words'",
    !ids(c.reflections).includes("n2"), ids(c.reflections).join(","));
  ok("91.59 §19 the words are capped at three", c.reflections.length <= 3, String(c.reflections.length));

  // ---- §23, §24. Counts, and a quiet day --------------------------------
  ok("91.60 §23 the summary is counts only",
    /^\d+ [a-z]/.test(c.calmSummary) && !/[!?]/.test(c.calmSummary), c.calmSummary);
  ok("91.61 §23 …with no zero clauses",
    !/\b0 /.test(calmSummaryLine({ completed: 2, deferred: 0, rescheduled: 0, changed: 0, stillOpen: 1, waitingOpen: 0 })),
    calmSummaryLine({ completed: 2, deferred: 0, rescheduled: 0, changed: 0, stillOpen: 1, waitingOpen: 0 }));
  ok("91.62 §23 …and it counts each section once",
    calmSummaryLine({ completed: 3, deferred: 1, rescheduled: 1, changed: 4, stillOpen: 3, waitingOpen: 1 })
      === "3 completed · 1 deferred · 1 rescheduled · 4 other changes · 3 still open · 1 waiting",
    calmSummaryLine({ completed: 3, deferred: 1, rescheduled: 1, changed: 4, stillOpen: 3, waitingOpen: 1 }));
  ok("91.63 §36 there is no percentage anywhere",
    !eveningStrings(c).some((x) => /%/.test(x)));
  {
    const empty = emptyStoreState();
    const cq = close(empty);
    ok("91.64 §24 a day with nothing recorded is quiet", cq.quiet === true);
    ok("91.65 §24 …and the sentence is about records, not about the person",
      QUIET_DAY === "No completed or changed commitments were recorded today.", QUIET_DAY);
    ok("91.66 §24 …with no guilt vocabulary",
      !EVENING_FORBIDDEN_WORDS.some((w) => QUIET_DAY.toLowerCase().includes(w)));
    ok("91.67 §24 …and every section is genuinely empty",
      cq.completed.length === 0 && cq.changed.length === 0 && cq.stillOpen.length === 0
      && cq.carryForward.length === 0 && cq.reflections.length === 0);
    ok("91.68 §23 …so the calm line has nothing to say", cq.calmSummary === "", cq.calmSummary);
  }
  ok("91.69 §24 a day WITH records is not quiet", c.quiet === false);

  // ---- §22, §32, §36. What it may never say -----------------------------
  {
    const bad = eveningStrings(c).filter((x) =>
      EVENING_FORBIDDEN_WORDS.some((w) => (x || "").toLowerCase().includes(w)));
    ok("91.70 §22, §36 nothing evaluates the day", bad.length === 0, bad.slice(0, 3).join(" | "));
  }
  ok("91.71 §20 the memory prompt is an invitation, not an assignment",
    MEMORY_PROMPT === "Anything about today worth remembering?"
    && !/journal|complete your|required/i.test(MEMORY_PROMPT + MEMORY_PROMPT_HINT),
    `${MEMORY_PROMPT} / ${MEMORY_PROMPT_HINT}`);
  ok("91.72 §16 the carry note says nothing moves on its own",
    /until you/i.test(CARRY_FORWARD_NOTE), CARRY_FORWARD_NOTE);
  ok("91.74 §14 one tomorrow heading says already, the other says possible",
    /already/i.test(TOMORROW_SCHEDULED_HEADING) && !/carry/i.test(TOMORROW_SCHEDULED_HEADING)
    && /carry/i.test(CARRY_FORWARD_HEADING) && !/already/i.test(CARRY_FORWARD_HEADING),
    `${TOMORROW_SCHEDULED_HEADING} / ${CARRY_FORWARD_HEADING}`);

  // ---- §25, §26. The day, and the day before ----------------------------
  ok("91.75 §26 a previous day can be closed",
    close(s, previousDay(TODAY), TODAY).date === "2026-09-08");
  ok("91.76 §26 …and it knows it is not today",
    close(s, previousDay(TODAY), TODAY).isToday === false);
  ok("91.77 §26 …while today knows it is", c.isToday === true);
  ok("91.78 §26 yesterday's close does not claim today's completions",
    !ids(close(s, previousDay(TODAY), TODAY).completed).includes("a-send"),
    ids(close(s, previousDay(TODAY), TODAY).completed).join(","));
  ok("91.79 §22 the heading is a date or 'Today', never a verdict",
    eveningHeading(c) === "Today"
    && /Sep/.test(eveningHeading(close(s, previousDay(TODAY), TODAY))),
    `${eveningHeading(c)} / ${eveningHeading(close(s, previousDay(TODAY), TODAY))}`);
  ok("91.80 §25 the day range is one local day, reused not reimplemented",
    resolveRange("custom", { customStart: TODAY, customEnd: TODAY, offsetMinutes: 0 }).startKey === TODAY);
  ok("91.81 §26 there is no rolling 24-hour window",
    previousDay(TODAY) === addDays(TODAY, -1));

  // ---- §31, §32, §33, §34. Consistency ----------------------------------
  {
    // §31. Everything the morning showed resolves into a truthful state, and
    // nothing simply vanishes because its date changed.
    const morningIds = ["a-send", "a-rec", "a-dentist", "a-transcript", "a-final", "a-plants"];
    const everywhere = new Set([
      ...ids(c.completed), ...ids(c.waitingResolved), ...ids(c.changed),
      ...c.deferred.map((d) => d.change.entity.id), ...ids(c.rescheduled),
      ...ids(c.stillOpen), ...c.waitingOpen.map((w) => w.action.id),
      ...c.tomorrowScheduled.map((t) => t.id), ...c.carryForward.map((f) => f.item.entity.id),
    ]);
    const vanished = morningIds.filter((id) => !everywhere.has(id));
    ok("91.82 §31 nothing the morning showed vanishes by evening",
      vanished.length === 0, vanished.join(","));
    ok("91.83 §31 …and the rescheduled item is still accounted for",
      everywhere.has("a-dentist"));
  }
  {
    // §33, §34. The same day, read by 081 directly, must agree.
    const day = resolveRange("custom", { customStart: TODAY, customEnd: TODAY, offsetMinutes: 0 });
    const direct = buildExecutiveChanges(s, day);
    ok("91.84 §33 the evening's completions are 081's completions",
      direct.filter((x) => (MOVED_FORWARD_KINDS as string[]).includes(x.kind)).length === c.completed.length,
      `${direct.filter((x) => (MOVED_FORWARD_KINDS as string[]).includes(x.kind)).length} vs ${c.completed.length}`);
    ok("91.85 §33 …and the evening's deferrals are 081's deferrals",
      direct.filter((x) => x.kind === "deferred").length === c.deferred.length);
    ok("91.86 §34 …and its reschedules are 081's reschedules",
      direct.filter((x) => x.kind === "rescheduled").length === c.rescheduled.length);
    ok("91.87 §33 every shown change carries the field it traces to",
      [...c.changed, ...c.changedDirection, ...c.rescheduled, ...c.waitingResolved]
        .every((x) => typeof x.evidence === "string" && x.evidence.length > 0));
  }
  ok("91.88 §4 the close is a projection — same state, same answer",
    JSON.stringify(close(world())) === JSON.stringify(close(world())));

  // ---- §42. Bounded work at scale ---------------------------------------
  for (const n of [100, 1000]) {
    const big = emptyStoreState();
    for (let i = 0; i < n; i += 1) {
      big.nextActions.push(act({ id: `b${i}`, title: `Action ${i}`,
        dueDate: i % 3 === 0 ? TODAY : undefined,
        status: i % 5 === 0 ? "completed" : "open",
        completedAt: i % 5 === 0 ? D(TODAY, 12) : undefined,
        history: [h("created", D("2026-08-01")),
          ...(i % 5 === 0 ? [h("completed", D(TODAY, 12), { fromStatus: "open", toStatus: "completed" })] : [])] }));
    }
    const bix = buildTodayIndexes(big, TODAY);
    const t = Date.now();
    const cb = buildEveningClose(big, bix, { date: TODAY, today: TODAY, offsetMinutes: 0 });
    const ms = Date.now() - t;
    ok(`91.89.${n} one evening close over ${n} actions is under 400ms`, ms < 400, `${ms}ms`);
    ok(`91.90.${n} …and the bounded sections stay bounded`,
      cb.stillOpen.length <= 3 && cb.carryForward.length <= 3 && cb.reflections.length <= 3,
      `${cb.stillOpen.length}/${cb.carryForward.length}/${cb.reflections.length}`);
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
