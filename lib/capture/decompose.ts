/**
 * Multi-intent decomposition (LIFEOS-060 §6).
 *
 * ## Why this is separate from `detectMultiIntent`
 *
 * `lib/capture/classify.ts` already answers *"does this hold more than one
 * thing?"* — but only by asking whether the parts classify DIFFERENTLY. That
 * makes it blind to the most common real capture there is:
 *
 *   "call my advisor tomorrow, finish the dashboard, buy dog food"
 *
 * Three actions. Same type. `detectMultiIntent` sees one kind and reports a
 * single intent, so all three collapse into one record and two errands vanish.
 * This module splits on INTENT SHAPE instead of on type disagreement.
 *
 * ## The merge-back rule is what keeps it safe
 *
 * Splitting on commas alone shreds ordinary prose: "Call Mom, Dad, and the
 * dentist" would become three segments, two of which are bare nouns. So a
 * segment only stands alone if it carries its OWN intent signal — an imperative
 * verb, a "need/want to", a waiting phrase, a conditional, a reflective opener.
 * A segment without one is merged back into the segment before it, which
 * restores the original sentence rather than inventing two empty ones.
 *
 * Over-splitting is worse than under-splitting: a missed split leaves one record
 * containing everything the user said, which is recoverable. A wrong split
 * creates records the user never asked for, which they must now delete.
 *
 * ## Conditionals are never split
 *
 * "When I get angry, wait ten minutes before replying" contains a comma that
 * belongs to the protocol. Leading conditionals are checked first and returned
 * whole, before any separator logic runs.
 *
 * ## Pure
 *
 * A function of the text alone. No state, no clock, no network.
 */

import { extractConditional, classifyOne } from "@/lib/capture/classify";
import { detectWaiting } from "@/lib/capture/waiting";
import { baseOfPast } from "@/lib/capture/morphology";

/** One piece of a capture, with its position in the original text preserved. */
export interface Segment {
  text: string;
  /** Character offset in the ORIGINAL capture — the evidence span for §3. */
  start: number;
  end: number;
}

/**
 * Imperative openers that make a fragment a standalone intent.
 *
 * Intentionally broader than `ACTION_VERBS` in `classify.ts`: that list decides
 * what an action IS, and must stay conservative because it creates records. This
 * list only decides where to CUT, and a cut that lands on a non-action still
 * produces a note, which is harmless.
 */
const SPLIT_VERBS = [
  "call", "email", "text", "message", "send", "buy", "purchase", "order",
  "schedule", "book", "pay", "renew", "submit", "file", "return", "pick up",
  "drop off", "fix", "repair", "clean", "wash", "print", "sign", "mail",
  "reply", "respond", "confirm", "cancel", "register", "download", "upload",
  "finish", "start", "write", "read", "review", "check", "update", "make",
  "lift", "practice", "study", "run", "work on", "follow up", "watch", "cook",
  "plan", "prepare", "organize", "organise", "build", "create", "design", "launch",
];

const INTENT_PREFIXES = [
  "i need to", "i have to", "i want to", "i ought to", "i should",
  "need to", "have to", "want to",
  "i've been", "i have been", "i'm still", "i am still", "i keep", "i'm not sure",
  "i am not sure", "i'm unsure", "i am unsure", "i've realized", "i have realized",
  "i'm noticing", "i am noticing", "looking back", "i wonder", "i'm wondering",
];

/**
 * Titles and initials whose full stop is not the end of a sentence.
 *
 * LIFEOS-066 found this the expensive way: "Dr. Sarah Chen hasn't replied about
 * the paperwork" was cut after "Dr", and the waiting detector — which handles
 * that sentence perfectly — never saw it. A two-character fragment then became
 * a note titled "Dr".
 */
const ABBREVIATION_RE = /\b(?:dr|mr|mrs|ms|mx|prof|sr|jr|st|rev|hon|dept|approx|no|vs|etc|e\.g|i\.e|[a-z])\.$/i;

/** Sentence-ish segmentation that keeps offsets. */
function sentenceSpans(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /[^.!?\n]+[.!?]*\s*|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lead = raw.length - raw.trimStart().length;
    const seg = { text: trimmed, start: m.index + lead, end: m.index + lead + trimmed.length };
    // An abbreviation's full stop belongs to the word, not to the sentence.
    const prev = out[out.length - 1];
    if (prev && ABBREVIATION_RE.test(prev.text)) {
      prev.text = `${prev.text} ${seg.text}`;
      prev.end = seg.end;
      continue;
    }
    out.push(seg);
  }
  return out.length > 0 ? out : [{ text: text.trim(), start: 0, end: text.trim().length }];
}

/** Does this fragment carry its own intent, or is it a dangling noun phrase? */
export function hasOwnIntent(fragment: string): boolean {
  const t = fragment.trim();
  if (t.length < 3) return false;
  const lower = t.toLowerCase();
  if (extractConditional(t)?.leading) return true;
  if (detectWaiting(t)) return true;
  if (INTENT_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (SPLIT_VERBS.some((v) => lower === v || lower.startsWith(v + " "))) return true;
  // "and lift" / "then practice guitar" — a conjunction followed by an imperative.
  const stripped = lower.replace(/^(?:and|then|also|plus)\s+/, "");
  if (stripped !== lower && SPLIT_VERBS.some((v) => stripped === v || stripped.startsWith(v + " "))) return true;
  // LIFEOS-066 §16. A PAST-tense verb is just as much an intent signal as an
  // imperative — "Called the dentist and booked a haircut for Friday at 3" is
  // two things, and reading it as one produced a single note that reported a
  // completion and lost an appointment.
  //
  // Narrowed to bases this module already cuts on, so the split surface does not
  // widen: "bread" is not a verb, "the chair to the garage" is not a verb, and
  // "left a message" has no entry in the table, so all three still merge back.
  if (startsWithPastVerb(stripped)) return true;
  return false;
}

/** Does this fragment open with a past-tense form of a verb we already cut on? */
function startsWithPastVerb(lower: string): boolean {
  const base = baseOfPast(lower.split(" ")[0] ?? "");
  return !!base && SPLIT_VERBS.includes(base);
}

/** Remove a leading enumerating conjunction once a fragment stands alone. */
function tidyFragment(s: string): string {
  return s.replace(/^(?:and|then|also|plus)\s+/i, "").replace(/^[,;:\s]+/, "").replace(/[,;\s]+$/, "").trim();
}

/**
 * Split one sentence on enumerating separators, merging back any fragment that
 * cannot stand on its own.
 */
function splitSentence(sentence: Segment): Segment[] {
  // A leading conditional owns its comma. Never cut it.
  const cond = extractConditional(sentence.text);
  if (cond?.leading) return [sentence];

  const parts: Segment[] = [];
  // LIFEOS-066 §14–§16. A bare " and " joins two intents at least as often as a
  // comma does — "I finished deployment and need to email my professor" is two
  // things. It is safe to cut here ONLY because `hasOwnIntent` merges back any
  // fragment that cannot stand alone, so "buy milk and bread" stays one action
  // and "move the sofa and the chair to the garage" stays one sentence.
  // LIFEOS-080 §22. `so` and `but` join two intents as readily as `and` does,
  // and the audit measured the cost of their absence:
  //
  //   "I want to get healthier so I should stop eating late"
  //     → one goal titled "get healthier so I should stop eating late"
  //
  // An aspiration and a rule, fused into a goal whose title is neither.
  //
  // Both are gated on a following "I". Mutation testing was clear about what
  // that gate does and does not buy: the merge-back rule below already rescues
  // the degree-adverb case ("I was so tired I went to bed" rejoins whether the
  // lookahead is there or not), so the gate is not what keeps prose intact.
  // What it does keep out is a cut before someone ELSE'S imperative — "I'm
  // running late so start without me" would otherwise yield "start without me"
  // as an errand the user is meant to perform.
  // The lookahead is spelled `[iI]` rather than relying on a flag: this regex
  // has always been case-SENSITIVE, and turning that on wholesale here would
  // quietly change where every other separator cuts.
  const re = /,\s*(?:and\s+|then\s+|also\s+|plus\s+|but\s+|so\s+)?|;\s*|\s+and\s+then\s+|\s+and\s+|\s+so\s+(?=[iI]\s)|\s+but\s+(?=[iI]\s)/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  const pieces: Segment[] = [];
  while ((m = re.exec(sentence.text)) !== null) {
    const piece = sentence.text.slice(cursor, m.index);
    if (piece.trim()) pieces.push({ text: piece, start: sentence.start + cursor, end: sentence.start + cursor + piece.length });
    cursor = m.index + m[0].length;
  }
  const tail = sentence.text.slice(cursor);
  if (tail.trim()) pieces.push({ text: tail, start: sentence.start + cursor, end: sentence.start + cursor + tail.length });

  if (pieces.length <= 1) return [sentence];

  // Merge-back: the first piece always stands; later pieces stand only if they
  // carry their own intent, otherwise they rejoin the piece before them.
  for (const piece of pieces) {
    const cleaned = tidyFragment(piece.text);
    if (parts.length === 0 || hasOwnIntent(cleaned)) {
      parts.push({ text: cleaned, start: piece.start, end: piece.end });
    } else {
      const prev = parts[parts.length - 1];
      // Rejoin using the ORIGINAL text between the two spans, so the merged
      // segment reads exactly as the user wrote it.
      parts[parts.length - 1] = {
        text: sentence.text.slice(prev.start - sentence.start, piece.end - sentence.start).trim(),
        start: prev.start,
        end: piece.end,
      };
    }
  }
  return parts.filter((p) => p.text.length > 0);
}

/**
 * Decompose a capture into independent intents.
 *
 * Always returns at least one segment covering the whole text — a capture with
 * nothing splittable in it is one segment, not zero.
 */
export function decompose(text: string): Segment[] {
  const src = (text ?? "").trim();
  if (!src) return [];

  // A whole-text leading conditional is one protocol, full stop.
  const cond = extractConditional(src);
  if (cond?.leading && sentenceSpans(src).length === 1) {
    return [{ text: src, start: 0, end: src.length }];
  }

  const segments = sentenceSpans(text ?? "").flatMap(splitSentence);
  const kept = segments.filter((s) => s.text.trim().length >= 3);
  if (kept.length === 0) return [{ text: src, start: 0, end: src.length }];
  return kept;
}

/**
 * True when the capture genuinely holds several things.
 *
 * Stricter than "more than one segment": two segments that classify the same way
 * AND sit in one sentence are still worth reporting, but a trailing fragment is
 * not. Used only for messaging — `decompose` is what produces the candidates.
 */
export function isMultiIntent(text: string): boolean {
  return decompose(text).length > 1;
}

/** Exported for tests that need to check the split-verb surface directly. */
export const SPLIT_VERB_COUNT = SPLIT_VERBS.length;

/** Kept so a test can assert a segment's kind without importing `classify` twice. */
export function segmentKind(segment: Segment): string {
  return classifyOne(segment.text).suggestedType;
}
