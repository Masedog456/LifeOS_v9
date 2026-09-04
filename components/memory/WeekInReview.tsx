"use client";

/**
 * Week in Review — the weekly executive review (LIFEOS-064, LIFEOS-084).
 *
 * Hosted on `/memory` rather than behind a new nav destination. LIFEOS-063's
 * navigation audit counted 40 destinations of which a full week of ordinary use
 * touched four, so the bar for a forty-first is high — and "Memory" is already
 * the page's name for looking backwards. LIFEOS-084 §29 keeps that promise:
 * this component is improved in place, and no `/weekly`, `/week-summary` or
 * `/executive-review` route was created.
 *
 * ## Five sections, not eight (§20)
 *
 * The audit measured what the eight-section version actually rendered on a
 * realistic week: a Deferred section that printed **six rows for two actions**,
 * three of them a weekly recurring commitment, and an Added section whose only
 * entry was an AI-written note. Both are gone here — deferral is now 081's
 * recurring-safe count, and creation is left to the arithmetic summary, which
 * already says how many things were added and cannot leak a model's prose into
 * a person's week.
 *
 *   FINISHED · MOVED AND CHANGED · STILL OPEN · IN YOUR OWN WORDS · NEXT WEEK
 *
 * Two sections were dropped rather than folded. **On the calendar** listed what
 * was scheduled in a week that has already happened, and 064's own note admits
 * Conqify has no record of attendance — weak evidence for "what actually
 * happened", and the summary still counts it. Next week's calendar survives,
 * under NEXT WEEK, where it is something a person can still act on.
 * **Projects** was a fourth block of counts with no history behind it; the goal
 * lines under MOVED AND CHANGED say the same thing one level up, and only for
 * goals that actually recorded something.
 *
 * ## One commitment, one row
 *
 * An overdue action is unresolved now AND a carry-forward candidate; a
 * repeatedly deferred one is a fact about the week AND still open AND possibly
 * worth a second look. Rendering each in every section that has something true
 * to say about it is the duplication LIFEOS-071 §15 and LIFEOS-083 §22 exist to
 * prevent — and it is not hypothetical here: the first draft put the same
 * action on screen three times with three near-identical sentences.
 *
 * So a single ownership pass runs before the render (`claim` below), in one
 * stated precedence, and the facts that are not rows in their own right attach
 * to whichever row owns the record.
 *
 * ## The review proposes; it never plans (§25, §26)
 *
 * Nothing here writes a date. Carry-forward is a list with reasons, and the
 * only way an item reaches next week is a person pressing a control on it.
 *
 * ## Sections disappear when empty (§21)
 *
 * Same rule as Today, for the same reason: a section with nothing in it is a
 * reminder that you have not filled something in, which is the opposite of what
 * a review of your own week is for.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { formatDayKey, todayKey } from "@/lib/reviews/dates";
import { formatLocalTime } from "@/lib/time/localtime";
import { nowLocalTime } from "@/lib/time/events";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { resolutionsForAction } from "@/lib/commitment/resolve";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import {
  WEEK_RANGE_LABEL, EMPTY_WEEK,
  type AutobiographicalEvent, type WeekRangeKind,
} from "@/lib/memory/week";
import {
  buildWeeklyExecutiveReview, WEEKLY_HEADINGS, PARTIAL_WEEK_NOTE,
  type WeeklyExecutiveReview,
} from "@/lib/memory/weekly";

const RANGES: WeekRangeKind[] = ["this_week", "last_week", "last_7_days"];

const rowClass = "flex items-baseline justify-between gap-3 py-1";
const metaClass = "shrink-0 text-[11px] text-zinc-400";
const linkClass = "min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100";

/** Where a record lives, so every line in the review is a way back to it. */
function hrefFor(ref: { kind: string; id: string }): string {
  switch (ref.kind) {
    case "action": return `/actions/${ref.id}`;
    case "goal": return `/goal/${ref.id}`;
    case "note": return "/notes";
    case "project": return `/project/${ref.id}`;
    case "decision": return `/decisions/${ref.id}`;
    case "formation": return `/formation/${ref.id}`;
    // A Reflection has no detail page; the formation timeline is where its text
    // is shown. `/formation/<id>` would 404 — that route resolves sessions.
    case "reflection": return "/formation/timeline";
    case "capture": return "/process";
    // An Event has no detail page yet. Today is where events are shown.
    default: return "/today";
  }
}

function Section({ title, id, show, note, children }: {
  title: string; id: string; show: boolean; note?: string; children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section data-week-section={id} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
      {note && <p className="mt-0.5 text-[11px] text-zinc-400">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A labelled block inside a primary section. Not a section — §20 counts those. */
function Block({ label, show, note, children }: {
  label: string; show: boolean; note?: string; children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div data-week-block={label.toLowerCase().replace(/[^a-z]+/g, "-")} className="mt-2 first:mt-0">
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      {note && <p className="text-[11px] text-zinc-400">{note}</p>}
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** Group dated facts under their day, the way §9 shows them. */
function byDay(events: AutobiographicalEvent[]): [string, AutobiographicalEvent[]][] {
  const map = new Map<string, AutobiographicalEvent[]>();
  for (const e of events) {
    const list = map.get(e.day);
    if (list) list.push(e);
    else map.set(e.day, [e]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function DayGroups({ groups, render }: {
  groups: [string, AutobiographicalEvent[]][];
  render: (e: AutobiographicalEvent) => React.ReactNode;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {groups.map(([day, items]) => (
        <li key={day}>
          <p className="text-[11px] font-medium text-zinc-500">{formatDayKey(day)}</p>
          <ul className="mt-0.5 flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {items.map((e) => (
              <li key={`${e.kind}:${e.recordRef.id}:${e.day}`} data-week-item={e.kind} className={rowClass}>
                {render(e)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** A recorded transition, stated as the transition and nothing more (§8, §19). */
const CHANGE_WORD: Record<string, string> = {
  goal_status_changed: "Status changed",
  goal_horizon_changed: "Horizon changed",
  goal_target_changed: "Target date changed",
  goal_replaced: "Replaced",
  rule_adopted: "Adopted",
  rule_revised: "Revised",
  rule_retired: "Retired",
};

export default function WeekInReview() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const [rangeKind, setRangeKind] = useState<WeekRangeKind>("this_week");
  const today = todayKey();
  // One clock reading per render, so every section agrees about "now".
  const [now] = useState(() => nowLocalTime());

  // ONE index pass, shared by the review AND the resolution controls below
  // (LIFEOS-071 §27, LIFEOS-084 §40): deriving a row's buttons must not scan the
  // store a second time.
  const ix = useMemo(() => buildTodayIndexes(state, today, now), [state, today, now]);

  // `todayKey()` reads the clock, so the review can only be built on the
  // client. Building it during the server pass would render a different week
  // than the one that hydrates.
  const review: WeeklyExecutiveReview | null = useMemo(
    () => (mounted ? buildWeeklyExecutiveReview(state, ix, rangeKind, today) : null),
    [state, ix, rangeKind, today, mounted],
  );

  if (!mounted || !review) {
    return <p className="text-sm text-zinc-400">Looking back…</p>;
  }

  const base = review.base;

  /**
   * ONE ownership pass, in one precedence — not a web of pairwise filters.
   *
   * The first version of this component rendered "Learn Portuguese" three times
   * on one screen: under Deferred more than once, under Worth carrying forward,
   * and under Worth a second look, each with a sentence beginning "You deferred
   * this 4 times." Every section was individually correct. It only reads as
   * absurd when you look at the page, which is why §39 asks you to.
   *
   * Fixing it pairwise did not hold either. Carry-vs-open and open-vs-deferred
   * left deferred-vs-reconsider, which the browser suite then caught on a week
   * crowded enough to push the item out of the carry cap. Pairwise rules fail
   * because they are O(n²) promises maintained by hand; this is one rule.
   *
   * A commitment is owned by the first list that claims it:
   *
   *   1. CARRY FORWARD   — forward-looking, actionable, carries controls
   *   2. STILL OPEN      — the present-state inventory
   *   3. DEFERRED        — a fact about the week just ended
   *
   * and the two facts that are not rows in their own right — the deferral count
   * and "it has no due date" — attach to whichever row owns the record.
   * `reconsider` never owns anything, so it renders only what nothing else did.
   */
  const owned = new Set<string>();
  const claim = <T,>(rows: T[], idOf: (row: T) => string): T[] => {
    const kept: T[] = [];
    for (const row of rows) {
      const id = idOf(row);
      if (owned.has(id)) continue;
      owned.add(id);
      kept.push(row);
    }
    return kept;
  };

  const carriedRows = claim(review.carryForward, (c) => c.entity.id);
  const stillWaiting = claim(review.stillWaiting, (w) => w.action.id);
  const stillOpen = claim(base.stillOpen, (o) => o.action.id);
  const repeatedShown = claim(review.repeatedDeferrals, (p) => p.action.id);
  const reconsiderShown = review.reconsider.filter((c) => !owned.has(c.entity.id));

  /** Facts that attach to a row rather than becoming one. */
  const deferralCount = new Map(review.repeatedDeferrals.map((p) => [p.action.id, p.count]));
  const reconsiderById = new Map(review.reconsider.map((c) => [c.entity.id, c]));
  /** The second-look clause, for the row that owns the record. */
  const undatedNote = (id: string) => (reconsiderById.has(id) ? "It has no due date." : "");
  const goalLines = review.goalReview.filter(
    (g) => g.completedThisWeek > 0 || g.directionChanges.length > 0);
  const movedForwardIds = new Set(review.movedForward.map((c) => c.entity.id));

  const changedShown = review.changedDirection.length > 0
    || review.waitingEnded.length > 0
    || repeatedShown.length > 0
    || goalLines.length > 0;
  const nextShown = carriedRows.length > 0
    || review.scheduledNext.length > 0
    || reconsiderShown.length > 0
    || !!review.leftBehind;

  return (
    <div data-week-review className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Week in review</h2>
        <div className="flex flex-wrap items-center gap-1">
          {RANGES.map((k) => (
            <button
              key={k}
              type="button"
              data-week-range={k}
              aria-pressed={rangeKind === k}
              onClick={() => setRangeKind(k)}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                rangeKind === k
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-black/[.10] text-zinc-500 hover:text-zinc-900 dark:border-white/[.12] dark:hover:text-zinc-100"
              }`}
            >
              {WEEK_RANGE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-zinc-400">{base.range.label}</p>
      {/* §28. A week still running is not a finished week, and saying so is the
          difference between a report and a premature verdict. */}
      {review.partial && (
        <p data-week-partial className="text-[11px] text-zinc-500">{PARTIAL_WEEK_NOTE}</p>
      )}

      {base.empty ? (
        <div data-week-empty className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm dark:border-white/[.12]">
          <p className="text-zinc-700 dark:text-zinc-200">{EMPTY_WEEK}</p>
          <p className="mt-1 text-xs text-zinc-500">
            That is a statement about the records, not about the week.
          </p>
        </div>
      ) : (
        <>
          {/* Arithmetic over recorded facts. Never an evaluation (§5, §13). This
              is also where creation is counted, now that Added is gone. */}
          <p data-week-summary className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
            {base.summary}
          </p>

          <div className="flex flex-col gap-3">
            {/* ---- 1. FINISHED --------------------------------------------- */}
            <Section title={WEEKLY_HEADINGS.finished} id="completed" show={base.completed.length > 0}>
              <DayGroups
                groups={byDay(base.completed)}
                render={(e) => (
                  <>
                    <Link href={hrefFor(e.recordRef)} className={linkClass}>{e.title}</Link>
                    {/* One occurrence of a standing responsibility being kept is
                        not the same as a task being finished, and the label says
                        which one this was. */}
                    {e.kind === "recurring_completion"
                      ? <span className={metaClass}>Recurring</span>
                      /* §7. "Moved forward" is completed work linked to a goal —
                         a completion and a link, never a horizon edit. The mark
                         goes on the completion row rather than repeating the
                         title in a second list. */
                      : movedForwardIds.has(e.recordRef.id)
                        ? <span data-moved-forward className={metaClass}>Under a goal</span>
                        : null}
                  </>
                )}
              />
            </Section>

            {/* ---- 2. MOVED AND CHANGED ------------------------------------ */}
            <Section title={WEEKLY_HEADINGS.moved} id="changed" show={changedShown}>
              {/* Goal lines: counts and recorded transitions. No health, no
                  percentage, no momentum (§13, §14). A goal with nothing
                  recorded says nothing, rather than saying "0". */}
              <Block label="Goals" show={goalLines.length > 0}>
                <ul className="flex flex-col gap-1.5">
                  {goalLines.map((g) => (
                    <li key={g.goal.id} data-week-goal={g.goal.id}>
                      <Link href={`/goal/${g.goal.id}`} className="text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                        {g.goal.title}
                      </Link>
                      <p className="text-[11px] text-zinc-500">
                        {[
                          g.completedThisWeek > 0
                            ? `${g.completedThisWeek} linked item${g.completedThisWeek === 1 ? "" : "s"} completed`
                            : null,
                          ...g.directionChanges.map((c) =>
                            c.from && c.to ? `${c.from} → ${c.to}` : CHANGE_WORD[c.kind] ?? "Changed"),
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              </Block>

              {/* Rules and standards, as transitions. Retiring a standard is a
                  decision a person made, not a lapse (§19). */}
              <Block
                label="Direction"
                show={review.changedDirection.filter((c) => c.entity.kind !== "goal").length > 0}
              >
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {review.changedDirection.filter((c) => c.entity.kind !== "goal").map((c) => (
                    <li key={c.id} data-week-change={c.kind} className={rowClass}>
                      <span className="min-w-0 flex-1 text-sm text-zinc-800 dark:text-zinc-100">{c.title}</span>
                      <span className={metaClass}>{CHANGE_WORD[c.kind] ?? "Changed"}</span>
                    </li>
                  ))}
                </ul>
              </Block>

              {/* §11. What STOPPED waiting is a fact about the week. What is
                  still waiting is a fact about now, and lives under STILL OPEN. */}
              <Block label="Stopped waiting" show={review.waitingEnded.length > 0}>
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {review.waitingEnded.map((c) => (
                    <li key={c.id} data-week-waiting-ended className={rowClass}>
                      <Link href={hrefFor(c.entity)} className={linkClass}>{c.title}</Link>
                      <span className={metaClass}>No longer waiting</span>
                    </li>
                  ))}
                </ul>
              </Block>

              {/* §9. ONE row per action with a count — not one row per deferral
                  event, and recurring work excluded, because moving a standing
                  routine by a day is scheduling, not slippage. The audit found
                  the old section rendering six rows for two actions, three of
                  them a weekly commitment. */}
              <Block
                label="Deferred more than once"
                show={repeatedShown.length > 0}
                note="Recurring commitments are not counted here."
              >
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {repeatedShown.map((p) => (
                    <li key={p.action.id} data-week-deferred className="py-1">
                      <div className={rowClass}>
                        <Link href={`/actions/${p.action.id}`} className={linkClass}>{p.action.title}</Link>
                        <span className={metaClass}>{p.count} times</span>
                      </div>
                      {undatedNote(p.action.id) && (
                        <p className="mt-0.5 text-[11px] text-zinc-400">{undatedNote(p.action.id)}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </Block>
            </Section>

            {/* ---- 3. STILL OPEN ------------------------------------------- */}
            <Section
              title={WEEKLY_HEADINGS.open}
              id="still-open"
              show={stillWaiting.length > 0 || stillOpen.length > 0}
              note="Open right now. Anything being carried into next week is listed there instead."
            >
              <Block label="Waiting on someone" show={stillWaiting.length > 0}>
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {stillWaiting.map((w) => (
                    <li key={w.action.id} data-week-item="waiting" className={rowClass}>
                      <Link href={`/actions/${w.action.id}`} className={linkClass}>
                        {w.waitingOn && <span className="font-medium">{w.waitingOn} · </span>}{w.action.title}
                      </Link>
                      <span className={metaClass}>
                        {/* "Since Tuesday" is a fact about the record. "Marcus
                            hasn't sent it" would be a claim about Marcus. */}
                        {w.followUpDue ? "Follow-up due" : w.since ? `Since ${formatDayKey(w.since)}` : "Waiting"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Block>

              <Block label="Open" show={stillOpen.length > 0}>
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {stillOpen.map((o) => (
                    <li key={o.action.id} data-week-item="open" className="py-1">
                      <div className={rowClass}>
                        <Link href={`/actions/${o.action.id}`} className={linkClass}>{o.action.title}</Link>
                        <span className={metaClass}>{o.detail}</span>
                      </div>
                      {/* The count goes on its OWN line rather than into the
                          meta. Appending it there pushed a `shrink-0` span wide
                          enough to truncate the title to "Request re…" at 390px
                          — the row's most important word, lost to its least. */}
                      {(deferralCount.has(o.action.id) || undatedNote(o.action.id)) && (
                        <p data-week-deferral-count className="mt-0.5 text-[11px] text-zinc-400">
                          {[deferralCount.has(o.action.id) ? `Deferred ${deferralCount.get(o.action.id)} times.` : "",
                            undatedNote(o.action.id)].filter(Boolean).join(" ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Block>
            </Section>

            {/* ---- 4. IN YOUR OWN WORDS -----------------------------------
                §12. Notes and reflections under a heading that claims only what
                is true of both. The provenance filter is in the model, not here:
                the audit found an AI-written note rendering as part of the
                user's week, and `isMachineProduced` now keeps a model's sentence
                out of a section whose entire claim is authorship. */}
            <Section title={WEEKLY_HEADINGS.words} id="reflections" show={review.reflections.length > 0}>
              <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                {review.reflections.map((c) => (
                  <li key={c.id} data-week-item="reflection" className="py-1">
                    <Link href={hrefFor(c.entity)} className="block text-sm leading-relaxed text-zinc-700 hover:underline dark:text-zinc-200">
                      {c.title.length > 180 ? `${c.title.slice(0, 179).trimEnd()}…` : c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>

            {/* ---- 5. NEXT WEEK -------------------------------------------- */}
            <Section title={WEEKLY_HEADINGS.next} id="next-week" show={nextShown}>
              {/* §15, §25, §26. A PROPOSAL. Nothing here has been scheduled, no
                  date has been written, and the reason on each row is the
                  evidence it came from. */}
              <Block
                label="Worth carrying forward"
                show={carriedRows.length > 0}
                note="Nothing has been scheduled. These are unresolved and still valid."
              >
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {carriedRows.map((c) => (
                    <li key={c.id} data-carry-forward={c.reason} className="py-1">
                      <div className={rowClass}>
                        <Link href={hrefFor(c.entity)} className={linkClass}>{c.title}</Link>
                        <span className={metaClass}>{c.explanation}</span>
                      </div>
                      {/* §15's other true facts about the SAME commitment —
                          attached, never a second row. */}
                      {(() => {
                        const extra = [
                          ...(c.attention?.secondaryReasons ?? []).map((r) => r.text),
                          // The only fact the second-look offer adds that the
                          // row does not already carry.
                          undatedNote(c.entity.id),
                        ].filter(Boolean);
                        return extra.length > 0 ? (
                          <p data-signal-secondary className="mt-0.5 text-[11px] text-zinc-400">{extra.join(" ")}</p>
                        ) : null;
                      })()}
                      {/* LIFEOS-071/072. The only way an item reaches next week
                          is a person pressing one of these. The review itself
                          writes nothing. */}
                      {c.entity.kind === "action" && (
                        <ResolutionControls
                          title={c.title}
                          actions={resolutionsForAction(state, c.entity.id, { ix, today })}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </Block>

              {/* §22. Structurally separate from carry-forward: an appointment
                  on Monday already has a place, and listing it as unresolved
                  work would turn a planned week into a backlog. */}
              <Block label="Already on the calendar" show={review.scheduledNext.length > 0}>
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {review.scheduledNext.map((s) => (
                    <li key={s.id} data-scheduled-next={s.kind} className={rowClass}>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{s.title}</span>
                      <span className={metaClass}>
                        {formatDayKey(s.date)}{s.time ? ` · ${formatLocalTime(s.time)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </Block>

              {/* §18. The facts, and then silence. Never "drop this", never
                  "give up on" — the product states what it recorded and the
                  person decides. */}
              <Block
                label="Worth a second look"
                show={reconsiderShown.length > 0}
                note="Conqify is not suggesting you drop anything."
              >
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {reconsiderShown.map((c) => (
                    <li key={c.id} data-reconsider className={rowClass}>
                      <Link href={hrefFor(c.entity)} className={linkClass}>{c.title}</Link>
                      <span className={metaClass}>{c.explanation}</span>
                    </li>
                  ))}
                </ul>
              </Block>

              {/* §23. One arithmetic line, said only when it is literally true. */}
              {review.leftBehind && (
                <p data-week-left-behind className="mt-2 text-[11px] text-zinc-500">{review.leftBehind}</p>
              )}
            </Section>
          </div>
        </>
      )}

      {base.limitations.map((l) => (
        <p key={l} data-week-limitation className="px-1 text-[11px] text-zinc-400">{l}</p>
      ))}
      <p data-week-coverage className="px-1 text-[11px] text-zinc-400">{base.coverage}</p>
    </div>
  );
}
