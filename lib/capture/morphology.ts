/**
 * Bounded past-tense morphology (LIFEOS-066 §17).
 *
 * People write a task one way and report it another. An Action titled "Call the
 * dentist" is reported as "Called the dentist", and until now those two
 * sentences had nothing in common as far as the parser was concerned.
 *
 * ## A table, not a stemmer
 *
 * Suffix-stripping was rejected outright. Chopping "-ed" turns "need" into
 * "ne", "speed" into "spe", and "red" into "r" — and the damage is silent,
 * producing matches against titles that happen to share a mangled prefix. A
 * wrong match here does not show a wrong date; it TICKS OFF a record the user
 * still has to do.
 *
 * So every pair is written out, and every pair exists because its base verb is
 * already something Conqify treats as an errand. The table cannot invent a verb
 * it was not given, and a word that is not in it simply is not past tense as far
 * as this module is concerned.
 *
 * ## Its own module so two callers can share it
 *
 * `lib/capture/decompose.ts` needs it to know where to CUT ("Called the dentist
 * and booked a haircut" is two things), and `lib/capture/completion.ts` needs it
 * to know what a sentence is ABOUT. Importing the second from the first would be
 * a cycle, and duplicating the table would let the two drift.
 *
 * ## Pure
 */

/**
 * Past tense → the verb an Action title would use.
 *
 * The irregulars at the end — did, got, took, made, worked — are the loosest
 * entries. They are safe only because every caller treats a bare past-tense
 * sentence as WEAK evidence: it must name something that actually exists before
 * anything is proposed.
 */
export const PAST_TO_BASE: Readonly<Record<string, string>> = {
  called: "call", emailed: "email", texted: "text", messaged: "message",
  sent: "send", bought: "buy", purchased: "purchase", ordered: "order",
  scheduled: "schedule", booked: "book", paid: "pay", renewed: "renew",
  submitted: "submit", filed: "file", returned: "return", mailed: "mail",
  printed: "print", signed: "sign", replied: "reply", responded: "respond",
  confirmed: "confirm", registered: "register", cleaned: "clean",
  washed: "wash", fixed: "fix", repaired: "repair", packed: "pack",
  shipped: "ship", delivered: "deliver", applied: "apply", drafted: "draft",
  refilled: "refill", restocked: "restock", updated: "update",
  replaced: "replace", installed: "install", collected: "collect",
  posted: "post", swapped: "swap", reviewed: "review", checked: "check",
  finished: "finish", completed: "complete",
  wrote: "write", made: "make", took: "take", got: "get", did: "do",
  worked: "work", read: "read", ran: "run", studied: "study",
};

/** Two-word verbs, matched before the single-word table so "up" is not lost. */
export const PAST_PHRASES: Readonly<Record<string, string>> = {
  "picked up": "pick up", "dropped off": "drop off",
  "topped up": "top up", "backed up": "back up", "signed up": "sign up",
  "sorted out": "sort out", "threw out": "throw out", "set up": "set up",
  "worked out": "work out", "followed up": "follow up",
};

/** The base form of a past-tense word, or `undefined` if it is not one. */
export function baseOfPast(word: string): string | undefined {
  return PAST_TO_BASE[(word ?? "").toLowerCase()];
}

/** Leading words that sit between "I" and the verb without changing it. */
const LEAD = /^(?:i\s+)?(?:just\s+|finally\s+|already\s+)?/i;

/** Leading noise on the object of a past-tense clause. Removed for matching. */
const DETERMINERS = /^(?:the|a|an|my|our|his|her|their|that|this|those|these)\s+/i;

/**
 * Trailing day words that name WHEN, not WHAT.
 *
 * `(?:^|\s+)` and not `\s+`: the object of "Worked out this morning" is the
 * whole of "this morning" with nothing before it, and requiring a leading space
 * left the word "morning" behind as the thing being searched for.
 */
const TRAILING_WHEN =
  /(?:^|\s+)(?:today|yesterday|tonight|this\s+morning|this\s+afternoon|this\s+evening|last\s+night|just\s+now|earlier|already|finally|at\s+last)\s*$/i;

function tidy(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "").trim();
}

/** The words that name the record, with grammar stripped and meaning kept. */
export function cleanObject(raw: string): string {
  let o = tidy(raw);
  // Repeated, because "the workout this morning already" has two tails.
  for (let i = 0; i < 3; i++) {
    const next = tidy(o.replace(TRAILING_WHEN, ""));
    if (next === o) break;
    o = next;
  }
  return tidy(o.replace(DETERMINERS, ""));
}

/**
 * Split a leading past-tense verb off a sentence, if there is one.
 *
 * Phrases first: "worked out" must not be read as "work" + "out", because
 * "out" is not what the sentence is about.
 */
export function splitPastVerb(text: string): { base: string; object: string } | null {
  const t = tidy(text).replace(LEAD, "");
  const lower = t.toLowerCase();

  for (const [phrase, base] of Object.entries(PAST_PHRASES)) {
    if (lower === phrase || lower.startsWith(phrase + " ")) {
      return { base, object: cleanObject(t.slice(phrase.length)) };
    }
  }
  const first = lower.split(" ")[0] ?? "";
  const base = baseOfPast(first);
  if (!base) return null;
  return { base, object: cleanObject(t.slice(first.length)) };
}
