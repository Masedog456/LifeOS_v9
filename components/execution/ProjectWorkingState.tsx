"use client";

/**
 * The working state of a project (LIFEOS-087 §20).
 *
 * ## Why this exists
 *
 * The audit opened a project holding eleven actions, an overdue item, a
 * blocker, two waits and an action deferred three times — and every panel on
 * its page was empty. `projectDashboard` returned progress 0, milestones 0,
 * reading 0, documents 0 and no sessions, because LIFEOS-031 built that page
 * for knowledge and sessions. The work lived somewhere else entirely, and the
 * one action surface rendered count chips over a flat list of all eleven
 * actions with the completed ones still in it.
 *
 * So this sits ABOVE those panels rather than replacing them: the knowledge
 * side is still true, it was simply never the answer to "what is happening
 * with this project?".
 *
 *   NEXT AND OPEN · STUCK AND WAITING · RECENTLY · CONTEXT
 *
 * (Overview is the page header, which already carries title, status and goal.)
 *
 * ## One action, one row (§26)
 *
 * `buildProjectContext` decides ownership in a single pass, so an action that
 * is overdue AND deferred three times AND the recommendation appears once, with
 * the other facts attached to it.
 *
 * ## No score (§28)
 *
 * Nothing here is a health, a momentum, a risk or a percentage.
 */

import Link from "next/link";
import { formatDayKey } from "@/lib/reviews/dates";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { DayKey } from "@/lib/reviews/dates";
import type { StoreState } from "@/types/mvp";
import { resolutionsForAction } from "@/lib/commitment/resolve";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import {
  PROJECT_HEADINGS, HISTORY_LIMITATION, NO_GOAL_LINKED, NO_OPEN_ACTIONS,
  NOTHING_COMPLETED, type ProjectContext, type ProjectRow,
} from "@/lib/execution/context";

const rowClass = "flex items-baseline justify-between gap-3 py-1";
const metaClass = "shrink-0 text-[11px] text-zinc-400";
const linkClass = "min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100";

/** A recorded transition, stated as the transition (§13, §14). */
const CHANGE_WORD: Record<string, string> = {
  completed: "Completed", recurring_completed: "Kept", deferred: "Deferred",
  rescheduled: "Date moved", returned: "Came back", waiting_started: "Started waiting",
  waiting_ended: "Stopped waiting", added: "Added",
};

function Section({ title, id, show, note, children }: {
  title: string; id: string; show: boolean; note?: string; children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section data-project-section={id} aria-labelledby={`proj-h-${id}`} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 id={`proj-h-${id}`} className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] text-zinc-400">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A labelled block inside a primary section. Not a section — §20 counts those. */
function Block({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div data-project-block={label.toLowerCase().replace(/[^a-z]+/g, "-")} className="mt-3 first:mt-0">
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** The facts that ATTACH to a row rather than becoming rows of their own (§26). */
function RowNotes({ row }: { row: ProjectRow }) {
  const parts = [row.attention, row.deferral].filter(Boolean);
  if (parts.length === 0) return null;
  return <p data-project-rownote className="mt-0.5 text-[11px] text-zinc-400">{parts.join(" ")}</p>;
}

export default function ProjectWorkingState({
  ctx, state, ix, today,
}: { ctx: ProjectContext; state: StoreState; ix: TodayIndexes; today: DayKey }) {
  const controls = (id: string, title: string) => (
    <ResolutionControls title={title} actions={resolutionsForAction(state, id, { ix, today })} />
  );

  const stuckShown = ctx.blocked.length > 0 || ctx.waiting.length > 0;
  const contextShown = !!ctx.goal || ctx.people.length > 0 || ctx.rules.length > 0;

  return (
    <div data-project-working className="mt-6 flex flex-col gap-3">
      {/* ---- 1. NEXT AND OPEN (§22) ------------------------------------- */}
      <Section
        title={PROJECT_HEADINGS.next}
        id="next"
        show={!!ctx.next || ctx.openRows.length > 0 || ctx.empty}
      >
        {ctx.next ? (
          <div data-project-next className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]">
            <p className="text-[11px] font-medium text-zinc-500">Suggested next</p>
            <Link href={`/actions/${ctx.next.action.id}`} className="mt-0.5 block text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
              {ctx.next.action.title}
            </Link>
            {/* §8. The recommender's own reasons, verbatim. This page adds no
                ranking of its own and no reason of its own. */}
            <p className="mt-0.5 text-[11px] text-zinc-400">{ctx.next.reasons.map((r) => r.text).join(" · ")}</p>
            {controls(ctx.next.action.id, ctx.next.action.title)}
          </div>
        ) : (
          // §30. Calm, and it never calls a project stalled.
          <p data-project-nonext className="text-sm text-zinc-500">
            {ctx.empty ? NO_OPEN_ACTIONS : ctx.nextNote}
          </p>
        )}

        {/* §22. The recommendation is NOT repeated here — it is owned above. */}
        <Block label="Also open" show={ctx.openRows.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.openRows.map((r) => (
              <li key={r.id} data-project-open className="py-1">
                <div className={rowClass}>
                  <Link href={`/actions/${r.action.id}`} className={linkClass}>{r.action.title}</Link>
                  <span className={metaClass}>{r.dueDate ? `Due ${formatDayKey(r.dueDate)}` : ""}</span>
                </div>
                <RowNotes row={r} />
              </li>
            ))}
          </ul>
        </Block>
      </Section>

      {/* ---- 2. STUCK AND WAITING (§23) ---------------------------------- */}
      <Section title={PROJECT_HEADINGS.stuck} id="stuck" show={stuckShown}>
        {/* §10. Real blocker evidence only, and the blocker named is the
            UNFINISHED one — a completed blocker is why the row would not be
            here at all. */}
        <Block label="Blocked" show={ctx.blocked.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.blocked.map((r) => (
              <li key={r.id} data-project-blocked className="py-1">
                <div className={rowClass}>
                  <Link href={`/actions/${r.action.id}`} className={linkClass}>{r.action.title}</Link>
                </div>
                {r.blockedBy && (
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Blocked by{" "}
                    <Link href={`/actions/${r.blockedBy.id}`} className="underline underline-offset-2">
                      “{r.blockedBy.title}”
                    </Link>
                  </p>
                )}
                <RowNotes row={r} />
              </li>
            ))}
          </ul>
        </Block>

        {/* §11. Reuses waiting semantics; a future follow-up stays future. */}
        <Block label="Waiting on" show={ctx.waiting.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.waiting.map((r) => (
              <li key={r.id} data-project-waiting className="py-1">
                <div className={rowClass}>
                  <Link href={`/actions/${r.action.id}`} className={linkClass}>{r.action.title}</Link>
                  <span className={metaClass} data-followup={r.followUpDue ? "due" : r.followUpDate ? "future" : "none"}>
                    {r.followUpDue
                      ? "Follow up today"
                      : r.followUpDate
                        ? `Follow up ${formatDayKey(r.followUpDate)}`
                        : "Waiting"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Waiting on {r.waitingOn ?? "someone"}{r.since ? ` since ${formatDayKey(r.since)}` : ""}.
                </p>
                <RowNotes row={r} />
                {controls(r.action.id, r.action.title)}
              </li>
            ))}
          </ul>
        </Block>
      </Section>

      {/* ---- 3. RECENTLY (§24, §35) -------------------------------------- */}
      <Section
        title={PROJECT_HEADINGS.recent}
        id="recent"
        show={!ctx.empty}
        note={ctx.range.label}
      >
        {ctx.recent.length === 0 ? (
          // §29. Scoped exactly to recorded linked completions — never "no
          // progress", which claims something the records do not say.
          <p data-project-norecent className="text-sm text-zinc-500">{NOTHING_COMPLETED(ctx.range.label)}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.recent.map((c) => (
              <li key={c.id} data-project-recent={c.kind} className={rowClass}>
                <Link href={`/actions/${c.entity.id}`} className={linkClass}>{c.title}</Link>
                <span className={metaClass}>
                  {CHANGE_WORD[c.kind] ?? "Changed"} · {formatDayKey(c.day)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* §27. Projects carry no lifecycle history, and the page says so
            rather than dating a status change from `updatedAt`. */}
        <p data-project-history-limit className="mt-2 text-[11px] text-zinc-400">{HISTORY_LIMITATION}</p>
      </Section>

      {/* ---- 4. CONTEXT (§25) -------------------------------------------- */}
      <Section title={PROJECT_HEADINGS.context} id="context" show={contextShown || !ctx.goal}>
        {/* §5, §6, §31. The recorded link, or the plain fact that there is none. */}
        <Block label="Goal" show>
          {ctx.goal ? (
            <Link href={`/goal/${ctx.goal.id}`} data-project-goal={ctx.goal.id} className="text-sm text-zinc-800 hover:underline dark:text-zinc-100">
              {ctx.goal.title}
            </Link>
          ) : (
            <p data-project-nogoal className="text-sm text-zinc-500">{NO_GOAL_LINKED}</p>
          )}
        </Block>

        {/* §12, §34. Conservative, and ambiguity travels with the row. */}
        <Block label="People named here" show={ctx.people.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.people.map((p) => (
              <li key={p.name} data-project-person={p.name} className="py-1">
                <div className={rowClass}>
                  <Link href={p.route} className={linkClass}>{p.name}</Link>
                  <span className={metaClass}>
                    {p.grounding === "waiting" ? "You are waiting on them" : `Named in ${p.actions} action${p.actions === 1 ? "" : "s"}`}
                  </span>
                </div>
                {p.longerForms.length > 0 && (
                  <p data-project-person-ambiguous className="mt-0.5 text-[11px] text-zinc-400">
                    Conqify also has “{p.longerForms[0]}”. It cannot tell whether that is the same {p.name}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Block>

        {/* §16. Context, never priority — and only where the existing relevance
            system already grounded the rule in an item's own words. */}
        <Block label="From your Personal Code" show={ctx.rules.length > 0}>
          <ul className="flex flex-col gap-1">
            {ctx.rules.map((r) => (
              <li key={r} data-project-rule className="text-[11px] text-zinc-500">“{r}”</li>
            ))}
          </ul>
        </Block>
      </Section>
    </div>
  );
}
