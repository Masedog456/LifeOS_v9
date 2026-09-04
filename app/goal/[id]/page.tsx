"use client";

/**
 * The goal page (LIFEOS-031, Feature 4 · LIFEOS-078 · LIFEOS-088).
 *
 * One page per goal, and only one (§27): where it is headed, what is carrying
 * it, what is stuck, what moved, and the context around it. `GoalCommandView`
 * holds the five sections; the LIFEOS-031 knowledge panels stay below it,
 * because the knowledge side is still true — it was simply never the answer to
 * "what is happening with this goal?".
 *
 * ## What LIFEOS-088 removed
 *
 * The Projects panel printed `projectProgress(p)` per row, so a project holding
 * eleven actions was drawn at "0%" with a bar at zero. That number is the
 * absence of evidence — `projectProgressMeasurable` already said so — and it is
 * gone. The command view carries the projects with counts, and a percentage
 * only where one rests on something countable.
 *
 * `GoalDirection` (078) is gone too, folded into the command view's Overview
 * and Context sections so the same fact is not stated twice on one screen. Its
 * "Replaced by…" control survives here as `RecordReplacement`.
 *
 * No AI, no auto-progress, no mission statement.
 */

import { use, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteGoal, linkGoalKnowledge, unlinkGoalKnowledge, replaceGoal, setGoalHorizon,
  setGoalProgress, updateGoal, useStore,
} from "@/lib/mvpStore";
import { makeEntityContext, ENTITY_LABEL, type Entity } from "@/lib/entities/entity";
import EntityLink from "@/components/entity/EntityLink";
import { findGoal, goalKnowledge, GOAL_STATUS_LABEL, PRIORITY_LABEL } from "@/lib/execution/goals";
import { goalDashboard } from "@/lib/execution/dashboard";
import { SESSION_TYPE_ICON, SESSION_TYPE_LABEL, formatDuration, sessionOutputs, sessionDuration } from "@/lib/workspaces/sessions";
import { buildIndex, searchFlat } from "@/lib/command/search";
import {
  GOAL_HORIZONS, GOAL_HORIZON_GUIDANCE, GOAL_HORIZON_LABEL, GOAL_HORIZON_PROMPT,
} from "@/lib/execution/horizons";
import { GOAL_LIFECYCLE_LABEL, GOAL_STATUS_CHOICES } from "@/lib/execution/lifecycle";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildGoalContext } from "@/lib/execution/goal-context";
import { todayKey } from "@/lib/reviews/dates";
import GoalCommandView from "@/components/execution/GoalCommandView";
import type { GoalStatus, ExecutionPriority, GoalHorizon } from "@/types/mvp";
import SyncStatus from "@/components/SyncStatus";
import { ProgressBar, ProgressOrNot, Panel, Empty } from "@/components/execution/Bits";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { buildImpact } from "@/lib/ux/confirmations";
import { toast } from "@/lib/ux/feedback";

/**
 * The statuses a person may choose here.
 *
 * `someday` is deprecated (LIFEOS-078) — a `life` horizon says the same thing
 * better — so it is offered only to goals that already hold it, rather than
 * being rewritten behind the user's back. `replaced` is never chosen: it is
 * what happens when a successor is named, and it needs one to point at.
 */
function statusChoices(current: GoalStatus): GoalStatus[] {
  const base = [...GOAL_STATUS_CHOICES];
  return base.includes(current) ? base : [...base, current];
}
const PRIORITIES: ExecutionPriority[] = ["high", "medium", "low"];

function GoalDashboard({ id }: { id: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const [linkQuery, setLinkQuery] = useState("");
  const [showLink, setShowLink] = useState(false);

  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const goal = findGoal(state, id);
  const index = useMemo(() => buildIndex(state), [state]);
  const dash = useMemo(() => (goal ? goalDashboard(ctx, goal) : null), [ctx, goal]);
  const today = todayKey();
  const ix = useMemo(() => buildTodayIndexes(state, today), [state, today]);
  const command = useMemo(() => buildGoalContext(state, id, ix, today), [state, id, ix, today]);

  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening goal…</p></main>;
  if (!goal || !dash || !command) {
    return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-500">This goal doesn’t exist.</p><Link href="/goals" className="mt-2 inline-block text-sm underline">← All goals</Link></main>;
  }

  const linkedKeys = new Set(goal.linkedKnowledge.map((r) => `${r.kind}:${r.id}`));
  const linkResults = linkQuery.trim()
    ? searchFlat(index, linkQuery, 15).filter((r) => !linkedKeys.has(`${r.entry.kind}:${r.entry.id}`) && !["goal", "project", "milestone"].includes(r.entry.kind))
    : [];
  const linked = goalKnowledge(ctx, goal);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-2"><Link href="/goals" className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">← Goals</Link></div>
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{goal.title}</h1>
            {goal.description && <p className="mt-1 max-w-xl text-sm text-zinc-500">{goal.description}</p>}
          </div>
          <div className="text-right text-xs text-zinc-400"><SyncStatus /></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><ProgressOrNot percent={dash.progress} label="Goal progress" /></div>
          {dash.progress !== null && <span className="text-sm font-medium tabular-nums" data-goal-progress={dash.progress}>{dash.progress}%</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Status
            <select value={goal.status} disabled={goal.status === "replaced"}
              onChange={(e) => updateGoal(goal.id, { status: e.target.value as GoalStatus })}
              className="rounded-lg border border-black/10 px-2 py-1 disabled:opacity-60 dark:border-white/12 dark:bg-black/20">
              {statusChoices(goal.status).map((s) => <option key={s} value={s}>{GOAL_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1" title={GOAL_HORIZON_PROMPT}>Horizon
            <select value={goal.horizon ?? ""} data-goal-horizon={goal.horizon ?? ""}
              onChange={(e) => setGoalHorizon(goal.id, (e.target.value || undefined) as GoalHorizon | undefined)}
              className="rounded-lg border border-black/10 px-2 py-1 dark:border-white/12 dark:bg-black/20">
              <option value="">Not set</option>
              {GOAL_HORIZONS.map((h) => <option key={h} value={h}>{GOAL_HORIZON_LABEL[h]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Priority
            <select value={goal.priority} onChange={(e) => updateGoal(goal.id, { priority: e.target.value as ExecutionPriority })} className="rounded-lg border border-black/10 px-2 py-1 dark:border-white/12 dark:bg-black/20">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Manual %
            <input type="number" min={0} max={100} value={goal.manualProgress ?? ""} placeholder="auto" aria-label="Manual progress override"
              onChange={(e) => setGoalProgress(goal.id, e.target.value === "" ? undefined : Number(e.target.value))}
              className="w-16 rounded-lg border border-black/10 px-2 py-1 dark:border-white/12 dark:bg-black/20" />
          </label>
          {/* Counts only, and a milestone count only when milestones exist —
              "0/0 milestones" is not a measurement of anything. */}
          <span className="text-zinc-400">
            {dash.overview.projectCounts.completed}/{dash.overview.projectCounts.total} projects
            {dash.overview.milestones.total > 0 && ` · ${dash.overview.milestones.done}/${dash.overview.milestones.total} milestones`}
          </span>
        </div>
        {goal.horizon && <p className="mt-2 text-[11px] text-zinc-400">{GOAL_HORIZON_GUIDANCE[goal.horizon]}</p>}
      </header>

      <GoalCommandView ctx={command} state={state} ix={ix} today={today} />

      <RecordReplacement goalId={goal.id} />

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Panel title="Next milestones">
          {dash.nextMilestones.length === 0 ? <Empty>No open milestones.</Empty> : (
            <ul className="space-y-1 text-sm">
              {dash.nextMilestones.map((m) => (
                <li key={m.ref.id} className="flex items-center justify-between gap-2">
                  <Link href={m.project.href} className="truncate hover:underline">◻ {m.ref.title}</Link>
                  {m.targetDate && <span className="shrink-0 text-[10px] text-zinc-400">{m.targetDate}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Linked knowledge" action={<button type="button" onClick={() => setShowLink((v) => !v)} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">{showLink ? "Done" : "＋ Link"}</button>}>
          {showLink && (
            <div className="mb-2">
              <input value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder="Search knowledge to link…" aria-label="Link knowledge"
                className="w-full rounded-lg border border-black/10 px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
              {linkQuery.trim() && (
                <ul className="mt-1 max-h-48 divide-y divide-black/[.06] overflow-auto rounded-lg border border-black/10 dark:divide-white/[.06] dark:border-white/12">
                  {linkResults.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-zinc-400">No matches.</li> :
                    linkResults.map((r) => (
                      <li key={`${r.entry.kind}:${r.entry.id}`} className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs">
                        <span className="truncate">{r.entry.title} <span className="text-zinc-400">· {ENTITY_LABEL[r.entry.kind] ?? r.entry.kind}</span></span>
                        <button type="button" aria-label={`Link ${r.entry.title}`} onClick={() => linkGoalKnowledge(goal.id, r.entry.kind, r.entry.id)} className="shrink-0 rounded-full border border-black/10 px-2 py-0.5 hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Link</button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
          {linked.length === 0 ? <Empty>Nothing linked yet.</Empty> : (
            <ul className="space-y-1 text-sm">
              {linked.map((r) => (
                <li key={`${r.kind}:${r.id}`} className="flex items-center justify-between gap-2">
                  <EntityLink kind={r.kind} id={r.id} className="truncate text-left hover:underline">{r.title}</EntityLink>
                  <button type="button" onClick={() => unlinkGoalKnowledge(goal.id, r.kind, r.id)} aria-label="Unlink" className="shrink-0 text-xs text-zinc-300 hover:text-red-500">✕</button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Reading"><ReadingList items={dash.recentReading} /></Panel>
        <Panel title="Recent captures"><EntityRows entities={dash.recentCaptures} empty="No captures yet." /></Panel>
        <Panel title="Recent decisions"><EntityRows entities={dash.recentDecisions} empty="No decisions yet." /></Panel>
        <Panel title="Knowledge graph"><RefRows refs={dash.neighbors} empty="No connected knowledge yet." /></Panel>
      </div>

      <section className="mt-6">
        <label htmlFor="goal-notes" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Notes</label>
        <textarea id="goal-notes" value={goal.notes} onChange={(e) => updateGoal(goal.id, { notes: e.target.value })} rows={3} placeholder="Working notes for this goal…"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
      </section>

      <SessionTimeline groups={dash.sessions} />

      <div className="mt-8 border-t border-black/[.06] pt-4 dark:border-white/[.08]">
        <button type="button" onClick={() => requestConfirm({ impact: buildImpact(state, "goal", goal.id), onConfirm: () => { deleteGoal(goal.id); toast({ kind: "success", message: "Goal deleted" }); router.push("/goals"); } })} className="text-xs text-zinc-400 hover:text-red-500">Delete goal</button>
      </div>
    </main>
  );
}

/**
 * Recording that this goal became another one (LIFEOS-078, kept by LIFEOS-088).
 *
 * The one thing on the old `GoalDirection` panel that was a CONTROL rather than
 * a restatement. The lineage, the history and the counts it also rendered now
 * live in the command view above, and printing them twice on one screen told the
 * reader nothing the first copy had not.
 *
 * Conqify never marks a goal achieved, let go, or replaced on its own — this is
 * always the user's act.
 */
function RecordReplacement({ goalId }: { goalId: string }) {
  const state = useStore();
  const goal = findGoal(state, goalId);
  const [replacing, setReplacing] = useState(false);
  const [successorId, setSuccessorId] = useState("");
  if (!goal) return null;

  // A goal cannot replace itself, and offering an already-replaced goal as the
  // successor would build a chain the store then refuses.
  const candidates = state.goals.filter((g) => g.id !== goal.id && g.status !== "replaced");

  const confirmReplace = () => {
    if (!successorId) return;
    const ok = replaceGoal(goal.id, successorId, undefined);
    toast(ok
      ? { kind: "success", message: "Recorded \u2014 this goal was replaced." }
      : { kind: "error", message: "That would loop back to this goal." });
    if (ok) { setReplacing(false); setSuccessorId(""); }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" data-goal-lifecycle={goal.status}>
      <span className="text-zinc-400">{GOAL_LIFECYCLE_LABEL[goal.status]}</span>
      {goal.status !== "replaced" && (
        <button type="button" onClick={() => setReplacing((v) => !v)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
          {replacing ? "Cancel" : "Replaced by\u2026"}
        </button>
      )}
      {replacing && (
        <>
          <select value={successorId} onChange={(e) => setSuccessorId(e.target.value)} aria-label="Replaced by which goal"
            className="rounded-lg border border-black/10 px-2 py-1 text-xs dark:border-white/12 dark:bg-black/20">
            <option value="">Choose the goal this became\u2026</option>
            {candidates.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
          <button type="button" onClick={confirmReplace} disabled={!successorId}
            className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Record</button>
        </>
      )}
    </div>
  );
}

function EntityRows({ entities, empty }: { entities: Entity[]; empty: string }) {
  if (entities.length === 0) return <Empty>{empty}</Empty>;
  return <ul className="space-y-1">{entities.map((e) => (
    <li key={`${e.ref.kind}:${e.ref.id}`} className="flex items-center justify-between gap-2 text-sm">
      <EntityLink kind={e.ref.kind} id={e.ref.id} className="truncate text-left hover:underline">{e.ref.title}</EntityLink>
      <span className="shrink-0 text-[10px] text-zinc-400">{ENTITY_LABEL[e.ref.kind] ?? e.ref.kind}</span>
    </li>))}</ul>;
}
function RefRows({ refs, empty }: { refs: { kind: string; id: string; title: string }[]; empty: string }) {
  if (refs.length === 0) return <Empty>{empty}</Empty>;
  return <ul className="space-y-1">{refs.map((r) => (
    <li key={`${r.kind}:${r.id}`} className="flex items-center justify-between gap-2 text-sm">
      <EntityLink kind={r.kind} id={r.id} className="truncate text-left hover:underline">{r.title}</EntityLink>
      <span className="shrink-0 text-[10px] text-zinc-400">{ENTITY_LABEL[r.kind] ?? r.kind}</span>
    </li>))}</ul>;
}
function ReadingList({ items }: { items: { ref: { kind: string; id: string; title: string }; percent: number }[] }) {
  if (items.length === 0) return <Empty>No documents linked.</Empty>;
  return <ul className="space-y-1.5">{items.map((d) => (
    <li key={d.ref.id} className="text-sm">
      <div className="flex items-center justify-between gap-2"><EntityLink kind="document" id={d.ref.id} className="truncate text-left hover:underline">{d.ref.title}</EntityLink><span className="shrink-0 text-[10px] text-zinc-400">{d.percent}%</span></div>
      <div className="mt-1"><ProgressBar percent={d.percent} /></div>
    </li>))}</ul>;
}

const BUCKETS: { key: "today" | "yesterday" | "thisWeek" | "older"; label: string }[] = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "thisWeek", label: "This Week" }, { key: "older", label: "Past Sessions" },
];
function SessionTimeline({ groups }: { groups: import("@/lib/workspaces/sessions").SessionGroups }) {
  const any = BUCKETS.some((b) => groups[b.key].length > 0);
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold tracking-tight">Session timeline</h2>
      {!any ? <Empty>No sessions have contributed to this goal yet.</Empty> : (
        <div className="space-y-4">
          {BUCKETS.map((b) => groups[b.key].length > 0 && (
            <div key={b.key}>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{b.label}</h3>
              <ul className="space-y-1.5">
                {groups[b.key].map((s) => {
                  const o = sessionOutputs(s);
                  return (
                    <li key={s.id} className="rounded-lg border border-black/[.06] px-3 py-2 text-sm dark:border-white/[.08]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{SESSION_TYPE_ICON[s.type]} {SESSION_TYPE_LABEL[s.type]}{s.goal ? ` — ${s.goal}` : ""}</span>
                        <span className="shrink-0 text-xs text-zinc-400">{formatDuration(sessionDuration(s))}{!s.endedAt ? " · active" : ""}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">{o.entitiesOpened} opened · {o.documentsRead} read · {o.capturesCreated} captured · {o.decisionsMade} decisions</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function GoalDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GoalDashboard id={id} />;
}
