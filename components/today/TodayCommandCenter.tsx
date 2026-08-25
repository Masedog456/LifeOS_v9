"use client";

/**
 * Today, as a restrained command center (LIFEOS-062 §5, §22, §23).
 *
 * ## One index pass, one projection
 *
 * `buildTodayIndexes` runs once; `buildTodayView` reads it. Every section below
 * renders from that single object. No card fetches, scans, or derives anything
 * of its own — the audit found `buildActivityIndex` running twice per render
 * before this, which is how a page gets slow without any one card being slow.
 *
 * ## The page recomputes; it never caches
 *
 * Suggested Next is a projection, not a record. Completing it changes the store,
 * `useStore` re-renders, and the recommendation is recomputed from scratch. There
 * is no cached suggestion to go stale and nothing persisted to clean up (§25).
 *
 * ## What this page will not say
 *
 * No greeting theater, no motivational quote, no "crush your day", no score, no
 * streak, no percentage. `FORBIDDEN_TODAY_WORDS` is asserted against every string
 * this projection produces. Today describes records; it does not characterise the
 * person reading it.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { completeOccurrence, useStore } from "@/lib/mvpStore";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView, waitingDays, COVERAGE_NOTE, EMPTY_PROMPT } from "@/lib/today/view";
import { formatLocalTime } from "@/lib/time/localtime";
import { formatDayKey, todayKey } from "@/lib/reviews/dates";
import { nowLocalTime } from "@/lib/time/events";
import { describeRule } from "@/lib/time/recurrence";
import {
  signalsForSection, PROJECT_NO_NEXT_ACTION, type CommitmentSignal,
} from "@/lib/commitment/signals";
import { resolutionsFor, resolutionsForAction } from "@/lib/commitment/resolve";
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
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

const rowClass = "flex items-baseline justify-between gap-3 py-1";
const linkClass = "min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100";
const metaClass = "shrink-0 text-[11px] text-zinc-500";

export default function TodayCommandCenter() {
  const state = useStore();
  const today = todayKey();
  // One clock reading per render, so every section agrees about "now".
  const [now] = useState(() => nowLocalTime());

  // ONE index pass, shared by the projection AND the resolvers below. LIFEOS-071
  // §27: deriving a row's controls must not scan the store again — the indexes
  // a button needs are the ones the page already built.
  const ix = useMemo(() => buildTodayIndexes(state, today, now), [state, today, now]);
  const view = useMemo(() => buildTodayView(state, ix), [state, ix]);
  // Split once, from the already-deduplicated list. Each section renders its own
  // slice; no section re-derives what belongs in it.
  const attention = useMemo(() => signalsForSection(view.signals, "attention"), [view.signals]);
  const returns = useMemo(() => signalsForSection(view.signals, "return"), [view.signals]);
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

  if (view.empty) {
    return (
      <div data-today-empty className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm dark:border-white/[.12]">
        <p className="text-zinc-700 dark:text-zinc-200">{EMPTY_PROMPT}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Errands, appointments, things you&apos;re waiting on — say it however it comes out.
        </p>
        <Link href="/" data-capture-link
          className="mt-3 inline-block rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Capture something →
        </Link>
      </div>
    );
  }

  const s = view.suggestion;

  return (
    <div className="flex flex-col gap-4">
      {/* ---- NOW ---- */}
      {(view.nowEvent || view.nextEvent) && (
        <section data-today-now className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          {view.nowEvent ? (
            <p className="text-sm text-zinc-800 dark:text-zinc-100">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Now: </span>
              {view.nowEvent.event.title}
              {view.nowEvent.startTime && (
                <span className={metaClass}> · {formatLocalTime(view.nowEvent.startTime)}
                  {view.nowEvent.endTime ? `–${formatLocalTime(view.nowEvent.endTime)}` : ""}</span>
              )}
            </p>
          ) : view.nextEvent && (
            <p data-next-event className="text-sm text-zinc-800 dark:text-zinc-100">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Next: </span>
              {view.nextEvent.event.title}
              {view.nextEvent.startTime && <span className={metaClass}> · {formatLocalTime(view.nextEvent.startTime)}</span>}
            </p>
          )}
        </section>
      )}

      {/* ---- SUGGESTED NEXT ---- */}
      <Section title="Suggested next" id="suggested" show={!!s.recommendation || !!s.note}>
        {s.recommendation ? (
          <div data-suggested-next>
            <Link href={`/actions/${s.recommendation.action.id}`} className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
              {s.recommendation.action.title}
            </Link>
            {/* §19: the explanation is mandatory. No explanation, no recommendation. */}
            <ul data-suggested-why className="mt-1 space-y-0.5">
              {s.recommendation.reasons.map((r) => (
                <li key={r.code} className="text-[11px] text-zinc-500">· {r.text}</li>
              ))}
            </ul>
            {/* §19. What it beat, in one sentence — present only when a
                runner-up existed and something real separated them. */}
            {s.recommendation.counterfactual && (
              <p data-suggested-counterfactual className="mt-1 text-[11px] italic text-zinc-400">
                {s.recommendation.counterfactual}
              </p>
            )}
            {/* §20. The SAME resolver every commitment row uses. This card used
                to carry its own bespoke "Mark done" button — a second mutation
                path for the same operation, and one that offered no undo. */}
            <ResolutionControls
              title={s.recommendation.action.title}
              actions={resolutionsForAction(state, s.recommendation.action.id, { today, ix })}
            />
          </div>
        ) : (
          <p data-no-suggestion className="text-[11px] text-zinc-500">{s.note}</p>
        )}
      </Section>

      {/* ---- TODAY ---- */}
      <Section title="Today" show={view.occurrences.length + view.dueToday.length + view.recurringToday.length + view.alsoToday.length > 0}>
        {view.occurrences.length > 0 && (
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {view.occurrences.map((o) => (
              // An Event carries no control. It happens; there is nothing to tick.
              <li key={`${o.event.id}:${o.date}`} data-today-event
                className={`${rowClass} ${!o.allDay && o.startTime && o.startTime < now ? "opacity-55" : ""}`}>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                  {o.event.title}
                  {o.event.recurrence && (
                    <span className="ml-1.5 text-[11px] text-zinc-400">{describeRule(o.event.recurrence)}</span>
                  )}
                </span>
                <span className={metaClass}>
                  {o.allDay || !o.startTime ? "All day" : formatLocalTime(o.startTime)}
                  {o.endTime ? `–${formatLocalTime(o.endTime)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(view.dueToday.length > 0 || view.recurringToday.length > 0 || view.alsoToday.length > 0) && (
          <ul className="mt-1 flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {view.dueToday.map((a) => (
              <li key={a.id} data-today-action className={rowClass}>
                <Link href={`/actions/${a.id}`} className={linkClass}>{a.title}</Link>
                <span className={metaClass}>{a.dueTime ? `Due ${formatLocalTime(a.dueTime)}` : "Due today"}</span>
              </li>
            ))}
            {view.alsoToday.map((a) => (
              <li key={a.id} data-today-also className={rowClass}>
                <Link href={`/actions/${a.id}`} className={linkClass}>{a.title}</Link>
                <span className={metaClass}>
                  {a.status === "in_progress" ? "In progress" : a.dueDate === today ? "Due today" : "Open"}
                </span>
              </li>
            ))}
            {view.recurringToday.map((r) => (
              <li key={r.action.id} data-today-recurring className="flex items-center justify-between gap-3 py-1">
                <Link href={`/actions/${r.action.id}`} className={linkClass}>
                  {r.action.title}
                  <span className="ml-1.5 text-[11px] text-zinc-400">
                    {/* LIFEOS-063 R-2. "Every day at 8:00 AM" is the whole point
                        of a timed standing responsibility; the schedule alone
                        does not tell you when today's instance is. */}
                    {r.action.dueTime ? `${r.schedule} at ${formatLocalTime(r.action.dueTime)}` : r.schedule}
                  </span>
                </Link>
                <button type="button" data-complete-occurrence
                  onClick={() => { if (completeOccurrence(r.action.id, r.occurrence)) toast({ kind: "success", message: "Done for today. It'll come back next time." }); }}
                  className="shrink-0 rounded-full border border-black/[.12] px-3 py-0.5 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300">
                  Mark done
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---- NEEDS ATTENTION ----
          Rendered from the deduplicated commitment signals (LIFEOS-070 §15/§16),
          so one commitment is one row no matter how many facts are true of it.
          Every row states WHY it is here in the record's own terms. */}
      <Section title="Needs attention" id="attention" show={attention.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {attention.map((s) => (
            <li key={`${s.recordRef.kind}:${s.recordRef.id}`} data-signal={s.kind} className="py-1">
              <div className={rowClass}>
                <Link href={hrefForSignal(s)} className={linkClass}>{s.title}</Link>
                <span className={metaClass}>{s.explanation}</span>
              </div>
              {/* §15. Other true facts about the SAME commitment — attached, never
                  a second row. */}
              {s.secondaryReasons.length > 0 && (
                <p data-signal-secondary className="mt-0.5 text-[11px] text-zinc-400">
                  {s.secondaryReasons.map((r) => r.text).join(" ")}
                </p>
              )}
              {/* LIFEOS-071 §23. Controls attach to the PRIMARY row only —
                  secondary reasons never grow a second menu. */}
              <ResolutionControls title={s.title} actions={actionsFor(s)} />
            </li>
          ))}
        </ul>
      </Section>

      {/* ---- WAITING ---- */}
      <Section title="Waiting" show={view.waiting.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {view.waiting.map((w) => {
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
                {/* §14. Only a wait whose follow-up date has ARRIVED gets
                    controls — a wait with no due follow-up is not actionable,
                    and putting buttons on it would manufacture urgency the
                    record does not support. */}
                {waitingSignal(w.action.id) && (
                  <ResolutionControls
                    title={w.action.title}
                    actions={actionsFor(waitingSignal(w.action.id)!)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ---- PROJECT PULSE ---- */}
      <Section title="Project pulse" id="pulse" show={view.pulse.length > 0}>
        <ul className="flex flex-col gap-1.5">
          {view.pulse.map((p) => (
            <li key={p.project.id} data-pulse>
              <Link href={`/project/${p.project.id}`} className="text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                {p.project.title}
              </Link>
              {/* Facts only. No health score, no percentage, no "at risk". */}
              <p className="text-[11px] text-zinc-500">
                {/* §11. One wording for this fact, shared with the signal layer
                    and with Memory — "executable" is the load-bearing word,
                    because a project whose only actions are blocked or waiting
                    does have next actions, just none that can be started. */}
                {p.nextAction ? `Next: ${p.nextAction.title}` : p.needsNextAction ? PROJECT_NO_NEXT_ACTION : ""}
                {p.blockedCount > 0 ? ` · ${p.blockedCount} blocked` : ""}
                {p.waitingCount > 0 ? ` · ${p.waitingCount} waiting` : ""}
              </p>
              {/* §16. The project's own signal carries "Add next action" — the
                  one place 071 is genuinely executive, and still user-written. */}
              {pulseSignal(p.project.id) && (
                <ResolutionControls title={p.project.title} actions={actionsFor(pulseSignal(p.project.id)!)} />
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* ---- RETURN ----
          Two things belong here (§16): a deferral the user themselves scheduled
          to come back, and an open commitment that has simply gone quiet. Both
          arrive as signals; the older single-record suggestion still appears for
          NON-action records, and is suppressed when it duplicates a signal. */}
      <Section title="Worth returning to" id="return"
        show={returns.length > 0 || !!view.returnItem}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {returns.map((s) => (
            <li key={`${s.recordRef.kind}:${s.recordRef.id}`} data-signal={s.kind} className="py-1">
              <div className={rowClass}>
                <Link href={hrefForSignal(s)} className={linkClass}>{s.title}</Link>
                <span className={metaClass}>{s.explanation}</span>
              </div>
              <ResolutionControls title={s.title} actions={actionsFor(s)} />
            </li>
          ))}
          {view.returnItem && (
            <li data-return className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{view.returnItem.title}</span>
              <span className={metaClass}>{view.returnItem.reason}</span>
            </li>
          )}
        </ul>
      </Section>

      {/* ---- UPCOMING ---- */}
      <Section title="Upcoming" show={view.upcoming.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {view.upcoming.map((u) => (
            <li key={`${u.kind}:${u.id}:${u.date}`} data-upcoming className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
                {u.title}{u.schedule && <span className="ml-1.5 text-[11px] text-zinc-400">{u.schedule}</span>}
              </span>
              <span className={metaClass}>
                {formatDayKey(u.date)}{u.time ? ` · ${formatLocalTime(u.time)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* §28: Today reflects what was RECORDED. No data is not no life activity. */}
      <p data-coverage className="px-1 text-[11px] text-zinc-400">
        {COVERAGE_NOTE}{" "}
        {/* LIFEOS-064 §19. One link, and nothing else — Today stays present
            tense. Dropping the week's history onto this page would undo the
            single thing LIFEOS-062 got right about it. */}
        <Link href="/memory" data-review-week className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300">
          Review this week
        </Link>
      </p>
    </div>
  );
}
