"use client";

/**
 * Week in Review (LIFEOS-064 §8, §18, §23).
 *
 * Hosted on `/memory` rather than behind a new nav destination. LIFEOS-063's
 * navigation audit counted 40 destinations of which a full week of ordinary use
 * touched four, so the bar for a forty-first is high — and "Memory" is already
 * the page's name for looking backwards. No new user-facing noun is introduced:
 * the word "autobiographical" appears nowhere on screen.
 *
 * ## Every heading is what the evidence supports
 *
 * "On the calendar", not "Attended". "Added", not "Started". A project line
 * counts linked records and never says the project moved. The headings are the
 * claim, so they are chosen with the same care as the model underneath them.
 *
 * ## Sections disappear when empty
 *
 * Same rule as Today, for the same reason: a section with nothing in it is a
 * reminder that you have not filled something in, which is the opposite of what
 * a review of your own week is for.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { formatDayKey } from "@/lib/reviews/dates";
import { formatLocalTime } from "@/lib/time/localtime";
import {
  buildWeekReview, WEEK_RANGE_LABEL, EMPTY_WEEK,
  type AutobiographicalEvent, type WeekRangeKind, type WeekReview,
} from "@/lib/memory/week";

const RANGES: WeekRangeKind[] = ["this_week", "last_week", "last_7_days"];

const rowClass = "flex items-baseline justify-between gap-3 py-1";
const metaClass = "shrink-0 text-[11px] text-zinc-400";
const linkClass = "min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100";

/** Where a record lives, so every line in the review is a way back to it. */
function hrefFor(ref: { kind: string; id: string }): string {
  switch (ref.kind) {
    case "action": return `/actions/${ref.id}`;
    case "note": return "/notes";
    case "project": return `/project/${ref.id}`;
    case "decision": return `/decisions/${ref.id}`;
    case "formation": return `/formation/${ref.id}`;
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

export default function WeekInReview() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const [rangeKind, setRangeKind] = useState<WeekRangeKind>("this_week");

  // `todayKey()` reads the clock, so the review can only be built on the
  // client. Building it during the server pass would render a different week
  // than the one that hydrates.
  const review: WeekReview | null = useMemo(
    () => (mounted ? buildWeekReview(state, rangeKind) : null),
    [state, rangeKind, mounted],
  );

  if (!mounted || !review) {
    return <p className="text-sm text-zinc-400">Looking back…</p>;
  }

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

      <p className="text-[11px] text-zinc-400">{review.range.label}</p>

      {review.empty ? (
        <div data-week-empty className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm dark:border-white/[.12]">
          <p className="text-zinc-700 dark:text-zinc-200">{EMPTY_WEEK}</p>
          <p className="mt-1 text-xs text-zinc-500">
            That is a statement about the records, not about the week.
          </p>
        </div>
      ) : (
        <>
          {/* Arithmetic over recorded facts. Never an evaluation (§21). */}
          <p data-week-summary className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
            {review.summary}
          </p>

          <div className="flex flex-col gap-3">
            <Section title="Completed" id="completed" show={review.completed.length > 0}>
              <DayGroups
                groups={byDay(review.completed)}
                render={(e) => (
                  <>
                    <Link href={hrefFor(e.recordRef)} className={linkClass}>{e.title}</Link>
                    {/* One occurrence of a standing responsibility being kept is
                        not the same as a task being finished, and the label says
                        which one this was. */}
                    {e.kind === "recurring_completion" && <span className={metaClass}>Recurring</span>}
                  </>
                )}
              />
            </Section>

            <Section
              title="On the calendar"
              id="scheduled"
              show={review.scheduled.length > 0}
              note="What was scheduled. Conqify has no record of attendance."
            >
              <DayGroups
                groups={byDay(review.scheduled)}
                render={(e) => (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
                    {e.detail && (
                      <span className={metaClass}>
                        {e.detail.split(" · ").map((part) => (/^\d{2}:\d{2}$/.test(part) ? formatLocalTime(part) : part)).join(" · ")}
                      </span>
                    )}
                  </>
                )}
              />
            </Section>

            <Section title="Added" id="added" show={review.added.length > 0}>
              <DayGroups
                groups={byDay(review.added)}
                render={(e) => (
                  <>
                    <Link href={hrefFor(e.recordRef)} className={linkClass}>{e.title}</Link>
                    <span className={metaClass}>
                      {e.kind === "waiting_started" ? `Waiting on ${e.detail ?? "someone"}` : "Added"}
                    </span>
                  </>
                )}
              />
            </Section>

            <Section title="Deferred" id="deferred" show={review.deferred.length > 0}>
              <DayGroups
                groups={byDay(review.deferred)}
                render={(e) => (
                  <>
                    <Link href={hrefFor(e.recordRef)} className={linkClass}>{e.title}</Link>
                    <span className={metaClass}>{e.detail}</span>
                  </>
                )}
              />
            </Section>

            <Section title="Waiting" id="waiting" show={review.waiting.length > 0}>
              <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                {review.waiting.map((w) => (
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
            </Section>

            {/* Notes and reflections in one section, under a heading that claims
                only what is true of both: these are the user's own words. A note
                about a tap washer is not a reflection, and calling it one would
                be the review interpreting rather than remembering. */}
            <Section title="In your own words" id="reflections" show={review.reflections.length > 0}>
              <DayGroups
                groups={byDay(review.reflections)}
                render={(e) => (
                  <Link href={hrefFor(e.recordRef)} className="min-w-0 flex-1 text-sm leading-relaxed text-zinc-700 hover:underline dark:text-zinc-200">
                    {e.title.length > 180 ? `${e.title.slice(0, 179).trimEnd()}…` : e.title}
                  </Link>
                )}
              />
            </Section>

            <Section
              title="Projects"
              id="projects"
              show={review.projects.length > 0}
              note="Counts of linked records. Conqify keeps no history of project changes."
            >
              <ul className="flex flex-col gap-1.5">
                {review.projects.map((p) => (
                  <li key={p.project.id} data-week-item="project">
                    <Link href={`/project/${p.project.id}`} className="text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                      {p.project.title}
                    </Link>
                    {/* Facts only. No percentage, no health score, no "progress". */}
                    <p className="text-[11px] text-zinc-500">
                      {[
                        p.completed > 0 ? `${p.completed} linked action${p.completed === 1 ? "" : "s"} completed` : null,
                        p.added > 0 ? `${p.added} added` : null,
                        p.eventsScheduled > 0 ? `${p.eventsScheduled} event${p.eventsScheduled === 1 ? "" : "s"} scheduled` : null,
                        p.waiting > 0 ? `${p.waiting} waiting` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section
              title="Still open"
              id="still-open"
              show={review.stillOpen.length > 0}
              note="A few unresolved items, chosen by deadline and by what is waiting."
            >
              <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                {review.stillOpen.map((o) => (
                  <li key={o.action.id} data-week-item="open" className={rowClass}>
                    <Link href={`/actions/${o.action.id}`} className={linkClass}>{o.action.title}</Link>
                    <span className={metaClass}>{o.detail}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </>
      )}

      {review.limitations.map((l) => (
        <p key={l} data-week-limitation className="px-1 text-[11px] text-zinc-400">{l}</p>
      ))}
      <p data-week-coverage className="px-1 text-[11px] text-zinc-400">{review.coverage}</p>
    </div>
  );
}
