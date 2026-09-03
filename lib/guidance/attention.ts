/**
 * The attention shortlist — "what should I focus on?" (LIFEOS-082 §4, §6, §9).
 *
 * ## What this is NOT
 *
 * Not a second signal engine. `buildCommitmentSignals` already produces nine
 * grounded kinds with a lexicographic order, factual explanations, evidence
 * fields and a resolution mapping, and Today already renders them. The 082 audit
 * found the signal layer far more complete than the gap suggested — what was
 * missing was **reach**, not detection.
 *
 * So this module composes. It calls the existing builder, adds the one grounded
 * fact that never reached guidance, orders by the order that already exists,
 * and cuts the list to something a person can act on. It re-derives nothing.
 *
 * ## The three facts that were computed and never surfaced
 *
 *   repeated deferral   `repeatedlyPostponed`   LIFEOS-081  → added here
 *   rule tension        `findTensions`          LIFEOS-079  → context, not a kind
 *   executive changes   `buildExecutiveChanges` LIFEOS-081  → deliberately not used
 *
 * The last one is a refusal §19 asks for: a change only deserves attention when
 * it leaves an unresolved consequence, and any such consequence is already
 * represented by one of the nine kinds. Adding it would duplicate a row rather
 * than inform one.
 *
 * ## Attention is not a next action (§3)
 *
 *   "Submit application"                        → a next action
 *   "You deferred 'Request recommendation' 3×"  → attention
 *
 * `recommendNextAction` answers the first and is not touched by this file.
 * Nothing here ranks tasks, and nothing here is executable on its own.
 *
 * ## No score, anywhere (§7)
 *
 * Ordering is lexicographic by kind, then by date, then by id. Every position
 * in the list is explainable by pointing at a field. There is no weight, no
 * percentage, no urgency number, and no way to add one without changing
 * `ATTENTION_ORDER`, which is a list of words.
 *
 * ## Pure
 *
 * A function of `(state, indexes, today)`. No store writes, no clock of its own,
 * no network, no AI.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { NextAction, RecordRefLite, StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import {
  buildCommitmentSignals, dedupe, COMMITMENT_ORDER,
  type CommitmentKind, type CommitmentReason, type CommitmentSignal,
} from "@/lib/commitment/signals";
import { repeatedlyPostponed, postponedLine } from "@/lib/memory/changes";
import { resolveRange } from "@/lib/insights/range";
import { rulesMatchingText } from "@/lib/code/personal-code";

// ------------------------------------------------------------------ kinds --

/**
 * The nine existing kinds, plus the one the audit found missing.
 *
 * `CommitmentKind` is reused rather than re-listed: a kind added to the signal
 * layer appears here automatically, and one removed there stops type-checking
 * here. That coupling is deliberate — two lists of attention kinds is exactly
 * the drift LIFEOS-081 spent a sprint undoing for "changed".
 */
export type AttentionKind = CommitmentKind | "repeated_deferral";

/**
 * THE ORDERING (§8). Lexicographic, first difference wins. No score.
 *
 * `COMMITMENT_ORDER` is spliced in whole rather than retyped, so Today's
 * section ordering and this shortlist can never disagree — and so that changing
 * one is visibly a change to both.
 *
 * `repeated_deferral` goes AFTER `due_soon`, which is the one judgement this
 * file makes about position. §8 forbids letting a vague long-term signal
 * outrank a concrete deadline, and a pattern of deferrals — however real — is
 * softer evidence than a date that has arrived. Everything with a date on it
 * comes first; the behavioural fact comes next; structural concerns last.
 */
export const ATTENTION_ORDER: readonly AttentionKind[] = (() => {
  const out: AttentionKind[] = [];
  for (const k of COMMITMENT_ORDER) {
    out.push(k);
    if (k === "due_soon") out.push("repeated_deferral");
  }
  return out;
})();

const RANK = new Map<AttentionKind, number>(ATTENTION_ORDER.map((k, i) => [k, i]));

/** Default shortlist size (§9). Three things a person can hold in their head. */
export const ATTENTION_DEFAULT_LIMIT = 3;
/** Hard ceiling (§9). "The user does not need a 17-item guilt inventory." */
export const ATTENTION_MAX_LIMIT = 5;

export interface ExecutiveAttentionItem {
  /** Stable derived key. Same state, same id — nothing random (§28). */
  id: string;
  kind: AttentionKind;
  entity: RecordRefLite;
  /** The record's own title. Never generated prose. */
  title: string;
  /** Why Conqify is showing this, in one factual sentence (§10). */
  explanation: string;
  /** The field this traces to. Asserted in tests. */
  evidence: string;
  /** The date the explanation refers to, when there is one. */
  date?: DayKey;
  projectRef?: RecordRefLite;
  /** Other true facts about the same item. Never a second row. */
  secondaryReasons: CommitmentReason[];
  /**
   * Rules of the user's that mention this item's words (§21).
   *
   * CONTEXT, never rank. This field is read by the presentation layer and by
   * nothing in the ordering — a rule cannot move an item up the list, and the
   * assertion that it cannot is one of the ones worth keeping.
   */
  ruleContext: string[];
  /**
   * The signal this came from, when it came from one.
   *
   * Carried so a caller can offer the SAME resolutions Today offers, from
   * LIFEOS-071's builder. Absent on `repeated_deferral`, which has no
   * `CommitmentKind` and therefore no entry in `RESOLUTIONS_BY_KIND` — that
   * case uses `resolutionsForAction`, exactly as LIFEOS-072's recommendation
   * does, rather than synthesising a signal no evidence supports.
   */
  signal?: CommitmentSignal;
  /** The action behind this item, when there is one. For `resolutionsForAction`. */
  actionId?: string;
}

/**
 * How far back to look for repeated deferrals.
 *
 * Bounded because the shortlist is about now: a task deferred three times last
 * spring and untouched since is not what a person means by "what should I focus
 * on today". Ninety days is stated here rather than buried, and it is the only
 * window this file introduces — §13's warning about inventing windows is why
 * there is not a second one.
 */
export const DEFERRAL_LOOKBACK_DAYS = 90;

export interface AttentionOptions {
  /** How many to return. Clamped to `ATTENTION_MAX_LIMIT`. */
  limit?: number;
  /** Only items about this record, or about work under it (§25). */
  entity?: RecordRefLite;
}

function itemFromSignal(state: StoreState, s: CommitmentSignal): ExecutiveAttentionItem {
  return {
    id: `${s.kind}:${s.recordRef.kind}:${s.recordRef.id}`,
    kind: s.kind,
    entity: s.recordRef,
    title: s.title,
    explanation: s.explanation,
    evidence: s.evidence,
    date: s.date,
    projectRef: s.projectRef,
    secondaryReasons: s.secondaryReasons,
    ruleContext: ruleContextFor(state, s.title),
    signal: s,
    actionId: s.recordRef.kind === "action" ? s.recordRef.id : undefined,
  };
}

/**
 * The user's own rules that mention this item's words.
 *
 * Reuses `rulesMatchingText`, which is word-level and never substring — the
 * same function the Personal Code page uses, so a rule shown here as context is
 * a rule the user would find there.
 */
function ruleContextFor(state: StoreState, text: string): string[] {
  return rulesMatchingText(state, text).map((r) => r.statement);
}

/**
 * Everything that currently deserves a look, ordered and capped.
 *
 * The cap is applied LAST, after ordering, so what survives is the most direct
 * evidence rather than whatever happened to be built first.
 */
export function buildAttentionShortlist(
  state: StoreState,
  ix: TodayIndexes,
  today: DayKey,
  opts: AttentionOptions = {},
): ExecutiveAttentionItem[] {
  const limit = Math.min(Math.max(1, opts.limit ?? ATTENTION_DEFAULT_LIMIT), ATTENTION_MAX_LIMIT);

  // 1. The existing signal layer, unchanged and unduplicated.
  const signals = dedupe(buildCommitmentSignals(state, ix, { today }));
  const items: ExecutiveAttentionItem[] = signals.map((s) => itemFromSignal(state, s));

  // 2. The one grounded fact that never reached guidance (§16).
  //
  //    `repeatedlyPostponed` already excludes recurring work and already counts
  //    only recorded deferrals at distinct instants — LIFEOS-081 §14/§15. Both
  //    guarantees are inherited by calling it rather than re-deriving it.
  const start = shiftDay(today, -DEFERRAL_LOOKBACK_DAYS);
  const range = resolveRange("custom", { today, customStart: start, customEnd: today });
  const alreadyListed = new Set(items.map((i) => i.entity.id));
  for (const p of repeatedlyPostponed(state, range)) {
    // One commitment, one row (§19's no-double-reporting, applied here). An
    // action already surfaced as overdue does not need a second line saying it
    // has also been deferred — that fact rides along as a secondary reason.
    if (alreadyListed.has(p.action.id)) {
      const existing = items.find((i) => i.entity.id === p.action.id);
      if (existing) {
        existing.secondaryReasons = [...existing.secondaryReasons, {
          code: "repeatedly_deferred",
          text: postponedLine(p),
          evidence: "action.history[].deferred",
        }];
      }
      continue;
    }
    items.push({
      id: `repeated_deferral:action:${p.action.id}`,
      kind: "repeated_deferral",
      entity: { kind: "action", id: p.action.id },
      title: p.action.title,
      // §16's wording, and §26's boundary: a count, never a diagnosis.
      explanation: postponedLine(p),
      evidence: "action.history[].deferred",
      date: p.lastAt.slice(0, 10) as DayKey,
      projectRef: p.action.projectId ? { kind: "project", id: p.action.projectId } : undefined,
      secondaryReasons: [],
      ruleContext: ruleContextFor(state, p.action.title),
      actionId: p.action.id,
    });
  }

  const scoped = opts.entity ? items.filter((i) => inAttentionScope(state, i, opts.entity!)) : items;
  return sortAttention(scoped).slice(0, limit);
}

/**
 * Is this item about the named record, or about work under it? (§25)
 *
 * A goal's scope includes its projects and the actions under them, because
 * "what needs attention with graduate school?" is not a question about the goal
 * ROW — it is a question about everything carrying that direction.
 */
export function inAttentionScope(
  state: StoreState,
  item: { entity: RecordRefLite; projectRef?: RecordRefLite },
  entity: RecordRefLite,
): boolean {
  if (item.entity.kind === entity.kind && item.entity.id === entity.id) return true;

  if (entity.kind === "project") {
    return item.projectRef?.id === entity.id;
  }
  if (entity.kind === "goal") {
    const projectIds = new Set(
      (state.projects ?? []).filter((p) => p.goalId === entity.id).map((p) => p.id),
    );
    if (item.projectRef && projectIds.has(item.projectRef.id)) return true;
    // An action linked straight to the goal, with no project in between.
    if (item.entity.kind === "action") {
      const a = (state.nextActions ?? []).find((x) => x.id === item.entity.id);
      if (a?.goalId === entity.id) return true;
      if (a?.projectId && projectIds.has(a.projectId)) return true;
    }
  }
  return false;
}

/**
 * Ordering (§8, §29). Kind, then date, then id.
 *
 * A tie does NOT mean returning nothing — that rule belongs to
 * `recommendNextAction`, where a wrong single pick is the whole answer. This is
 * a shortlist, so identical items are ordered by a stable deterministic
 * tie-break and both are shown.
 */
export function sortAttention(items: ExecutiveAttentionItem[]): ExecutiveAttentionItem[] {
  return [...items].sort((a, b) => {
    const ra = RANK.get(a.kind) ?? 99;
    const rb = RANK.get(b.kind) ?? 99;
    if (ra !== rb) return ra - rb;
    // Earlier date first: a thing that slipped on Monday is more directly
    // evidenced than one that slipped today.
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.id.localeCompare(b.id);
  });
}

/** Shift a day key by N days without a Date round-trip in the caller. */
function shiftDay(day: DayKey, delta: number): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10) as DayKey;
}

/** Said when nothing qualifies (§38.10). Bounded to the record, never praise. */
export const NOTHING_NEEDS_ATTENTION =
  "Nothing in what Conqify has recorded is asking for attention right now.";

/**
 * The one sentence that introduces a shortlist.
 *
 * Deliberately not "your top priorities" — there is no priority here, only
 * evidence, and calling it a priority would imply a ranking the product does
 * not compute.
 */
export const ATTENTION_HEADING = "What may deserve your attention";

/**
 * Words this layer may never use (§24, §26).
 *
 * The commitment layer's bans, plus the psychologising this sprint could
 * plausibly introduce. Asserted by sweeping every string the module produces.
 */
export const ATTENTION_FORBIDDEN_WORDS: readonly string[] = [
  "neglect", "neglecting", "neglected", "avoiding", "you avoid", "afraid",
  "anxious", "sabotag", "procrastinat", "lazy", "undisciplined", "failing",
  "you failed", "you should have", "priority score", "importance", "urgency",
  "top priority", "falling behind", "you're behind",
];

/** Every string this module can put in front of a person. For the sweep. */
export function attentionStrings(items: ExecutiveAttentionItem[]): string[] {
  return [
    NOTHING_NEEDS_ATTENTION,
    ATTENTION_HEADING,
    ...items.flatMap((i) => [
      i.title, i.explanation,
      ...i.secondaryReasons.map((r) => r.text),
      ...i.ruleContext,
    ]),
  ];
}

/** True when an action is the subject of a `repeated_deferral` item. */
export function isRepeatedlyDeferred(items: ExecutiveAttentionItem[], action: NextAction): boolean {
  return items.some((i) => i.kind === "repeated_deferral" && i.entity.id === action.id);
}
