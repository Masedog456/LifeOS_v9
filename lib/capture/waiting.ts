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
  /**
   * WHAT is being waited for, when the sentence separates it from the subject.
   *
   * LIFEOS-066 §10. "Waiting on Priya for the quote" used to put the whole
   * phrase in `waitingOn`, so two waits on Priya were two different people as
   * far as any grouping was concerned. The subject and the object are different
   * facts and the grammar usually separates them; when it does not, this stays
   * empty rather than guessing.
   */
  waitingFor?: string;
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
  // Kept at six words so a title and a full name survive intact —
  // "Dr. Sarah Chen" and "the advisor at the clinic" are both real answers to
  // "who are you waiting on?" (§10).
  const words = cleaned.split(" ");
  return words.length <= 6 ? cleaned : "";
}

/**
 * Patterns, in priority order. Each names the capture group holding the subject,
 * or `0` when the shape does not expose one.
 */
const PATTERNS: Array<{ re: RegExp; group: number; objectGroup?: number; reason: string }> = [
  // The original two shapes, with the OBJECT split off where the grammar marks
  // it. "Waiting on Priya for the quote" is one person and one thing, not a
  // six-word person (§10).
  //
  // A leading "still" is allowed everywhere it can appear. LIFEOS-063 found
  // that one word defeated the whole detector — "Still waiting on Priya" became
  // a note — which is the most common way anyone says this out loud.
  // "waiting for Finance to approve it" — the subject ends where the thing they
  // owe you begins, and "to <verb>" marks that boundary as clearly as "for" does.
  { re: /^(?:still\s+)?(?:i'?m\s+|i\s+am\s+)?(?:still\s+)?wait(?:ing)?\s+(?:for|on)\s+(.+?)\s+to\s+(\w+.*)$/i, group: 1, objectGroup: 2, reason: "Describes waiting on someone or something." },
  { re: /^(?:still\s+)?(?:i'?m\s+|i\s+am\s+)?(?:still\s+)?wait(?:ing)?\s+(?:for|on)\s+(.+?)(?:\s+(?:for|about|on|re|regarding)\s+(.+))?$/i, group: 1, objectGroup: 2, reason: "Describes waiting on someone or something." },
  { re: /^(?:i\s+)?(?:still\s+)?need\s+(.+?)\s+to\s+(?:respond|reply|get back|send|confirm|approve)\b(?:\s+(.+))?$/i, group: 1, objectGroup: 2, reason: "Describes waiting on someone or something." },
  // "Still haven't heard from the dealer" / "Need to hear back from the landlord"
  { re: /^(?:still\s+)?(?:i\s+)?(?:still\s+)?(?:haven'?t|have\s+not|need\s+to)\s+hear(?:d)?\s+(?:back\s+)?from\s+(.+?)(?:\s+(?:about|re|regarding)\s+(.+))?$/i, group: 1, objectGroup: 2, reason: "You're waiting to hear back." },

  // "Marcus still owes me the document" / "he owes me a reply"
  { re: /^(.+?)\s+(?:still\s+)?owes?\s+me\s*(.*)$/i, group: 1, objectGroup: 2, reason: "Someone owes you something." },
  // "Marcus still hasn't sent the file" / "Sarah hasn't replied" /
  // "Alex never sent the document" / "The advisor hasn't gotten back to me"
  { re: /^(.+?)\s+(?:still\s+)?(?:hasn'?t|haven'?t|has\s+not|have\s+not|never)\s+(?:sent|replied|responded|gotten\s+back|got\s+back|answered|confirmed|returned|delivered|shared|come\s+back)\s*(?:to\s+me\s*)?(?:about\s+|with\s+)?(.*)$/i, group: 1, objectGroup: 2, reason: "Someone hasn't come back to you yet." },
  // "Marcus was supposed to send the draft"
  { re: /^(.+?)\s+(?:was|were|is|are)\s+supposed\s+to\s+(?:send|reply|respond|get\s+back|confirm|deliver|share|return)\b/i, group: 1, reason: "Someone owed you a response." },
  // "still waiting to hear back from Marcus"
  { re: /\b(?:hear|hearing)\s+back\s+from\s+(.+)$/i, group: 1, reason: "You're waiting to hear back." },
  // "follow up with Marcus about the invoice"
  { re: /^follow\s+up\s+(?:with|on)\s+(.+?)(?:\s+(?:about|re|regarding)\s+(.+))?$/i, group: 1, objectGroup: 2, reason: "A follow-up with someone." },
  // "chase up the invoice" — a follow-up whose subject is a thing, not a person.
  { re: /^(?:chase|chasing)\s+(?:up\s+)?(.+?)(?:\s+(?:about|for|re|regarding)\s+(.+))?$/i, group: 1, objectGroup: 2, reason: "A follow-up." },
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
  for (const { re, group, objectGroup, reason } of PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    const raw = group > 0 ? (m[group] ?? "") : "";
    const object = objectGroup ? tidy(m[objectGroup] ?? "") : "";
    return { waitingOn: subject(raw), waitingFor: object || undefined, reason };
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
