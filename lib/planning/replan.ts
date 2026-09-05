/**
 * Replanning, as a decision rather than a mutation (LIFEOS-090 §34).
 *
 * ## What the audit found
 *
 * `RECOMMENDATION_RESOLUTIONS` offers the same four controls to every kind of
 * work, and only `complete_*` varies. So the row for a wait on Maria, the row
 * for a weekly recurring chore and the row for an ordinary errand all offer
 * "Defer", and "Defer" means one thing:
 *
 *     status → "deferred",  deferredUntil → a day
 *
 * On a wait that leaves `waitingOn: "Maria"` and `waitingSince` sitting on a
 * record whose status is now `deferred`. Nothing clears them, and every surface
 * that asks "what am I waiting on?" tests `status === "waiting"` — so Maria
 * vanishes from the waiting list while the record still names her. On a
 * recurring action it parks the SERIES, because `isDeferredAhead` hides the
 * series record from Today, the signal layer and the recommender. The user
 * meant "not this occurrence" and got "pause the repeat". `batchAction` does
 * both at once across a mixed selection, with no preview.
 *
 * ## So this layer answers one question
 *
 * *Given this record and this intent, what may safely happen?*
 *
 * It proposes; it never writes. The existing setters execute, and there is no
 * second date-writing path (§33) — every proposal names an existing store
 * primitive by the op it maps to.
 *
 * ## Defer is not reschedule, and the audit found that already true
 *
 * `deferAction` writes `history[].deferred` and changes status. `setActionDueDate`
 * writes `history[].due_set` and changes nothing else. LIFEOS-081 counts the
 * former and ignores the latter, which is why an action rescheduled three times
 * does not read as postponed. That distinction is preserved here rather than
 * re-derived (§4, §24, §26).
 *
 * ## What cannot be done, said rather than faked (§15)
 *
 * `RecurrenceCompletion` gives occurrence-level COMPLETION. There is no row kind
 * and no field that can say "this occurrence moved and the series did not", so
 * occurrence-level deferral is not offered and the series is preserved. §15
 * asks for exactly this rather than a migration.
 *
 * ## Pure
 *
 * A function of `(state, ids, intent, ix, today)`. No writes, no clock of its
 * own, no network, no AI, no persistence (§34).
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import { todayKey, addDays, weekStartKey, formatDayKey, type DayKey } from "@/lib/reviews/dates";
import { isLive } from "@/lib/actions/due";
import { readRule } from "@/lib/time/recurrence";
import { DEFER_LABEL, deferKeyFor } from "@/lib/actions/defer";
import type { ResolutionOps } from "@/lib/commitment/apply";

// ---------------------------------------------------------------- intents ---

/**
 * What the user is asking for.
 *
 * `defer` and `reschedule` are separate kinds because they are separate facts
 * (§4): one records that work was pushed, the other records that a plan
 * changed. Collapsing them into a generic "move" is what §4 forbids.
 */
export type ReplanIntent =
  /** "Not today." — intended, pushed forward. Records a deferral. */
  | { kind: "defer"; day?: DayKey; option?: "tomorrow" | "next_week" | "someday" }
  /** "The date changed." — a neutral scheduling edit. No deferral fact. */
  | { kind: "reschedule"; day: DayKey }
  /** "Follow up Friday." — the wait continues (§11). */
  | { kind: "follow_up"; day?: DayKey }
  /** "I'm not doing this anymore." — a lifecycle change, never a defer (§16). */
  | { kind: "stop" };

export type ReplanKind = ReplanIntent["kind"];

/** The store primitive a proposal maps to. Named, so no caller invents one. */
export type ReplanOp =
  | "deferAction"
  | "setActionDueDate"
  | "setNextFollowUpDate"
  | "cancelAction";

/** Why an item cannot take the intent it was given. */
export type ReplanBlock = "waiting" | "recurring_series" | "not_live" | "no_day";

// ---------------------------------------------------------------- results ---

export interface ReplanProposal {
  actionId: string;
  title: string;
  kind: ReplanKind;
  op: ReplanOp;
  /** Absent for `someday` and for `stop`. */
  day?: DayKey;
  /** For `deferAction`, the option the store takes. */
  option?: "tomorrow" | "next_week" | "someday" | { date: DayKey };
  /** §35. Factual and imperative. "Move to Friday". Never "AI recommends". */
  explanation: string;
  /** §30. Consequential work asks; an ordinary defer may run with undo. */
  authority: "auto_with_undo" | "confirm";
  /** §13. Stated on the proposal, never a reason to refuse it. */
  blockerNote?: string;
}

export interface ReplanException {
  actionId: string;
  title: string;
  reason: ReplanBlock;
  /** §19, §35. What is true, said plainly. */
  note: string;
  /** The intent this record CAN take instead, when there is one. */
  instead?: ReplanProposal;
}

export interface ReplanPlan {
  intent: ReplanIntent;
  proposals: ReplanProposal[];
  /** §19. Items the intent does not fit, each with its own reason. */
  exceptions: ReplanException[];
  /** §30. True for a batch, a stop, or anything carrying a blocker. */
  requiresConfirmation: boolean;
}

// ------------------------------------------------------------------ words ---

/** §5. The intent, named as the user thinks of it rather than as a mechanism. */
export const NOT_TODAY = "Not today";

/**
 * §11. A wait is not deferred work, and the note says which fact is protected.
 */
export const WAITING_NOTE = (who?: string) =>
  who
    ? `Still waiting on ${who} — a wait isn't work you can push.`
    : "Still waiting — a wait isn't work you can push.";

/**
 * §14, §15. The limitation, stated rather than faked.
 *
 * Conqify can close ONE occurrence and it cannot move one. Deferring the record
 * would park the whole repeat, so it is not offered.
 */
export const RECURRING_NOTE =
  "This repeats. Conqify can close today's occurrence, but it can't move one without moving the whole repeat.";

/** §13. Said ON the proposal — a blocker is a fact, not a veto. */
export const BLOCKED_NOTE = (blocker: string) =>
  `Still blocked by “${blocker}”. Moving the date won't unblock it.`;

/** §36. Said when the phrase carries no day the parser will stand behind. */
export const NEEDS_A_DAY = "Which day? Conqify won't guess at “later”.";

/** §16. Stop is a lifecycle change, and the wording never implies a delay. */
export const STOP_NOTE = "Cancels this Action. It is not completed and it is not deleted.";

/** §32, §35. Words a replanning surface may never use. */
export const REPLAN_FORBIDDEN_WORDS: readonly string[] = [
  "ai recommends", "you seem", "overloaded", "you should really", "you keep",
  "falling behind", "too much on", "realistic", "be honest with yourself",
  "% likely", "priority raised", "priority lowered",
];

// --------------------------------------------------------------- choices ---

export interface ReplanChoice {
  id: string;
  label: string;
  /** Absent only for `someday`, which is a dateless deferral the store supports. */
  day?: DayKey;
}

/**
 * The quick choices behind "Not today" (§5, §7, §8).
 *
 * `next_week` reuses `deferKeyFor`, which resolves to the following Monday —
 * an existing product convention, not one invented here (§8).
 *
 * "Later this week" is deliberately NOT a single guessed day. The date parser
 * classifies the phrase as `vague` and refuses to date it, and §7 says not to
 * invent a hidden weekday; so the remaining days of this week are offered as
 * themselves. A week with no days left offers none rather than a fabricated one.
 */
export function notTodayChoices(today: DayKey = todayKey()): ReplanChoice[] {
  const out: ReplanChoice[] = [
    { id: "tomorrow", label: DEFER_LABEL.tomorrow, day: addDays(today, 1) },
  ];
  for (const day of restOfWeek(today)) {
    out.push({ id: `day:${day}`, label: formatDayKey(day, { weekday: "long" }), day });
  }
  out.push({ id: "next_week", label: DEFER_LABEL.next_week, day: deferKeyFor("next_week", today) });
  out.push({ id: "someday", label: DEFER_LABEL.someday });
  return out;
}

/**
 * The days left in this week AFTER tomorrow.
 *
 * Tomorrow already has its own choice, and repeating it as a weekday would put
 * the same day on screen twice under two names.
 */
export function restOfWeek(today: DayKey = todayKey()): DayKey[] {
  const start = weekStartKey(today);
  const out: DayKey[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    if (day > addDays(today, 1)) out.push(day);
  }
  return out;
}

// ------------------------------------------------------------- the model ---

const titleOf = (a: NextAction) => a.title ?? "";

/** The unfinished blocker holding an action up, if there is one. */
function blockerOf(a: NextAction, ix: TodayIndexes): NextAction | undefined {
  if (!ix.blockedActionIds.has(a.id)) return undefined;
  const id = [...(ix.blockedByMap.get(a.id) ?? [])]
    .find((bid) => { const b = ix.actionsById.get(bid); return !!b && isLive(b); });
  return id ? ix.actionsById.get(id) : undefined;
}

/**
 * What may safely happen to these records under this intent.
 *
 * Every record is judged on its own: §19 requires a mixed batch to show its
 * exceptions rather than applying one mutation to everything.
 */
export function planReplan(
  state: StoreState,
  actionIds: readonly string[],
  intent: ReplanIntent,
  ix: TodayIndexes,
  today: DayKey = todayKey(),
): ReplanPlan {
  const proposals: ReplanProposal[] = [];
  const exceptions: ReplanException[] = [];

  for (const id of actionIds) {
    const a = ix.actionsById.get(id) ?? (state.nextActions ?? []).find((x) => x.id === id);
    if (!a) continue;
    const one = planOne(a, intent, ix, today);
    if (one.proposal) proposals.push(one.proposal);
    if (one.exception) exceptions.push(one.exception);
  }

  return {
    intent,
    proposals,
    exceptions,
    // §30. A batch is consequential because it is a batch; everything else
    // that asks does so because its own proposal asked. A stop needs no clause
    // of its own — `planOne` gives it `authority: "confirm"`, and a second
    // condition saying the same thing would be logic no assertion could reach.
    requiresConfirmation:
      actionIds.length > 1
      || proposals.some((p) => p.authority === "confirm"),
  };
}

function planOne(
  a: NextAction,
  intent: ReplanIntent,
  ix: TodayIndexes,
  today: DayKey,
): { proposal?: ReplanProposal; exception?: ReplanException } {
  const title = titleOf(a);
  const base = { actionId: a.id, title, kind: intent.kind } as const;

  // A finished record is not replanned; it is restored first.
  if (!isLive(a)) {
    return { exception: { actionId: a.id, title, reason: "not_live",
      note: "This is already finished — reopen it before replanning it." } };
  }

  // §16. Stop is a lifecycle change and never a delay, so it applies to every
  // live record regardless of what else is true of it.
  if (intent.kind === "stop") {
    return { proposal: { ...base, op: "cancelAction", explanation: `Stop “${title}”`,
      authority: "confirm" } };
  }

  // §11. A wait is not deferred work. Deferring it would leave `waitingOn` and
  // `waitingSince` on a record whose status says `deferred`, which is worse
  // than clearing them: the record would claim two things at once.
  if (a.status === "waiting") {
    if (intent.kind === "follow_up") {
      const day = intent.day;
      if (!day) {
        return { exception: { actionId: a.id, title, reason: "no_day", note: NEEDS_A_DAY } };
      }
      return { proposal: { ...base, op: "setNextFollowUpDate", day,
        explanation: `Keep waiting; follow up ${formatDayKey(day)}`, authority: "auto_with_undo" } };
    }
    const day = dayFor(intent, today);
    return { exception: {
      actionId: a.id, title, reason: "waiting", note: WAITING_NOTE(a.waitingOn),
      // The intent this record CAN take, at the day the user already chose.
      instead: day
        ? { ...base, kind: "follow_up", op: "setNextFollowUpDate", day,
          explanation: `Keep waiting; follow up ${formatDayKey(day)}`, authority: "auto_with_undo" }
        : undefined,
    } };
  }

  // §14, §15. A recurring record is a standing source. Deferring or moving IT
  // moves the series, and nothing in the model can move one occurrence.
  if (readRule(a.recurrence)) {
    return { exception: { actionId: a.id, title, reason: "recurring_series", note: RECURRING_NOTE } };
  }

  // §11's follow-up has no meaning off a wait.
  if (intent.kind === "follow_up") {
    return { exception: { actionId: a.id, title, reason: "waiting",
      note: "This isn't waiting on anyone, so there is no follow-up to move." } };
  }

  const day = dayFor(intent, today);
  // §36. "Later" carries no day, and nothing here guesses one.
  if (!day && !(intent.kind === "defer" && intent.option === "someday")) {
    return { exception: { actionId: a.id, title, reason: "no_day", note: NEEDS_A_DAY } };
  }

  // §13. A blocker is a fact stated ON the proposal, not a veto: the user may
  // still insist, and §13 says to allow that explicitly.
  const blocker = blockerOf(a, ix);

  if (intent.kind === "reschedule") {
    return { proposal: { ...base, op: "setActionDueDate", day,
      explanation: `Move to ${formatDayKey(day!)}`,
      authority: blocker ? "confirm" : "auto_with_undo",
      blockerNote: blocker ? BLOCKED_NOTE(titleOf(blocker)) : undefined } };
  }

  const option: ReplanProposal["option"] =
    intent.option === "someday" ? "someday"
      : intent.option === "next_week" ? "next_week"
        : intent.option === "tomorrow" ? "tomorrow"
          : day ? { date: day } : "someday";

  return { proposal: { ...base, op: "deferAction", day, option,
    explanation: day ? `Not today — back ${formatDayKey(day)}` : "Not today — back when you choose",
    authority: blocker ? "confirm" : "auto_with_undo",
    blockerNote: blocker ? BLOCKED_NOTE(titleOf(blocker)) : undefined } };
}

/** The day an intent resolves to, reusing the store's own defer conventions. */
export function dayFor(intent: ReplanIntent, today: DayKey = todayKey()): DayKey | undefined {
  if (intent.kind === "stop") return undefined;
  if (intent.kind === "defer" && intent.option) return deferKeyFor(intent.option, today);
  return intent.day;
}

// ------------------------------------------------------------- rendering ---

/** §19. "3 selected · 2 can move · 1 is waiting on Maria." */
export function summarize(plan: ReplanPlan): string {
  const n = plan.proposals.length + plan.exceptions.length;
  const parts = [`${n} selected`];
  if (plan.proposals.length) parts.push(`${plan.proposals.length} can move`);
  for (const e of plan.exceptions) parts.push(`1 ${shortReason(e)}`);
  return parts.join(" · ");
}

function shortReason(e: ReplanException): string {
  switch (e.reason) {
    case "waiting": return "is waiting";
    case "recurring_series": return "repeats";
    case "not_live": return "is finished";
    default: return "needs a day";
  }
}

// --------------------------------------------------------------- applying ---

/**
 * The store primitives a replan needs (§33).
 *
 * `ResolutionOps` is LIFEOS-071's interface and already binds every one of
 * them; `cancelAction` is the one addition, because stopping work is a
 * lifecycle change LIFEOS-071 never had to make. Extending that interface keeps
 * ONE set of date-writing rules rather than letting Today, the Project page and
 * the Goal page each grow their own.
 */
export interface ReplanOps extends ResolutionOps {
  cancelAction(actionId: string): void;
}

export interface ReplanOutcome {
  applied: number;
  /** Said to the user, whether or not everything went through. */
  message: string;
  /** Ids that could not be applied, with why. */
  refused: { actionId: string; message: string }[];
}

/**
 * Run the proposals the user confirmed. Nothing else.
 *
 * Takes proposals rather than a plan, so a caller that showed exceptions cannot
 * accidentally apply them: §19's whole point is that the excluded items stay
 * excluded, and passing the plan would make "apply everything" the easy call.
 */
export function applyReplan(
  proposals: readonly ReplanProposal[],
  ops: ReplanOps,
): ReplanOutcome {
  const refused: ReplanOutcome["refused"] = [];
  let applied = 0;

  for (const p of proposals) {
    switch (p.op) {
      case "deferAction":
        ops.deferAction(p.actionId, p.option ?? (p.day ? { date: p.day } : "someday"));
        applied += 1;
        break;
      case "setActionDueDate":
        ops.setActionDueDate(p.actionId, p.day);
        applied += 1;
        break;
      case "setNextFollowUpDate": {
        // The store refuses a follow-up on a record that is not waiting, and a
        // refusal that reads as a success is a lie about the user's records.
        const ok = ops.setNextFollowUpDate(p.actionId, p.day);
        if (ok) applied += 1;
        else refused.push({ actionId: p.actionId, message: `Couldn't move the follow-up on “${p.title}”.` });
        break;
      }
      case "cancelAction":
        ops.cancelAction(p.actionId);
        applied += 1;
        break;
    }
  }

  return {
    applied,
    message: applied === 0
      ? "Nothing changed."
      : applied === 1
        ? proposals.find((p) => !refused.some((r) => r.actionId === p.actionId))?.explanation ?? "Done."
        : `${applied} items replanned.`,
    refused,
  };
}

/** Every string this layer can render, for the sweep. */
export function replanStrings(plan: ReplanPlan): string[] {
  return [
    NOT_TODAY, RECURRING_NOTE, NEEDS_A_DAY, STOP_NOTE, summarize(plan),
    ...plan.proposals.flatMap((p) => [p.explanation, p.blockerNote ?? ""]),
    ...plan.exceptions.flatMap((e) => [e.note, e.instead?.explanation ?? ""]),
  ].filter(Boolean);
}
