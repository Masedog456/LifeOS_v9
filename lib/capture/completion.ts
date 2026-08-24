/**
 * Completion and missed-action language (LIFEOS-066 §6, §7, §8, §17, §18, §21).
 *
 * "I finished deployment." "Called the dentist." "Paid the electric bill."
 * "Didn't work out today."
 *
 * People report what happened far more often than they file a task, and until
 * now every one of those sentences became a NEW note or a NEW action — so the
 * thing that was actually finished stayed open, and the report of finishing it
 * sat beside it as a second record. The LIFEOS-063 dogfood produced this shape
 * on five of seven days.
 *
 * ## This is an UPDATE, never a creation (§6)
 *
 * Nothing here proposes a new record. A completion sentence either names an
 * existing Action — in which case it proposes marking THAT one complete — or it
 * names nothing, in which case the sentence stays exactly what the user typed.
 * There is deliberately no path that creates an Action called "finished
 * deployment" and immediately ticks it: that manufactures history nobody lived.
 *
 * ## It reuses LIFEOS-065's safety model wholesale (§7, §21)
 *
 * Same `TemporalEditIntent`, same `matchEditTargets`, same `authorityFor`, same
 * `ChangeConfirm` panel, same `applyTemporalEdit` dispatcher. `complete` is one
 * more operation on the existing change path, not a second mutation language.
 * The three-way authority rule is unchanged and is the whole point:
 *
 *   UNAMBIGUOUS  one live match      → a proposal, confirmed by a person
 *   AMBIGUOUS    several matches     → a question, with nothing preselected
 *   NO MATCH     none                → the capture is preserved, nothing written
 *
 * **There is no recency tie-breaker.** Two open actions called "Proposal" means
 * two rows and a question, exactly as it does for rescheduling. Picking the
 * newer one silently is how a user loses a record they were relying on, and it
 * is worse here than for a date change: an accidental completion removes the
 * thing from every surface that would have reminded them.
 *
 * ## Strong shapes ask; weak shapes only speak when they match (§18)
 *
 * "I finished the deployment" is unmistakably a completion report, so it opens
 * the panel even when nothing matches — the user is told Conqify found nothing
 * to tick rather than silently filing a note.
 *
 * "Called the dentist" is a past-tense sentence, and most past-tense sentences
 * in a capture box are just notes about the day. So the weak shape produces a
 * proposal ONLY when it names something that is actually open. No match means
 * no panel and no interruption — it stays an ordinary capture.
 *
 * ## Not-done language is not the inverse of completion (§8)
 *
 * "I didn't work out today" is a fact about a day. It is not a completion, it is
 * not a reschedule, and it is not a failure. `detectMissed` returns a reading
 * that Capture turns into an ordinary note; the matching open Action is
 * mentioned so the user can see it is still there, and nothing about it changes.
 * No streak breaks, no "missed" flag, no moral language anywhere in this file.
 *
 * ## Pure
 *
 * Reads state, returns intents. Every write goes through `applyTemporalEdit`.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { StoreState } from "@/types/mvp";
import { extractTemporal } from "@/lib/capture/dates";
import { cleanObject, splitPastVerb } from "@/lib/capture/morphology";
import {
  matchEditTargets, authorityFor, splitEditClauses, detectTemporalEdit,
  type EditRefusal, type EditTarget, type TemporalEditIntent,
} from "@/lib/capture/temporal-edit";

// -------------------------------------------------------------- detection ---

/**
 * Unmistakable completion reports (§6).
 *
 * Each names finishing as the point of the sentence, not as an aside, so these
 * open the panel even when nothing matches.
 */
const STRONG_PATTERNS: Array<{ re: RegExp; object: number }> = [
  // "I finished the deployment", "just completed the proposal", "finally did the taxes"
  { re: /^(?:i\s+)?(?:just\s+|finally\s+|already\s+)?(?:finished|completed)\s+(?:with\s+)?(.+)$/i, object: 1 },
  // "I'm done with the proposal", "done with laundry"
  { re: /^(?:i'?m\s+|i\s+am\s+)?done\s+with\s+(.+)$/i, object: 1 },
  // "Took care of the insurance", "wrapped up the report", "knocked out the taxes"
  { re: /^(?:i\s+)?(?:just\s+|finally\s+)?(?:took\s+care\s+of|wrapped\s+up|knocked\s+out|dealt\s+with|got\s+through)\s+(.+)$/i, object: 1 },
  // "The proposal is done", "deployment done", "laundry is finally finished"
  { re: /^(.+?)\s+(?:is\s+|are\s+|'s\s+)?(?:finally\s+|now\s+|all\s+)?(?:done|finished|complete|completed|sorted|handled)\s*$/i, object: 1 },
];

/**
 * Language that reports something NOT happening (§8).
 *
 * Checked before completion, because "I didn't finish the proposal" contains a
 * completion shape and means its opposite. Getting this order wrong would tick
 * off the exact thing the user said they had not done — the worst single
 * failure available in this sprint.
 */
const MISSED_PATTERNS: Array<{ re: RegExp; object: number }> = [
  { re: /^(?:i\s+)?(?:did\s*n'?t|did\s+not|have\s*n'?t|have\s+not|has\s*n'?t|never)\s+(?:(?:get|got)\s+(?:a\s*)?(?:round|around)\s+to\s+|manage\s+to\s+|end\s+up\s+)?(.+)$/i, object: 1 },
  { re: /^(?:i\s+)?(?:forgot|failed|neglected)\s+to\s+(.+)$/i, object: 1 },
  { re: /^(?:i\s+)?(?:missed|skipped)\s+(?!out\b)(.+)$/i, object: 1 },
  { re: /^(.+?)\s+(?:did\s*n'?t|did\s+not)\s+happen\s*$/i, object: 1 },
];

/**
 * Missed-language that is really WAITING, and must not be claimed here.
 *
 * "I haven't heard back from Marcus" is about someone else's silence, and
 * `lib/capture/waiting.ts` already reads it correctly. Capture consults waiting
 * first, but this guard means the two cannot disagree if that order ever moves.
 */
const WAITING_SHAPED = /\b(?:heard|hear)\s+(?:back\s+)?from\b|\bgot(?:ten)?\s+back\s+to\s+me\b|\breply\b|\bresponded\b/i;

function tidy(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "").trim();
}

/**
 * Does this sentence report something being finished?
 *
 * Cheap and deliberately generous — the expensive part is matching, and a
 * sentence that gets here but names nothing simply produces no intent.
 */
export function looksLikeCompletion(text: string): boolean {
  const t = tidy(text);
  if (!t) return false;
  if (looksLikeMissed(t)) return false;
  if (STRONG_PATTERNS.some((p) => p.re.test(t))) return true;
  return !!splitPastVerb(t);
}

/** Does this sentence report something NOT happening? (§8) */
export function looksLikeMissed(text: string): boolean {
  const t = tidy(text);
  if (!t) return false;
  if (WAITING_SHAPED.test(t)) return false;
  return MISSED_PATTERNS.some((p) => p.re.test(t));
}

// --------------------------------------------------------------- matching ---

/**
 * Find the Actions a completion could be about (§7).
 *
 * Two queries, narrow first: "call dentist" before "dentist". A verb the user
 * supplied is evidence, and dropping it straight away would turn "Emailed the
 * professor" into a match against "Call the professor".
 *
 * Events are excluded on purpose. An Event has no status in this ontology —
 * it either happened or it did not — so offering to "complete" one would need a
 * concept that does not exist, and §35 forbids inventing it.
 */
function findCompletionTargets(queries: string[], state: StoreState, strong: boolean): EditTarget[] {
  for (const q of queries) {
    if (!q) continue;
    const hits = matchEditTargets(q, state, "action");
    if (hits.length === 0) continue;
    const live = hits.filter((h) => !h.blocked);
    if (live.length > 0) return live;
    // Everything that matched is already closed. A STRONG report deserves to be
    // told so — "I finished the registration" when it is already ticked is worth
    // a sentence. A weak past-tense aside does not: "Renewed the registration"
    // said in passing about a done thing should stay an ordinary note rather
    // than open a panel to announce that nothing will happen (§18).
    if (strong) return hits;
  }
  return [];
}

/** Why this completion will not be applied, if it will not. */
function refusalForCompletion(matches: EditTarget[], query: string): EditRefusal | undefined {
  if (matches.length === 0) {
    return {
      code: "no_target",
      message: query
        ? `Nothing open called “${query}”. This stays as you wrote it — nothing was marked complete.`
        : "Couldn't tell what this finished. It stays as you wrote it.",
    };
  }
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only?.blocked) return { code: "already_complete", message: only.blocked };
  if (only && only.kind !== "action") {
    return {
      code: "not_completable",
      message: "Events aren't checked off — they either happened or they didn't.",
    };
  }
  return undefined;
}

// ---------------------------------------------------------------- reading ---

/**
 * Read one sentence as a completion, or return `null`.
 *
 * `contextTarget` is the record the surface is already holding, used only when
 * the sentence names nothing itself ("done" after a proposal). Same rule as
 * LIFEOS-065 §9: a referent the user can see, never hidden session state.
 */
export function detectCompletion(
  text: string,
  state: StoreState,
  today: DayKey,
  contextTarget?: EditTarget,
): TemporalEditIntent | null {
  const src = tidy(text);
  if (!src || !looksLikeCompletion(src)) return null;

  const temporal = extractTemporal(src, today);

  let object = "";
  let queries: string[] = [];
  let strong = false;

  for (const p of STRONG_PATTERNS) {
    const m = p.re.exec(src);
    if (!m) continue;
    object = cleanObject(m[p.object]);
    queries = [object];
    strong = true;
    break;
  }

  if (!strong) {
    const past = splitPastVerb(src);
    if (!past) return null;
    object = past.object;
    // Narrow before broad. A weak shape has only its own words to go on.
    queries = [`${past.base} ${object}`.trim(), object];
  }

  const useContext = object.length < 3 && !!contextTarget;
  const matches = useContext ? [contextTarget!] : findCompletionTargets(queries, state, strong);

  // §18. An ordinary past-tense sentence that names nothing open is just a note
  // about the day, and interrupting it with a panel would make Capture hostile.
  if (!strong && matches.length === 0) return null;

  const authority = authorityFor(matches);
  const intent: TemporalEditIntent = {
    targetType: "action",
    targetQuery: useContext ? contextTarget!.title : object,
    operation: "complete",
    proposedFields: {
      // The day the report is about. Only a RECURRING action uses it — that is
      // which occurrence closed. A one-time action has no per-day completion,
      // so this is carried and ignored rather than written somewhere false.
      date: temporal.dueDate ?? today,
    },
    sourceText: src,
    confidence: authority === "unambiguous" ? "high" : authority === "ambiguous" ? "likely" : "possible",
    authority,
    candidateMatches: matches,
    unresolved: temporal.unresolved,
    refusal: undefined,
  };
  intent.refusal = refusalForCompletion(matches, object);
  return intent;
}

/** Read a whole utterance as zero or more completions. */
export function detectCompletions(
  text: string,
  state: StoreState,
  today: DayKey,
  contextTarget?: EditTarget,
): TemporalEditIntent[] {
  const src = tidy(text);
  if (!src) return [];
  const out: TemporalEditIntent[] = [];
  for (const part of splitEditClauses(src)) {
    const intent = detectCompletion(part, state, today, contextTarget);
    if (intent) out.push(intent);
  }
  return out;
}

// ------------------------------------------------------------ missed work ---

/**
 * What a not-done sentence means (§8).
 *
 * Deliberately NOT an intent: there is nothing to confirm, because nothing will
 * change. The sentence becomes an ordinary note, and `related` lets Capture say
 * — factually — that the matching Action is still open.
 */
export interface MissedReading {
  sourceText: string;
  /** The words naming what did not happen. */
  objectQuery: string;
  /** The day the statement is about. Recorded in the note's own words, not stored. */
  day: DayKey;
  /** Open Actions the statement appears to be about. Never modified. */
  related: EditTarget[];
}

export function detectMissed(text: string, state: StoreState, today: DayKey): MissedReading | null {
  const src = tidy(text);
  if (!looksLikeMissed(src)) return null;

  let object = "";
  for (const p of MISSED_PATTERNS) {
    const m = p.re.exec(src);
    if (!m) continue;
    object = cleanObject(m[p.object]);
    break;
  }

  const temporal = extractTemporal(src, today);
  // "I didn't finish the proposal" keeps its verb, and the Action is titled
  // "Proposal" — so the bare object is tried too. Same narrow-then-broad order
  // the completion path uses, for the same reason: the verb is evidence until it
  // turns out to be noise.
  const withoutVerb = object.replace(/^\S+\s+/, "");
  const related = relatedTo([object, cleanObject(withoutVerb)], state);

  return { sourceText: src, objectQuery: object, day: temporal.dueDate ?? today, related };
}

function relatedTo(queries: string[], state: StoreState): EditTarget[] {
  for (const q of queries) {
    if (!q) continue;
    const hits = matchEditTargets(q, state, "action").filter((t) => !t.blocked);
    if (hits.length > 0) return hits;
  }
  return [];
}

/**
 * The sentence a missed-work note carries as its explanation.
 *
 * Every word here is checked against §8: it states what was said, states what
 * was not changed, and stops. There is no "missed", no "slipped", no "again",
 * no encouragement. A person writing down that they did not go to the gym does
 * not need their software to have an opinion about it.
 */
export function missedNoteReason(reading: MissedReading): string {
  const base = "Kept as a note. Nothing was marked complete and nothing was rescheduled.";
  if (reading.related.length === 1) {
    return `${base} “${reading.related[0].title}” is still open.`;
  }
  if (reading.related.length > 1) {
    return `${base} ${reading.related.length} open actions match these words.`;
  }
  return base;
}

// ----------------------------------------------------------- the front door --

/**
 * Everything in one utterance that is a CHANGE rather than a new record (§16).
 *
 * "I finished deployment and need to email my professor tomorrow" is both: a
 * completion of something that exists and a new action that does not. Capture
 * has to show both, so this returns the changes AND the text that is left over,
 * which goes down the ordinary interpretation path untouched.
 *
 * Reschedules are read before completions on each clause. "Move the dentist to
 * Friday" contains no completion shape, but the reverse ordering would let a
 * future edit verb be eaten by a past-tense rule, and a wrongly-ticked record is
 * more expensive than a wrongly-offered date change.
 */
export function readChanges(
  text: string,
  state: StoreState,
  today: DayKey,
  contextTarget?: EditTarget,
): { changes: TemporalEditIntent[]; remainder: string } {
  const src = tidy(text);
  if (!src) return { changes: [], remainder: "" };

  const parts = splitEditClauses(src);
  const changes: TemporalEditIntent[] = [];
  const leftover: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const edit = detectTemporalEdit(part, state, today, i > 0 ? parts[i - 1] : undefined, contextTarget);
    if (edit) { changes.push(edit); continue; }
    const done = detectCompletion(part, state, today, contextTarget);
    if (done) { changes.push(done); continue; }
    leftover.push(part);
  }

  // Nothing split usefully — re-read the whole sentence as one change.
  if (changes.length === 0 && parts.length > 1) {
    const whole = detectTemporalEdit(src, state, today, undefined, contextTarget)
      ?? detectCompletion(src, state, today, contextTarget);
    if (whole) return { changes: [whole], remainder: "" };
  }

  return { changes, remainder: changes.length > 0 ? leftover.join(". ") : src };
}
