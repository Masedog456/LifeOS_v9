/**
 * Commitment awareness — what may be slipping out of view (LIFEOS-070).
 *
 * ## A different question from Suggested Next, over the same evidence
 *
 * Suggested Next asks "what should I do now?" and answers with ONE executable
 * action. This module asks "what may be slipping out of view?" and answers with
 * a list that deliberately includes things the user CANNOT act on — a wait whose
 * follow-up date arrived, work blocked by something unfinished, a project with
 * no executable step left. Those are the items a recommender must exclude and a
 * commitment view must include, which is exactly why the two stay separate (§15)
 * while sharing one set of facts (§4).
 *
 * ## Forgotten is not old
 *
 * Nothing here surfaces because it is old. Every signal names a dated fact that
 * a person could verify by opening the record: a due date that passed, a
 * follow-up date that arrived, a deferral that came back, a recurrence due
 * today, an unmet blocker, a project with no executable action, or — and only
 * under the full conjunction in `dormantSignals` — an open commitment with no
 * recorded activity and nothing else explaining the silence.
 *
 * ## No scores, ever
 *
 * Ordering is `COMMITMENT_ORDER`, a fixed lexicographic list. There is no
 * urgency number, no risk band, no weighting, and no hidden probability. If two
 * signals share a kind they are ordered by the date the fact carries, which is
 * itself evidence rather than a judgment.
 *
 * ## One commitment, one row (§15)
 *
 * A single action can be overdue AND blocking something AND back from deferral.
 * It appears once, under its highest-priority kind, with the rest attached as
 * `secondaryReasons`. The audit found this exact item rendered three times in
 * three sections with three different wordings.
 *
 * ## Nothing is persisted, and nothing is rescanned
 *
 * A function of `(state, TodayIndexes)`. Every index it needs — `actionsById`,
 * `blocksMap`, `blockedByMap`, `blockedActionIds`, `completions`, `activity` —
 * arrives prebuilt, so this adds no store scan and no dependency traversal.
 */

import type { NextAction, Project, RecordRefLite, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { todayKey, formatDayKey, dayDiff } from "@/lib/reviews/dates";
import {
  isLive, dueLabel, dueKeyOf, overdueActions, upcomingActions,
  UPCOMING_WINDOW_DAYS,
} from "@/lib/actions/due";
import { isFollowUpDue } from "@/lib/actions/waiting";
import { blockersOf } from "@/lib/actions/dependencies";
import { readRule } from "@/lib/time/recurrence";
import { occurrenceFor } from "@/lib/mvpStore";
import { lastActivityByRecord } from "@/lib/insights/dormancy";
import { RETURN_THRESHOLD_DAYS } from "@/lib/planning/today-signals";
import type { TodayIndexes } from "@/lib/today/indexes";

// ------------------------------------------------------------------ kinds ---

/**
 * The eight kinds of evidence that a commitment may need attention.
 *
 * Every member has a recorded field behind it. There is no `at_risk`, no
 * `important`, and no `slipping`, because nothing in the schema records risk,
 * importance, or a trajectory.
 */
export type CommitmentKind =
  | "overdue"
  | "follow_up_due"
  | "returned_today"
  | "recurring_due"
  | "blocked"
  | "due_soon"
  | "project_no_next_action"
  | "dormant";

/**
 * THE ORDERING (§5). Lexicographic, by kind, first difference wins.
 *
 * This is the approved order and it is not a ranking of importance — it is a
 * ranking of how directly the evidence bears on "this may have slipped". A
 * passed due date is the most direct; a long silence is the least, which is why
 * it is last and why it is also the most heavily conditioned.
 */
export const COMMITMENT_ORDER: readonly CommitmentKind[] = [
  "overdue",
  "follow_up_due",
  "returned_today",
  "recurring_due",
  "blocked",
  "due_soon",
  "project_no_next_action",
  "dormant",
];

const RANK = new Map<CommitmentKind, number>(COMMITMENT_ORDER.map((k, i) => [k, i]));

/** Which Today section a kind belongs in (§16). No new section is created. */
export type CommitmentSection = "attention" | "return" | "waiting" | "pulse";

export const COMMITMENT_SECTION: Record<CommitmentKind, CommitmentSection> = {
  overdue: "attention",
  follow_up_due: "waiting",
  returned_today: "return",
  recurring_due: "attention",
  blocked: "attention",
  due_soon: "attention",
  project_no_next_action: "pulse",
  dormant: "return",
};

/** A supporting fact attached to a signal that already has a primary kind. */
export interface CommitmentReason {
  code: string;
  text: string;
  evidence: string;
}

export interface CommitmentSignal {
  kind: CommitmentKind;
  recordRef: RecordRefLite;
  /** The record's own title. Never generated prose. */
  title: string;
  /** WHY this is here, in one factual sentence (§6). */
  explanation: string;
  /** The date the explanation refers to, when there is one. */
  date?: DayKey;
  projectRef?: RecordRefLite;
  /** The field this signal traces to. Asserted in tests. */
  evidence: string;
  /** Other true facts about the same commitment (§15). Never a second row. */
  secondaryReasons: CommitmentReason[];
}

/** Said when nothing qualifies. Bounded to the record — never "all caught up". */
export const NOTHING_STANDS_OUT =
  "Nothing stands out from what Conqify has recorded.";

/**
 * The one wording for a project with nothing startable left (§11).
 *
 * Exported so Today's Project Pulse, the signal layer and Memory all say the
 * same sentence. "Executable" is load-bearing: a project whose only actions are
 * blocked or waiting DOES have next actions, just none that can be started, and
 * the older copy ("No next action recorded") was untrue about exactly that case.
 */
export const PROJECT_NO_NEXT_ACTION = "No executable next action is recorded";

/**
 * Words a commitment signal may never use.
 *
 * This layer is the single most likely place for a calm product to start
 * nagging, because its entire job is to raise things the user has not done.
 * The bans from Today, Return and due dates are unioned here and asserted over
 * every string the module produces.
 */
export const COMMITMENT_FORBIDDEN_WORDS: readonly string[] = [
  "you forgot", "you neglected", "neglected", "falling behind", "you're behind",
  "you are behind", "urgent", "you should have", "late", "overdue by", "failed",
  "failing", "stalled", "at risk", "slipping", "streak", "shame", "guilt",
  "unproductive", "caught up", "all clear",
];

// ------------------------------------------------------- the shared facts ---

/**
 * The factual observations both this layer and Suggested Next depend on (§4).
 *
 * Horizon-free on purpose: `daysUntilDue` is the raw distance to the due date,
 * and each consumer applies its OWN named window to it. The audit found four
 * horizon constants and two different meanings of "due soon" — Today's Upcoming
 * looked seven days ahead while the recommender looked three, and both called it
 * the same thing. Now there is one date computation and two explicitly named
 * windows (§7).
 */
export interface CommitmentFacts {
  /** Whole days a due date has passed. 0 when not overdue. */
  overdueDays: number;
  dueToday: boolean;
  /** Days until the due date. `undefined` when there is no future due date. */
  daysUntilDue?: number;
  followUpDue: boolean;
  /** A `returned` history event recorded TODAY (§1). Never a stale field. */
  returnedToday: boolean;
  /** How many other actions this one blocks. */
  blocksCount: number;
}

/**
 * Gather the observable facts about one action.
 *
 * Every date question delegates to the canonical helper — `dueKeyOf` for
 * liveness, `isFollowUpDue` for follow-ups (§8), `dayDiff` for distance. Nothing
 * here re-implements a comparison that `lib/actions/due.ts` already owns.
 */
export function commitmentFactsFor(a: NextAction, ix: TodayIndexes, today: DayKey): CommitmentFacts {
  const due = dueKeyOf(a);
  // `dayDiff(x, y)` is x MINUS y.
  const overdueDays = due && due < today ? dayDiff(today, due) : 0;
  const daysUntilDue = due && due > today ? dayDiff(due, today) : undefined;
  return {
    overdueDays,
    dueToday: due === today,
    daysUntilDue,
    followUpDue: isFollowUpDue(a, today),
    returnedToday: returnedOn(a, today),
    blocksCount: ix.blocksMap.get(a.id)?.size ?? 0,
  };
}

/**
 * Did this action come back from a deferral on `day`?
 *
 * Read from the `returned` HISTORY EVENT, not from `deferredUntil`. Returning
 * clears that field — correctly, since the deferral is over — so the field can
 * never witness the return. LIFEOS-070's audit found both consumers testing it
 * anyway, which is why the signal had never once rendered.
 */
export function returnedOn(a: NextAction, day: DayKey): boolean {
  return (a.history ?? []).some((h) => h.action === "returned" && h.at.slice(0, 10) === day);
}

// ------------------------------------------------------------ the signals ---

export interface CommitmentOptions {
  today?: DayKey;
  /** How far ahead a due date still counts as approaching. Canonical: 7 days. */
  horizonDays?: number;
  /** Days of silence before an open commitment may be called dormant. */
  dormantAfterDays?: number;
}

/**
 * Build every commitment signal for the current state, deduplicated.
 *
 * Reads only from `ix`; adds no scan of its own (§23).
 */
export function buildCommitmentSignals(
  state: StoreState,
  ix: TodayIndexes,
  opts: CommitmentOptions = {},
): CommitmentSignal[] {
  const today = opts.today ?? ix.today ?? todayKey();
  const horizon = opts.horizonDays ?? UPCOMING_WINDOW_DAYS;
  const dormantAfter = opts.dormantAfterDays ?? RETURN_THRESHOLD_DAYS;

  const actions = state.nextActions ?? [];

  /**
   * A deferral the user set for a LATER day is a decision, not a lapse.
   *
   * `isLive` correctly treats a deferred action as live — it is not finished —
   * but a date-based signal must still stay quiet about it, because the user has
   * already answered "not now" and a stale `dueDate` does not override that.
   * LIFEOS-070 §21 fixed this for Today's own section; the audit's browser run
   * showed the SIGNAL layer had the same hole, so an action deferred to next
   * week kept reporting itself overdue. Deferring is supposed to end the signal.
   */
  const deferredAhead = (a: NextAction): boolean =>
    a.status === "deferred" && (!a.deferredUntil || a.deferredUntil > today);

  const live = actions.filter((a) => isLive(a) && !deferredAhead(a));
  // A recurring action is a standing source, not a dated task: its occurrence is
  // asked for by the schedule and it must never also appear as an ordinary due
  // item, or one responsibility becomes two rows.
  const nonRecurring = live.filter((a) => !readRule(a.recurrence));

  const found: CommitmentSignal[] = [];
  const push = (s: CommitmentSignal) => found.push(s);

  const refOf = (a: NextAction): RecordRefLite => ({ kind: "action", id: a.id });
  const projectOf = (a: NextAction): RecordRefLite | undefined =>
    a.projectId ? { kind: "project", id: a.projectId } : undefined;

  // ---- overdue -----------------------------------------------------------
  // Wording delegates to `dueLabel`, so this layer never invents a third
  // phrasing for a passed deadline (§6). "Was due Sun, Aug 23" — not a count.
  for (const a of overdueActions(nonRecurring, today)) {
    push({
      kind: "overdue", recordRef: refOf(a), title: a.title,
      explanation: `${dueLabel(a, today)}.`, date: a.dueDate,
      projectRef: projectOf(a), evidence: "action.dueDate", secondaryReasons: [],
    });
  }

  // ---- follow-up due ------------------------------------------------------
  for (const a of actions) {
    if (!isFollowUpDue(a, today)) continue;
    push({
      kind: "follow_up_due", recordRef: refOf(a), title: a.title,
      explanation: a.followUpDate === today
        ? "Follow-up date is today."
        : `Follow-up date was ${formatDayKey(a.followUpDate!)}.`,
      date: a.followUpDate, projectRef: projectOf(a),
      evidence: "action.followUpDate", secondaryReasons: [],
    });
  }

  // ---- returned from deferral --------------------------------------------
  for (const a of live) {
    if (!returnedOn(a, today)) continue;
    push({
      kind: "returned_today", recordRef: refOf(a), title: a.title,
      explanation: "Returned from deferral today.", date: today,
      projectRef: projectOf(a),
      evidence: "action.history[].returned", secondaryReasons: [],
    });
  }

  // ---- recurring due today ------------------------------------------------
  // Delegated entirely to the existing engine (§14). A completed occurrence
  // makes `occurrenceFor` move on, so it disappears with no rule of its own.
  for (const a of live) {
    if (!readRule(a.recurrence)) continue;
    if (occurrenceFor(a, today, ix.completions) !== today) continue;
    push({
      kind: "recurring_due", recordRef: refOf(a), title: a.title,
      explanation: "A recurring occurrence is due today.", date: today,
      projectRef: projectOf(a),
      evidence: "recurrence occurrence", secondaryReasons: [],
    });
  }

  // ---- blocked, but only where the blockage itself needs attention (§10) --
  //
  // Surfacing every blocked action would produce a pile of work that is merely
  // LATER. A blockage is attention-worthy when the thing waiting is already due,
  // or when the blocker itself has stopped moving — which are both dated facts.
  const lastActivity = lastActivityByRecord(ix.activity);
  const quiet = (a: NextAction): boolean => {
    const at = lastActivity.get(`action:${a.id}`);
    if (!at) return true;
    const day = at.slice(0, 10);
    return day < today && dayDiff(today, day) >= dormantAfter;
  };

  for (const a of nonRecurring) {
    if (!ix.blockedActionIds.has(a.id)) continue;
    const blockers = blockersOf(a.id, ix.blockedByMap, ix.actionsById)
      .filter((b) => isLive(b));
    if (blockers.length === 0) continue;
    const due = dueKeyOf(a);
    const selfDue = !!due && due <= today;
    const stuckBlocker = blockers.find((b) => {
      const bd = dueKeyOf(b);
      return (!!bd && bd < today) || quiet(b);
    });
    if (!selfDue && !stuckBlocker) continue;

    const names = blockers.map((b) => b.title).join(", ");
    push({
      kind: "blocked", recordRef: refOf(a), title: a.title,
      // §9. "Blocked by" — never "Waiting on". A dependency is not a wait: the
      // user is not expecting anything from anyone, another piece of their own
      // work is unfinished. The old Today copy conflated the two.
      explanation: `Blocked by ${names}.`,
      date: due, projectRef: projectOf(a),
      evidence: "actionDependencies[]",
      secondaryReasons: stuckBlocker && !selfDue
        ? [{
          code: "blocker_stuck",
          // `dueLabel` returns "Was due Sat, Aug 22" — a sentence with a real
          // date in it. Lower-casing it to splice mid-sentence produced
          // "was due sat, aug 22", so the label is used as written and the
          // blocker's name leads instead.
          text: dueKeyOf(stuckBlocker) && dueKeyOf(stuckBlocker)! < today
            ? `${stuckBlocker.title}: ${dueLabel(stuckBlocker, today)}.`
            : `${stuckBlocker.title} has no recorded activity in ${dormantAfter} days.`,
          evidence: "blocker.dueDate | activity index",
        }]
        : [],
    });
  }

  // ---- due soon -----------------------------------------------------------
  for (const a of upcomingActions(nonRecurring, today, horizon)) {
    push({
      kind: "due_soon", recordRef: refOf(a), title: a.title,
      explanation: `${dueLabel(a, today)}.`, date: a.dueDate,
      projectRef: projectOf(a), evidence: "action.dueDate", secondaryReasons: [],
    });
  }

  // ---- project with no executable next action (§11) ------------------------
  for (const s of projectNoNextActionSignals(state, ix)) push(s);

  // ---- dormant open commitment (§12) --------------------------------------
  //
  // Last, and only for records NOTHING else has flagged. §12's rule is "no
  // stronger signal already applies", and that is a suppression rather than a
  // secondary reason: a blocked item is quiet BECAUSE it is blocked, so adding
  // "no recorded activity in 120 days" underneath "Blocked by X" restates the
  // consequence as if it were a second problem.
  const alreadySignalled = new Set(found.map((s) => `${s.recordRef.kind}:${s.recordRef.id}`));
  for (const s of dormantSignals(nonRecurring, lastActivity, today, dormantAfter)) {
    if (alreadySignalled.has(`${s.recordRef.kind}:${s.recordRef.id}`)) continue;
    push(s);
  }

  return dedupe(found);
}

/**
 * Active projects that have commitments but nothing executable left.
 *
 * "Executable" is Today's definition, deliberately: live, not waiting, not
 * blocked. The audit found three incompatible definitions of this question
 * across the codebase; this one is chosen because §11 asks specifically about an
 * EXECUTABLE next action, and it matches what Project Pulse already shows.
 * `planning-inbox` keeps its own broader rule and is untouched this sprint —
 * that divergence is documented rather than silently resolved.
 */
export function projectNoNextActionSignals(
  state: StoreState, ix: TodayIndexes,
): CommitmentSignal[] {
  const out: CommitmentSignal[] = [];
  const live = (state.nextActions ?? []).filter(isLive);
  for (const project of (state.projects ?? []) as Project[]) {
    if (project.status !== "active") continue;
    const mine = live.filter((a) => a.projectId === project.id);
    // A project with no commitments at all is not missing a next action; it is
    // a project with nothing in it. Flagging that would be inventing a problem.
    if (mine.length === 0) continue;
    const executable = mine.filter((a) => a.status !== "waiting" && !ix.blockedActionIds.has(a.id));
    if (executable.length > 0) continue;
    out.push({
      kind: "project_no_next_action",
      recordRef: { kind: "project", id: project.id },
      title: project.title,
      // §11. A statement about the RECORD, not about the project's health.
      explanation: `${PROJECT_NO_NEXT_ACTION}.`,
      projectRef: { kind: "project", id: project.id },
      evidence: "project linked actions",
      secondaryReasons: [{
        code: "project_open_count",
        text: `${mine.length} linked ${mine.length === 1 ? "action is" : "actions are"} waiting or blocked.`,
        evidence: "project linked actions",
      }],
    });
  }
  return out;
}

/**
 * Open commitments that have simply gone quiet (§12).
 *
 * The conjunction is the whole signal, and every clause removes a case where
 * silence is already explained:
 *
 *   open              — completed and cancelled work is not forgotten
 *   not waiting       — the silence belongs to someone else
 *   not deferred      — the user chose the silence themselves
 *   no due date       — a date already explains it, past OR future
 *   quiet ≥ threshold — no recorded activity in the existing 30-day window
 *
 * The due-date clause matters more than it looks: the audit found the Return
 * card offering an OVERDUE item as "No recorded activity in 120 days", so an
 * actively-flagged commitment was being presented as a forgotten one.
 */
export function dormantSignals(
  actions: NextAction[],
  lastActivity: Map<string, string>,
  today: DayKey,
  thresholdDays: number,
): CommitmentSignal[] {
  const out: CommitmentSignal[] = [];
  for (const a of actions) {
    if (a.status === "waiting" || a.status === "deferred") continue;
    if (dueKeyOf(a)) continue;
    // The LATER of indexed activity and the record's own `updatedAt`.
    //
    // The activity index carries status transitions, not field edits, so an
    // action changed five minutes ago can have no index entry at all. That
    // matters as of LIFEOS-071: `stopWaiting` moves an item out of `waiting`
    // (where dormancy never applies) into `open` (where it does), and reading
    // only the index would flag a wait the user JUST resolved as forgotten.
    // `updatedAt` is recorded evidence that the record changed, so it counts.
    const indexed = lastActivity.get(`action:${a.id}`);
    const at = [indexed, a.updatedAt, a.createdAt]
      .filter((x): x is string => !!x)
      .sort()
      .pop();
    if (!at) continue;
    const day = at.slice(0, 10);
    if (day >= today) continue;
    const days = dayDiff(today, day);
    if (days < thresholdDays) continue;
    out.push({
      kind: "dormant", recordRef: { kind: "action", id: a.id }, title: a.title,
      explanation: `No recorded activity in ${days} days.`,
      projectRef: a.projectId ? { kind: "project", id: a.projectId } : undefined,
      evidence: "activity index",
      secondaryReasons: [],
    });
  }
  return out;
}

/**
 * One commitment, one row (§15).
 *
 * The highest-priority kind wins and every other kind that matched the same
 * record becomes a secondary reason. Ordering within a kind is by the date the
 * signal carries, then by title — both facts about the records, never a score.
 */
export function dedupe(signals: CommitmentSignal[]): CommitmentSignal[] {
  const byRecord = new Map<string, CommitmentSignal[]>();
  for (const s of signals) {
    const key = `${s.recordRef.kind}:${s.recordRef.id}`;
    const list = byRecord.get(key);
    if (list) list.push(s);
    else byRecord.set(key, [s]);
  }

  const out: CommitmentSignal[] = [];
  for (const list of byRecord.values()) {
    list.sort((a, b) => (RANK.get(a.kind) ?? 99) - (RANK.get(b.kind) ?? 99));
    const primary = list[0];
    const secondary: CommitmentReason[] = [
      ...primary.secondaryReasons,
      ...list.slice(1).map((s) => ({ code: s.kind, text: s.explanation, evidence: s.evidence })),
    ];
    out.push({ ...primary, secondaryReasons: secondary });
  }

  out.sort((a, b) => {
    const ra = RANK.get(a.kind) ?? 99;
    const rb = RANK.get(b.kind) ?? 99;
    if (ra !== rb) return ra - rb;
    if ((a.date ?? "") !== (b.date ?? "")) return (a.date ?? "9999").localeCompare(b.date ?? "9999");
    return a.title.localeCompare(b.title);
  });
  return out;
}

/** Signals belonging to one Today section, in order (§16). */
export function signalsForSection(signals: CommitmentSignal[], section: CommitmentSection): CommitmentSignal[] {
  return signals.filter((s) => COMMITMENT_SECTION[s.kind] === section);
}

/** Does any string this layer produces characterise the reader? Used by tests. */
export function violatesCommitmentLanguage(text: string): string[] {
  const low = (text ?? "").toLowerCase();
  return COMMITMENT_FORBIDDEN_WORDS.filter((w) => low.includes(w));
}

/** Every generated string in a signal list. User titles are excluded by design. */
export function commitmentStrings(signals: CommitmentSignal[]): string[] {
  const out: string[] = [NOTHING_STANDS_OUT];
  for (const s of signals) {
    out.push(s.explanation);
    for (const r of s.secondaryReasons) out.push(r.text);
  }
  return out;
}
