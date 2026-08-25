"use client";

/**
 * Ask your memory (LIFEOS-069 §20, §21).
 *
 * ## One box, one answer
 *
 * Not a chat. There is no transcript, no thread, no "Claude is typing", and no
 * second surface — this sits on `/memory`, above the deterministic Week in
 * Review it shares its evidence with. A question replaces the previous answer
 * rather than appending to it, because a scrollback of a person's life would
 * turn a reference tool into a conversation about them.
 *
 * ## It stores nothing (§21, §28)
 *
 * The question lives in component state and the answer is recomputed from the
 * store on every render. Nothing here is written, so a deleted record disappears
 * from future answers with no invalidation step — and no answer can outlive the
 * evidence that produced it.
 *
 * ## The status is shown, not smoothed
 *
 * A partial answer says which half is missing. An ambiguous one asks. One with
 * no evidence says so and stops. Those three are the point of the feature: a
 * memory tool that always produces a confident paragraph is a memory tool that
 * is sometimes making things up.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildIndex } from "@/lib/command/search";
import { MEMORY_QUERY_EXAMPLES } from "@/lib/memory/query";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { todayKey } from "@/lib/reviews/dates";
import { resolutionsFor } from "@/lib/commitment/resolve";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import { answerMemoryQuery, type MemoryAnswer, type MemoryAnswerStatus } from "@/lib/memory/answer";
import type { RecordRefLite } from "@/types/mvp";

const STATUS_LABEL: Record<MemoryAnswerStatus, string> = {
  ANSWERED: "From your records",
  PARTIALLY_ANSWERED: "Partly answerable",
  NO_RECORDED_EVIDENCE: "No recorded evidence",
  NEEDS_CHOICE: "Which one?",
};

const STATUS_TONE: Record<MemoryAnswerStatus, string> = {
  ANSWERED: "text-zinc-500",
  PARTIALLY_ANSWERED: "text-amber-600 dark:text-amber-500",
  NO_RECORDED_EVIDENCE: "text-zinc-400",
  NEEDS_CHOICE: "text-zinc-500",
};

export default function AskMemory() {
  const state = useStore();
  const [draft, setDraft] = useState("");
  /** The question being answered. Separate from the draft so typing is quiet. */
  const [asked, setAsked] = useState("");
  /** The record the user picked from an ambiguous answer. Cleared on a new ask. */
  const [focusRef, setFocusRef] = useState<RecordRefLite | undefined>();

  // Built once per store snapshot and handed to the answer layer, so a question
  // does not rebuild the index the rest of the page already has (§25).
  const searchIndex = useMemo(() => buildIndex(state), [state]);
  // Likewise for the commitment indexes: built once here, reused by the answer
  // AND by every row's resolution controls (LIFEOS-071 §27).
  const todayIndexes = useMemo(() => buildTodayIndexes(state, todayKey()), [state]);

  const answer: MemoryAnswer | undefined = useMemo(
    () => (asked.trim() ? answerMemoryQuery(state, asked, { searchIndex, focusRef, todayIndexes }) : undefined),
    [state, asked, searchIndex, focusRef, todayIndexes],
  );

  function submit(q: string) {
    setDraft(q);
    setAsked(q);
    setFocusRef(undefined);
  }

  return (
    <section data-memory-ask className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Ask your memory</h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Answered only from what you recorded. Nothing you ask here is saved.
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(draft); }}
        className="flex items-center gap-2"
      >
        <input
          id="memory-query"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What did I finish last week?"
          aria-label="Ask a question about what you recorded"
          className="min-w-0 flex-1 rounded-full border border-black/[.12] bg-transparent px-4 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/[.25] dark:border-white/[.15] dark:focus:border-white/[.30]"
        />
        <button
          type="submit"
          data-memory-submit
          disabled={!draft.trim()}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Ask
        </button>
      </form>

      {!answer && (
        <div className="flex flex-wrap gap-1.5">
          {MEMORY_QUERY_EXAMPLES.slice(0, 4).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              className="rounded-full border border-black/[.10] px-2.5 py-1 text-[11px] text-zinc-500 hover:bg-black/[.04] dark:border-white/[.12] dark:hover:bg-white/[.06]"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {answer && (
        <div
          data-memory-answer
          data-memory-status={answer.status}
          className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]"
        >
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[answer.status]}`}>
            {STATUS_LABEL[answer.status]}
          </p>
          <h3 data-memory-heading className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {answer.heading}
          </h3>
          {answer.summary && (
            <p data-memory-summary className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              {answer.summary}
            </p>
          )}

          {answer.items.length > 0 && (
            <ul data-memory-items className="mt-3 flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {answer.items.map((item, i) => (
                <li key={`${item.ref?.kind}:${item.ref?.id}:${item.evidence}:${i}`} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    {/* §16. Every line is a way back to the record behind it. */}
                    {item.href ? (
                      <Link href={item.href} data-memory-item-link className="min-w-0 flex-1 text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                        {item.text}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 text-sm text-zinc-800 dark:text-zinc-100">{item.text}</span>
                    )}
                    {item.when && <span className="shrink-0 text-[11px] text-zinc-400">{item.when}</span>}
                  </div>
                  {/* §6. The attribution is part of the answer, not decoration —
                      it is what separates "you said" from "a model wrote". */}
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    <span data-memory-attribution>{item.attribution}</span>
                    {item.detail ? ` · ${item.detail}` : ""}
                  </p>
                  {/* LIFEOS-071 §18. A commitment answered here is resolvable
                      here, through the SAME builder Today uses. There is no
                      Memory-specific resolver. */}
                  {item.signal && (
                    <ResolutionControls
                      signal={item.signal}
                      actions={resolutionsFor(state, item.signal, { ix: todayIndexes })}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {answer.choices && answer.choices.length > 0 && (
            <ul data-memory-choices className="mt-3 flex flex-col gap-1.5">
              {answer.choices.map((c) => (
                <li key={`${c.ref.kind}:${c.ref.id}`} className="flex items-center gap-2">
                  <button
                    type="button"
                    data-memory-choice
                    onClick={() => setFocusRef(c.ref)}
                    className="min-w-0 flex-1 rounded-xl border border-black/[.10] px-3 py-2 text-left text-sm hover:bg-black/[.04] dark:border-white/[.12] dark:hover:bg-white/[.06]"
                  >
                    <span className="text-zinc-800 dark:text-zinc-100">{c.title}</span>
                    <span className="ml-2 text-[11px] text-zinc-400">{c.kindLabel}</span>
                  </button>
                  {c.href && (
                    <Link href={c.href} className="shrink-0 text-[11px] text-zinc-500 underline underline-offset-2">
                      Open
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}

          {answer.limitation && (
            <p data-memory-limitation className="mt-3 border-t border-black/[.05] pt-2 text-[11px] leading-relaxed text-zinc-400 dark:border-white/[.06]">
              {answer.limitation}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
