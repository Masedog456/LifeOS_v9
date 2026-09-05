"use client";

/**
 * The command view of one goal (LIFEOS-088 §27, §28).
 *
 * ## Why this exists
 *
 * The audit opened a goal carrying an overdue action, a blocked action, two
 * waits, an action deferred three times and a perfectly good next action. The
 * page showed six empty panels, four counts, and none of the commitments — and
 * two of the things it DID show were false: a project holding eleven actions
 * drawn at "0%", and, on a sibling goal, "No active project is linked to this
 * goal. Add a project" while the recommender was already naming that goal's
 * next step.
 *
 * Five sections, and no sixth:
 *
 *   WHERE THIS IS HEADED · NEXT AND SUPPORT · STUCK AND WAITING · RECENTLY · CONTEXT
 *
 * ## One action, one row (§34)
 *
 * `buildGoalContext` decides ownership in a single pass, so an action that is
 * overdue AND deferred three times AND the recommendation appears once, with the
 * other facts attached to it.
 *
 * ## No score, no percentage, no mission statement (§5, §38)
 *
 * Nothing here is a health, a momentum, an alignment or a progress bar, and
 * nothing here writes prose about what the goal means. Every line is a record,
 * a count, or a recorded transition.
 */

import Link from "next/link";
import { formatDayKey } from "@/lib/reviews/dates";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { DayKey } from "@/lib/reviews/dates";
import type { StoreState } from "@/types/mvp";
import { resolutionsForAction } from "@/lib/commitment/resolve";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import { GOAL_HORIZON_GUIDANCE } from "@/lib/execution/horizons";
import { projectHref } from "@/lib/execution/projects";
import {
  GOAL_HEADINGS, NO_HORIZON, NO_TARGET, NOTHING_MOVED, PROGRESS_NOT_MEASURED,
  type GoalContext, type GoalRow,
} from "@/lib/execution/goal-context";

const rowClass = "flex items-baseline justify-between gap-3 py-1";
const metaClass = "shrink-0 text-[11px] text-zinc-400";
const linkClass = "min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100";

/** A recorded transition, stated as the transition (§16, §17). */
const CHANGE_WORD: Record<string, string> = {
  completed: "Completed", recurring_completed: "Kept", deferred: "Deferred",
  rescheduled: "Date moved", returned: "Came back", waiting_started: "Started waiting",
  waiting_ended: "Stopped waiting", added: "Added",
  goal_created: "Created", goal_status_changed: "Status changed",
  goal_horizon_changed: "Horizon changed", goal_target_changed: "Target date changed",
  goal_replaced: "Replaced",
};

function Section({ title, id, show, note, children }: {
  title: string; id: string; show: boolean; note?: string; children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section data-goal-section={id} aria-labelledby={`goal-h-${id}`} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 id={`goal-h-${id}`} className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] text-zinc-400">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A labelled block inside a primary section. Not a section — §28 counts those. */
function Block({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div data-goal-block={label.toLowerCase().replace(/[^a-z]+/g, "-")} className="mt-3 first:mt-0">
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** The facts that ATTACH to a row rather than becoming rows of their own (§34). */
function RowNotes({ row }: { row: GoalRow }) {
  const parts = [row.attention, row.deferral].filter(Boolean);
  if (parts.length === 0) return null;
  return <p data-goal-rownote className="mt-0.5 text-[11px] text-zinc-400">{parts.join(" ")}</p>;
}

/**
 * How this action reaches the goal (§11).
 *
 * A direct link is the user's own statement that this serves the goal, and it is
 * said as plainly as the project route — neither is the "real" one.
 */
function Via({ row }: { row: GoalRow }) {
  if (row.via === "direct") {
    return <span data-goal-via="direct" className={metaClass}>Linked to this goal</span>;
  }
  return (
    <Link href={projectHref(row.via.project.id)} data-goal-via="project" className={`${metaClass} hover:underline`}>
      {row.via.project.title}
    </Link>
  );
}

export default function GoalCommandView({
  ctx, state, ix, today,
}: { ctx: GoalContext; state: StoreState; ix: TodayIndexes; today: DayKey }) {
  const controls = (id: string, title: string) => (
    <ResolutionControls title={title} actions={resolutionsForAction(state, id, { ix, today })} />
  );

  const stuckShown = ctx.blocked.length > 0 || ctx.waiting.length > 0;
  const recentlyShown = ctx.movement.length > 0 || ctx.direction.length > 0 || !ctx.noWorkLinked;
  const contextShown = ctx.history.length > 0 || ctx.lineage.length > 1
    || ctx.people.length > 0 || ctx.rules.length > 0 || ctx.successorMissing;

  return (
    <div data-goal-command className="mt-6 flex flex-col gap-3">
      {/* ---- 1. WHERE THIS IS HEADED (§6, §7, §13, §14, §38) ------------- */}
      <Section title={GOAL_HEADINGS.overview} id="overview" show>
        {/* §6, §7. Both facts, both straight from the record, neither derived
            from the other. A `life` goal may carry a date; a `now` goal may
            carry none. Nothing compares one against the other. */}
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <p className="text-sm" data-goal-horizon-fact={ctx.horizon ?? ""}>
            <span className="text-zinc-400">Horizon </span>
            {ctx.horizon
              ? <span className="text-zinc-800 dark:text-zinc-100">{ctx.horizonLabel}</span>
              : <span className="text-zinc-500">{NO_HORIZON}</span>}
          </p>
          <p className="text-sm" data-goal-target={ctx.targetDate ?? ""}>
            <span className="text-zinc-400">Target </span>
            {ctx.targetDate
              // With the YEAR, unlike every other date on this page. A due date
              // is days away and a weekday is the useful part; a goal's target
              // is routinely months or years out, and "Sat, Jan 2" without a
              // year is ambiguous exactly where the ambiguity costs most.
              ? <span className="text-zinc-800 dark:text-zinc-100">{formatDayKey(ctx.targetDate, { year: "numeric", month: "short", day: "numeric" })}</span>
              : <span className="text-zinc-500">{NO_TARGET}</span>}
          </p>
        </div>
        {ctx.horizon && (
          <p className="mt-1 text-[11px] text-zinc-400">{GOAL_HORIZON_GUIDANCE[ctx.horizon]}</p>
        )}

        {/* What is carrying this, as counts. LIFEOS-078's alignment facts said
            the same thing from a different derivation; these come from the rows
            below, so the summary and the detail cannot disagree. No percentage,
            no score, and no "last recorded activity" — that date mixed a
            project's `updatedAt` into an activity claim, and Recently answers
            the same question from dated transitions instead (§8, §16). */}
        <p data-goal-facts className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {ctx.counts.activeProjects} active project{ctx.counts.activeProjects === 1 ? "" : "s"} of {ctx.counts.projects}
          {" · "}{ctx.counts.open} open
          {" · "}{ctx.counts.blocked} blocked
          {" · "}{ctx.counts.waiting} waiting
          {" · "}{ctx.counts.completedRecently} completed in {ctx.range.label}
        </p>

        {/* §13, §14. Said only when there is something to say, and it names the
            checks it made rather than pronouncing on the goal. */}
        {ctx.pathNote && (
          <p data-goal-path={ctx.path} className="mt-2 text-sm text-zinc-500">
            {ctx.pathNote}
            {ctx.path === "none" && (
              <> <Link href={`/projects?new=1&goal=${ctx.goal.id}`} className="underline">Add a project</Link></>
            )}
          </p>
        )}

        {/* §38. Counts, which are known. A percentage only where
            `projectProgressMeasurable` says the number rests on something. */}
        <Block label="Projects" show={ctx.projects.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.projects.map((p) => (
              <li key={p.project.id} data-goal-project={p.project.status} className="py-1">
                <div className={rowClass}>
                  <Link href={projectHref(p.project.id)} className={linkClass}>{p.project.title}</Link>
                  <span className={metaClass}>
                    {p.percent === undefined
                      ? <span data-goal-project-unmeasured title={PROGRESS_NOT_MEASURED}>—</span>
                      : <span data-goal-project-percent={p.percent}>{p.percent}%</span>}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {p.open} open · {p.blocked} blocked · {p.waiting} waiting · {p.completed} completed
                </p>
              </li>
            ))}
          </ul>
        </Block>
      </Section>

      {/* ---- 2. NEXT AND SUPPORT (§15) ----------------------------------- */}
      {/* §34. Omitted entirely when nothing is linked: Overview already said
          "No active project, and no action linked directly to this goal", and
          a second card underneath saying "No project and no action is linked to
          this goal" was the same fact twice on one screen, in two wordings. */}
      <Section
        title={GOAL_HEADINGS.next}
        id="next"
        show={!!ctx.next || ctx.support.length > 0 || (!ctx.noWorkLinked && !!ctx.nextNote)}
      >
        {ctx.next ? (
          <div data-goal-next className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]">
            <p className="text-[11px] font-medium text-zinc-500">Suggested next</p>
            <Link href={`/actions/${ctx.next.action.id}`} className="mt-0.5 block text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
              {ctx.next.action.title}
            </Link>
            {/* §15. The recommender's own reasons, verbatim. This page adds no
                ranking of its own and no reason of its own. */}
            <p className="mt-0.5 text-[11px] text-zinc-400">{ctx.next.reasons.map((r) => r.text).join(" · ")}</p>
            {controls(ctx.next.action.id, ctx.next.action.title)}
          </div>
        ) : (
          <p data-goal-nonext className="text-sm text-zinc-500">{ctx.nextNote}</p>
        )}

        {/* §34. The recommendation is NOT repeated here — it is owned above. */}
        <Block label="Also carrying this" show={ctx.support.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.support.map((r) => (
              <li key={r.id} data-goal-support className="py-1">
                <div className={rowClass}>
                  <Link href={`/actions/${r.action.id}`} className={linkClass}>{r.action.title}</Link>
                  <span className={metaClass}>{r.dueDate ? `Due ${formatDayKey(r.dueDate)}` : ""}</span>
                </div>
                <div className="mt-0.5"><Via row={r} /></div>
                <RowNotes row={r} />
              </li>
            ))}
          </ul>
        </Block>
      </Section>

      {/* ---- 3. STUCK AND WAITING (§20, §21, §22) ------------------------ */}
      <Section title={GOAL_HEADINGS.stuck} id="stuck" show={stuckShown}>
        {/* §20, §22. Rows, never a verdict: the goal is not called "blocked"
            because one action is, and the blocker named is the UNFINISHED one —
            a completed blocker is why the row would not be here at all. */}
        <Block label="Blocked" show={ctx.blocked.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.blocked.map((r) => (
              <li key={r.id} data-goal-blocked className="py-1">
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

        {/* §21. A future follow-up stays future, and nothing says a wait has
            gone on too long. */}
        <Block label="Waiting on" show={ctx.waiting.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.waiting.map((r) => (
              <li key={r.id} data-goal-waiting className="py-1">
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

      {/* ---- 4. RECENTLY (§16, §17, §18) -------------------------------- */}
      <Section title={GOAL_HEADINGS.recent} id="recent" show={recentlyShown} note={ctx.range.label}>
        {/* §16. Completed linked work, and nothing else. */}
        <Block label="Moved forward" show>
          {ctx.movement.length === 0 ? (
            // §29. Scoped exactly to recorded linked completions — never "no
            // progress", which claims something the records do not say.
            <p data-goal-nomovement className="text-sm text-zinc-500">{NOTHING_MOVED(ctx.range.label)}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {ctx.movement.map((c) => (
                <li key={c.id} data-goal-movement={c.kind} className={rowClass}>
                  <Link href={c.entity.kind === "project" ? projectHref(c.entity.id) : `/actions/${c.entity.id}`} className={linkClass}>{c.title}</Link>
                  <span className={metaClass}>{CHANGE_WORD[c.kind] ?? "Changed"} · {formatDayKey(c.day)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* §17. A horizon change, a status edit or a new target date is a
            change of DIRECTION. It is recorded, and it is not progress. */}
        <Block label="Changed direction" show={ctx.direction.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.direction.map((c) => (
              <li key={c.id} data-goal-direction={c.kind} className={rowClass}>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                  {CHANGE_WORD[c.kind] ?? "Changed"}{c.from && c.to ? ` · ${c.from} → ${c.to}` : ""}
                </span>
                <span className={metaClass}>{formatDayKey(c.day)}</span>
              </li>
            ))}
          </ul>
        </Block>
      </Section>

      {/* ---- 5. CONTEXT (§8, §9, §23, §24) ------------------------------ */}
      <Section title={GOAL_HEADINGS.context} id="context" show={contextShown}>
        {/* §8. From the append-only history, never from `updatedAt` — which a
            title edit moves, and which would misdate the moment a goal changed. */}
        <Block label="What has changed" show={ctx.history.length > 0}>
          {/* The COUNT lives on the container, as LIFEOS-078 put it there: its
              append-only proof re-selects the same horizon and asserts the
              attribute did not move. Per-row attributes carry no value, so
              reading one as a count would compare "" with "" and pass whatever
              the product did. */}
          <ul data-goal-history={ctx.history.length} className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.history.map((h) => (
              <li key={h.id} data-goal-history-row className={rowClass}>
                <span className="min-w-0 flex-1 text-sm text-zinc-800 dark:text-zinc-100">{h.text}{h.note ? ` ${h.note}` : ""}</span>
                <span className={metaClass}>{formatDayKey(h.day)}</span>
              </li>
            ))}
          </ul>
        </Block>

        {/* §9. Factual, dated from the history entry, and never a UUID. */}
        <Block label="Replacement" show={ctx.lineage.length > 1 || ctx.successorMissing}>
          {ctx.successorMissing ? (
            <p data-goal-successor-missing className="text-sm text-zinc-500">
              Replaced by a goal that has since been deleted.
            </p>
          ) : (
            <ol className="flex flex-col gap-1" data-goal-lineage={ctx.lineage.length}>
              {ctx.lineage.map((g) => (
                <li key={g.id} className={g.id === ctx.goal.id ? "text-sm font-medium" : "text-sm text-zinc-500"}>
                  {g.id === ctx.goal.id ? g.title : <Link href={`/goal/${g.id}`} className="hover:underline">{g.title}</Link>}
                </li>
              ))}
            </ol>
          )}
          {ctx.replacedOn && (
            <p data-goal-replaced-on={ctx.replacedOn} className="mt-1 text-[11px] text-zinc-400">
              Recorded {formatDayKey(ctx.replacedOn)}.
            </p>
          )}
        </Block>

        {/* §23. Conservative, and ambiguity travels with the row: "Marcus" and
            "Marcus Webb" stay two references the reader can tell apart. */}
        <Block label="People named here" show={ctx.people.length > 0}>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {ctx.people.map((p) => (
              <li key={p.name} data-goal-person={p.name} className="py-1">
                <div className={rowClass}>
                  <Link href={p.route} className={linkClass}>{p.name}</Link>
                  <span className={metaClass}>
                    {p.grounding === "waiting" ? "You are waiting on them" : `Named in ${p.actions} action${p.actions === 1 ? "" : "s"}`}
                  </span>
                </div>
                {p.longerForms.length > 0 && (
                  <p data-goal-person-ambiguous className="mt-0.5 text-[11px] text-zinc-400">
                    Conqify also has “{p.longerForms[0]}”. It cannot tell whether that is the same {p.name}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Block>

        {/* §24. Context, never priority — and only where the existing relevance
            system already grounded the rule in an item's own words. No generic
            Rules wallpaper. */}
        <Block label="From your Personal Code" show={ctx.rules.length > 0}>
          <ul className="flex flex-col gap-1">
            {ctx.rules.map((r) => (
              <li key={r} data-goal-rule className="text-[11px] text-zinc-500">“{r}”</li>
            ))}
          </ul>
        </Block>
      </Section>
    </div>
  );
}
