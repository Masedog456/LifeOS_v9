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
];

/**
 * Outcome verbs implying a multi-step result rather than a single errand.
 * Used only for a LOW-confidence project suggestion — see `classifyCapture`.
 */
const PROJECT_VERBS = [
  "build", "create", "design", "launch", "plan", "organize", "organise",
  "set up", "renovate", "remodel", "redesign", "develop", "start a", "write a book",
];

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
export function extractConditional(text: string): { trigger: string; response: string; leading: boolean } | null {
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
      return { trigger, response: resp, leading: true };
    }
  }
  // Trailing: "Y when X"
  const trailing = /^(.+?)\s+(when(?:ever)?|if)\s+(.+)$/i.exec(t);
  if (trailing) {
    const resp = tidy(trailing[1]);
    const cond = tidy(trailing[3]);
    if (resp && cond) return { trigger: cond, response: resp, leading: false };
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
      confidence: "high",
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
  const verb = startsWithAny(lower, ACTION_VERBS);
  if (verb) {
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
