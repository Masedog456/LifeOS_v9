/**
 * Executive changes — one derivation of "what changed" (LIFEOS-081 §5, §6).
 *
 * ## The defect this exists for
 *
 * The audit found **three** definitions of "changed", none aware of the others:
 *
 *   lib/today/daily.ts   CHANGE_KINDS      13 kinds, labelled
 *   lib/memory/answer.ts CHANGE_GROUPS      9 kinds, grouped, no same-day dedup
 *   lib/memory/week.ts   section filters    its own, PLUS the same-day dedup
 *
 * So Daily Review answered "what changed today?" better than Memory answered
 * "what changed this week?", and an action created and completed in one minute
 * was reported twice by Memory and once by Week Review — using a dedup
 * convention that already existed and simply was not shared.
 *
 * And none of the three read `goal.history[]` or `constitutionRevisions[]`.
 * LIFEOS-078 shipped goal history; nothing on the "what changed?" path had ever
 * read it, so a horizon moving `near → medium` was invisible.
 *
 * ## What this is NOT
 *
 * Not an event store. Nothing here is persisted, and no migration was written
 * (§30). Every change below is derived from evidence that already exists, which
 * buys the three things persistence would have to re-implement: deleting a
 * record removes its history for free, editing one updates it for free, and a
 * derived sentence can never be mistaken for something the user wrote.
 *
 * ## Source priority (§8)
 *
 * Strongest evidence first, and `updatedAt` is not on the list at all:
 *
 *   1. an explicit lifecycle/history event  (action.history[], goal.history[])
 *   2. an explicit completion record        (recurrenceCompletions[])
 *   3. a revision record                    (constitutionRevisions[])
 *   4. a creation timestamp                 (createdAt)
 *
 * If a claim would require guessing, it is not made. That is why there is no
 * `BLOCKED`, no `UNBLOCKED`, no `EVENT_RESCHEDULED` and no project lifecycle
 * kind — the schema records none of them, and §5 says not to implement a kind
 * that cannot be grounded.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type {
  ConstitutionElement, ConstitutionRevision, NextAction, RecordRefLite, StoreState,
} from "@/types/mvp";
import type { ResolvedRange } from "@/lib/insights/range";
import type { ActivityEvent } from "@/lib/insights/activity";
import type { OriginType } from "@/lib/provenance";
import { classifyOrigin } from "@/lib/provenance/classify";
import { readRule } from "@/lib/time/recurrence";
import { goalHistory } from "@/lib/execution/lifecycle";
import { goalLinkedActions, goalLinkedProjects } from "@/lib/execution/alignment";
import { GOAL_HORIZON_LABEL } from "@/lib/execution/horizons";
import { buildAutobiographicalTimeline, type AutobiographicalEvent } from "@/lib/memory/week";

// ------------------------------------------------------------------ kinds --

/**
 * Every kind of change this product can prove happened.
 *
 * The action kinds are LIFEOS-073's, reused rather than re-derived. The goal and
 * rule kinds are new, and each names the field it comes from.
 */
export type ExecutiveChangeKind =
  // ---- actions, via the autobiographical timeline -------------------------
  | "created"
  | "completed"
  | "recurring_completed"
  | "cancelled"
  | "deferred"
  | "returned"
  | "restored"
  | "rescheduled"
  | "due_cleared"
  | "planned"
  | "prerequisite_removed"
  | "waiting_started"
  | "waiting_ended"
  // ---- goals, via goal.history[] (LIFEOS-078) -----------------------------
  | "goal_created"
  | "goal_status_changed"
  | "goal_horizon_changed"
  | "goal_target_changed"
  | "goal_replaced"
  // ---- personal code, via constitutionRevisions[] -------------------------
  | "rule_adopted"
  | "rule_revised"
  | "rule_retired"
  // ---- words and calendar -------------------------------------------------
  | "reflection_added"
  | "note_added"
  | "capture_added"
  | "decision_recorded"
  | "event_scheduled";

/** Kinds that mean work finished. Never mixed with the ones that don't (§9). */
export const MOVED_FORWARD_KINDS: readonly ExecutiveChangeKind[] = [
  "completed", "recurring_completed",
];

/**
 * Kinds that are a change of DIRECTION, not of progress (§9).
 *
 * LIFEOS-078 drew this line and it is load-bearing here: a horizon edit, a
 * target-date edit and a status change are recorded transitions, and not one of
 * them is a thing getting done. Reporting them under "moved forward" would be
 * the product telling someone they made progress by changing their mind.
 */
export const DIRECTION_KINDS: readonly ExecutiveChangeKind[] = [
  "goal_status_changed", "goal_horizon_changed", "goal_target_changed", "goal_replaced",
];

export interface ExecutiveChange {
  /** Stable derived key — same inputs, same id, so a UI can key on it. */
  id: string;
  occurredAt: string;
  day: DayKey;
  kind: ExecutiveChangeKind;
  entity: RecordRefLite;
  /** Safe display text. The record's own words — never generated prose. */
  title: string;
  /** The field this traces to. Shown in dev, asserted in tests. */
  evidence: string;
  /** Extra recorded detail — an occurrence date, a person, a schedule. */
  detail?: string;
  /** A recorded transition's two ends, when the history holds both. */
  from?: string;
  to?: string;
  projectRef?: RecordRefLite;
  /** Provenance of the underlying record. Derived lines are never authored. */
  origin: OriginType;
  /** True when only a day is known, so ordering against instants is not real. */
  dayOnly?: boolean;
}

// ------------------------------------------------------- action changes ----

/**
 * The autobiographical kinds, mapped onto this vocabulary.
 *
 * A rename, and a deliberate one: `waiting_stopped` becomes `waiting_ended`
 * because §12 asks for the historical EPISODE to be nameable separately from
 * the current waiting STATE, and two words that differ by one suffix are how
 * those get confused.
 *
 * Kinds absent from this map are absent from the answer — that is the whole
 * mechanism, and it is why adding a kind to the timeline cannot silently start
 * making claims here.
 */
const FROM_TIMELINE: Partial<Record<AutobiographicalEvent["kind"], ExecutiveChangeKind>> = {
  completed_action: "completed",
  recurring_completion: "recurring_completed",
  action_created: "created",
  action_cancelled: "cancelled",
  action_deferred: "deferred",
  action_returned: "returned",
  action_restored: "restored",
  action_rescheduled: "rescheduled",
  action_due_cleared: "due_cleared",
  action_planned: "planned",
  prerequisite_removed: "prerequisite_removed",
  waiting_started: "waiting_started",
  waiting_stopped: "waiting_ended",
  note_created: "note_added",
  reflection_captured: "reflection_added",
  capture_created: "capture_added",
  decision_recorded: "decision_recorded",
  event_scheduled: "event_scheduled",
};

// --------------------------------------------------------- goal changes ----

/** Goal status, in the user's words. Matches the Goals surface. */
const GOAL_STATUS_WORD: Record<string, string> = {
  active: "active",
  paused: "paused",
  completed: "achieved",
  abandoned: "abandoned",
  replaced: "replaced",
};

/**
 * Changes to what a life is pointed at.
 *
 * Read from `goal.history[]` — the append-only log LIFEOS-078 added — and never
 * from `updatedAt`, which a title edit moves. A goal with no history entries
 * contributes nothing rather than contributing its creation date, because a
 * record written before 078 genuinely has no recorded transition and inventing
 * one from `createdAt` would date a life decision by when a row appeared.
 */
function goalChanges(state: StoreState, range: ResolvedRange): ExecutiveChange[] {
  const out: ExecutiveChange[] = [];
  const byId = new Map((state.goals ?? []).map((g) => [g.id, g]));

  for (const g of state.goals ?? []) {
    for (const h of goalHistory(g)) {
      if (!within(h.at, range)) continue;

      const base = {
        id: `goal:${h.kind}:${g.id}:${h.at}`,
        occurredAt: h.at,
        day: h.at.slice(0, 10) as DayKey,
        entity: { kind: "goal", id: g.id } as RecordRefLite,
        // §25: `GoalHistoryEvent` preserves no previous TITLE, so the current
        // one is the only wording available. That is honest for a goal (the
        // transitions recorded are about status and horizon, not wording) and
        // it is why the rule path below behaves differently.
        title: g.title,
        origin: "user_authored" as OriginType,
        detail: h.note,
      };

      switch (h.kind) {
        case "created":
          out.push({ ...base, kind: "goal_created", evidence: "goal.history[].created" });
          break;

        case "status":
          out.push({
            ...base, kind: "goal_status_changed",
            evidence: "goal.history[].toStatus",
            from: h.fromStatus ? GOAL_STATUS_WORD[h.fromStatus] : undefined,
            to: h.toStatus ? GOAL_STATUS_WORD[h.toStatus] : undefined,
          });
          break;

        case "horizon":
          out.push({
            ...base, kind: "goal_horizon_changed",
            evidence: "goal.history[].toHorizon",
            from: h.fromHorizon ? GOAL_HORIZON_LABEL[h.fromHorizon] : undefined,
            to: h.toHorizon ? GOAL_HORIZON_LABEL[h.toHorizon] : undefined,
          });
          break;

        case "target_date":
          out.push({ ...base, kind: "goal_target_changed", evidence: "goal.history[].target_date" });
          break;

        case "replaced": {
          // §26. The successor may have been deleted since. Degrade to a
          // sentence about a record that is gone — never print an id.
          const successor = h.successorGoalId ? byId.get(h.successorGoalId) : undefined;
          out.push({
            ...base, kind: "goal_replaced",
            evidence: "goal.history[].successorGoalId",
            to: h.successorGoalId
              ? (successor ? successor.title : "a goal you later deleted")
              : undefined,
          });
          break;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------- personal code changes ---

/**
 * Which revision kinds are a change to the CODE, and which are bookkeeping.
 *
 * `created` is absent: writing a standard without adopting it is a draft, and
 * LIFEOS-079 was explicit that a draft is not part of the code. `edited` and
 * `relinked` are absent for the reason §4 gives — a wording correction and a
 * link change are edits, and calling an edit a change of position is the
 * central thing this sprint refuses to do. `revised` IS here, because the
 * schema distinguishes it from `edited` precisely on that point.
 */
const RULE_CHANGE: Partial<Record<ConstitutionRevision["changeKind"], ExecutiveChangeKind>> = {
  adopted: "rule_adopted",
  revised: "rule_revised",
  retired: "rule_retired",
};

/**
 * Changes to the standards a person holds themselves to.
 *
 * Only UNCONDITIONAL rules reach this function, and that is not an oversight:
 * `Protocol` has no history of any kind, so a conditional rule's change date
 * does not exist. LIFEOS-079 refused to fabricate it from `updatedAt` — which
 * moves when a typo is fixed — and §16 forbids opening 0048 to add it. The
 * limitation is reported instead, by `PROTOCOL_CHANGE_LIMITATION` below.
 */
function ruleChanges(state: StoreState, range: ResolvedRange): ExecutiveChange[] {
  const out: ExecutiveChange[] = [];
  const byId = new Map((state.constitutionElements ?? []).map((e) => [e.id, e]));

  for (const rev of state.constitutionRevisions ?? []) {
    const kind = RULE_CHANGE[rev.changeKind];
    if (!kind || !within(rev.at, range)) continue;

    const element: ConstitutionElement | undefined = byId.get(rev.elementId);
    // A revision whose element was deleted has no wording to show. §26: degrade,
    // never print an id, never fabricate the statement.
    if (!element && !rev.previousStatement && !rev.newStatement) continue;
    // Personal Code is standards and protocols. A `value` or `purpose` changing
    // is a Constitution change and belongs to a different question.
    if (element && element.kind !== "standard") continue;

    // §25 — THE case where historical wording exists and must be used. A
    // revision records the words before and after; attributing today's wording
    // to a change made three weeks ago would put a sentence in the user's mouth
    // that they had not yet written.
    const title = rev.changeKind === "revised"
      ? (rev.previousStatement ?? element?.statement ?? "a rule you later deleted")
      : (element?.statement ?? rev.newStatement ?? "a rule you later deleted");

    out.push({
      id: `rule:${rev.changeKind}:${rev.elementId}:${rev.at}`,
      occurredAt: rev.at,
      day: rev.at.slice(0, 10) as DayKey,
      kind,
      entity: { kind: "constitution_element", id: rev.elementId },
      title,
      evidence: `constitutionRevisions[].${rev.changeKind}`,
      from: rev.changeKind === "revised" ? rev.previousStatement : undefined,
      to: rev.changeKind === "revised" ? rev.newStatement : undefined,
      detail: rev.reason,
      // Adoption is not authorship (LIFEOS-050A/050B): a wording kept from a
      // suggestion still reads as machine prose after the user adopts it.
      origin: element
        ? classifyOrigin({ kind: "constitution_element", text: element.statement, fromAiText: element.fromAiText })
        : "user_authored",
    });
  }
  return out;
}

export const PROTOCOL_CHANGE_LIMITATION =
  "Conqify records when an unconditional rule changed, but a when/then rule keeps no history, so its changes cannot be dated.";

// ------------------------------------------------------------- the builder --

function within(iso: string | undefined, range: ResolvedRange): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= range.startMs && t < range.endMs;
}

export interface ExecutiveChangeOptions {
  /** A prebuilt activity index, when the caller already has one. */
  index?: ActivityEvent[];
  /** Only changes to this record. Resolved by the CALLER, never guessed (§19). */
  entity?: RecordRefLite;
}

/**
 * Every change this product can prove, inside a bounded range (§7).
 *
 * The range is not optional and nothing here scans eternity: the timeline is
 * bounded by `eventsInRange`, and the goal and rule passes test every entry
 * against the same millisecond bounds.
 */
export function buildExecutiveChanges(
  state: StoreState,
  range: ResolvedRange,
  opts: ExecutiveChangeOptions = {},
): ExecutiveChange[] {
  const timeline = buildAutobiographicalTimeline(state, range, opts.index);

  const fromTimeline: ExecutiveChange[] = [];
  for (const e of timeline) {
    const kind = FROM_TIMELINE[e.kind];
    if (!kind) continue;
    fromTimeline.push({
      id: `${kind}:${e.recordRef.kind}:${e.recordRef.id}:${e.at}`,
      occurredAt: e.at,
      day: e.day,
      kind,
      entity: e.recordRef,
      title: e.title,
      evidence: e.evidence,
      detail: e.detail,
      projectRef: e.projectRef,
      origin: e.origin,
      dayOnly: e.dayOnly,
    });
  }

  const all = [...fromTimeline, ...goalChanges(state, range), ...ruleChanges(state, range)];
  /**
   * LIFEOS-087 RED 1. A PROJECT scope means the project's WORK.
   *
   * Matching only `c.entity` made "what changed with Clinic launch?" report
   * "Conqify recorded no change" in a week that completed an action and
   * deferred another three times — because a Project has no history of its own,
   * so no change is ever *about* the project record. Its actions are, and every
   * change already carries the `projectRef` that says so.
   */
  /**
   * LIFEOS-088 RED 3. A GOAL scope means the goal's WORK as well as its history.
   *
   * A goal DOES have history, so unlike a project it always had at least one row
   * — which made the gap harder to see: "what changed with Open the clinic?"
   * returned one horizon edit and hid the action that completed and the one
   * deferred three times, because no change is *about* the goal record. The
   * links the user made are `Project.goalId` and `NextAction.goalId`, and both
   * routes count, exactly as `goalLinkedActions` already defines them.
   */
  const goalScope = opts.entity?.kind === "goal"
    ? {
      actions: new Set(goalLinkedActions(state, opts.entity.id).map((a) => a.id)),
      projects: new Set(goalLinkedProjects(state, opts.entity.id).map((p) => p.id)),
    }
    : undefined;

  const scoped = opts.entity
    ? all.filter((c) =>
        (c.entity.kind === opts.entity!.kind && c.entity.id === opts.entity!.id)
        || (opts.entity!.kind === "project" && c.projectRef?.id === opts.entity!.id)
        || (!!goalScope && ((c.entity.kind === "action" && goalScope.actions.has(c.entity.id))
          || (c.entity.kind === "project" && goalScope.projects.has(c.entity.id)))))
    : all;

  return sortChanges(dedupe(scoped));
}

/**
 * One underlying change, one line (§23).
 *
 * Two rules, and the second is the one Memory was missing.
 *
 *   1. Same kind, same record, same day → one. `markActionWaiting` can
 *      legitimately be called twice for one item, and "started waiting on
 *      Marcus" is one thing that happened.
 *
 *   2. **Created AND completed on the same day → the completion only.**
 *      `buildRangeReview` has applied this since LIFEOS-064 and `answerChanges`
 *      never did, so Memory reported "Email the department" as both added and
 *      completed — two lines for one minute of someone's life. Promoted here so
 *      both surfaces share it rather than one remembering it.
 */
function dedupe(changes: ExecutiveChange[]): ExecutiveChange[] {
  const completedSameDay = new Set(
    changes
      .filter((c) => c.kind === "completed" || c.kind === "recurring_completed")
      .map((c) => `${c.entity.id}:${c.day}`),
  );

  const seen = new Set<string>();
  return changes.filter((c) => {
    if (c.kind === "created" && completedSameDay.has(`${c.entity.id}:${c.day}`)) return false;
    const key = `${c.kind}:${c.entity.kind}:${c.entity.id}:${c.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Ordering: by when it happened, then deterministically (§24).
 *
 * There is no importance ranking anywhere in this file. Two changes at the same
 * instant are ordered by kind and then by id — arbitrary, but STABLE, which is
 * what a list rendered twice needs to be.
 */
function sortChanges(changes: ExecutiveChange[]): ExecutiveChange[] {
  return [...changes].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt.localeCompare(b.occurredAt);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });
}

// -------------------------------------------------- repeated postponement ---

export interface PostponedItem {
  action: NextAction;
  /** Recorded deferrals at DISTINCT instants. Never a guess from a due date. */
  count: number;
  /** Every instant, so the count can be checked against the record. */
  at: string[];
  lastAt: string;
}

/** Below this, "repeatedly" is not a word the evidence supports. */
export const REPEATED_THRESHOLD = 2;

/**
 * What a person has actually put off, counted from what they actually did (§14).
 *
 * ## Only recorded deferrals
 *
 * `deferAction` appends a `deferred` history entry. That entry — not
 * `deferredUntil`, not an old due date — is the evidence. §13 is explicit that a
 * future due date alone is not a deferral, and it is right: a task dated next
 * Friday was scheduled, not avoided, and a task whose date passed was missed,
 * which is a different fact with a different feeling attached.
 *
 * ## Recurring work is never postponement (§15)
 *
 * A weekly commitment generates a deferral every time it is pushed a day, and
 * calling that "something you keep putting off" would tell someone their
 * standing routine is a personal failing. Recurring actions are excluded
 * outright — the exclusion is a filter on the record, not a heuristic.
 *
 * ## Neutral by construction (§21)
 *
 * This returns a COUNT and the instants behind it. It has no vocabulary for
 * avoidance, resistance or fear, because deciding what three deferrals mean
 * about a person is not something the evidence supports and not something this
 * product does.
 */
export function repeatedlyPostponed(
  state: StoreState,
  range: ResolvedRange,
  threshold: number = REPEATED_THRESHOLD,
): PostponedItem[] {
  const out: PostponedItem[] = [];

  for (const a of state.nextActions ?? []) {
    // §15. A standing schedule is not avoidance.
    if (readRule(a.recurrence)) continue;

    const at = Array.from(new Set(
      (a.history ?? [])
        .filter((h) => h.action === "deferred" && within(h.at, range))
        .map((h) => h.at),
    )).sort();

    if (at.length < threshold) continue;
    out.push({ action: a, count: at.length, at, lastAt: at[at.length - 1] });
  }

  // Most-deferred first, then most recent, then by id. Deterministic, and not a
  // ranking of importance — just an order.
  return out.sort((x, y) =>
    y.count - x.count
    || y.lastAt.localeCompare(x.lastAt)
    || x.action.id.localeCompare(y.action.id));
}

/**
 * The factual sentence for a postponed item. Neutral, and §21's example verbatim.
 *
 * "You deferred this 3 times." — never "you keep failing to do this", never
 * "you seem to be avoiding it". The count is the claim; the meaning is the
 * person's business.
 */
export function postponedLine(item: PostponedItem): string {
  return `You deferred this ${item.count} times.`;
}

/**
 * Words this layer may never use about someone's own record (§21, §22).
 *
 * Asserted by sweeping every string the module can produce.
 */
export const CHANGE_FORBIDDEN_WORDS: readonly string[] = [
  "procrastinat", "avoiding", "afraid", "resistance", "failing", "failure",
  "lazy", "undisciplined", "you keep failing", "should have", "transformative",
  "productive week", "streak", "score", "grade", "neglected",
];
