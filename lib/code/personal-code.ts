/**
 * Personal Code — one view of the standards a person has chosen (LIFEOS-079).
 *
 * ## Why this is a projection and not a domain
 *
 * A Rule already has a home, and LIFEOS-056 chose it deliberately:
 *
 *   > a rule is a `Protocol` (conditional) or a `standard` (unconditional)
 *
 * Both records already carry the user's own words, a lifecycle, provenance,
 * links and a place in the search index. A `rules` table would duplicate a
 * schema, its RLS policies, an export domain, a sync mapper, a tombstone path
 * and — for standards — a revision history, all of which exist. So Personal
 * Code is a READ MODEL: it unifies what is already stored, and stores nothing.
 *
 * ## The two halves are not pretended to be identical
 *
 * They genuinely differ, and the difference is reported rather than smoothed:
 *
 *   UNCONDITIONAL  `ConstitutionElement` kind `standard`. Adopted or retired —
 *                  there is no `paused`, because a standard you still hold but
 *                  are not applying is not a state the Constitution models.
 *                  Carries full lifecycle history through `ConstitutionRevision`.
 *   CONDITIONAL    `Protocol`. Active, paused or retired. Carries NO history,
 *                  so "when did I change this?" is unanswerable for it — stated
 *                  plainly wherever it matters instead of being faked from
 *                  `updatedAt`, which a typo fix also moves.
 *
 * ## What it never does
 *
 * No score, no compliance rate, no streak, no violation count, no percentage,
 * no ranking of one rule against another. Every number this module produces is
 * a count of records the user wrote.
 *
 * Pure and deterministic over `StoreState`.
 */

import type {
  ConstitutionElement, Protocol, RecordRefLite, StoreState,
} from "@/types/mvp";
import { normalizeStatement, significantWords } from "@/lib/constitution/revision";

/** The one user-facing name for this surface. Never "policy", "law", "code of conduct". */
export const PERSONAL_CODE_LABEL = "Personal Code";
/** The one user-facing name for a member of it. */
export const RULE_LABEL = "Rule";

/**
 * Which underlying record a rule is.
 *
 * Surfaced in the UI as a shape ("Always" / "When…") rather than as a domain
 * name — a person writing down how they want to behave should not have to learn
 * that one sentence becomes a Constitution standard and another a Protocol.
 */
export type RuleShape = "unconditional" | "conditional";

/**
 * The lifecycle states Personal Code can show.
 *
 * The union of both domains, NOT a lowest common denominator: `paused` exists
 * only for conditional rules and `draft` only for unconditional ones, and the
 * view says which rather than hiding the asymmetry behind a shared word.
 */
export type RuleState = "draft" | "active" | "paused" | "retired";

export const RULE_STATE_LABEL: Record<RuleState, string> = {
  draft: "Not adopted yet",
  active: "Active",
  paused: "Paused",
  retired: "Retired",
};

export interface CodeRule {
  /** The underlying record's id. Personal Code mints no ids of its own. */
  id: string;
  shape: RuleShape;
  /** `constitution_element` or `protocol` — the real record kind, for refs and hrefs. */
  recordKind: "constitution_element" | "protocol";
  /**
   * The rule as one sentence, in the USER'S words.
   *
   * For a standard this is `statement` verbatim. For a protocol it is the
   * trigger and response joined by the connective the user's own phrasing
   * implies — the two halves are stored separately and neither is rewritten.
   */
  statement: string;
  /** A conditional rule's trigger, stored without its leading "when"/"if". */
  trigger?: string;
  /** A conditional rule's response. */
  response?: string;
  /** The user's own "why this matters". Never generated. */
  note?: string;
  state: RuleState;
  /** References to goals, protocols, actions… Only standards carry these today. */
  linkedRefs: RecordRefLite[];
  /** True when the WORDING originated as machine prose the user kept. */
  fromAiText: boolean;
  sourceCaptureId?: string;
  /**
   * Whether this rule's record can answer "when did I change it?".
   *
   * False for every conditional rule, because `Protocol` has no history. The
   * UI and Memory both read this rather than assuming.
   */
  hasLifecycleHistory: boolean;
  createdAt: string;
  updatedAt: string;
}

const PROTOCOL_STATE: Record<Protocol["status"], RuleState> = {
  active: "active", paused: "paused", retired: "retired",
};

/**
 * A standard's Personal Code state.
 *
 * `adoptedAt` is the load-bearing field in LIFEOS-056: a saved-but-unadopted
 * element is NOT part of the Constitution. That reading is preserved exactly —
 * `draft` here means "written, not yet adopted", not "paused".
 */
function standardState(el: ConstitutionElement): RuleState {
  if (el.status === "retired") return "retired";
  if (el.status === "active" && el.adoptedAt) return "active";
  return "draft";
}

/** The one place a conditional rule becomes a sentence. */
export function conditionalStatement(trigger: string, response: string): string {
  const t = (trigger ?? "").trim();
  const r = (response ?? "").trim();
  if (!t) return r;
  if (!r) return `When ${t}`;
  return `When ${t}, ${r}`;
}

export function ruleFromStandard(el: ConstitutionElement): CodeRule {
  return {
    id: el.id,
    shape: "unconditional",
    recordKind: "constitution_element",
    statement: el.statement,
    note: el.note,
    state: standardState(el),
    linkedRefs: el.linkedRefs ?? [],
    fromAiText: el.fromAiText === true,
    sourceCaptureId: el.sourceCaptureId,
    hasLifecycleHistory: true,
    createdAt: el.createdAt,
    updatedAt: el.updatedAt,
  };
}

export function ruleFromProtocol(p: Protocol): CodeRule {
  return {
    id: p.id,
    shape: "conditional",
    recordKind: "protocol",
    statement: conditionalStatement(p.trigger, p.response),
    trigger: p.trigger,
    response: p.response,
    note: p.reason,
    state: PROTOCOL_STATE[p.status] ?? "active",
    // Protocols carry no links today. An empty array rather than a fabricated one.
    linkedRefs: [],
    fromAiText: p.fromAiText === true,
    sourceCaptureId: p.sourceCaptureId,
    // The limitation, carried on the record itself so no caller has to remember it.
    hasLifecycleHistory: false,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Every rule the person has written, both shapes, most recently changed first.
 *
 * `value`, `purpose` and `principle` elements are NOT included. They are what
 * the user believes and what matters to them; a Personal Code that swept them
 * in would be answering "what do I think?" while claiming to answer "how do I
 * want to act?".
 */
export function allRules(state: StoreState): CodeRule[] {
  const out: CodeRule[] = [];
  for (const el of state.constitutionElements ?? []) {
    if (el.kind !== "standard") continue;
    out.push(ruleFromStandard(el));
  }
  for (const p of state.protocols ?? []) out.push(ruleFromProtocol(p));
  return out.sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.statement.localeCompare(b.statement));
}

/** The rules currently in force. The honest answer to "what do I live by?". */
export function activeRules(state: StoreState): CodeRule[] {
  return allRules(state).filter((r) => r.state === "active");
}

export interface CodeGroup {
  state: RuleState;
  label: string;
  rules: CodeRule[];
}

/**
 * Grouped for display, in force first.
 *
 * Empty groups are dropped: a person with nothing retired does not need to be
 * shown an empty "Retired" heading, and unlike a goal horizon there is nothing
 * meaningful about the absence.
 */
export function groupRulesByState(rules: CodeRule[]): CodeGroup[] {
  const order: RuleState[] = ["active", "draft", "paused", "retired"];
  return order
    .map((s) => ({ state: s, label: RULE_STATE_LABEL[s], rules: rules.filter((r) => r.state === s) }))
    .filter((g) => g.rules.length > 0);
}

/** Counts, and nothing that reads as a measurement of the person. */
export function ruleCounts(state: StoreState): Record<RuleState | "total", number> {
  const rules = allRules(state);
  return {
    total: rules.length,
    active: rules.filter((r) => r.state === "active").length,
    draft: rules.filter((r) => r.state === "draft").length,
    paused: rules.filter((r) => r.state === "paused").length,
    retired: rules.filter((r) => r.state === "retired").length,
  };
}

export function findRule(state: StoreState, id: string): CodeRule | undefined {
  return allRules(state).find((r) => r.id === id);
}

/**
 * Whether a rule's record can say WHEN it changed, and why not when it cannot.
 *
 * Returned as a sentence so every surface says the same thing. `updatedAt` is
 * deliberately not offered as a substitute: it moves when a typo is fixed, so
 * presenting it as the date a standard changed would be inventing a life event.
 */
export const PROTOCOL_HISTORY_LIMITATION =
  "Conqify records when an unconditional rule changed, but not yet for a when/then rule.";

// ------------------------------------------------------------ topics -------

/**
 * Deterministic context matching (§16, §33).
 *
 * A fixed vocabulary, matched literally against the user's own words. There is
 * no learned weighting, no embedding and no relevance percentage — a rule
 * matches a context because the sentence contains one of these words, which is
 * a fact a person can check by reading their own rule.
 */
export const CODE_CONTEXTS = [
  "conflict", "work", "money", "health", "sleep", "relationships",
  "study", "parenting", "creative", "truth", "anger",
] as const;

export type CodeContext = (typeof CODE_CONTEXTS)[number];

const CONTEXT_WORDS: Record<CodeContext, string[]> = {
  conflict: ["conflict", "argument", "argue", "fight", "fighting", "confront", "escalate", "escalates"],
  work: ["work", "job", "meeting", "email", "colleague", "boss", "deadline", "project"],
  money: ["money", "spend", "spending", "buy", "purchase", "purchases", "budget", "cost"],
  health: ["health", "exercise", "eat", "eating", "drink", "drinking", "training", "body"],
  sleep: ["sleep", "bed", "bedtime", "rest", "tired", "late", "night"],
  relationships: ["relationship", "relationships", "partner", "friend", "friends", "family", "brother", "sister"],
  study: ["study", "studying", "read", "reading", "learn", "learning", "revision", "exam"],
  parenting: ["parenting", "child", "children", "kid", "kids", "son", "daughter"],
  creative: ["creative", "write", "writing", "draw", "music", "practice", "craft"],
  truth: ["truth", "truthful", "honest", "honesty", "lie", "lying", "exaggerate", "distort"],
  anger: ["angry", "anger", "furious", "upset", "rage", "mad", "frustrated"],
};

/**
 * Which contexts a rule mentions. Word-level, never substring.
 *
 * Substring matching would make "read" match "already" and "mad" match "made" —
 * a relevance claim the user could not verify from their own sentence.
 */
export function ruleContexts(rule: CodeRule): CodeContext[] {
  const words = new Set(significantWords(`${rule.statement} ${rule.note ?? ""}`));
  return CODE_CONTEXTS.filter((c) => CONTEXT_WORDS[c].some((w) => words.has(w)));
}

/** Rules mentioning a context, in the store's order. */
export function rulesInContext(state: StoreState, context: CodeContext): CodeRule[] {
  return allRules(state).filter((r) => ruleContexts(r).includes(context));
}

/**
 * Rules whose words overlap an arbitrary phrase.
 *
 * Used to connect a rule to an action or a capture. The overlap must be on
 * MEANING-BEARING words — `significantWords` drops the stopwords — and at least
 * one must match, so "the" never links a rule to anything.
 */
export function rulesMatchingText(state: StoreState, text: string): CodeRule[] {
  const needles = new Set(significantWords(text));
  if (needles.size === 0) return [];
  return allRules(state).filter((r) => {
    if (r.state !== "active") return false;
    return significantWords(r.statement).some((w) => needles.has(w));
  });
}

/** Normalised form, exported so duplicate and conflict detection agree with the UI. */
export const ruleKey = (r: CodeRule): string => normalizeStatement(r.statement);
