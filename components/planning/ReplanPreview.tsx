"use client";

/**
 * Batch replanning, previewed before anything moves (LIFEOS-090 §18, §19).
 *
 * ## Why a preview at all
 *
 * The audit ran `batchAction(["a-plain","a-wait","a-recur"], "defer")` against a
 * live store and got three deferrals: the wait was orphaned — `status` became
 * `deferred` while `waitingOn: "Maria"` stayed on the record — and the weekly
 * series was parked. One button, no preview, three different kinds of work, one
 * mutation.
 *
 * So this shows what will happen to each item BEFORE it happens, and §19's
 * exceptions are the point rather than an edge case: a mixed selection reads
 *
 *     3 selected · 1 can move · 1 is waiting · 1 repeats
 *
 * and the two that cannot take the intent are left alone unless the user
 * resolves them explicitly.
 *
 * ## Nothing here decides
 *
 * `planReplan` decides and `applyReplan` writes, through the store primitives
 * LIFEOS-071 already binds (§33). This component holds the selection and the
 * confirmation, and it passes `applyReplan` the PROPOSALS rather than the plan,
 * so an excluded item cannot be swept in by a caller reaching for "apply
 * everything".
 */

import { useMemo, useState } from "react";
import {
  completeAction, completeOccurrence, deferAction, setActionDueDate,
  setNextFollowUpDate, stopWaiting, createAction, reopenAction, uncompleteOccurrence,
  cancelAction, useStore,
} from "@/lib/mvpStore";
import { todayKey } from "@/lib/reviews/dates";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { toast } from "@/lib/ux/feedback";
import {
  planReplan, applyReplan, summarize, notTodayChoices,
  type ReplanIntent, type ReplanOps, type ReplanProposal,
} from "@/lib/planning/replan";

/** Every member is an existing primitive. Nothing here sets a field directly. */
const storeOps: ReplanOps = {
  completeAction: (id) => completeAction(id),
  completeOccurrence: (id, day) => completeOccurrence(id, day),
  deferAction: (id, option) => deferAction(id, option),
  setActionDueDate: (id, d) => setActionDueDate(id, d),
  setNextFollowUpDate: (id, d) => setNextFollowUpDate(id, d),
  stopWaiting: (id) => stopWaiting(id),
  createAction: (input) => createAction({ title: input.title, projectId: input.projectId }),
  reopenAction: (id) => reopenAction(id),
  uncompleteOccurrence: (id, day) => uncompleteOccurrence(id, day),
  cancelAction: (id) => cancelAction(id),
};

const chip =
  "rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-300 dark:hover:bg-white/[.06]";
const chipOn =
  "rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900";

export default function ReplanPreview({
  ids, onDone, onCancel,
}: {
  ids: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const state = useStore();
  const today = todayKey();
  const ix = useMemo(() => buildTodayIndexes(state, today), [state, today]);

  const choices = useMemo(() => notTodayChoices(today), [today]);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  /** Exceptions the user chose to resolve with the alternative offered. */
  const [taken, setTaken] = useState<Set<string>>(new Set());

  const plan = useMemo(() => {
    const chosen = choices.find((c) => c.id === choiceId);
    if (!chosen) return null;
    // A named option keeps the store's own convention ("next week" is the
    // following Monday); a bare weekday from `restOfWeek` carries its own day.
    const intent: ReplanIntent =
      chosen.id === "next_week" || chosen.id === "someday" || chosen.id === "tomorrow"
        ? { kind: "defer", option: chosen.id as "tomorrow" | "next_week" | "someday" }
        : { kind: "defer", day: chosen.day };
    return planReplan(state, ids, intent, ix, today);
  }, [state, ids, ix, today, choices, choiceId]);

  function confirm() {
    if (!plan) return;
    // §19. The exceptions the user explicitly took, and NOTHING else.
    const extra = plan.exceptions
      .filter((e) => e.instead && taken.has(e.actionId))
      .map((e) => e.instead as ReplanProposal);
    const outcome = applyReplan([...plan.proposals, ...extra], storeOps);
    toast({
      kind: outcome.refused.length ? "info" : "success",
      message: outcome.refused.length
        ? `${outcome.message} ${outcome.refused.length} couldn't be changed.`
        : outcome.message,
    });
    setTaken(new Set());
    setChoiceId(null);
    onDone();
  }

  const toggle = (id: string) =>
    setTaken((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div data-replan-preview className="flex flex-col gap-2 rounded-2xl border border-black/[.10] p-3 dark:border-white/[.12]">
      <p className="text-xs font-medium">Move {ids.length} item{ids.length === 1 ? "" : "s"} — when should they come back?</p>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="When should they come back">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            data-replan-choice={c.id}
            aria-pressed={choiceId === c.id}
            onClick={() => setChoiceId(choiceId === c.id ? null : c.id)}
            className={choiceId === c.id ? chipOn : chip}
          >
            {/* §43. The selected state is in words as well as in colour. */}
            {choiceId === c.id ? `✓ ${c.label}` : c.label}
          </button>
        ))}
      </div>

      {plan && (
        <>
          {/* §18, §19. What will change, before it changes. */}
          <p data-replan-summary className="text-[11px] text-zinc-500">{summarize(plan)}</p>

          {plan.proposals.length > 0 && (
            <ul data-replan-proposals className="flex flex-col gap-0.5">
              {plan.proposals.map((p) => (
                <li key={p.actionId} data-replan-proposal={p.op} className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  <span className="font-medium">{p.title}</span> — {p.explanation}
                  {p.blockerNote && (
                    <span data-replan-blocker className="text-zinc-400"> {p.blockerNote}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* §19. The exceptions, each with its own reason and its own way out. */}
          {plan.exceptions.length > 0 && (
            <ul data-replan-exceptions className="flex flex-col gap-1">
              {plan.exceptions.map((e) => (
                <li key={e.actionId} data-replan-exception={e.reason} className="text-[11px] text-amber-700 dark:text-amber-400">
                  <span className="font-medium">{e.title}</span> — {e.note}
                  {e.instead && (
                    <button
                      type="button"
                      data-replan-instead={taken.has(e.actionId) ? "on" : "off"}
                      aria-pressed={taken.has(e.actionId)}
                      onClick={() => toggle(e.actionId)}
                      className={`ml-1.5 ${taken.has(e.actionId) ? chipOn : chip}`}
                    >
                      {taken.has(e.actionId) ? `✓ ${e.instead.explanation}` : `${e.instead.explanation} instead`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-replan-confirm
          disabled={!plan || (plan.proposals.length === 0 && taken.size === 0)}
          onClick={confirm}
          className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Confirm
        </button>
        <button type="button" data-replan-cancel onClick={onCancel} className={chip}>Cancel</button>
      </div>
    </div>
  );
}
