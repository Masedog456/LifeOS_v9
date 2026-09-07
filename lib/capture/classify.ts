/**
 * Deterministic capture classification (LIFEOS-054).
 *
 * Suggests where a capture probably belongs. It is a PURE function of the text:
 * no AI provider, no network, no state, no randomness. The same sentence always
 * produces the same suggestion, which is what makes the behaviour explainable and
 * testable — and what lets the whole feature work offline.
 *
 * ## The rule that governs everything here
 *
 * **Classify automatically; adopt only with confirmation.** Nothing in this
 * module creates a record. It returns a suggestion, a plain-language reason, and
 * (where extraction is safe) structured fields the user can edit before
 * confirming. Even "Call the dentist" — as unambiguous as captures get — yields a
 * proposal, never an action. The user remains the author of their commitments.
 *
 * ## Why deterministic rules rather than a model
 *
 * The common shapes of everyday capture are syntactically distinctive: an
 * imperative verb, a `when X → Y` conditional, a `waiting for` prefix. Rules
 * handle them with no latency, no cost, no provider dependency, and no risk of a
 * model quietly changing its mind between releases. An AI fallback for genuinely
 * ambiguous text is a reasonable future step; it is deliberately not this sprint.
 *
 * ## Confidence means routing, not truth
 *
 * `confidence` answers *"how sure is the system about where this goes?"* It never
 * answers "how true is this statement?". Nothing here computes belief confidence,
 * psychological certainty, or importance — those would be judgments about the
 * user's own thinking, which this product does not make.
 */

import type { CaptureType, ClassificationConfidence } from "@/types/mvp";
// LIFEOS-101. The tense test this module used to keep privately now lives with
// the other tense tests, so "is this past?" has one answer for every caller.
import { opensWithPastVerb } from "@/lib/capture/stance";

export type { CaptureType, ClassificationConfidence };

export interface ExtractedFields {
  /** Protocol: the condition, with its leading connective removed. */
  trigger?: string;
  /** Protocol: the intended response. */
  response?: string;
  /** Waiting: who or what is being waited on. */
  waitingOn?: string;
  /** Action/Project/Note: a cleaned title or body. */
  title?: string;
}

export interface CaptureClassification {
  suggestedType: CaptureType;
  confidence: ClassificationConfidence;
  /** Plain language, shown to the user. Never regex internals. */
  reason: string;
  extracted?: ExtractedFields;
  /** True when the text looks like it holds more than one intent. */
  multiIntent?: boolean;
}

/** Strip trailing punctuation and collapse whitespace, preserving the wording. */
function tidy(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "").trim();
}

/** Sentence-ish segmentation, shared with multi-intent detection. */
function sentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Imperative/action openers. Kept to verbs that are unambiguously about DOING
 * something in the world — a deliberately short list, because a long one starts
 * classifying ordinary prose as work.
 */
const ACTION_VERBS = [
  "call", "email", "text", "message", "send", "buy", "purchase", "order",
  "schedule", "book", "pay", "renew", "submit", "file", "return", "pick up",
  "drop off", "fix", "repair", "clean", "wash", "print", "sign", "mail",
  "reply", "respond", "confirm", "cancel", "register", "download", "upload",
  // LIFEOS-060: completion verbs. "Finish the dashboard" fell through to Note,
  // which is the single most common everyday errand shape the list was missing.
  // Kept to verbs that only ever describe doing — `review` and `make` are
  // deliberately absent, because "review of the paper" and "make of the car"
  // are ordinary nouns and a wrong action costs more than a right one gains.
  "finish", "complete", "update", "refill", "restock", "pack", "ship",
  "deliver", "apply", "draft", "unsubscribe", "reschedule",
  // LIFEOS-066 §11. Everyday errand verbs the LIFEOS-063 dogfood proved
  // missing. "Replace the kitchen tap washer" became a note, and four days
  // later there was nothing to reschedule.
  //
  // Each was checked for a noun collision before being added. The ones that
  // collide — `review`, `check`, `write`, `take`, `bring` — are here too, but
  // they are gated by NOUN_PHRASE_RE below, because "review of the book" and
  // "check-in time" are ordinary nouns and a wrong action costs more than a
  // right one gains.
  "replace", "swap", "collect", "post", "hang", "install", "assemble",
  "review", "check", "write", "take", "bring", "sort out", "throw out",
  "back up", "top up", "chase up", "look into", "sign up", "set up",
];

/**
 * Shapes where a leading verb is really the head of a NOUN phrase.
 *
 * "Review of the book" and "check-in at three" both start with a word on the
 * verb list and neither is something to do. The discriminator is the word
 * immediately after: a preposition ("of", "from") or a hyphen means the word is
 * being used as a noun, and an ordinary imperative never reads that way.
 */
const NOUN_PHRASE_RE = /^(?:review|check|write|take|bring|post|swap|sign|set|back|top)\s*(?:-|of\b|from\b|for\s+the\s+(?:week|month|year)\b|notes\b|s\b)/i;

/**
 * Outcome verbs implying a multi-step result rather than a single errand.
 * Used only for a LOW-confidence project suggestion — see `classifyCapture`.
 */
const PROJECT_VERBS = [
  "build", "create", "design", "launch", "plan", "organize", "organise",
  "set up", "renovate", "remodel", "redesign", "develop", "start a", "write a book",
];

/**
 * Verbs that open a WAY OF BEING rather than a thing to do.
 *
 * "I should be more patient" is a disposition and belongs to Personal Code;
 * "I should call the dentist" is an errand. Giving the first one a checkbox is
 * the LIFEOS-059 defect, and the distinction is the same one the normative
 * detector makes from the other side.
 *
 * LIFEOS-101 lifted this out of the `i should` rule so the reminder rule can
 * use it too — "Remind me to be kinder to myself" was becoming an auto-writable
 * Action titled "be kinder to myself" the moment Fix C taught the parser to
 * read "remind me to". One list, two rules, no drift.
 */
const DISPOSITION = "be\\b|stay\\b|remain\\b|keep\\b|stop\\b|start\\b|treat\\b|hold\\b|protect\\b|always\\b|never\\b|make sure\\b";
const DISPOSITION_RE = new RegExp(`^(?:${DISPOSITION})`, "i");

/** Explicitly reflective openers. Everything else declarative stays a Note. */
const REFLECTION_MARKERS = [
  "i've realized", "i have realized", "i've realised", "i have realised",
  "i'm noticing", "i am noticing", "i've been thinking", "i have been thinking",
  "i keep noticing", "looking back",
  // LIFEOS-060: doubt, not just insight. "I've been questioning whether teaching
  // is what I want to do" is the single most reflective sentence in the torture
  // test and fell through to the generic note fallback — which mislabelled it
  // AND made it look unplaceable enough to escalate to a model for no reason.
  "i've been questioning", "i have been questioning", "i'm questioning", "i am questioning",
  "i've been wondering", "i have been wondering", "i'm wondering", "i am wondering",
  "i'm still unsure", "i am still unsure", "i'm unsure", "i am unsure",
  "i keep wondering", "i keep coming back to",
];

/**
 * Does the sentence OPEN reflectively? (LIFEOS-080 §15)
 *
 * The same list rule 7 uses, exposed so the capture router can ask the question
 * before it routes. "I've been thinking I want to change careers" holds a real
 * ambition, and the audit found it vanishing: the reflective reading won and the
 * goal inside was never offered at all. Neither reading should be suppressed and
 * neither should be asserted over the other — so the router keeps the reflection
 * as what the sentence IS, and offers the goal beside it, unticked.
 */
export function looksReflective(text: string): boolean {
  const lower = tidy(text).toLowerCase();
  return REFLECTION_MARKERS.some((m) => lower.startsWith(m));
}

/** Informational shapes that are notes even when they contain a verb. */
const NOTE_MARKERS = [
  "recipe", "notes on", "notes about", "things i learned", "remember that",
  "vocabulary", "cheat sheet", "reference",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Detect a `when/if/before/whenever X → Y` conditional and split it.
 *
 * Two orderings are handled, because people write both:
 *   "When X, do Y."   → trigger X, response Y
 *   "Do Y when X."    → trigger X, response Y
 *
 * Only the leading-connective form is treated as high confidence. The trailing
 * form is common in ordinary prose that is not a protocol at all ("call me when
 * you land"), so it is reported as `likely` and still requires confirmation.
 */
export function extractConditional(text: string): { trigger: string; response: string; leading: boolean; explicit: boolean } | null {
  const t = tidy(text);
  // Leading: "When X, Y" / "If X then Y" / "Before X, Y" / "Whenever X, Y"
  const leading = /^(when(?:ever)?|if|before|after)\b\s+([^,]+?)\s*(?:,|\s+then\s+)\s*(.+)$/i.exec(t);
  if (leading) {
    const connective = leading[1].toLowerCase();
    const cond = tidy(leading[2]);
    const resp = tidy(leading[3]);
    if (cond && resp) {
      // "Before X, Y" keeps its connective in the trigger — "making a large
      // purchase" alone loses the timing that makes the protocol meaningful.
      const trigger = connective === "before" || connective === "after" ? `${connective} ${cond}` : cond;
      return { trigger, response: resp, leading: true, explicit: true };
    }
  }
  // LIFEOS-080 §11. The un-delimited leading form: "If I feel overwhelmed I go
  // for a walk". The audit found this falling through to Note, and it is one of
  // the two most natural ways people write a rule for themselves.
  //
  // Widened HERE rather than in a parallel detector on purpose. This function is
  // load-bearing for six callers — the protocol classifier, `decompose`'s
  // never-split rule, `saveRule`'s routing, `normative.ts`'s exclusion, inbox
  // conversion and the Protocols page — and a second opinion about what a
  // conditional is would let them disagree about the same sentence.
  //
  // Without a delimiter there is nothing to split on but the SUBJECT, so both
  // halves must be first-person clauses. That is narrow, and narrow is the
  // point: "When I got home the dog was gone" has one "I" and does not match.
  const implied = /^(when(?:ever)?|if)\b\s+(i\s+[^,]+?)\s+(i\s+[^,]+)$/i.exec(t);
  if (implied) {
    const cond = tidy(implied[2]);
    const resp = tidy(implied[3]);
    // A NARRATIVE is not a protocol. "When I saw him I told him the truth"
    // reports a day; a protocol describes what one does whenever the trigger
    // recurs. Past tense in either half means the sentence is the former.
    if (cond && resp && !opensWithPastVerb(cond) && !opensWithPastVerb(resp)) {
      return { trigger: cond, response: resp, leading: true, explicit: false };
    }
  }
  // Trailing: "Y when X"
  const trailing = /^(.+?)\s+(when(?:ever)?|if)\s+(.+)$/i.exec(t);
  if (trailing) {
    const resp = tidy(trailing[1]);
    const cond = tidy(trailing[3]);
    if (resp && cond) return { trigger: cond, response: resp, leading: false, explicit: true };
  }
  return null;
}

/** Detect "waiting for/on X" and extract what is being waited on. */
export function extractWaiting(text: string): string | null {
  const t = tidy(text);
  const m = /^(?:i'?m\s+|i\s+am\s+)?wait(?:ing)?\s+(?:for|on)\s+(.+)$/i.exec(t);
  if (m) return tidy(m[1]);
  const m2 = /^need\s+(.+?)\s+to\s+(?:respond|reply|get back|send|confirm)\b/i.exec(t);
  if (m2) return tidy(m2[1]);
  return null;
}

const startsWithAny = (lower: string, list: string[]) =>
  list.find((v) => lower === v || lower.startsWith(v + " "));

/**
 * Does this phrase open with a verb this module treats as DOING something?
 *
 * Exported for LIFEOS-096 §8, which needs to tell "transcript" from "send the
 * lease" before recomposing a waiting title — and must ask THIS list rather
 * than keep a second one, because two lists drift and only one of them is the
 * one the classifier trusts. Same `NOUN_PHRASE_RE` gate, so "review of the
 * book" is a noun here exactly as it is above.
 */
export function startsWithActionVerb(phrase: string): boolean {
  const lower = phrase.trim().toLowerCase();
  if (!lower) return false;
  return !!startsWithAny(lower, ACTION_VERBS) && !NOUN_PHRASE_RE.test(lower);
}

/**
 * Detect a capture that appears to hold several intents.
 *
 * Conservative on purpose: a false positive here sends the user to the split
 * screen for no reason. Requires either multiple sentences that classify
 * differently, or an explicit enumerating conjunction joining clauses that do.
 */
export function detectMultiIntent(text: string): { multi: boolean; segments: string[] } {
  const parts = sentences(text);
  if (parts.length > 1) {
    const kinds = new Set(parts.map((p) => classifyOne(p).suggestedType));
    kinds.delete("unknown");
    if (kinds.size > 1) return { multi: true, segments: parts };
  }
  // Single sentence with ", and " / ", then " joining differently-shaped clauses.
  const clauses = tidy(text).split(/,\s*(?:and|then)\s+|;\s+/i).map(tidy).filter((c) => c.length >= 8);
  if (clauses.length > 1) {
    const kinds = new Set(clauses.map((c) => classifyOne(c).suggestedType));
    kinds.delete("unknown");
    if (kinds.size > 1) return { multi: true, segments: clauses };
  }
  return { multi: false, segments: [] };
}

/** Classify ONE clause/sentence. Exported for testing the rule order directly. */
export function classifyOne(text: string): CaptureClassification {
  const raw = tidy(text);
  const lower = raw.toLowerCase();
  if (!raw) return { suggestedType: "unknown", confidence: "possible", reason: "There is nothing to classify yet." };

  // 1. PROTOCOL first. A conditional often CONTAINS an action verb ("when X,
  //    call Y"), so testing actions first would misroute every protocol.
  const cond = extractConditional(raw);
  if (cond && cond.leading) {
    return {
      suggestedType: "protocol",
      confidence: cond.explicit ? "high" : "likely",
      reason: "Uses a when → response pattern.",
      extracted: { trigger: cond.trigger, response: cond.response },
    };
  }

  // 2. WAITING — a distinctive prefix, and it must beat the action rule because
  //    "waiting for Sarah to send" contains "send".
  const waitingOn = extractWaiting(raw);
  if (waitingOn) {
    return {
      suggestedType: "waiting",
      confidence: "high",
      reason: "Describes waiting on someone or something.",
      extracted: { waitingOn, title: raw },
    };
  }

  // 3. Informational markers beat action verbs: "Recipe for chicken soup" is a
  //    note even though a recipe is full of imperatives.
  if (NOTE_MARKERS.some((m) => lower.includes(m))) {
    return { suggestedType: "note", confidence: "high", reason: "Looks informational rather than actionable.", extracted: { title: raw } };
  }
  // "Topic: detail" — the shape of a learning note ("Spanish: por vs para").
  if (/^[a-z][\w\s]{1,24}:\s+\S/i.test(raw) && !/^(when|if|before|after)\b/i.test(raw)) {
    return { suggestedType: "note", confidence: "high", reason: "Looks like a note about a topic.", extracted: { title: raw } };
  }

  // 4. ACTION — an imperative opener, or an explicit "I need/have to".
  const needTo = /^(?:i\s+)?(?:need|have|want|ought)\s+to\s+(.+)$/i.exec(raw);
  if (needTo) {
    return { suggestedType: "action", confidence: "high", reason: "Describes something you need to do.", extracted: { title: tidy(needTo[1]) } };
  }
  /**
   * LIFEOS-101 Fix C — "I've got to" and "I gotta" are "I have to" out loud.
   *
   * Measured as Notes before this: "I've got to call the dentist" and "I gotta
   * email Marcus tomorrow" are two of the most ordinary ways anyone states an
   * errand, and the parser required the written register.
   *
   * ## Two things this does NOT do, both deliberate
   *
   * The contraction is REQUIRED. Bare "I got to" is past tense far more often
   * than it is obligation — "I got to meet him yesterday", "I got to see the
   * clinic finally" — and both of those are Notes today and stay Notes.
   *
   * The remainder must open with an action verb, which the rule above does not
   * require. That asymmetry is on purpose and the audit is why: "I have to
   * admit that was hard" ALREADY becomes an auto-writable Action titled "admit
   * that was hard", which is a pre-existing false positive of that rule
   * (reported as a known gap, out of scope here). A new opener inheriting a bug
   * discovered while adding it would be a choice, so this one is gated and
   * "I've got to admit that was hard" stays a Note.
   */
  const gotTo = /^i(?:'ve|\s+have)\s+got\s+to\s+(.+)$|^i\s+gotta\s+(.+)$/i.exec(raw);
  if (gotTo) {
    const rest = tidy(gotTo[1] ?? gotTo[2] ?? "");
    if (startsWithActionVerb(rest)) {
      return { suggestedType: "action", confidence: "high", reason: "Describes something you need to do.", extracted: { title: rest } };
    }
  }
  // LIFEOS-080. "I should talk to Dana about it" was a Note, because `should`
  // was missing here — while `decompose` has cut on "i should" all along, so the
  // clause was already being split out and then had nowhere to go.
  //
  // The exclusion is the same one the normative detector uses from the other
  // side: a DISPOSITION ("I should be more patient") is a way of acting and
  // belongs to Personal Code; a plain verb is a thing to do. Written as one
  // negative lookahead so the two lists can be read against each other.
  const shouldDo = new RegExp(`^i\\s+should\\s+(?!${DISPOSITION})(.+)$`, "i").exec(raw);
  if (shouldDo) {
    return { suggestedType: "action", confidence: "likely", reason: "Describes something you mean to do.", extracted: { title: tidy(shouldDo[1]) } };
  }
  // LIFEOS-066 §13. "Remember to X" is an errand wearing a memory word, and the
  // errand is X — "call the dentist", not "remember to call the dentist". The
  // word alone decides nothing: "Remember Mom's birthday" has no `to`, does not
  // match here, and stays whatever the occasion rules make of it. That split is
  // the entire point — a birthday given a checkbox is the LIFEOS-059 defect.
  /**
   * LIFEOS-101 Fix C — the other ways people ask to be reminded.
   *
   * "Remember to X" was already here. The corpus found three more that are the
   * same request in different words, all landing as Notes:
   *
   *   "Remind me to call the dentist Friday"
   *   "Don't let me forget to submit the application"
   *   "Make sure I send Maria the form"
   *
   * ## Why this extends the existing rule instead of adding one
   *
   * §27. The errand is X, not the framing — and this rule already knows how to
   * say so, already refuses a conditional remainder, and already hands the
   * stripped phrase to the same title path. A parallel rule would have to
   * re-derive all three and would drift from them.
   *
   * ## The distinction the whole thing turns on (§5)
   *
   *   REMIND ME TO + action   → an errand
   *   REMIND ME THAT + fact   → a note
   *
   * `to` is required in every alternative, so "Remind me that my passport
   * expires in March" and "Don't let me forget that the lease expires Friday"
   * never reach here. And every alternative is `^`-anchored, so "DON'T remind
   * me to call the dentist" does not match either — the negation guard is the
   * anchor rather than a list of things not to match.
   *
   * "Make sure I" needs its pronoun: "Make sure Maria sends the form" is
   * someone else's action and §8 says not to read every sentence about another
   * person as a commitment, so it stays a Note.
   */
  const rememberTo = /^(?:i\s+(?:need|have|want|ought)\s+to\s+)?remember\s+to\s+(.+)$|^remind\s+me\s+to\s+(.+)$|^don'?t\s+let\s+me\s+forget\s+to\s+(.+)$|^make\s+sure\s+i\s+(.+)$/i.exec(raw);
  if (rememberTo) {
    const rest = tidy(rememberTo[1] ?? rememberTo[2] ?? rememberTo[3] ?? rememberTo[4] ?? "");
    // "Remember to give him space when he gets overwhelmed" is a PROTOCOL
    // wearing a memory word — a response to a situation, not an errand with an
    // end. A conditional anywhere in the remainder means the sentence keeps
    // whatever reading the rules below give it, rather than gaining a checkbox
    // it can never satisfy.
    // A disposition is not an errand, whichever framing asked to be reminded of
    // it. Same list the `i should` rule uses, one test earlier.
    if (rest && !extractConditional(rest) && !DISPOSITION_RE.test(rest)) {
      return {
        suggestedType: "action",
        confidence: "high",
        reason: "Describes something you want to remember to do.",
        extracted: { title: rest },
      };
    }
  }

  const verb = startsWithAny(lower, ACTION_VERBS);
  if (verb && !NOUN_PHRASE_RE.test(lower)) {
    return { suggestedType: "action", confidence: "high", reason: "Starts with an action verb.", extracted: { title: raw } };
  }

  // 5. PROJECT — only an outcome verb, and only ever `possible`. Deliberately
  //    weak: over-classifying as Project manufactures structure, and the cost of
  //    a wrong Project is far higher than a wrong Note.
  const projVerb = startsWithAny(lower, PROJECT_VERBS);
  if (projVerb) {
    return {
      suggestedType: "project",
      confidence: "possible",
      reason: "Describes an outcome that may take several steps.",
      extracted: { title: raw },
    };
  }

  // 6. QUESTION — interrogative. There is no simple question record in the
  //    product (`Inquiry` is the output of a dialectical analysis run, not a
  //    creatable note-sized thing), so this routes to Note and says so.
  if (raw.endsWith("?")) {
    return { suggestedType: "question", confidence: "likely", reason: "Reads as an open question.", extracted: { title: raw } };
  }

  // 7. REFLECTION — only with EXPLICIT reflective language. "I think X" is not
  //    enough: a declarative sentence is not evidence that someone wants a
  //    belief recorded, and Belief must stay an intentional promotion (§10).
  if (REFLECTION_MARKERS.some((m) => lower.startsWith(m))) {
    return { suggestedType: "reflection", confidence: "likely", reason: "Uses reflective language.", extracted: { title: raw } };
  }

  // 8. Fallback. Note is the safe default — it is why Note was built.
  return { suggestedType: "note", confidence: "possible", reason: "Kept as a note — nothing here needs a category.", extracted: { title: raw } };
}

/**
 * Classify a whole capture.
 *
 * Multi-intent is checked FIRST and reported rather than resolved: collapsing
 * "call the dentist, renew the registration, and remember to give him space"
 * into one type would silently drop two of the three things the person said.
 */
export function classifyCapture(text: string): CaptureClassification {
  const multi = detectMultiIntent(text);
  if (multi.multi) {
    const first = classifyOne(multi.segments[0]);
    return {
      ...first,
      multiIntent: true,
      confidence: "possible",
      reason: "This looks like it holds more than one thing — splitting it keeps each part.",
    };
  }
  return classifyOne(text);
}

/** Human label for a suggested type. Plain product words, no ontology jargon. */
export const CAPTURE_TYPE_LABEL: Record<CaptureType, string> = {
  action: "Next action",
  note: "Note",
  protocol: "Protocol",
  waiting: "Waiting on something",
  reflection: "Reflection",
  project: "Project",
  question: "Question",
  unknown: "Note",
};

/**
 * Types that have a real, confirmable destination today.
 *
 * `question` is absent deliberately: there is no simple question record to
 * create, so a question is offered as a Note rather than pointed at a
 * destination that does not exist.
 */
export const CONFIRMABLE_TYPES: CaptureType[] = ["action", "note", "protocol", "waiting", "reflection", "project"];

export function hasDestination(t: CaptureType): boolean {
  return CONFIRMABLE_TYPES.includes(t);
}
