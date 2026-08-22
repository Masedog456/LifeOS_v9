/**
 * Waiting-language detection (LIFEOS-060 §9).
 *
 * ## The gap this closes
 *
 * LIFEOS-059 measured it: "Marcus still owes me the document" classified as a
 * NOTE, because `extractWaiting` in `classify.ts` recognised only two shapes —
 * `waiting for/on X` and `need X to respond`. Those are how a system asks the
 * question; "owes me" and "still hasn't sent" are how a person answers it.
 *
 * Follow-ups are the highest-value catch a life system makes, so the phrasing
 * that most often carries one should not be the phrasing that misses.
 *
 * ## No People record
 *
 * The sprint forbids one, and it would be the wrong shape anyway at this size.
 * What comes out is a STRING — the existing `NextAction.waitingOn` field, which
 * has been there since LIFEOS-036. "Marcus" is stored as text on the action, so
 * "what is Marcus sitting on?" is answerable by grouping on that string without
 * a new noun, a new table, or a contact record.
 *
 * ## Deliberately conservative on the subject
 *
 * The subject is extracted only when the sentence names it in a position the
 * grammar makes unambiguous — the thing before "owes me", the thing after
 * "waiting on". When the shape is less certain the detection still fires (so the
 * item becomes a waiting action) but `waitingOn` is left empty rather than
 * guessed, because a wrong name is worse than a missing one.
 *
 * ## Pure
 */

/** What was found, and who or what is being waited on. */
export interface WaitingFinding {
  /** The subject, when the sentence names it unambiguously. May be empty. */
  waitingOn: string;
  /** A short, plain reason for the UI. Never a regex. */
  reason: string;
}

function tidy(s: string): string {
  return (s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|a|an|my|our)\s+/i, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

/** Trim a subject down to a name-like head, dropping any trailing clause. */
function subject(s: string): string {
  const t = tidy(s);
  if (!t) return "";
  // "Marcus from the office still" → "Marcus from the office"
  const cleaned = t.replace(/\s+(?:still|yet|again|ever)$/i, "").trim();
  // A subject longer than a short phrase is almost certainly a mis-parse.
  const words = cleaned.split(" ");
  return words.length <= 6 ? cleaned : "";
}

/**
 * Patterns, in priority order. Each names the capture group holding the subject,
 * or `0` when the shape does not expose one.
 */
const PATTERNS: Array<{ re: RegExp; group: number; reason: string }> = [
  // The original two shapes, kept identical so nothing that worked stops working.
  { re: /^(?:i'?m\s+|i\s+am\s+)?wait(?:ing)?\s+(?:for|on)\s+(.+)$/i, group: 1, reason: "Describes waiting on someone or something." },
  { re: /^need\s+(.+?)\s+to\s+(?:respond|reply|get back|send|confirm)\b/i, group: 1, reason: "Describes waiting on someone or something." },

  // "Marcus still owes me the document" / "he owes me a reply"
  { re: /^(.+?)\s+(?:still\s+)?owes?\s+me\b/i, group: 1, reason: "Someone owes you something." },
  // "Marcus still hasn't sent the file" / "Sarah hasn't replied"
  { re: /^(.+?)\s+(?:still\s+)?(?:hasn'?t|haven'?t|has\s+not|have\s+not)\s+(?:sent|replied|responded|gotten\s+back|got\s+back|answered|confirmed|returned|delivered|shared)\b/i, group: 1, reason: "Someone hasn't come back to you yet." },
  // "Marcus was supposed to send the draft"
  { re: /^(.+?)\s+(?:was|were|is|are)\s+supposed\s+to\s+(?:send|reply|respond|get\s+back|confirm|deliver|share|return)\b/i, group: 1, reason: "Someone owed you a response." },
  // "still waiting to hear back from Marcus"
  { re: /\b(?:hear|hearing)\s+back\s+from\s+(.+)$/i, group: 1, reason: "You're waiting to hear back." },
  // "follow up with Marcus about the invoice"
  { re: /^follow\s+up\s+(?:with|on)\s+(.+?)(?:\s+(?:about|re|regarding)\b.*)?$/i, group: 1, reason: "A follow-up with someone." },
  // "chase up the invoice" — a follow-up whose subject is a thing, not a person.
  { re: /^(?:chase|chasing)\s+(?:up\s+)?(.+)$/i, group: 1, reason: "A follow-up." },
  // Bare "still no word from the clinic"
  { re: /^still\s+no\s+(?:word|reply|response|answer)\s+from\s+(.+)$/i, group: 1, reason: "No response yet." },
  // "pending Marcus's approval"
  { re: /^(?:pending|blocked\s+on|blocked\s+by)\s+(.+)$/i, group: 1, reason: "Blocked on someone or something." },
];

/**
 * Detect waiting language.
 *
 * Returns `null` when nothing matches, so callers can fall through to ordinary
 * classification unchanged.
 */
export function detectWaiting(text: string): WaitingFinding | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const { re, group, reason } of PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    const raw = group > 0 ? (m[group] ?? "") : "";
    return { waitingOn: subject(raw), reason };
  }
  return null;
}

/**
 * The title to store for a waiting item.
 *
 * The ORIGINAL sentence, not a reconstruction. "Marcus still owes me the
 * document" is already the clearest possible statement of the situation, and
 * rewriting it as "Document from Marcus" would lose the fact that it is late.
 */
export function waitingTitle(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "").trim();
}
