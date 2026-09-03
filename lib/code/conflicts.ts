/**
 * When two of your own rules point different ways (LIFEOS-079 §10).
 *
 * ## The case this exists for
 *
 *   "Answer people promptly."                    — a standard
 *   "When I'm angry, wait before replying."      — a protocol
 *
 * Both are the user's. Both are reasonable. In the moment they disagree, and
 * the person is better served by seeing that than by a product that quietly
 * decides for them.
 *
 * ## No winner, ever
 *
 * This module returns BOTH rules and one factual sentence about why they may
 * disagree. It does not rank them, score them, mark one violated, suggest
 * retiring either, or reorder anything. Choosing between one's own commitments
 * is the person's business; noticing the tension is the product's.
 *
 * ## How a tension is detected
 *
 * Deterministically, and only on evidence a reader can check:
 *
 *   1. the two rules are about the same SUBJECT, AND
 *   2. one leans toward acting and the other toward holding back.
 *
 * "Same subject" is not word identity. The brief's own example —
 *
 *   "Answer people promptly."   /   "When I'm angry, wait before replying."
 *
 * — shares no word at all: `answer` and `replying` are the same subject in
 * English and different strings in a `Set`. A first draft required a shared
 * word and found nothing, which is the kind of test result worth believing:
 * the rule was wrong, not the example. So subjects are small literal groups of
 * synonyms, and a tension names the group it matched.
 *
 * The direction vocabulary is a fixed literal list. A rule with no direction
 * word is never reported as conflicting — the absence of evidence is not a
 * tension, and guessing at intent from a sentence is exactly the opaque
 * inference §17 forbids.
 */

import type { StoreState } from "@/types/mvp";
import { significantWords } from "@/lib/constitution/revision";
import { allRules, type CodeRule } from "@/lib/code/personal-code";

/** Words that lean toward acting now. */
const TOWARD = [
  "promptly", "quickly", "immediately", "now", "fast", "answer", "reply",
  "respond", "start", "begin", "always", "first",
];

/** Words that lean toward holding back. */
const AWAY = [
  "wait", "pause", "delay", "sleep", "later", "never", "don't", "dont", "not",
  "avoid", "stop", "before", "hold", "step",
];

export type RuleDirection = "toward" | "away" | "none";

/**
 * Which way a rule leans, or neither.
 *
 * `none` is the common and correct answer for most rules, and it means this
 * module stays silent about them. That is the intended bias: a missed tension
 * costs nothing, a fabricated one tells someone their own commitments are
 * incoherent when they are not.
 */
export function ruleDirection(rule: CodeRule): RuleDirection {
  const words = new Set(significantWords(rule.statement));
  const toward = TOWARD.some((w) => words.has(w));
  const away = AWAY.some((w) => words.has(w));
  if (toward && !away) return "toward";
  if (away && !toward) return "away";
  // Both or neither: a rule like "don't answer angry" carries an action word and
  // a restraint word and is not internally conflicted. Say nothing.
  return "none";
}

/**
 * Subjects two rules can be about, as literal synonym groups.
 *
 * Deliberately few and deliberately concrete. Each is a place where a "do it"
 * rule and a "hold back" rule genuinely collide in ordinary life.
 */
const SUBJECTS: Record<string, string[]> = {
  replying: ["answer", "answering", "reply", "replying", "respond", "responding", "message", "messages", "text", "texting", "email", "emails", "call", "calling"],
  spending: ["buy", "buying", "purchase", "purchases", "spend", "spending", "order", "ordering"],
  working: ["work", "working", "job", "task", "tasks", "deadline", "overtime"],
  deciding: ["decide", "deciding", "decision", "decisions", "commit", "quit", "quitting", "sign"],
  speaking: ["say", "saying", "tell", "telling", "speak", "speaking", "share", "post", "posting"],
};

export interface RuleTension {
  /** The rule leaning toward acting. */
  toward: CodeRule;
  /** The rule leaning toward holding back. */
  away: CodeRule;
  /** The words and/or subject that put them on the same thing. Shown, not summarised. */
  sharedWords: string[];
  /** The subject group, when that is what matched. Named so the UI can say it. */
  subject?: string;
}

/** Enough shared meaning to be about the same thing at all. */
const SHARED_WORDS_REQUIRED = 1;

function sharedSignificant(a: CodeRule, b: CodeRule): string[] {
  const wb = new Set(significantWords(b.statement));
  return significantWords(a.statement).filter((w) => wb.has(w));
}

/** The subjects a rule mentions. */
function subjectsOf(rule: CodeRule): string[] {
  const words = new Set(significantWords(rule.statement));
  return Object.keys(SUBJECTS).filter((k) => SUBJECTS[k].some((w) => words.has(w)));
}

/**
 * Tensions among the rules currently in force.
 *
 * Only `active` rules. A retired rule cannot conflict with anything — the
 * person already decided about it — and reporting it would be the product
 * arguing with a choice they have made.
 */
export function findTensions(state: StoreState): RuleTension[] {
  const active = allRules(state).filter((r) => r.state === "active");
  const toward = active.filter((r) => ruleDirection(r) === "toward");
  const away = active.filter((r) => ruleDirection(r) === "away");

  // Subjects computed once per rule, not once per pair — the pair loop is the
  // only quadratic part and it must stay cheap (§40).
  const subj = new Map<string, string[]>();
  for (const r of [...toward, ...away]) subj.set(r.id, subjectsOf(r));

  const out: RuleTension[] = [];
  for (const t of toward) {
    for (const a of away) {
      const shared = sharedSignificant(t, a);
      if (shared.length >= SHARED_WORDS_REQUIRED) {
        out.push({ toward: t, away: a, sharedWords: shared });
        continue;
      }
      const common = (subj.get(t.id) ?? []).find((k) => (subj.get(a.id) ?? []).includes(k));
      if (common) out.push({ toward: t, away: a, sharedWords: [], subject: common });
    }
  }
  return out;
}

/** Tensions involving one particular rule, for its own card. */
export function tensionsFor(state: StoreState, ruleId: string): RuleTension[] {
  return findTensions(state).filter((t) => t.toward.id === ruleId || t.away.id === ruleId);
}

/**
 * The one wording for a tension.
 *
 * "may point in different directions" — a hedge that is accurate, because
 * whether they actually conflict depends on a situation the product cannot see.
 * Never "conflict", "contradiction", "inconsistent" or "you broke".
 */
export const TENSION_LINE = "These two may point in different directions here.";

/** Words this layer may never use about a person's own commitments. */
export const CONFLICT_FORBIDDEN_WORDS: readonly string[] = [
  "violated", "violation", "broke", "broken", "failed", "failure", "inconsistent",
  "hypocrite", "contradiction", "should have", "you didn't", "non-compliant",
  "compliance", "score", "streak", "discipline",
];
