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
import { completeAction, completeOccurrence, useStore } from "@/lib/mvpStore";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView, waitingDays, COVERAGE_NOTE, EMPTY_PROMPT } from "@/lib/today/view";
import { formatLocalTime } from "@/lib/time/localtime";
import { formatDayKey, todayKey } from "@/lib/reviews/dates";
import { nowLocalTime } from "@/lib/time/events";
import { describeRule } from "@/lib/time/recurrence";
import { toast } from "@/lib/ux/feedback";

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

  const view = useMemo(() => buildTodayView(state, buildTodayIndexes(state, today, now)), [state, today, now]);

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
            <button type="button" data-complete-suggested
              onClick={() => { completeAction(s.recommendation!.action.id); toast({ kind: "success", message: "Done." }); }}
              className="mt-2 rounded-full border border-black/[.12] px-3 py-0.5 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300">
              Mark done
            </button>
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
                  {r.action.title}<span className="ml-1.5 text-[11px] text-zinc-400">{r.schedule}</span>
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

      {/* ---- NEEDS ATTENTION ---- */}
      <Section title="Needs attention" id="attention"
        show={view.overdue.length + view.returnedToday.length + view.blocked.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {view.overdue.map((a) => (
            <li key={a.id} data-overdue className={rowClass}>
              <Link href={`/actions/${a.id}`} className={linkClass}>{a.title}</Link>
              {/* Past tense, stated once. No count, no exclamation, no blame. */}
              <span className={metaClass}>Was due {formatDayKey(a.dueDate!)}</span>
            </li>
          ))}
          {view.returnedToday.map((a) => (
            <li key={a.id} data-returned className={rowClass}>
              <Link href={`/actions/${a.id}`} className={linkClass}>{a.title}</Link>
              <span className={metaClass}>Comes back today</span>
            </li>
          ))}
          {view.blocked.map((b) => (
            <li key={b.action.id} data-blocked className={rowClass}>
              <Link href={`/actions/${b.action.id}`} className={linkClass}>{b.action.title}</Link>
              <span className={metaClass}>
                Waiting on {b.blockers.length === 1 ? b.blockers[0].title : `${b.blockers.length} prerequisites`}
              </span>
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
              <li key={w.action.id} data-waiting className={rowClass}>
                <Link href={`/actions/${w.action.id}`} className={linkClass}>
                  {w.waitingOn && <span className="font-medium">{w.waitingOn} · </span>}{w.action.title}
                </Link>
                <span className={metaClass}>
                  {w.followUpDue ? "Follow-up due" : days !== undefined ? `Since ${formatDayKey(w.action.waitingSince!.slice(0, 10))}` : "Waiting"}
                </span>
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
                {p.nextAction ? `Next: ${p.nextAction.title}` : p.needsNextAction ? "No next action recorded" : ""}
                {p.blockedCount > 0 ? ` · ${p.blockedCount} blocked` : ""}
                {p.waitingCount > 0 ? ` · ${p.waitingCount} waiting` : ""}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {/* ---- RETURN ---- */}
      <Section title="Worth returning to" id="return" show={!!view.returnItem}>
        {view.returnItem && (
          <div data-return>
            <p className="text-sm text-zinc-800 dark:text-zinc-100">{view.returnItem.title}</p>
            <p className="text-[11px] text-zinc-500">{view.returnItem.reason}</p>
          </div>
        )}
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
      <p data-coverage className="px-1 text-[11px] text-zinc-400">{COVERAGE_NOTE}</p>
    </div>
  );
}
