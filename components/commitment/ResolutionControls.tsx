"use client";

/**
 * The controls on a commitment row (LIFEOS-071 §19, §21, §22).
 *
 * ## One row, up to three buttons
 *
 * `MAX_INLINE` is the whole layout policy. A signal that could offer five things
 * offers three, in the order `RESOLUTIONS_BY_KIND` declares, and the rest stay
 * on the record's own page. Button soup is how a calm surface becomes a control
 * panel, and the row's job is still to state a fact — the controls are the
 * smaller half of it.
 *
 * ## Confirm means a bounded choice, not an editor
 *
 * A `confirm` action opens a short row of presets (or one text field), inline,
 * and closes on selection. There is deliberately no date picker, no recurrence
 * editor and no dependency graph here — §7 keeps those on the detail page, and
 * recreating them inside Today is how the page stops being Today.
 *
 * ## Failure keeps the affordance
 *
 * §22: a refused mutation leaves the row, the buttons and the panel exactly
 * where they were, and prints what the store said. Nothing here optimistically
 * removes anything — the row disappears on the next render because the signal
 * was recomputed and its evidence changed (§20).
 */

import { useState } from "react";
import Link from "next/link";
import {
  completeAction, completeOccurrence, deferAction, setActionDueDate,
  setNextFollowUpDate, stopWaiting, createAction, reopenAction, uncompleteOccurrence,
} from "@/lib/mvpStore";
import { todayKey } from "@/lib/reviews/dates";
import { toast } from "@/lib/ux/feedback";
import type { ResolutionAction, ResolutionChoice } from "@/lib/commitment/resolve";
import { applyResolution, type ResolutionOps } from "@/lib/commitment/apply";

/** At most three controls on a row. The rest live on the record's page. */
export const MAX_INLINE = 3;

/**
 * The real store, bound to the ops interface.
 *
 * Every member is an existing primitive. Nothing in this file sets a field
 * directly — see the header of `lib/commitment/apply.ts`.
 */
const storeOps: ResolutionOps = {
  completeAction: (id) => completeAction(id),
  completeOccurrence: (id, day) => completeOccurrence(id, day),
  deferAction: (id, option) => deferAction(id, option),
  setActionDueDate: (id, d) => setActionDueDate(id, d),
  setNextFollowUpDate: (id, d) => setNextFollowUpDate(id, d),
  stopWaiting: (id) => stopWaiting(id),
  createAction: (input) => createAction({ title: input.title, projectId: input.projectId }),
  reopenAction: (id) => reopenAction(id),
  uncompleteOccurrence: (id, day) => uncompleteOccurrence(id, day),
};

const btn =
  "rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:text-zinc-300 dark:hover:bg-white/[.06]";
const primaryBtn =
  "rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900";

export default function ResolutionControls({
  title, actions,
}: {
  /**
   * The record's title, used only to label the one text input.
   *
   * A title, not a `CommitmentSignal` — a recommended action need not carry a
   * signal, and passing a synthesised one just to satisfy a prop would put a
   * fake piece of evidence into the render tree (LIFEOS-072 §20).
   */
  title: string;
  actions: ResolutionAction[];
}) {
  /** Which action's bounded choice panel is open, by kind. */
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** The last refusal, kept visible until the user does something else (§22). */
  const [problem, setProblem] = useState<string | null>(null);

  const shown = actions.slice(0, MAX_INLINE);
  if (shown.length === 0) return null;

  function run(action: ResolutionAction, choice?: ResolutionChoice, text?: string) {
    const outcome = applyResolution({ action, choice, text, today: todayKey() }, storeOps);
    if (!outcome.applied) {
      // The row stays. The buttons stay. The panel stays open so a corrected
      // choice is one click away.
      setProblem(outcome.message);
      return;
    }
    setProblem(null);
    setOpen(null);
    setDraft("");
    toast({
      kind: "success",
      message: outcome.message,
      action: outcome.undo ? { label: outcome.undo.label, run: outcome.undo.run } : undefined,
    });
  }

  return (
    <div data-resolutions className="mt-1 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((a, i) => {
          if (a.authority === "navigate" && a.href) {
            return (
              <Link key={a.kind} href={a.href} data-resolution={a.kind}
                className={btn} title={a.explanation}>
                {a.label}
              </Link>
            );
          }
          return (
            <button
              key={a.kind}
              type="button"
              data-resolution={a.kind}
              disabled={!a.enabled}
              title={a.explanation}
              onClick={() => {
                // A disabled button never fires this, which is why the reason
                // it is disabled is rendered below rather than waiting here.
                // A bounded choice or a text field opens first; an
                // auto-with-undo action runs on this press.
                if (a.authority === "confirm") setOpen(open === a.kind ? null : a.kind);
                else run(a);
              }}
              className={i === 0 && a.authority === "auto_with_undo" ? primaryBtn : btn}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      {/*
        LIFEOS-090 §15, §43. A control that is offered but cannot be used owes
        the reader a reason, and a `title` is not one: it needs a pointer and a
        hover, so a touch user and a screen-reader user both get silence. The
        recurring row's "Not today" is the case that matters — the honest answer
        is that one occurrence cannot move without moving the series, and that
        sentence has to be readable on the page.
      */}
      {shown.filter((a) => !a.enabled && a.explanation).map((a) => (
        <p key={`why-${a.kind}`} data-resolution-unavailable={a.kind}
          className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {a.explanation}
        </p>
      ))}

      {shown.map((a) => {
        if (open !== a.kind) return null;

        // §16. The user writes the next action; Conqify supplies the link only.
        if (a.kind === "create_project_next_action") {
          return (
            <form key={a.kind} data-resolution-panel={a.kind}
              onSubmit={(e) => { e.preventDefault(); run(a, undefined, draft); }}
              className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                placeholder="What's the next step?"
                aria-label={`Next action for ${title}`}
                data-resolution-input
                className="min-w-0 flex-1 rounded-full border border-black/[.12] bg-transparent px-3 py-1 text-[11px] outline-none dark:border-white/[.15]"
              />
              <button type="submit" className={primaryBtn} data-resolution-submit>Add</button>
            </form>
          );
        }

        // Several blockers: the user picks. Never resolved by recency (§15).
        if (a.kind === "open_blocker") {
          return (
            <div key={a.kind} data-resolution-panel={a.kind} className="flex flex-wrap items-center gap-1.5">
              {(a.choices ?? []).map((c) => (
                <Link key={c.id} href={c.href ?? "#"} data-resolution-choice={c.id} className={btn}>
                  {c.label}
                </Link>
              ))}
            </div>
          );
        }

        // A `confirm` action with no presets — "Stop waiting" — needs a plain
        // yes/no. Rendering only the choice list here left an EMPTY panel whose
        // sole control was "Never mind", so the operation could be started and
        // never completed. The browser smoke found it; nothing in the resolver
        // or the fake could have.
        if (!a.choices || a.choices.length === 0) {
          return (
            <div key={a.kind} data-resolution-panel={a.kind} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">{a.explanation}</span>
              <button type="button" data-resolution-confirm onClick={() => run(a)} className={primaryBtn}>
                {a.label}
              </button>
              <button type="button" onClick={() => setOpen(null)}
                className="text-[11px] text-zinc-400 underline underline-offset-2">
                Never mind
              </button>
            </div>
          );
        }

        return (
          <div key={a.kind} data-resolution-panel={a.kind} className="flex flex-wrap items-center gap-1.5">
            {(a.choices ?? []).map((c) => (
              <button key={c.id} type="button" data-resolution-choice={c.id}
                onClick={() => run(a, c)} className={btn}>
                {c.label}
              </button>
            ))}
            <button type="button" onClick={() => setOpen(null)}
              className="text-[11px] text-zinc-400 underline underline-offset-2">
              Never mind
            </button>
          </div>
        );
      })}

      {/* §22. Factual, compact, and it does not take the controls away. */}
      {problem && (
        <p data-resolution-problem className="text-[11px] text-amber-600 dark:text-amber-500">
          {problem}
        </p>
      )}
    </div>
  );
}
