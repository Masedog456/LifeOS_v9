"use client";

/**
 * Meaning capture — the optional half of closing a day (LIFEOS-093).
 *
 * ## What this is not
 *
 * Not a journal. There is no session, no completion state, nothing to finish,
 * no progress meter, and no streak. A day closed with nothing written here is a
 * day fully closed — the facts above it are the review, and this is the part
 * only the person can supply.
 *
 * ## Why one composer rather than three boxes (§5, §26)
 *
 * Six textareas on arrival IS the wizard, in one column instead of seven steps.
 * So the prompts are chips: three offered, the rest one press away, and exactly
 * one composer open at a time. Choosing a prompt is cheap; being confronted
 * with six empty boxes is not.
 *
 * ## Each answer saves alone (§27)
 *
 * One prompt, one `Reflection`, one save. Nothing batches, so there is no state
 * in which a person has written something and not yet kept it.
 */

import { useState } from "react";
import { addReflection } from "@/lib/mvpStore";
import { toast } from "@/lib/ux/feedback";
import { formatDayKey, type DayKey } from "@/lib/reviews/dates";
import {
  primaryPrompts, otherPrompts, meaningEntry, writtenLaterNote,
  MEANING_EMPTY, MEANING_MORE,
  type ReflectionPromptKind, type MeaningCard,
} from "@/lib/reviews/meaning";

const chip =
  "rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-300 dark:hover:bg-white/[.06]";
const chipOn =
  "rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900";

export default function MeaningCapture({
  reviewedDay, cards, more, otherWords, canWrite,
}: {
  /** The day being reviewed — not necessarily today (§14). */
  reviewedDay: DayKey;
  /** What is already written for this day, rendered here and nowhere else (§31). */
  cards: MeaningCard[];
  /** How many further answers the cap left out. Counted, never dropped (§41). */
  more: number;
  /**
   * The day's other user-authored words — notes, captures — as LIFEOS-091's
   * "In your own words" already showed them.
   *
   * They belong here because the section is about what the person wrote, not
   * about which record type they wrote it into. The first version of this
   * component rendered only prompt answers and silently dropped notes from a
   * section that had been showing them; 091's own suite caught it.
   */
  otherWords: { id: string; text: string }[];
  /** Past days are read-only: you cannot add to a day you are only looking at. */
  canWrite: boolean;
}) {
  const [open, setOpen] = useState<ReflectionPromptKind | null>(null);
  const [draft, setDraft] = useState("");
  const [showMore, setShowMore] = useState(false);

  const prompts = showMore ? [...primaryPrompts(), ...otherPrompts()] : primaryPrompts();

  function save(kind: ReflectionPromptKind) {
    const entry = meaningEntry(kind, draft, reviewedDay);
    // §29. An empty answer is a complete answer and leaves no record behind.
    if (!entry) { setOpen(null); setDraft(""); return; }
    addReflection({ prompt: entry.prompt, response: entry.response, context: entry.context });
    setDraft("");
    setOpen(null);
    toast({ kind: "success", message: "Saved with your reflections." });
  }

  return (
    <div data-meaning className="flex flex-col gap-2">
      {/* §30, §31. The words, owned here. The prompt sits once above its answer
          rather than being repeated around it. */}
      {cards.length > 0 && (
        <ul data-meaning-cards className="flex flex-col gap-2">
          {cards.map((card) => (
            <li key={card.reflection.id} data-meaning-card={card.kind ?? "other"}
              className="flex flex-col gap-0.5">
              <p className="text-[11px] text-zinc-400">{card.prompt}</p>
              <p data-review-words className="text-sm text-zinc-700 dark:text-zinc-200">
                “{card.reflection.response}”
              </p>
              {/* §13. When it was typed is a different fact from what it is
                  about, and the honest move is to say so rather than to hide
                  one behind the other. */}
              {writtenLaterNote(card, (d) => formatDayKey(d)) && (
                <p data-meaning-written-later className="text-[11px] text-zinc-400">
                  {writtenLaterNote(card, (d) => formatDayKey(d))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {otherWords.length > 0 && (
        <ul data-meaning-other className="flex flex-col gap-1.5">
          {otherWords.map((w) => (
            <li key={w.id} data-review-words className="text-sm text-zinc-700 dark:text-zinc-200">
              “{w.text}”
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p data-meaning-more-count className="text-[11px] text-zinc-400">
          {more} more {more === 1 ? "answer" : "answers"} from this day.
        </p>
      )}

      {canWrite && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Reflection prompts">
            {prompts.map((p) => (
              <button
                key={p.kind}
                type="button"
                data-meaning-prompt={p.kind}
                aria-pressed={open === p.kind}
                aria-expanded={open === p.kind}
                onClick={() => { setOpen(open === p.kind ? null : p.kind); setDraft(""); }}
                className={open === p.kind ? chipOn : chip}
              >
                {p.label}
              </button>
            ))}
            {!showMore && (
              <button type="button" data-meaning-more onClick={() => setShowMore(true)}
                className="text-[11px] text-zinc-400 underline-offset-4 hover:underline">
                {MEANING_MORE}
              </button>
            )}
          </div>

          {open ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="meaning-response" className="text-[11px] text-zinc-500">
                {prompts.find((p) => p.kind === open)?.text}{" "}
                <span className="text-zinc-400">{MEANING_EMPTY}</span>
              </label>
              <div className="flex items-start gap-2">
                <textarea
                  id="meaning-response"
                  data-meaning-input={open}
                  rows={2}
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter saves; Shift+Enter is a new line. Escape abandons a
                    // draft without keeping anything, because an unfinished
                    // sentence is not a record.
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(open); }
                    if (e.key === "Escape") { setOpen(null); setDraft(""); }
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12"
                />
                <button type="button" data-meaning-save disabled={!draft.trim()}
                  onClick={() => save(open)}
                  className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
                  Save
                </button>
              </div>
            </div>
          ) : (
            // §4, §29. No prompt open is the resting state, and the copy says
            // nothing about what has or has not been written.
            <p data-meaning-rest className="text-[11px] text-zinc-400">{MEANING_EMPTY}</p>
          )}
        </div>
      )}
    </div>
  );
}
