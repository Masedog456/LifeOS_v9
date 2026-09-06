/**
 * The record's name, as distinct from the sentence that created it (LIFEOS-096).
 *
 * ## What this is not
 *
 * Not a classifier, not a rewriter, and not a generator. It reads what
 * `interpret` ALREADY extracted and recomposes a title from those fields. If
 * the fields do not support a better title, it returns the original and says so
 * (§40). There is no confidence score, no phrase dictionary, and no model.
 *
 * ## Why so little of it
 *
 * The audit expected to strip framing and dates. It found `interpret` already
 * does both: "I need to send Marcus the lease" is titled "send Marcus the
 * lease", and "Dinner with Ana next Thursday at 7" is titled "Dinner with Ana"
 * with the date and time in fields. So the two real jobs left are small:
 *
 *   1. Waiting, which extracts `waitingOn` AND `waitingFor` and then titles the
 *      record with the whole sentence anyway.
 *   2. The lower-case residue framing-stripping leaves behind (§24).
 *
 * ## The safe direction
 *
 * Every rule here returns the original title when it is not certain. That
 * matters more than the rules themselves: a title is the name a person will see
 * for a commitment for months, and a wrong one is worse than a long one.
 */

import type { Candidate } from "@/lib/capture/interpret";
import { startsWithActionVerb } from "@/lib/capture/classify";

export interface TitleResult {
  title: string;
  changed: boolean;
  /** Why it changed, or why it did not. Shown in tests, never to the user. */
  reason: string;
}

/**
 * Words that make `waitingFor` a clause about an action rather than a thing.
 *
 * "I'm waiting for the landlord to send the lease" parses `waitingFor` as
 * "send the lease" — recomposing that gives "Send the lease from landlord",
 * which is worse than the sentence it replaced. §8 is explicit: do not
 * fabricate nouns. So a verb-headed `waitingFor` declines.
 *
 * The verb list is `classify.ts`'s own `ACTION_VERBS`, reached through
 * `startsWithActionVerb` rather than copied — a second list would drift from
 * the first, and the first is the one the classifier trusts.
 *
 * There was a second clause here rejecting an infinitive ("to send the lease",
 * "for them to reply"). Mutation M4 removed it and nothing reddened, so it was
 * measured across nine phrasings: the interpreter strips the leading "to" and
 * "for" every time, and `waitingFor` never arrives with one. Dead logic reads
 * like a protection the code does not have, so it is gone rather than pinned.
 */
function isThing(waitingFor: string): boolean {
  const t = waitingFor.trim();
  if (!t) return false;
  return !startsWithActionVerb(t);
}

/** Trailing sentence punctuation has no place in a record's name (§24). */
function trimPunctuation(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[.,;:!?\s]+$/u, "");
}

/**
 * Upper-case the first letter, and nothing else (§24).
 *
 * Explicitly NOT title case: "Send Marcus The Lease" is a headline, not a
 * record. And explicitly not applied when the first word is already capitalised
 * some other way — an acronym or a name the user typed ("iPhone battery",
 * "eBay listing") is theirs, and shouting it back is a change they did not ask
 * for.
 */
function leadingCapital(s: string): string {
  if (!s) return s;
  const first = s[0];
  if (first !== first.toLowerCase()) return s;
  // A word that carries a capital anywhere else is deliberately cased.
  const word = s.split(/\s/)[0] ?? "";
  if (/[A-Z]/.test(word.slice(1))) return s;
  return first.toUpperCase() + s.slice(1);
}

/**
 * A waiting record's name: the thing, then who has it (§8).
 *
 *   waitingFor "transcript" + waitingOn "Maria"  → "Transcript from Maria"
 *   waitingFor "send the lease"                  → declines, verb-headed
 *   waitingOn only                               → declines, nothing to name
 *
 * "from" rather than "owed by" deliberately (§10). "Maria owes me the
 * recommendation letter" is the user's framing of a relationship, and the
 * record's job is to name the thing being waited for — not to restate a claim
 * about what somebody owes.
 */
function waitingTitle(c: Candidate): TitleResult | null {
  const who = (c.fields.waitingOn ?? "").trim();
  const what = (c.fields.waitingFor ?? "").trim();
  if (!what) return null;
  if (!isThing(what)) return null;
  const thing = leadingCapital(trimPunctuation(what));
  if (!thing) return null;
  if (!who) return { title: thing, changed: true, reason: "named the thing being waited for" };
  // Already says who: "the transcript from Maria" needs no second "from Maria".
  if (new RegExp(`\\b(?:from|by)\\s+${escapeRe(who)}\\b`, "i").test(what)) {
    return { title: thing, changed: true, reason: "the thing already names the person" };
  }
  return {
    title: `${thing} from ${who}`,
    changed: true,
    reason: "recomposed from waitingFor and waitingOn",
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Kinds whose title may be RECOMPOSED from other fields.
 *
 * Only waiting, and only because it is the one kind that parses out both the
 * thing and the person and then titles the record with the sentence anyway.
 * Recomposition is the strong operation here and it has exactly one member.
 */
const RECOMPOSABLE = new Set(["waiting"]);

/**
 * Kinds whose title may be TIDIED — capitalised and de-punctuated (§24).
 *
 * A wider set, because tidying changes no meaning. Goals and projects are in
 * it: the interpreter titles a goal "get healthier", and §14 and §15 forbid
 * strengthening what it CLAIMS about an aspiration, not making the claim it
 * already made read like a record. The 080 browser suite is what surfaced this
 * — one sentence produced "get healthier" beside "Book a physical", and a list
 * where two records made by one sentence are cased on different principles is
 * worse than either convention.
 *
 * Deliberately absent:
 *
 *   note, reflection   §12, §13 — the prose IS the record, and
 *                      `commitCapture` writes `body || title` regardless
 *   protocol           no title at all; a trigger and a response, and §20's
 *                      dependency lives in them
 *   standard           §16 — normative wording is not this sprint's to touch,
 *                      even in ways that look harmless
 */
const TIDYABLE = new Set(["action", "waiting", "event", "goal", "project"]);

/**
 * The one entry point (§39).
 *
 * Pure: a function of the candidate. No store, no clock, no network. Returns
 * the original title whenever it cannot do better, which is most of the time —
 * the audit found the interpreter already produces a clean title for every
 * Event and for every Action whose sentence opened with framing.
 */
export function cleanCandidateTitle(c: Candidate): TitleResult {
  const original = c.fields.title ?? "";
  if (!TIDYABLE.has(c.kind)) {
    return { title: original, changed: false, reason: `${c.kind} titles are left alone` };
  }

  if (RECOMPOSABLE.has(c.kind)) {
    const composed = waitingTitle(c);
    if (composed) return composed;
    // No object, or the object is a clause. "Waiting on Marcus" stays as it is
    // — §8 says so in as many words.
  }

  const tidied = leadingCapital(trimPunctuation(original));
  if (tidied === original) return { title: original, changed: false, reason: "already clean" };
  return { title: tidied, changed: true, reason: "trimmed and capitalised" };
}

/**
 * Every title a set of candidates would be saved under.
 *
 * Exists so a caller cannot apply the rule to some candidates and forget
 * others — the failure mode that produces a list where two records made by one
 * sentence are named on different principles.
 */
export function cleanTitles(candidates: readonly Candidate[]): TitleResult[] {
  return candidates.map((c) => cleanCandidateTitle(c));
}
