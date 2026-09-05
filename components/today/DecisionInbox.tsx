"use client";

/**
 * "Needs your decision" — the one place a judgment call is asked (LIFEOS-094).
 *
 * ## What this page refuses to become
 *
 * A backlog. §17 is the whole design constraint: overdue work, work due soon,
 * open actions, blocked actions and planning-hygiene rows are all excluded, and
 * the audit's test for why is in `lib/guidance/decisions.ts` — where a signal's
 * options are ways of DOING the work, the user needs notice, not a decision.
 * Seven of LIFEOS-082's ten attention kinds fall on that side and none of them
 * appear here. This is not ExecutiveAttention 2.0.
 *
 * ## It renders no engine of its own
 *
 * Every control on a row comes from a list something else built. LIFEOS-071's
 * `resolutionsForAction` / `resolutionsFor` produce the resolution controls,
 * with their own labels, their own enablement and their own bounded-choice
 * panels; LIFEOS-090's `planReplan` / `applyReplan` produce the one operation
 * 071 has no word for, ending a commitment. This file FILTERS those lists to
 * the options the model named. It never constructs a control, and it never
 * touches a store field.
 *
 * That is also why a row's buttons cannot drift from its model: the model names
 * `ResolutionKind`s and `ReplanIntent`s, and assertion 94.22b checks each one
 * against the engine that would run it, on the real record, under the label the
 * row prints.
 *
 * ## Nothing resolves itself
 *
 * §22: no option is preselected, no row has a default, and nothing here runs
 * without a press. §39: a resolved condition stops producing its row on the
 * next render because the evidence changed — there is no dismissal to record
 * and no queue row to delete.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, getSnapshot } from "@/lib/mvpStore";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { todayKey } from "@/lib/reviews/dates";
import { toast } from "@/lib/ux/feedback";
import {
  buildDecisionInbox, decisionStillStands,
  DECISION_HEADING, DECISION_EMPTY, MAX_DECISIONS,
  type DecisionItem, type DecisionOption,
} from "@/lib/guidance/decisions";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { resolutionsFor, resolutionsForAction, type ResolutionAction } from "@/lib/commitment/resolve";
import { planReplan, applyReplan } from "@/lib/planning/replan";
import { storeReplanOps } from "@/components/planning/replanOps";
import ResolutionControls from "@/components/commitment/ResolutionControls";

const btn =
  "rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-300 dark:hover:bg-white/[.06]";

/**
 * The row's controls, taken from the engines rather than built here.
 *
 * An action reads LIFEOS-071's per-record list, which already refuses to offer
 * "Defer" on a wait and "Not today" on a recurring series. A goal reads the
 * list for its own `goal_path_missing` signal. Anything the model did not name
 * is dropped, so a row shows the answers to ITS question and not every
 * operation the record happens to support.
 */
function engineControls(
  item: DecisionItem,
  state: ReturnType<typeof getSnapshot>,
  ix: ReturnType<typeof buildTodayIndexes>,
  today: string,
): ResolutionAction[] {
  const wanted = new Set(item.options.map((o) => o.resolution).filter(Boolean));
  if (wanted.size === 0) return [];
  const built = item.entity.kind === "action"
    ? resolutionsForAction(state, item.entity.id, { ix, today })
    : buildCommitmentSignals(state, ix, { today })
      .filter((s) => s.recordRef.id === item.entity.id)
      .flatMap((s) => resolutionsFor(state, s, { ix, today }));
  // Deduplicated by kind: a goal carrying two signals would otherwise offer
  // "Open goal" twice, and React would warn about the key besides.
  const seen = new Set<string>();
  return built.filter((r) =>
    wanted.has(r.kind) && !seen.has(r.kind) && (seen.add(r.kind), true));
}

export default function DecisionInbox({ limit = MAX_DECISIONS }: { limit?: number }) {
  const state = useStore();
  const today = todayKey();
  const ix = useMemo(() => buildTodayIndexes(state, today), [state, today]);
  const inbox = useMemo(
    () => buildDecisionInbox(state, ix, { today, limit }),
    [state, ix, today, limit],
  );

  /**
   * §40. The queue on screen may be a minute old.
   *
   * A stop is the one operation here that this file initiates, so it re-reads
   * the store at press time rather than trusting the render that drew the
   * button. `applyResolution` already does the equivalent for the 071 controls,
   * and `planReplan` refuses on its own evidence — this adds the row-level
   * question the plan cannot ask: is this still a decision at all?
   */
  function stop(item: DecisionItem, option: DecisionOption) {
    const fresh = getSnapshot();
    if (!decisionStillStands(fresh, item)) {
      toast({ kind: "info", message: `“${item.title}” changed somewhere else. Nothing was done.` });
      return;
    }
    if (item.entity.kind !== "action" || !option.replan) return;
    const plan = planReplan(fresh, [item.entity.id], option.replan,
      buildTodayIndexes(fresh, today), today);
    if (plan.proposals.length === 0) {
      toast({ kind: "info", message: plan.exceptions[0]?.note ?? `“${item.title}” can't be stopped from here.` });
      return;
    }
    const outcome = applyReplan(plan.proposals, storeReplanOps);
    toast({ kind: outcome.applied > 0 ? "success" : "info", message: outcome.message });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8" data-decision-inbox>
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">{DECISION_HEADING}</h1>
        <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
          Things Conqify won&rsquo;t settle without you. Open work lives on Today.
        </p>
      </header>

      {/*
        §35. Zero is the ordinary state and it is a good one. One sentence, no
        illustration, no "you're all caught up!", and nothing that implies a
        queue ought to have things in it.
      */}
      {inbox.items.length === 0 ? (
        <p data-decision-empty className="text-sm text-zinc-500 dark:text-zinc-400">
          {DECISION_EMPTY}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inbox.items.map((item) => {
            const controls = engineControls(item, state, ix, today);
            const links = item.options.filter((o) => o.href && !o.resolution);
            const stops = item.options.filter((o) => o.replan);
            return (
              <li
                key={item.key}
                data-decision={item.kind}
                data-decision-entity={item.entity.id}
                className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"
              >
                {/* §20. The question leads. The record's own words sit under it. */}
                <p className="text-sm font-medium" data-decision-question>{item.question}</p>
                <p className="mt-0.5 truncate text-[12px] text-zinc-500 dark:text-zinc-400"
                  data-decision-title title={item.title}>
                  {item.title}
                </p>
                {/* §38. Why this is being asked, in one checkable sentence. */}
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400" data-decision-reason>
                  {item.reason}
                </p>

                {controls.length > 0 && (
                  <ResolutionControls title={item.title} actions={controls} />
                )}

                {(links.length > 0 || stops.length > 0) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {stops.map((o) => (
                      <button key={o.id} type="button" data-decision-option={o.id}
                        onClick={() => stop(item, o)} className={btn}>
                        {o.label}
                      </button>
                    ))}
                    {links.map((o) => (
                      <Link key={o.id} href={o.href ?? "#"} data-decision-option={o.id} className={btn}>
                        {o.label}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/*
        §36. The cap is a display cap, and the remainder is stated rather than
        dropped. There is no "show all" — a queue that can grow without bound is
        the backlog this page exists not to be.
      */}
      {inbox.total > inbox.items.length && (
        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400" data-decision-remainder>
          {inbox.total - inbox.items.length} more waiting on a decision.
        </p>
      )}
    </div>
  );
}
