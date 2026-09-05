/**
 * What Conqify cannot decide without you (LIFEOS-094).
 *
 * ## The line this draws
 *
 * LIFEOS-082 already answers "what deserves notice?" This answers a different
 * question — "what should Conqify NOT settle on its own?" — and the two are not
 * the same list. An overdue action needs notice; it does not need a decision,
 * because the answer is to do it. Two open actions that both match what you
 * said needs a decision, because picking one would be the product guessing at
 * something only you know.
 *
 * The audit found the test hiding in the resolutions each signal already
 * offers. Where the options are ways of DOING the work — complete, reschedule,
 * defer, open — the user needs notice. Where they are mutually exclusive
 * answers to a question the system cannot settle — keep waiting or stop; give
 * this goal a path or leave it — that is a judgment boundary. Seven of the ten
 * attention kinds fall on the first side.
 *
 * ## Why this is not a filter over the shortlist
 *
 * It was going to be, until the measurement. `buildAttentionShortlist` collapses
 * one record to one kind and picks by `ATTENTION_ORDER`, which puts attention
 * ahead of judgment — so an action both overdue and deferred three times comes
 * back as `["overdue"]` and its deferral decision is invisible. Filtering that
 * list would hide every decision sitting on a record with a louder attention
 * signal. So this derives from the four sources directly and dedupes with its
 * own precedence (§19).
 *
 * ## Nothing here is stored
 *
 * No queue rows, no dismissals, no status (§24). Every item is derived from
 * records that already exist, which buys three things persistence would have to
 * re-implement: a resolved condition stops producing its item for free (§39),
 * the queue reflects synced state without a sync domain of its own (§41), and
 * there is no way for a stored row to disagree with the record it describes.
 *
 * ## Pure
 *
 * A function of `(state, indexes, today)`. No writes, no clock, no AI (§43).
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { Goal, NextAction, RecordRefLite, StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import { todayKey } from "@/lib/reviews/dates";
import { resolveRange } from "@/lib/insights/range";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { repeatedlyPostponed, REPEATED_THRESHOLD } from "@/lib/memory/changes";
import { goalsWithoutAnyPath } from "@/lib/execution/alignment";
import { interpret } from "@/lib/capture/interpret";
import { buildCaptureContextIndex, suggestContext } from "@/lib/capture/context";
import { isLive } from "@/lib/actions/due";
import type { ResolutionKind } from "@/lib/commitment/resolve";
import type { ReplanIntent } from "@/lib/planning/replan";

// ----------------------------------------------------------------- kinds ---

/**
 * The kinds backed by current product evidence, and only those.
 *
 * `PERSONAL_CODE_CONFLICT` is absent deliberately: LIFEOS-079 has no conflict
 * detector — the only "conflict" in `personal-code.ts` is a topic keyword in a
 * life-area list, beside "argument" and "fight" — and §6 forbids inventing a
 * kind because it sounds useful.
 *
 * `AMBIGUOUS_PERSON` is absent for a different reason: `longerForms` needs a
 * NAME, so Marcus and Marcus Webb are only ambiguous once something asks about
 * Marcus. There is no store-wide derivation to read, and §9 says to leave a
 * purely informational ambiguity contextual.
 *
 * `BLOCKED_REVIEW` is absent because a blocked action's only resolutions are
 * `open_blocker` and `open_record` — navigation, not a choice (§12).
 */
export type DecisionKind =
  | "AMBIGUOUS_CAPTURE_CONTEXT"
  | "WAITING_FOLLOW_UP"
  | "GOAL_NO_PATH"
  | "REPEATED_DEFERRAL_REVIEW";

/**
 * §37's precedence, and the reason for it.
 *
 * An ambiguity BLOCKS something the user already started — a capture they wrote
 * and have not filed — so it comes first. A due follow-up is a date that has
 * arrived. A structural goal choice has no clock on it. A reconsideration is
 * the softest: three deferrals is a fact, not a deadline.
 *
 * Lexicographic by kind, then by the date the item refers to, then by id. No
 * score anywhere (§37).
 */
export const DECISION_ORDER: readonly DecisionKind[] = [
  "AMBIGUOUS_CAPTURE_CONTEXT",
  "WAITING_FOLLOW_UP",
  "GOAL_NO_PATH",
  "REPEATED_DEFERRAL_REVIEW",
];

const RANK = new Map(DECISION_ORDER.map((k, i) => [k, i]));

// ----------------------------------------------------------------- model ---

/**
 * One thing a person can do about a decision. Never a fake button (§21).
 *
 * Exactly one of `resolution`, `replan` or `href` is set, and the first two are
 * the EXISTING vocabularies rather than strings: `ResolutionKind` is
 * LIFEOS-071's table and `ReplanIntent` is LIFEOS-090's, both imported as
 * types, so a label that names an operation nothing implements cannot compile.
 * That matters here more than usual — the first draft of this file offered
 * "Stop doing this" as `resolution: "stop"`, which is not a `ResolutionKind` at
 * all and would have rendered a button with nothing behind it.
 *
 * Two vocabularies rather than one because neither covers the queue alone: 071
 * has no way to end a commitment, and 090 has no follow-up or goal-project
 * operation. Both already write through store primitives, and this layer adds
 * no third path.
 */
export interface DecisionOption {
  id: string;
  label: string;
  /** LIFEOS-071's operation, when the answer is one of those. */
  resolution?: ResolutionKind;
  /** LIFEOS-090's intent, when the answer is a replan or an ending. */
  replan?: ReplanIntent;
  /** Where it goes, when the honest answer is "look at this". */
  href?: string;
}

export interface DecisionItem {
  /** Stable derived key. Same state, same key — nothing random. */
  key: string;
  kind: DecisionKind;
  entity: RecordRefLite;
  /** The record's own words. Never generated prose. */
  title: string;
  /** §20. The actual decision, as a question a person would ask. */
  question: string;
  /** §38. Why Conqify needs the user, in one checkable sentence. */
  reason: string;
  /** The field this traces to. Asserted in tests. */
  evidence: string;
  /** §21. Two to four, each mapping to something that exists. */
  options: DecisionOption[];
  /** The date the reason refers to, when there is one. */
  date?: DayKey;
  /** Where the entity lives. */
  href: string;
}

export interface DecisionInbox {
  items: DecisionItem[];
  /** Everything derived, before the cap — so "show more" can be honest. */
  total: number;
}

// ------------------------------------------------------------- constants ---

/** §4. "Decisions" is taken — the palette already opens the knowledge kind. */
export const DECISION_HEADING = "Needs your decision";

/** §35. Zero is a success state, and the copy says so without filling space. */
export const DECISION_EMPTY = "Nothing needs your decision right now.";

/** §36. Small by default. The audit's realistic worlds produced one to three. */
export const MAX_DECISIONS = 5;

/**
 * Words this layer may never use (§44, §20, §38).
 *
 * The psychology ban is the load-bearing half. Three deferrals is evidence of
 * three deferrals; it is not evidence of avoidance, fear or self-sabotage, and
 * a product that reads it that way is diagnosing someone from a date field.
 */
export const DECISION_FORBIDDEN_WORDS: readonly string[] = [
  "avoiding", "avoidance", "afraid", "fear", "resistance", "self-sabotage",
  "procrastinat", "you keep", "failing", "should have", "needs attention",
  "urgent", "critical", "score", "priority score", "at risk",
];

// --------------------------------------------------------------- helpers ---

const actionHref = (id: string) => `/actions/${id}`;
const goalHref = (id: string) => `/goal/${id}`;
const captureHref = (id: string) => `/capture?capture=${id}`;

// ------------------------------------------------------------ the sources --

/**
 * A wait whose follow-up date has ARRIVED (§11).
 *
 * Not every wait — a follow-up three weeks out is a plan, not a question. The
 * signal layer already draws that line, so this reads `follow_up_due` rather
 * than re-deriving it and risking a second definition.
 */
function waitingDecisions(state: StoreState, ix: TodayIndexes, today: DayKey): DecisionItem[] {
  const out: DecisionItem[] = [];
  for (const s of buildCommitmentSignals(state, ix, { today })) {
    if (s.kind !== "follow_up_due") continue;
    const a = (state.nextActions ?? []).find((x) => x.id === s.recordRef.id);
    if (!a || !isLive(a)) continue;
    const who = a.waitingOn?.trim();
    out.push({
      key: `follow_up:${a.id}`,
      kind: "WAITING_FOLLOW_UP",
      entity: { kind: "action", id: a.id },
      title: a.title,
      // §20. The decision, not the diagnosis.
      question: who ? `Follow up with ${who}?` : "Follow up on this?",
      reason: s.explanation,
      evidence: "action.followUpDate",
      date: a.followUpDate,
      options: [
        { id: "follow_up", label: "Set next follow-up", resolution: "set_follow_up" },
        { id: "stop", label: "Stop waiting", resolution: "stop_waiting" },
        { id: "open", label: "Open", href: actionHref(a.id) },
      ],
      href: actionHref(a.id),
    });
  }
  return out;
}

/**
 * An active goal nothing is carrying (§13).
 *
 * `goalsWithoutAnyPath` is LIFEOS-088's own predicate, so the goal page and
 * this queue cannot disagree about what "no path" means. Achieved and abandoned
 * goals are excluded by that predicate, not by a second rule here.
 *
 * It is that predicate and NOT `goalsMissingPath`, which asks only about
 * projects. 088 kept the two apart on purpose: Today's sentence claims only
 * that no active project carries the goal, while this row asks "what should
 * carry this goal?" — a question with a wrong answer when a live action is
 * already linked straight to it. Measured: a goal with one open directly-linked
 * action is `goalPathState` "actions", still listed by `goalsMissingPath`, and
 * absent from `goalsWithoutAnyPath`. Asking it here would be a decision the
 * user has already made.
 */
function goalDecisions(state: StoreState): DecisionItem[] {
  return goalsWithoutAnyPath(state).map((g: Goal) => ({
    key: `goal_path:${g.id}`,
    kind: "GOAL_NO_PATH" as const,
    entity: { kind: "goal", id: g.id } as RecordRefLite,
    title: g.title,
    question: "What should carry this goal?",
    // §13. A fact about records, and no implication of failure.
    reason: "No active project or live action is linked to this goal.",
    evidence: "project.goalId",
    options: [
      { id: "project", label: "Add a project", resolution: "create_goal_project" },
      { id: "open", label: "Open goal", href: goalHref(g.id) },
    ],
    href: goalHref(g.id),
  }));
}

/**
 * Work put off enough times to be worth a second look (§10).
 *
 * The threshold is LIFEOS-081's, and so is the counting: recorded `deferred`
 * history entries at distinct instants, with recurring work excluded outright
 * because a standing schedule is not avoidance.
 */
function deferralDecisions(state: StoreState, today: DayKey, offsetMinutes?: number): DecisionItem[] {
  // The record's whole life, so the count does not depend on when you asked.
  const wide = resolveRange("custom", { customStart: "1970-01-01", customEnd: today, offsetMinutes });
  return repeatedlyPostponed(state, wide, REPEATED_THRESHOLD)
    .filter((p) => isLive(p.action))
    .map((p) => ({
      key: `deferral:${p.action.id}`,
      kind: "REPEATED_DEFERRAL_REVIEW" as const,
      entity: { kind: "action", id: p.action.id } as RecordRefLite,
      title: p.action.title,
      question: `Keep “${p.action.title}”?`,
      // §44. The count is the claim. What it means is the person's business.
      reason: `You deferred this ${p.count} times.`,
      evidence: "action.history[].deferred",
      // The labels are the ones the engines themselves produce, so the row and
      // the control cannot disagree about what a button does. There is no
      // no-op "Keep it": keeping this means committing to a date, and a button
      // that changes nothing is the fake button §21 forbids.
      options: [
        { id: "reschedule", label: "Reschedule", resolution: "reschedule" },
        { id: "not_today", label: "Not today", resolution: "not_today" },
        { id: "stop", label: "Stop doing this", replan: { kind: "stop" } },
        { id: "open", label: "Open", href: actionHref(p.action.id) },
      ],
      href: actionHref(p.action.id),
    }));
}

/**
 * A capture still in the inbox whose context is genuinely contested (§8, §30).
 *
 * §30 and §31 expected this to be transient and therefore ineligible. It is
 * not: a `Capture` persists with a `processingStatus`, and `interpret` and
 * `suggestContext` are both pure functions of persisted state, so the ambiguity
 * re-derives from the record. Measured — an inbox capture reading "Follow up on
 * the applications and the portfolio review" comes back with "More than one
 * Project matches — choose which."
 *
 * The boundary §31 asks about is real and sits either side of this: a PROCESSED
 * capture has nothing unresolved, and a candidate the composer holds before the
 * capture is saved has no record at all. Neither is eligible.
 */
function captureDecisions(state: StoreState, today: DayKey): DecisionItem[] {
  const captures = (state.captures ?? []).filter(
    (c) => (c.processingStatus ?? "inbox") === "inbox" && !c.archivedAt,
  );
  if (captures.length === 0) return [];

  const index = buildCaptureContextIndex(state);
  const out: DecisionItem[] = [];
  for (const c of captures) {
    let asked = false;
    for (const candidate of interpret(c.text, state, today).candidates ?? []) {
      if (asked) break;
      for (const s of suggestContext(candidate, state, index)) {
        // Only a CONTESTED suggestion is a decision. A confident one is a
        // suggestion the composer can offer, and §20 of LIFEOS-089 already
        // governs how — this queue is for the ones that cannot be offered.
        // §24 of LIFEOS-089 populates `ambiguousAlternatives` only when the
        // suggestion is genuinely ambiguous, with nothing preselected — which
        // is exactly this queue's admission test.
        if (!s.ambiguousAlternatives || s.ambiguousAlternatives.length === 0) continue;
        out.push({
          key: `capture_context:${c.id}`,
          kind: "AMBIGUOUS_CAPTURE_CONTEXT",
          entity: { kind: "capture", id: c.id },
          title: c.text,
          question: "Which project does this belong to, if either?",
          reason: s.reason,
          evidence: "capture.text",
          options: [
            ...s.ambiguousAlternatives.slice(0, 2).map((alt, i) => ({
              id: `alt${i}`, label: alt.label, href: captureHref(c.id),
            })),
            { id: "none", label: "Neither", href: captureHref(c.id) },
          ],
          href: captureHref(c.id),
        });
        asked = true;
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ the builder --

export interface DecisionInboxOptions {
  today?: DayKey;
  offsetMinutes?: number;
  /** How many to return. The rest are counted, never dropped silently (§36). */
  limit?: number;
}

/**
 * Everything Conqify currently cannot decide alone (§5).
 *
 * §19's ownership rule: one underlying record produces at most one row, and the
 * kind that wins is the earliest in `DECISION_ORDER`. A goal that is both
 * path-missing and something else is one question, not two, and an action that
 * is both a due follow-up and a repeated deferral is asked about once — as the
 * follow-up, because a date that has arrived outranks a pattern.
 */
export function buildDecisionInbox(
  state: StoreState,
  ix: TodayIndexes,
  opts: DecisionInboxOptions = {},
): DecisionInbox {
  const today = opts.today ?? todayKey();
  const all = [
    ...captureDecisions(state, today),
    ...waitingDecisions(state, ix, today),
    ...goalDecisions(state),
    ...deferralDecisions(state, today, opts.offsetMinutes),
  ];

  // §19. One record, one row. First writer wins, and the sources are visited in
  // precedence order above, so "first" means "highest precedence".
  const byRecord = new Map<string, DecisionItem>();
  for (const item of all) {
    const id = `${item.entity.kind}:${item.entity.id}`;
    const held = byRecord.get(id);
    if (!held || (RANK.get(item.kind) ?? 99) < (RANK.get(held.kind) ?? 99)) {
      byRecord.set(id, item);
    }
  }

  const items = [...byRecord.values()].sort((a, b) =>
    (RANK.get(a.kind) ?? 99) - (RANK.get(b.kind) ?? 99)
    || (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31")
    || a.key.localeCompare(b.key));

  return { items: items.slice(0, opts.limit ?? MAX_DECISIONS), total: items.length };
}

/** The compact count Today and the Morning brief show, or null at zero (§26, §27). */
export function decisionCountLine(inbox: DecisionInbox): string | null {
  if (inbox.total === 0) return null;
  return `${DECISION_HEADING} · ${inbox.total}`;
}

/**
 * Whether an option is still safe to run (§40).
 *
 * A queue rendered a minute ago can be acted on after the record changed in
 * another tab. The check is deliberately about the RECORD, not about the row:
 * a completed action is no longer a thing to stop waiting on, and a goal that
 * gained a project no longer needs a path.
 */
export function decisionStillStands(state: StoreState, item: DecisionItem): boolean {
  switch (item.kind) {
    case "WAITING_FOLLOW_UP": {
      const a = (state.nextActions ?? []).find((x) => x.id === item.entity.id);
      return !!a && a.status === "waiting" && isLive(a);
    }
    case "REPEATED_DEFERRAL_REVIEW": {
      const a = (state.nextActions ?? []).find((x) => x.id === item.entity.id);
      return !!a && isLive(a);
    }
    case "GOAL_NO_PATH":
      return goalsWithoutAnyPath(state).some((g) => g.id === item.entity.id);
    case "AMBIGUOUS_CAPTURE_CONTEXT": {
      const c = (state.captures ?? []).find((x) => x.id === item.entity.id);
      return !!c && (c.processingStatus ?? "inbox") === "inbox" && !c.archivedAt;
    }
    default:
      return false;
  }
}

/** Every string the queue can produce, for the language guards to sweep. */
export function decisionStrings(inbox: DecisionInbox): string[] {
  return [
    DECISION_HEADING, DECISION_EMPTY, decisionCountLine(inbox) ?? "",
    ...inbox.items.flatMap((i) => [i.question, i.reason, ...i.options.map((o) => o.label)]),
  ];
}

/** Live actions a decision refers to, for surfaces that want the record. */
export function decisionAction(state: StoreState, item: DecisionItem): NextAction | undefined {
  if (item.entity.kind !== "action") return undefined;
  return (state.nextActions ?? []).find((a) => a.id === item.entity.id);
}
