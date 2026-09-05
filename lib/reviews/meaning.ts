/**
 * Meaning capture — the part of a day only the user can supply (LIFEOS-093).
 *
 * ## The division of labour
 *
 * Conqify derives what happened: what completed, what changed, what was
 * deferred, what is still open, what tomorrow holds. It cannot derive what any
 * of that MEANT. LIFEOS-092 removed the wizard that used to ask — correctly,
 * because that wizard also asked the user to retype facts the store already
 * knew — and the loss it left behind was the meaning, not the facts.
 *
 * So this asks a small number of plain questions and writes the answers through
 * the reflection path that already exists. Several prompts are several
 * reflections; the `prompt` field carries which question was answered. There is
 * no journal record, no session, no completion state, and nothing to finish.
 *
 * ## Why there is no new schema (§7, §8)
 *
 * `Reflection` already has everything this needs:
 *
 *   prompt     which question this answers      → the prompt kind
 *   response   the user's words, immutable      → the meaning
 *   context    "optional context the user attached" → the reviewed day
 *   createdAt  when it was typed
 *
 * ## The reviewed day (§13, §14)
 *
 * `context` was already being written by LIFEOS-091 and read by nothing, so a
 * reflection typed at 22:00 about yesterday landed on today. `reflectionDayKey`
 * is the one place that is decided, and it is deliberately conservative: an
 * explicit context is honoured only when it IS a day key, so an older
 * reflection whose context says "tired" keeps falling back to `createdAt`.
 * Nothing is restamped and no timestamp is faked — the creation instant stays
 * exactly what it was, and only the DAY the reflection is filed under changes.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { Reflection } from "@/types/mvp";
import { isDayKey, dayKeyFromIso } from "@/lib/reviews/dates";

// --------------------------------------------------------------- prompts ---

/**
 * The kinds of meaning a day can carry.
 *
 * Not stored as an enum anywhere — the prompt TEXT is what persists, and this
 * is the vocabulary the UI and Memory share so that both name the same six
 * things. §7 permits exactly this when the schema cannot hold a kind, and the
 * schema cannot.
 */
export type ReflectionPromptKind =
  | "mattered"
  | "learned"
  | "difficult"
  | "realization"
  | "decision"
  | "remember";

export interface ReflectionPrompt {
  kind: ReflectionPromptKind;
  /** The question, in plain words (§6). */
  text: string;
  /** A short label for a chooser. Never a category name for a feeling. */
  label: string;
}

/**
 * The prompts, in the order they are offered.
 *
 * §6 rules the language: plain, non-clinical, no therapeutic framing. There is
 * no "describe your emotional state", no "rate the quality of your day", and no
 * "what limiting beliefs arose" — those ask a person to perform a diagnosis on
 * themselves, which is not something a task product should be doing.
 */
export const REFLECTION_PROMPTS: readonly ReflectionPrompt[] = [
  { kind: "mattered", text: "What mattered today?", label: "What mattered" },
  { kind: "learned", text: "What did you learn?", label: "What you learned" },
  { kind: "remember", text: "Anything worth remembering?", label: "Worth remembering" },
  { kind: "difficult", text: "What felt difficult?", label: "What was difficult" },
  { kind: "realization", text: "What are you realizing?", label: "What you're realizing" },
  { kind: "decision", text: "Did you make a decision worth remembering?", label: "A decision" },
];

/**
 * The three offered without asking for more (§5).
 *
 * Six textareas is a journal. Three questions with one composer is a place to
 * say something, and the rest are one press away.
 */
export const PRIMARY_PROMPT_KINDS: readonly ReflectionPromptKind[] =
  ["mattered", "learned", "remember"];

export const MAX_VISIBLE_PROMPTS = 3;

export function primaryPrompts(): readonly ReflectionPrompt[] {
  return REFLECTION_PROMPTS.filter((p) => PRIMARY_PROMPT_KINDS.includes(p.kind));
}

export function otherPrompts(): readonly ReflectionPrompt[] {
  return REFLECTION_PROMPTS.filter((p) => !PRIMARY_PROMPT_KINDS.includes(p.kind));
}

export function promptFor(kind: ReflectionPromptKind): ReflectionPrompt {
  return REFLECTION_PROMPTS.find((p) => p.kind === kind) ?? REFLECTION_PROMPTS[0];
}

/** The kind a stored reflection answers, or null when it answers none of them. */
export function promptKindOf(r: Pick<Reflection, "prompt">): ReflectionPromptKind | null {
  const found = REFLECTION_PROMPTS.find((p) => p.text === r.prompt);
  if (found) return found.kind;
  // LIFEOS-091's single prompt, which predates the set and means the same thing.
  if (/worth remembering/i.test(r.prompt || "")) return "remember";
  return null;
}

/**
 * The day a reflection is ABOUT (§13, §14).
 *
 * An explicit reviewed-day context wins, but only when it is actually a day
 * key. `context` is documented as free-form ("optional mood/context the user
 * attached"), so a reflection carrying "tired" or "on the train" must not be
 * filed under a nonsense date — it falls back to when it was written, which is
 * the honest answer when nothing better was recorded.
 */
export function reflectionDayKey(r: Pick<Reflection, "context" | "createdAt">): DayKey {
  if (r.context && isDayKey(r.context)) return r.context;
  return dayKeyFromIso(r.createdAt) as DayKey;
}

/** True when this reflection was explicitly filed against a reviewed day. */
export function hasReviewedDay(r: Pick<Reflection, "context">): boolean {
  return !!r.context && isDayKey(r.context);
}

// ------------------------------------------------------------ the writing --

/** What the UI hands the store. Every field is an existing `Reflection` field. */
export interface MeaningEntry {
  prompt: string;
  response: string;
  /** The day under review — not necessarily today (§14). */
  context: DayKey;
}

/**
 * Build the reflection for one answered prompt (§11, §27).
 *
 * Returns `null` for an empty answer rather than writing a blank record: an
 * unanswered prompt is a complete answer, and §4 means it leaves no trace.
 * Each call is one independent save — there is no batch, no session and no
 * "finish" (§27).
 */
export function meaningEntry(
  kind: ReflectionPromptKind,
  response: string,
  reviewedDay: DayKey,
): MeaningEntry | null {
  const text = response.trim();
  if (!text) return null;
  return { prompt: promptFor(kind).text, response: text, context: reviewedDay };
}

// ------------------------------------------------------------- displaying --

export interface MeaningCard {
  reflection: Reflection;
  kind: ReflectionPromptKind | null;
  /** The question, shown once above the answer (§30). */
  prompt: string;
  /** The day it is about. */
  day: DayKey;
  /** True when it was typed on a different day from the one it is about. */
  writtenLater: boolean;
}

/**
 * The reflections belonging to one day, as cards (§30, §31).
 *
 * Ownership once: this is the only place the Evening Close renders a
 * reflection, and the prompt appears once above its answer rather than being
 * repeated around it.
 */
/**
 * How many answers a day shows before the rest are counted (§30, §41).
 *
 * There are six prompts, so six answers is a day where every question was
 * taken up — a legitimate ceiling rather than an arbitrary one. Beyond that the
 * remainder is counted, because 250 cards is the wall this product caps
 * everywhere else (still open at three, the waiting roster at three) and a
 * performance run at 5,000 records rendered exactly that.
 */
export const MAX_MEANING_CARDS = REFLECTION_PROMPTS.length;

export function meaningForDay(reflections: readonly Reflection[], day: DayKey): MeaningCard[] {
  return reflections
    .filter((r) => reflectionDayKey(r) === day)
    .map((r) => ({
      reflection: r,
      kind: promptKindOf(r),
      prompt: r.prompt,
      day,
      // §13. Stated, never hidden: the creation instant is still the truth
      // about when it was typed, and saying so is cheaper than pretending.
      writtenLater: (dayKeyFromIso(r.createdAt) as string) !== day,
    }))
    .sort((a, b) => a.reflection.createdAt.localeCompare(b.reflection.createdAt));
}

/** Everything for the day, and how many the cap left out. Never dropped silently. */
export function meaningPageForDay(reflections: readonly Reflection[], day: DayKey): {
  cards: MeaningCard[]; more: number;
} {
  const all = meaningForDay(reflections, day);
  return { cards: all.slice(0, MAX_MEANING_CARDS), more: Math.max(0, all.length - MAX_MEANING_CARDS) };
}

/** "You wrote this on Fri, Sep 4" — only when it differs from the day shown. */
export function writtenLaterNote(card: MeaningCard, format: (d: DayKey) => string): string | null {
  if (!card.writtenLater) return null;
  return `Written ${format(dayKeyFromIso(card.reflection.createdAt) as DayKey)}`;
}

// --------------------------------------------------------------- language --

/** §29. Absence is a complete answer, and the copy says nothing about it. */
export const MEANING_EMPTY = "Optional. One sentence, or nothing at all.";

/** §26. One press to reach the rest, rather than six boxes on arrival. */
export const MEANING_MORE = "Another prompt";

/**
 * Words this layer may never use (§6, §23, §24, §25, §36).
 *
 * The interpretation ban is the important half. "Writing the statement felt
 * impossible" is a sentence a person wrote about a task; it is not evidence of
 * avoidance, anxiety or burnout, and a product that reads it that way is
 * diagnosing someone from a text box.
 */
export const MEANING_FORBIDDEN_WORDS: readonly string[] = [
  "mood", "sentiment", "stress score", "difficulty score", "rate your",
  "emotional state", "limiting belief", "burnout", "anxiety", "avoidance",
  "streak", "journal streak", "completion", "you haven't finished",
  "today's themes were", "positive day", "negative day",
];

/** Every string this layer can produce, for the language guards to sweep. */
export function meaningStrings(): string[] {
  return [
    ...REFLECTION_PROMPTS.map((p) => `${p.text} ${p.label}`),
    MEANING_EMPTY, MEANING_MORE,
  ];
}
