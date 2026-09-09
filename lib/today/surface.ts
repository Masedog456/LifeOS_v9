/**
 * The Today command projection (LIFEOS-104 §52).
 *
 * ## Why this exists
 *
 * §52 permits one pure Today projection "only if this reduces real drift". The
 * audit measured the drift, so this is not speculative:
 *
 *   - The orientation line counted LIFEOS-070's raw signals while the section
 *     beneath it rendered LIFEOS-082's shortlist. Five of sixteen non-empty
 *     worlds disagreed with themselves — three of them promising "1 item needing
 *     attention" above a page with no attention section at all.
 *   - `view.empty` was decided inside `buildTodayView`, which cannot see
 *     `sinceYesterday` (built one layer up) and has no slot for undated open
 *     work. Four of twenty worlds rendered the NEW-USER empty state over live
 *     records.
 *   - LIFEOS-083's dedup suppressed the duplicate ATTENTION card for the
 *     recommended action but not its duplicate TODAY row, because the two lived
 *     in different builders. Five worlds printed the suggestion verbatim twice;
 *     two printed it three times.
 *
 * Every one of those is the same shape of bug: two places deciding one thing.
 * So the decisions move here, once, and the component renders what it is given.
 *
 * ## What this is NOT
 *
 * Not a ranker, not a scorer, not an engine. Every list below arrives already
 * ordered from the builder that owns it — `recommendNextAction` chose the
 * suggestion, `buildTodayView` ordered the schedule and the roster,
 * `buildAttentionShortlist` ordered and capped attention, `buildDecisionInbox`
 * ordered the questions. This file splits, suppresses and counts. There is no
 * comparator in it.
 *
 * ## Pure
 *
 * A function of `(state, ix, today)`. No clock of its own, no store writes, no
 * persistence (§54). Nothing here is cached: completing the suggested action
 * changes the store, the page re-renders, and the projection is rebuilt.
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { EventOccurrence } from "@/lib/time/events";
import {
  buildTodayView, type ProjectPulse, type TodayView,
  type UpcomingItem, type WaitingItem,
} from "@/lib/today/view";
import { buildTodayOrientation, orientationLine } from "@/lib/today/daily";
import { buildDayShape, conflictLine, type DayShape } from "@/lib/today/shape";
import { buildDailyCommandView, type DailyCommandView } from "@/lib/today/command";
import { buildDecisionInbox, type DecisionItem } from "@/lib/guidance/decisions";
import { signalsForSection, type CommitmentSignal } from "@/lib/commitment/signals";
import type { ExecutiveAttentionItem } from "@/lib/guidance/attention";
import type { RecommendResult } from "@/lib/today/recommend";
import { isLive, dueKeyOf } from "@/lib/actions/due";
import { describeRule } from "@/lib/time/recurrence";
import { blockersOf } from "@/lib/actions/dependencies";
import { isDeferredAhead } from "@/lib/actions/defer";

// ------------------------------------------------------------------ types ---

/** A row in TODAY that a person ATTENDS rather than does (§21). */
export interface FixedRow {
  kind: "event" | "action";
  id: string;
  title: string;
  /** Local wall-clock start. Rendered through the canonical formatter (§22). */
  time?: string;
  endTime?: string;
  /** "All day", or a recurrence rule. A recorded fact, never a judgment. */
  detail?: string;
  /** Happening at this moment, by the one clock reading the page took. */
  isNow: boolean;
  /** The next one still ahead. Marks the row rather than raising a section. */
  isNext: boolean;
  occurrence?: EventOccurrence;
  action?: NextAction;
  /**
   * For a RECURRING timed action: today's occurrence key.
   *
   * A timed standing responsibility ("Take the medication, every day at 8") is a
   * BE THERE row by §21 and a closable occurrence by §23, and it needs to be
   * both. Splitting fixed from flexible without carrying this cost Today the
   * only control that closes one occurrence without ending the series — the
   * 074 reachability suite caught it, and no amount of restructuring justifies
   * removing a mutation the user had.
   */
  occurrenceKey?: DayKey;
  /** The rule in words, for the row that carries the occurrence control. */
  schedule?: string;
  /**
   * The unfinished prerequisites, when there are any (§14).
   *
   * A timed action can be blocked, and until now nothing on its row said so:
   * "Install the reception desk · Due 2 PM" read as a commitment to keep while
   * its blocker sat unfinished. `WorkRow` had carried this since LIFEOS-104;
   * being fixed in the day does not make an action any more startable.
   *
   * Never set for an event — nothing blocks attending something.
   */
  blockedBy?: string[];
}

/** A row in TODAY that a person DOES (§21). */
export interface WorkRow {
  action: NextAction;
  /**
   * Why it belongs to today. One recorded fact (§11).
   *
   * §22: never a time. A clock reading leaves this model as `dueTime` and is
   * rendered through the canonical formatter, because "14:00" is a storage
   * format and "2 PM" is what a person reads.
   */
  detail: string;
  /** The due time, unformatted. The caller formats it (§22). */
  dueTime?: string;
  /** Present for a recurring action; the occurrence key `completeOccurrence` needs. */
  occurrence?: DayKey;
  /** The recurrence rule in words, when there is one. */
  schedule?: string;
  /** A suppressed attention card's sentence, moved onto this row (§23). */
  inlineReason?: string;
  /**
   * §14. The unfinished prerequisites, when there are any.
   *
   * A blocked action with a date today still belongs on today's list — the date
   * is real — but it must not read as ready to start. LIFEOS-083's inline reason
   * covers this only when the blocked signal happens to survive the attention
   * shortlist's cap of three; in the torture world it did not, and "Install the
   * reception desk · Due today" rendered as ordinary work while its blocker sat
   * unfinished. The names come from `blockersOf` over the dependency index —
   * the same helper, for the same reason, as `FixedRow.blockedBy`.
   */
  blockedBy?: string[];
}

/** §17, §48. Judgment kinds never render as work. */
export const JUDGMENT_KINDS: readonly string[] = ["goal_path_missing", "project_no_next_action"];

/** §8. Said when nothing is dated and nothing is grounded. Never urgency. */
export const NOTHING_PRESSING = "Nothing is pressing right now.";

/** §8. Introduces the open-work list under that line. A list, not a ranking. */
export const OPEN_WORK_NOTE = "Open work Conqify has recorded, in the order you added it:";

/** §9. The genuinely-empty prompt. Reached only when nothing is recorded. */
export const NOTHING_TO_SHOW = "Nothing needs your attention right now.";

/** §8. How much open work the quiet-day list shows before it stops. */
export const OPEN_WORK_LIMIT = 5;

export interface TodayCommand {
  today: DayKey;
  /** §4. At most one, from LIFEOS-072. Never a second ranker. */
  suggestedNext: RecommendResult;
  /** §33. What to say instead when 072 grounds nothing. Never a fallback pick. */
  suggestedNote?: string;
  /** §8. Live executable work, when nothing else is showing it. Record order. */
  openWork: NextAction[];
  /** §21. BE THERE. */
  fixed: FixedRow[];
  /** §21. DO — minus whatever Suggested next already shows (§24). */
  work: WorkRow[];
  /** §19. The count, and the one question worth previewing. Never the full inbox. */
  decisions: { total: number; top?: DecisionItem };
  /** §47. The actionable residue, judgment removed. */
  attention: ExecutiveAttentionItem[];
  /** §26. Context. Never above actionable work. */
  sinceYesterday: DailyCommandView["sinceYesterday"];
  /** §49. Everything that is context rather than today's decision. */
  later: {
    waiting: WaitingItem[];
    pulse: ProjectPulse[];
    returns: CommitmentSignal[];
    returnItem: TodayView["returnItem"];
    upcoming: UpcomingItem[];
  };
  /**
   * LIFEOS-106. What today can actually hold, from the rows in `fixed`.
   *
   * The orientation line counted the work with no denominator — "3 to fit in"
   * above a schedule that already ran 08:00 to 17:30. This is the denominator,
   * and it is arithmetic over recorded start and end times only.
   */
  shape: DayShape;
  /** §14. One grounded calming line, or nothing. */
  canWait?: string;
  /** The line above everything. Counts the lists BELOW it, and nothing else. */
  orientation: string;
  /** §9. Nothing recorded that Today can speak to — not merely nothing dated. */
  empty: boolean;
  /** The underlying projections, for callers that still need a field directly. */
  view: TodayView;
  command: DailyCommandView;
}

// ------------------------------------------------------------------ build ---

/**
 * Compose Today.
 *
 * `view` and `command` are accepted rather than rebuilt when the caller already
 * has them, because building a second `TodayView` pays for the whole index pass
 * twice on every render.
 */
export function buildTodayCommand(
  state: StoreState,
  ix: TodayIndexes,
  today: DayKey,
  opts: { view?: TodayView; command?: DailyCommandView } = {},
): TodayCommand {
  const view = opts.view ?? buildTodayView(state, ix);
  const command = opts.command ?? buildDailyCommandView(state, ix, view, today);
  const inbox = buildDecisionInbox(state, ix, { today });
  const { fixedToday } = buildTodayOrientation(state, ix, today);

  const suggestedId = view.suggestion.recommendation?.action.id;

  /**
   * Blockers for any row this surface renders, from the canonical dependency
   * index (§A: "derived from canonical data rather than UI-local state").
   *
   * `view.blocked` was the source, and it deliberately narrows to items that
   * would otherwise be DUE — "a blocked item with no deadline is not risk, it
   * is just later", which is right for raising a signal and wrong here. By the
   * time a row is on Today the question is settled; what is left is whether it
   * can be started. That also reaches a blocked RECURRING action, which carries
   * no `dueDate` for `view.blocked` to match on.
   *
   * `blockersOf` is LIFEOS-036's helper and skips dangling ids, so a deleted
   * blocker cannot hide work behind a name that no longer exists.
   */
  const blockersFor = (id: string): string[] | undefined => {
    if (!ix.blockedActionIds.has(id)) return undefined;
    const names = blockersOf(id, ix.blockedByMap, ix.actionsById)
      .filter((b) => b.status !== "completed" && b.status !== "cancelled")
      .map((b) => b.title);
    return names.length ? names : undefined;
  };
  // ---- BE THERE (§21) ----------------------------------------------------
  //
  // The NOW card is gone, and this is where it went. It rendered a single line
  // — "Next: Advisor meeting · 11:00" — for an event the orientation card had
  // already listed and the Today section listed again below it: one commitment,
  // three times, in eleven rows. A marker on the row says the same thing once.
  const nextOccurrenceId = view.nextEvent?.event.id;
  const recurringById = new Map(view.recurringToday.map((r) => [r.action.id, r]));
  const fixed: FixedRow[] = fixedToday
    // §24 again. Only an ACTION can be the suggestion, and a timed action that
    // is already the strongest next move does not also need a schedule row two
    // inches below it — its due time is stated in the reason that recommended
    // it ("Due today at 4 PM"). Events are never suppressed: nothing can
    // recommend attending one.
    .filter((f) => !(f.kind === "action" && f.id === suggestedId))
    .map((f) => ({
    kind: f.kind,
    id: f.id,
    title: f.title,
    time: f.time,
    endTime: f.event?.endTime,
    /**
     * The recurrence rule, for whichever kind carries one (§B).
     *
     * "Every day" is the whole reason an 08:00 row is on today's list at all,
     * and that was true of EVENTS before LIFEOS-104 rewrote this section —
     * `view.occurrences` rendered `describeRule(o.event.recurrence)` and the
     * rewrite carried the label across for actions only. A standing Monday
     * standup came through as an ordinary appointment.
     *
     * `describeRule` is the time system's own formatter; nothing is re-derived
     * here. "All day" is deliberately NOT repeated — the row's meta column
     * already says it, and the audit's event-heavy world printed
     * "Parents' evening · All day · All day".
     */
    detail: recurrenceLabel(f),
    isNow: f.kind === "event"
      ? f.id === view.nowEvent?.event.id
      : false,
    isNext: f.kind === "event" && !view.nowEvent && f.id === nextOccurrenceId,
    occurrence: f.event,
    action: f.action,
    occurrenceKey: f.kind === "action" ? recurringById.get(f.id)?.occurrence : undefined,
    schedule: f.kind === "action" ? recurringById.get(f.id)?.schedule : undefined,
    // §A. Nothing blocks attending an Event.
    blockedBy: f.kind === "action" ? blockersFor(f.id) : undefined,
  }));

  // ---- DO (§21, §24) -----------------------------------------------------
  //
  // §24: the strongest next move is not repeated underneath itself. The audit
  // found "Call the dentist" three times in an eleven-row page — orientation,
  // Suggested next, Today — and the recurring world and the torture world both
  // repeated the suggestion verbatim two rows below it.
  //
  // Nothing is lost by the suppression, and that is what makes it safe. The
  // Suggested next card carries the record's title, its due label as a grounded
  // reason, and the SAME resolution controls the Today row would have offered —
  // `recommendationResolutionsFor` returns `complete_occurrence` for a recurring
  // action, which is the one control this row has that the others do not.
  const work: WorkRow[] = [];
  const seenWork = new Set<string>();
  const pushWork = (row: WorkRow) => {
    if (row.action.id === suggestedId) return;
    if (seenWork.has(row.action.id)) return;
    seenWork.add(row.action.id);
    work.push({
      ...row,
      inlineReason: command.inlineReasons[row.action.id],
      blockedBy: blockersFor(row.action.id),
    });
  };
  for (const a of view.dueToday) {
    // A timed due action is already a FIXED row above; listing it here would
    // show one commitment in two senses (§21).
    if (fixed.some((f) => f.kind === "action" && f.id === a.id)) continue;
    pushWork({ action: a, detail: "Due today", dueTime: a.dueTime });
  }
  for (const r of view.recurringToday) {
    if (fixed.some((f) => f.kind === "action" && f.id === r.action.id)) continue;
    pushWork({ action: r.action, detail: r.schedule, occurrence: r.occurrence, schedule: r.schedule });
  }
  for (const a of view.alsoToday) {
    pushWork({
      action: a,
      detail: a.status === "in_progress" ? "In progress" : a.dueDate === today ? "Due today" : "Open",
    });
  }

  // ---- JUDGMENT is not ATTENTION (§17, §18, §48) -------------------------
  //
  // `goal_path_missing` asks only whether a PROJECT links to the goal, so a goal
  // carried by a live action trips it. LIFEOS-088 knew that — its truthful
  // predicate is `goalsWithoutAnyPath` — and LIFEOS-094's Decision Inbox uses
  // the truthful one. Today was rendering the other, in the section that means
  // "you can act on this": the audit's world J flagged BOTH goals, including one
  // with a live action against it, while the inbox flagged one.
  //
  // Removing the kinds here fixes both halves at once. The classification is
  // §17's ("this is judgment, not executable work") and the queue that owns
  // judgment already derives it correctly, so nothing needs re-deriving and
  // LIFEOS-070's own semantics are left exactly as they are.
  const attention = command.attention.filter((a) => !JUDGMENT_KINDS.includes(a.kind));

  // ---- §8, §9: what is actually empty ------------------------------------
  //
  // Undated open work belongs to no section — it was visible only THROUGH the
  // recommendation, so two open actions with no dates, a deferral that expired
  // today, three changes from yesterday, or two commitments dated next month all
  // produced "Tell Conqify what's going on." That sentence is for a person who
  // has recorded nothing. These people had recorded plenty.
  const shown = new Set<string>([
    ...(suggestedId ? [suggestedId] : []),
    ...work.map((w) => w.action.id),
    ...fixed.filter((f) => f.kind === "action").map((f) => f.id),
    ...attention.map((a) => a.actionId ?? a.entity.id),
    ...view.waiting.map((w) => w.action.id),
  ]);
  const openWork = (state.nextActions ?? [])
    // No `status !== "waiting"` clause: `shown` already holds every waiting
    // action, because the roster lists them all. Said as a comment rather than
    // written as a redundant filter — a §60 mutant that deleted the clause
    // changed nothing, which is what an equivalent mutant looks like, and a
    // condition that cannot fail is a condition nobody can test.
    .filter((a) => isLive(a))
    .filter((a) => !isDeferredAhead(a, today))
    .filter((a) => !ix.blockedActionIds.has(a.id))
    .filter((a) => !shown.has(a.id));

  /**
   * §19, §25. The preview is the top question NOT already answered on screen.
   *
   * A due follow-up is one fact with two names: LIFEOS-070 calls it
   * `follow_up_due` and LIFEOS-094 calls it `WAITING_FOLLOW_UP`. While the
   * decision queue was a bare count that cost nothing; as a section it put
   * "Follow up with Maria?" directly above "Transcript · Follow-up date is
   * today." — the same record, the same evidence, two rows apart. So the
   * preview skips anything the page already shows and takes the next question
   * down; when every question is already answered on screen, the section says
   * the count and nothing more, which is still true and still reaches the queue.
   */
  const onScreen = new Set<string>([
    ...(suggestedId ? [suggestedId] : []),
    ...work.map((w) => w.action.id),
    // §C. A FIXED row is on screen too. It was missing here, and the gap is
    // reachable: a repeatedly-deferred action carrying a due time is a BE THERE
    // row, and when three higher-ranked items fill the attention shortlist's
    // cap it is absent from `attention` as well — so "Do the tax return"
    // rendered at 8 AM in the schedule and again as the decision preview.
    // Matched on the record's own id; no title comparison anywhere.
    ...fixed.filter((f) => f.kind === "action").map((f) => f.id),
    ...attention.map((a) => a.actionId ?? a.entity.id),
  ]);
  const previewDecision = inbox.items.find((d) => !onScreen.has(d.entity.id));

  /**
   * §51 again, one layer further in.
   *
   * The clauses count the rows this page RENDERS, not the rows the builders
   * produced. Once the suggested action stopped being repeated below itself
   * (§24), counting `fixedToday`/`flexibleToday` reintroduced the same defect
   * at a smaller scale: world C said "1 timed commitment" while the only timed
   * commitment was the suggestion and the schedule was empty. So the line is
   * assembled from `fixed` and `work`, which are exactly the lists beneath it.
   */
  const orientationInput = {
    fixedToday: fixed.map((f) => ({ kind: f.kind, id: f.id, title: f.title, time: f.time })),
    flexibleToday: work.map((w) => ({ action: w.action, reason: "due_today" as const, detail: w.detail })),
    attention: [],
  };
  const hasClauses =
    fixed.length > 0 || work.length > 0 || attention.length > 0 || inbox.total > 0;

  const anythingElse =
    fixed.length > 0 || work.length > 0 || attention.length > 0 ||
    view.waiting.length > 0 || view.pulse.length > 0 || view.upcoming.length > 0 ||
    !!view.returnItem || command.sinceYesterday.length > 0 || inbox.total > 0;

  const empty = !view.suggestion.recommendation && !anythingElse && openWork.length === 0;

  /**
   * LIFEOS-106. The day's shape, from the rows this function just built.
   *
   * `fixed` is the input rather than the store: the durations printed above the
   * schedule must be the durations OF that schedule, and the suggestion §24
   * lifts out of `fixed` is added back — it is still a commitment on the day,
   * it is merely rendered in a different card. Leaving it out would have the
   * arithmetic quietly disagree with the page whenever the strongest next move
   * happened to be timed.
   */
  const suggestedFixed = fixedToday.filter((f) => f.kind === "action" && f.id === suggestedId);
  const shape = buildDayShape(
    [
      ...fixed.map((f) => ({ id: f.id, title: f.title, time: f.time, endTime: f.endTime })),
      ...suggestedFixed.map((f) => ({ id: f.id, title: f.title, time: f.time, endTime: undefined })),
    ],
    { flexible: work.length },
  );

  /**
   * §33. What to say when 072 grounds nothing — never a fallback ranker.
   *
   * Two different silences were being reported with one sentence. "No single
   * next action stands out from what Conqify has recorded" is true of a quiet
   * day and false of a day with twelve dated items, where the recommender
   * declined only because several of them tie on every ordering fact. §31E's
   * refusal is right and is untouched; the sentence describing it is what the
   * audit found misleading, so it now names which silence this is. Both
   * halves are arithmetic over the lists rendered below.
   */
  const dated = work.length + fixed.length;
  const suggestedNote = view.suggestion.recommendation
    ? undefined
    : dated > 0
      ? `${dated} thing${dated === 1 ? "" : "s"} on today, and no single one stands out ahead of the rest.`
      : openWork.length > 0
        ? NOTHING_PRESSING
        : view.suggestion.note;

  return {
    today,
    suggestedNext: view.suggestion,
    suggestedNote,
    /**
     * §8, §33. The quiet-day list, and ONLY the quiet day.
     *
     * When the day already holds dated work, listing undated work underneath
     * "no single one stands out" adds rows to the one section that exists to
     * reduce them — §33's secondary content is the fixed obligations and the
     * decision boundary, both of which the page renders on their own.
     */
    openWork: suggestedNote === NOTHING_PRESSING ? openWork.slice(0, OPEN_WORK_LIMIT) : [],
    fixed,
    work,
    decisions: { total: inbox.total, top: previewDecision },
    shape,
    attention,
    sinceYesterday: command.sinceYesterday,
    later: {
      waiting: view.waiting,
      pulse: view.pulse,
      returns: signalsForSection(view.signals, "return"),
      returnItem: view.returnItem,
      upcoming: view.upcoming,
    },
    canWait: command.canWait,
    // §51: the line counts the lists it sits above, and nothing else — and it
    // says nothing at all when it has nothing to count.
    //
    // `orientationLine` falls back to "Nothing dated for today stands out from
    // what Conqify has recorded" when every clause is zero. That sentence is
    // right for a store with nothing in it and wrong above a recommendation:
    // once the count of items needing attention became the RENDERED count,
    // world D dropped to zero clauses (its one overdue item is the suggestion)
    // and the line began contradicting the card underneath it. A count line
    // with no counts is not a sentence; it is an absence.
    orientation: hasClauses
      ? orientationLine(orientationInput, inbox.total, attention.length)
      : "",
    empty,
    view,
    command,
  };
}

/**
 * The recurrence rule on a fixed row, whichever kind carries it.
 *
 * One place, so an Event and an Action cannot end up described by two different
 * formatters — `describeRule` belongs to the time system and is the only one.
 */
function recurrenceLabel(f: { detail?: string; event?: EventOccurrence; action?: NextAction }): string | undefined {
  const rule = f.event?.event.recurrence ?? f.action?.recurrence;
  // `describeRule` returns "" for a rule it cannot read — a stored shape from
  // an older writer, say. An empty label is a blank span the reader cannot
  // interpret, so it is treated as no label rather than rendered.
  const said = rule ? describeRule(rule).trim() : "";
  if (said) return said;
  return f.detail === "All day" ? undefined : f.detail;
}

/** Every string this projection can put on screen, for the language sweep. */
export function todaySurfaceStrings(c: TodayCommand): string[] {
  return [
    c.orientation, c.suggestedNote ?? "", c.canWait ?? "",
    NOTHING_PRESSING, OPEN_WORK_NOTE, NOTHING_TO_SHOW,
    ...c.fixed.map((f) => f.detail ?? ""),
    ...c.work.map((w) => `${w.detail} ${w.inlineReason ?? ""}`),
    ...c.attention.map((a) => a.explanation),
    ...(c.decisions.top ? [c.decisions.top.question, c.decisions.top.reason] : []),
    // LIFEOS-106. The day's arithmetic is prose this surface prints, so it is
    // held to the same vocabulary as everything else on the page — a capacity
    // line is exactly the sort of copy that drifts into a verdict.
    c.shape.line ?? "",
    ...c.shape.conflicts.map((x) => conflictLine(x)),
  ].filter(Boolean);
}

/** Is this action dated at all? Used by the quiet-day list to say so. */
export function openWorkDetail(a: NextAction, today: DayKey): string {
  const due = dueKeyOf(a);
  if (!due) return a.status === "in_progress" ? "In progress" : "No date";
  return due > today ? `Due ${due}` : "Due today";
}
