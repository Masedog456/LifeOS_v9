"use client";

/**
 * Today, as a decision surface (LIFEOS-104 §3, §49, §50).
 *
 * ## What this page answers, in order
 *
 *   1. What should I do next?      → Suggested next
 *   2. What else matters today?    → Today (BE THERE, then DO)
 *   3. What needs my judgment?     → Needs your decision
 *
 * …then the actionable residue, then one collapsed block of context. Five
 * sections. The audit found eleven on the torture world and twelve on a
 * 120-record store, which is a dashboard: §50 asks for 3–5 and this is what
 * measuring produced.
 *
 * ## One projection, one place that decides
 *
 * `buildTodayCommand` decides everything — what is suggested, what is
 * suppressed, what counts as attention, what the orientation line says, whether
 * the day is empty. This file renders it. The audit's three worst defects were
 * all two places deciding one thing: a summary line counting a different list
 * from the section under it, an empty check that could not see the changes one
 * layer up, a dedup rule that reached the attention card but not the schedule
 * row. None of those can recur from here without a comparator appearing in a
 * file that has none.
 *
 * ## The page recomputes; it never caches
 *
 * Suggested next is a projection, not a record. Completing it changes the store,
 * `useStore` re-renders, and the whole surface is rebuilt from current state.
 * Nothing is persisted and there is no cached ranking to go stale (§53, §54).
 *
 * ## What this page will not say
 *
 * No greeting theater, no motivational quote, no "crush your day", no score, no
 * streak, no percentage. `FORBIDDEN_TODAY_WORDS` is asserted against every
 * string this projection produces. Today describes records; it does not
 * characterise the person reading it.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ROW_META } from "@/lib/design/tokens";
import { completeOccurrence, useStore } from "@/lib/mvpStore";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView, waitingDays, COVERAGE_NOTE, EMPTY_PROMPT } from "@/lib/today/view";
import { REVIEW_TODAY_LABEL } from "@/lib/today/daily";
import { formatLocalTime } from "@/lib/time/localtime";
import { formatDayKey, todayKey } from "@/lib/reviews/dates";
import { nowLocalTime } from "@/lib/time/events";
import { PROJECT_NO_NEXT_ACTION, type CommitmentSignal } from "@/lib/commitment/signals";
import { changeWord } from "@/lib/changes/vocabulary";
import { resolutionsFor, resolutionsForAction } from "@/lib/commitment/resolve";
import { buildDailyCommandView, SINCE_YESTERDAY_HEADING } from "@/lib/today/command";
import { DECISION_HEADING } from "@/lib/guidance/decisions";
import {
  buildTodayCommand, openWorkDetail, NOTHING_PRESSING, OPEN_WORK_NOTE,
} from "@/lib/today/surface";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import { toast } from "@/lib/ux/feedback";

/** Where a signal's record opens. Every row is a way back to the record. */
function hrefForSignal(s: CommitmentSignal): string {
  return s.recordRef.kind === "project" ? `/project/${s.recordRef.id}` : `/actions/${s.recordRef.id}`;
}

function Section({ title, show, children, id }: { title: string; show: boolean; children: React.ReactNode; id?: string }) {
  // Empty sections do not render. A panel that says "nothing here" is a reminder
  // that you have not filled something in, which is the opposite of the point.
  if (!show) return null;
  return (
    <section data-today-section={id ?? title.toLowerCase().replace(/\s+/g, "-")}
      className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

/** A sub-heading inside Today. §21: DO and BE THERE are not the same verb. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <p data-today-group={label.toLowerCase()} className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</p>
      {children}
    </div>
  );
}

const rowClass = "flex items-baseline justify-between gap-3 py-1";
const linkClass = "min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100";
const metaClass = ROW_META;

export default function TodayCommandCenter() {
  const state = useStore();
  const today = todayKey();
  // One clock reading per render, so every section agrees about "now".
  const [now] = useState(() => nowLocalTime());

  // ONE index pass, shared by every projection below. LIFEOS-071 §27: deriving a
  // row's controls must not scan the store again — the indexes a button needs
  // are the ones the page already built.
  const ix = useMemo(() => buildTodayIndexes(state, today, now), [state, today, now]);
  const view = useMemo(() => buildTodayView(state, ix), [state, ix]);
  const command = useMemo(
    () => buildDailyCommandView(state, ix, view, today),
    [state, ix, view, today],
  );
  /**
   * The whole surface, decided once (LIFEOS-104 §52).
   *
   * `view` and `command` are handed in rather than rebuilt: this component
   * already has both, and building a second `TodayView` would pay for the index
   * pass twice on every render (§35).
   *
   * `buildDailyExecutiveView` is deliberately NOT called here any more. Today
   * read three of its twelve fields and paid 128 ms of a 348 ms derivation at
   * 5,000 records for the other nine, which belong to `/today/review`. The three
   * come from `buildTodayOrientation` — the same code, extracted, not copied.
   */
  const cmd = useMemo(
    () => buildTodayCommand(state, ix, today, { view, command }),
    [state, ix, today, view, command],
  );
  /** Actions the shortlist already leads with, controls and all (§41). */
  const onAttentionList = useMemo(
    () => new Set(cmd.attention.map((a) => a.actionId ?? a.entity.id).filter(Boolean) as string[]),
    [cmd.attention],
  );
  // Resolutions for every rendered signal, computed once per store snapshot
  // rather than per button.
  const resolutions = useMemo(() => {
    const m = new Map<string, ReturnType<typeof resolutionsFor>>();
    for (const s of view.signals) {
      m.set(`${s.recordRef.kind}:${s.recordRef.id}`, resolutionsFor(state, s, { today, ix }));
    }
    return m;
  }, [state, view.signals, today, ix]);
  const actionsFor = (s: CommitmentSignal) => resolutions.get(`${s.recordRef.kind}:${s.recordRef.id}`) ?? [];
  /** The project's own commitment signal, when it has one. */
  const pulseSignal = (projectId: string) =>
    view.signals.find((s) => s.kind === "project_no_next_action" && s.recordRef.id === projectId);
  /** A waiting action's signal — present only once its follow-up date arrived. */
  const waitingSignal = (actionId: string) =>
    view.signals.find((s) => s.kind === "follow_up_due" && s.recordRef.id === actionId);

  if (cmd.empty) {
    return (
      <div data-today-empty className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm dark:border-white/[.12]">
        <p className="text-zinc-700 dark:text-zinc-200">{EMPTY_PROMPT}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Errands, appointments, things you&apos;re waiting on — say it however it comes out.
        </p>
        <Link href="/" data-capture-link
          className="mt-3 inline-block rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Capture something →
        </Link>
      </div>
    );
  }

  const s = cmd.suggestedNext;
  const hasLater =
    cmd.sinceYesterday.length > 0 || cmd.later.waiting.length > 0 || cmd.later.pulse.length > 0 ||
    cmd.later.returns.length > 0 || !!cmd.later.returnItem || cmd.later.upcoming.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ---- ORIENTATION (LIFEOS-073 §2, §4, §6) ----
          The reading path, in one line of counts, before any section expands.

          It composes; it does not compute. LIFEOS-104 §51: every number is now
          the length of a list this page actually renders. It used to count
          LIFEOS-070's raw signals while the section below rendered LIFEOS-082's
          capped shortlist, so three of the audit's worlds promised "1 item
          needing attention" above a page with no attention section at all, and
          the 120-record world said sixteen and rendered three. */}
      <section data-daily-orientation className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        {cmd.orientation && (
          <p data-orientation-line className="mb-3 text-sm text-zinc-800 dark:text-zinc-100">
            {cmd.orientation}
          </p>
        )}
        {/* §31. Review is a link and never the main call to action. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link href="/today/review" data-review-today-link
            className="text-[11px] text-zinc-500 dark:text-zinc-400 underline-offset-4 hover:underline">
            {REVIEW_TODAY_LABEL} →
          </Link>
        </div>
      </section>

      {/* ---- 1. SUGGESTED NEXT (§3, §4, §5) ---- */}
      <Section title="Suggested next" id="suggested" show={!!s.recommendation || !!cmd.suggestedNote}>
        {s.recommendation ? (
          <div data-suggested-next>
            <Link href={`/actions/${s.recommendation.action.id}`} className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
              {s.recommendation.action.title}
            </Link>
            {/* §5: the explanation is mandatory. No explanation, no recommendation. */}
            <ul data-suggested-why className="mt-1 space-y-0.5">
              {s.recommendation.reasons.map((r) => (
                <li key={r.code} className="text-[11px] text-zinc-500 dark:text-zinc-400">· {r.text}</li>
              ))}
            </ul>
            {/* §35. What it beat, in one sentence — present only when a
                runner-up existed and something real separated them. */}
            {s.recommendation.counterfactual && (
              <p data-suggested-counterfactual className="mt-1 text-[11px] italic text-zinc-500 dark:text-zinc-400">
                {s.recommendation.counterfactual}
              </p>
            )}
            {/* LIFEOS-083 §23. The attention card this row SUPPRESSED, as an
                inline reason — the same sentence, on the row the user is
                already reading. */}
            {cmd.command.inlineReasons[s.recommendation.action.id] && (
              <p data-inline-reason className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                {cmd.command.inlineReasons[s.recommendation.action.id]}
              </p>
            )}
            {/* §51. The SAME resolver every commitment row uses — including
                `complete_occurrence` for a recurring action, which is what makes
                §24's suppression of the duplicate Today row lossless. */}
            <ResolutionControls
              title={s.recommendation.action.title}
              actions={resolutionsForAction(state, s.recommendation.action.id, { today, ix })}
            />
          </div>
        ) : (
          <>
            {/* §33. No fallback ranker. Two different silences, said in two
                different sentences: a day with dated work where nothing stands
                out ahead of the rest, and a day with nothing pressing at all.
                The audit found one sentence covering both, which read as
                "there is nothing" on a page listing twelve dated items. */}
            <p data-no-suggestion className="text-[11px] text-zinc-500 dark:text-zinc-400">{cmd.suggestedNote}</p>
            {/* §8, §38. Undated open work used to be visible ONLY through the
                recommendation, so a store with two dateless actions rendered
                the new-user empty state. Listed in record order — that is not a
                ranking and the note says so. */}
            {cmd.openWork.length > 0 && (
              <div data-open-work className="mt-2">
                {cmd.suggestedNote === NOTHING_PRESSING && (
                  <p className="mb-1 text-[11px] text-zinc-500 dark:text-zinc-400">{OPEN_WORK_NOTE}</p>
                )}
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {cmd.openWork.map((a) => (
                    <li key={a.id} data-open-work-item className={rowClass}>
                      <Link href={`/actions/${a.id}`} className={linkClass}>{a.title}</Link>
                      <span className={metaClass}>{openWorkDetail(a, today)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ---- 2. TODAY (§21, §22, §24) ----
          BE THERE and DO are different verbs and now say so. They used to render
          as two unlabelled sibling lists inside one heading, and the event-heavy
          world put four appointments and one task under a single word.

          Nothing here repeats Suggested next (§24): the audit found "Call the
          dentist" three times in an eleven-row page. */}
      <Section title="Today" show={cmd.fixed.length + cmd.work.length > 0}>
        {cmd.fixed.length > 0 && (
          <Group label="Be there">
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {cmd.fixed.map((f) => (
                // An Event carries no control. It happens; there is nothing to tick.
                <li key={`${f.kind}:${f.id}`} data-today-fixed={f.kind}
                  className={`${rowClass} ${!f.isNow && f.time && f.time < now ? "opacity-55" : ""}`}>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                    {/* §29, §33 of 083: a marker on the row, not a section of
                        its own. The NOW card said "Next: Advisor meeting" for an
                        event the orientation and this list both already named. */}
                    {f.isNow && <span data-today-now className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Now</span>}
                    {f.isNext && <span data-today-next className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Next</span>}
                    {f.title}
                    {f.detail && <span className="ml-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{f.detail}</span>}
                  </span>
                  <span className={metaClass}>
                    {/* §22. Canonical formatter, never the stored "14:00". */}
                    {f.time ? formatLocalTime(f.time) : "All day"}
                    {f.time && f.endTime ? `–${formatLocalTime(f.endTime)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Group>
        )}
        {cmd.work.length > 0 && (
          <Group label="Do">
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {cmd.work.map((w) => (
                <li key={w.action.id} data-today-action data-today-also={w.detail === "Open" || w.detail === "In progress" ? "" : undefined}
                  className="py-0.5">
                  <div className={rowClass}>
                    <Link href={`/actions/${w.action.id}`} className={linkClass}>
                      {w.action.title}
                      {w.schedule && <span className="ml-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{w.schedule}</span>}
                    </Link>
                    <span className={metaClass}>
                      {w.dueTime ? `Due ${formatLocalTime(w.dueTime)}` : w.detail}
                    </span>
                  </div>
                  {/* §23. The suppressed attention card's reason, inline. */}
                  {w.inlineReason && (
                    <p data-inline-reason className="text-[11px] text-amber-700 dark:text-amber-400">
                      {w.inlineReason}
                    </p>
                  )}
                  {/* §14. Blocked work keeps its date and loses its readiness.
                      The inline reason above covers this only when the blocked
                      signal survives the shortlist's cap of three; the torture
                      world's did not, and the row read as ordinary work. */}
                  {!w.inlineReason && w.blockedBy && (
                    <p data-today-blocked className="text-[11px] text-amber-700 dark:text-amber-400">
                      Blocked by {w.blockedBy.join(", ")}.
                    </p>
                  )}
                  {/* LIFEOS-063 R-2. A recurring occurrence closes today without
                      ending the series. */}
                  {w.occurrence && (
                    <button type="button" data-complete-occurrence
                      onClick={() => { if (completeOccurrence(w.action.id, w.occurrence!)) toast({ kind: "success", message: "Done for today. It'll come back next time." }); }}
                      className="mt-1 rounded-full border border-black/[.12] px-3 py-0.5 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300">
                      Mark done
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Group>
        )}
      </Section>

      {/* ---- 3. NEEDS YOUR DECISION (§3, §7, §17, §19) ----
          Promoted from a link in the orientation card to a section of its own,
          because §7 puts it in the first viewport beside Suggested next and
          Today, and because §19 asks for the top item rather than a bare count.

          It is the count and ONE question. Not the queue, not the options, not
          the resolution controls — those live at /today/decisions, and
          duplicating them here is exactly what §19 forbids. */}
      <Section title={DECISION_HEADING} id="decisions" show={cmd.decisions.total > 0}>
        <div data-decision-summary>
          <p className="text-sm text-zinc-800 dark:text-zinc-100">
            {cmd.decisions.total} {cmd.decisions.total === 1 ? "item" : "items"}
          </p>
          {cmd.decisions.top && (
            <div data-decision-preview className="mt-1">
              <p className="text-sm text-zinc-700 dark:text-zinc-200">{cmd.decisions.top.question}</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{cmd.decisions.top.reason}</p>
            </div>
          )}
          <Link href="/today/decisions" data-decision-count-link
            className="mt-2 inline-block text-[11px] text-zinc-500 dark:text-zinc-400 underline-offset-4 hover:underline">
            {DECISION_HEADING} →
          </Link>
        </div>
      </Section>

      {/* ---- 4. NEEDS ATTENTION (§47, §48) ----
          The ACTIONABLE residue. Rendered from the 082 shortlist, capped at
          three, with anything already prominent as Next or on today's schedule
          suppressed — and now with judgment kinds removed.

          `goal_path_missing` asks only whether a PROJECT links to the goal, so a
          goal carried by a live action tripped it: the audit's world J flagged
          both goals here while the Decision Inbox, using the truthful predicate,
          flagged one. §17 says that is judgment, and the queue that owns
          judgment already derives it correctly. */}
      <Section title="Needs attention" id="attention" show={cmd.attention.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {cmd.attention.map((a) => (
            <li key={a.id} data-signal={a.kind} data-attention className="py-1">
              <div className={rowClass}>
                <Link href={a.signal ? hrefForSignal(a.signal) : `/actions/${a.entity.id}`} className={linkClass}>{a.title}</Link>
                <span className={metaClass}>{a.explanation}</span>
              </div>
              {/* §15. Other true facts about the SAME commitment — attached, never
                  a second row. */}
              {a.secondaryReasons.length > 0 && (
                <p data-signal-secondary className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {a.secondaryReasons.map((r) => r.text).join(" ")}
                </p>
              )}
              {/* §46. A rule appears ONLY where it is grounded in this item's own
                  words, and only as context. It never reorders anything. */}
              {a.ruleContext.length > 0 && (
                <p data-rule-context className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Fits your rule: “{a.ruleContext[0]}”
                </p>
              )}
              {a.signal
                ? <ResolutionControls title={a.title} actions={actionsFor(a.signal)} />
                : a.actionId
                  ? <ResolutionControls title={a.title} actions={resolutionsForAction(state, a.actionId, { ix, today })} />
                  : null}
            </li>
          ))}
        </ul>
      </Section>

      {/* ---- §14. One grounded calming line, or nothing. ---- */}
      {cmd.canWait && (
        <p data-can-wait className="px-1 text-[11px] text-zinc-500 dark:text-zinc-400">{cmd.canWait}</p>
      )}

      {/* ---- 5. CONTEXT (§26, §29, §49, §50) ----
          Since yesterday, the waiting roster, project pulse, what has gone quiet
          and what is coming — five sections that were competing with the day,
          collapsed into one.

          §26 says Since yesterday is context; §29 says tomorrow is not primary
          morning content; §49 says the residue is collapsed and secondary. None
          of it is removed and none of it is a click further away than the
          disclosure: everything below still renders its own rows, with the same
          controls, from the same builders. What changed is that a person
          deciding what to do at 9 a.m. no longer scrolls through it first. */}
      {hasLater && (
        <details data-today-later className="lo-details rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          <summary className="flex items-center gap-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-300">
            <span aria-hidden className="lo-caret text-[9px]">▸</span> Context and what&apos;s coming
          </summary>
          <div className="mt-3 flex flex-col gap-4">

            {/* §26. What FINISHED, what stopped waiting, what changed direction. */}
            {cmd.sinceYesterday.length > 0 && (
              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{SINCE_YESTERDAY_HEADING}</h3>
                <ul className="flex flex-col gap-1">
                  {cmd.sinceYesterday.map((c) => (
                    <li key={c.id} data-since-yesterday={c.kind} className={rowClass}>
                      <span className="text-sm text-zinc-700 dark:text-zinc-200">{c.title}</span>
                      <span className={metaClass}>
                        {c.from && c.to ? `${c.from} → ${c.to}` : changeWord(c.kind)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* §42. Waiting is not executable, and the roster never says it is.
                A wait whose follow-up has ARRIVED is actionable — and it is
                already on the attention shortlist above, with these same
                controls, so it does not grow a second menu here (LIFEOS-090
                §41). A wait with no follow-up date shows how long it has been
                waiting and nothing else: §13 measured that 070 and 094 both
                exclude it deliberately, and Today does not redefine that. */}
            {cmd.later.waiting.length > 0 && (
              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Waiting</h3>
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {cmd.later.waiting.map((w) => {
                    const days = waitingDays(w, today);
                    return (
                      <li key={w.action.id} data-waiting className="py-1">
                        <div className={rowClass}>
                          <Link href={`/actions/${w.action.id}`} className={linkClass}>
                            {w.waitingOn && <span className="font-medium">{w.waitingOn} · </span>}{w.action.title}
                          </Link>
                          <span className={metaClass}>
                            {w.followUpDue ? "Follow-up due" : days !== undefined ? `Since ${formatDayKey(w.action.waitingSince!.slice(0, 10))}` : "Waiting"}
                          </span>
                        </div>
                        {waitingSignal(w.action.id) && !onAttentionList.has(w.action.id) && (
                          <ResolutionControls
                            title={w.action.title}
                            actions={actionsFor(waitingSignal(w.action.id)!)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* §15, §44. Facts only. No health score, no percentage, no "at risk". */}
            {cmd.later.pulse.length > 0 && (
              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Project pulse</h3>
                <ul className="flex flex-col gap-1.5">
                  {cmd.later.pulse.map((p) => (
                    <li key={p.project.id} data-pulse>
                      <Link href={`/project/${p.project.id}`} className="text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                        {p.project.title}
                      </Link>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {/* §18. "Executable" is the load-bearing word: a project
                            whose only actions are blocked or waiting does have
                            next actions, just none that can be started. */}
                        {p.nextAction ? `Next: ${p.nextAction.title}` : p.needsNextAction ? PROJECT_NO_NEXT_ACTION : ""}
                        {p.blockedCount > 0 ? ` · ${p.blockedCount} blocked` : ""}
                        {p.waitingCount > 0 ? ` · ${p.waitingCount} waiting` : ""}
                      </p>
                      {pulseSignal(p.project.id) && (
                        <ResolutionControls title={p.project.title} actions={actionsFor(pulseSignal(p.project.id)!)} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* A deferral the user themselves scheduled to come back, and an open
                commitment that has simply gone quiet. */}
            {(cmd.later.returns.length > 0 || cmd.later.returnItem) && (
              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Worth returning to</h3>
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {cmd.later.returns.map((sig) => (
                    <li key={`${sig.recordRef.kind}:${sig.recordRef.id}`} data-signal={sig.kind} className="py-1">
                      <div className={rowClass}>
                        <Link href={hrefForSignal(sig)} className={linkClass}>{sig.title}</Link>
                        <span className={metaClass}>{sig.explanation}</span>
                      </div>
                      <ResolutionControls title={sig.title} actions={actionsFor(sig)} />
                    </li>
                  ))}
                  {cmd.later.returnItem && (
                    <li data-return className={rowClass}>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{cmd.later.returnItem.title}</span>
                      <span className={metaClass}>{cmd.later.returnItem.reason}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* §29. Tomorrow matters late in the day, not as primary morning
                content. It is dated evidence either way. */}
            {cmd.later.upcoming.length > 0 && (
              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Upcoming</h3>
                <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                  {cmd.later.upcoming.map((u) => (
                    <li key={`${u.kind}:${u.id}:${u.date}`} data-upcoming className={rowClass}>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
                        {u.title}{u.schedule && <span className="ml-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{u.schedule}</span>}
                      </span>
                      <span className={metaClass}>
                        {formatDayKey(u.date)}{u.time ? ` · ${formatLocalTime(u.time)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      {/* §28 of 062: Today reflects what was RECORDED. No data is not no life activity. */}
      <p data-coverage className="px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {COVERAGE_NOTE}{" "}
        {/* LIFEOS-064 §19. One link, and nothing else — Today stays present tense. */}
        <Link href="/memory" data-review-week className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300">
          Review this week
        </Link>
      </p>
    </div>
  );
}
