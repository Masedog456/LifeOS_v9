"use client";

/**
 * Goal dashboard (LIFEOS-031, Feature 4).
 *
 * One deterministic projection of a goal: overall (derived) progress, its
 * projects and milestones, recent sessions / reading / captures / decisions, a
 * knowledge-graph frontier, and a session timeline. You can edit status,
 * priority, and notes, set a manual progress override, add projects, and link
 * knowledge. No AI, no auto-progress.
 */

import { use, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteGoal, linkGoalKnowledge, unlinkGoalKnowledge, setGoalProgress, updateGoal, useStore,
} from "@/lib/mvpStore";
import { makeEntityContext, ENTITY_LABEL, type Entity } from "@/lib/entities/entity";
import EntityLink from "@/components/entity/EntityLink";
import { findGoal, goalKnowledge, GOAL_STATUS_LABEL, PRIORITY_LABEL } from "@/lib/execution/goals";
import { goalDashboard } from "@/lib/execution/dashboard";
import { projectHref } from "@/lib/execution/projects";
import { SESSION_TYPE_ICON, SESSION_TYPE_LABEL, formatDuration, sessionOutputs, sessionDuration } from "@/lib/workspaces/sessions";
import { buildIndex, searchFlat } from "@/lib/command/search";
import type { GoalStatus, ExecutionPriority } from "@/types/mvp";
import SyncStatus from "@/components/SyncStatus";
import { ProgressBar, Panel, Empty } from "@/components/execution/Bits";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { buildImpact } from "@/lib/ux/confirmations";
import { toast } from "@/lib/ux/feedback";

const STATUSES: GoalStatus[] = ["active", "paused", "completed", "abandoned", "someday"];
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

  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening goal…</p></main>;
  if (!goal || !dash) {
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
          <div className="flex-1"><ProgressBar percent={dash.progress} label="Goal progress" /></div>
          <span className="text-sm font-medium tabular-nums" data-goal-progress={dash.progress}>{dash.progress}%</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Status
            <select value={goal.status} onChange={(e) => updateGoal(goal.id, { status: e.target.value as GoalStatus })} className="rounded-lg border border-black/10 px-2 py-1 dark:border-white/12 dark:bg-black/20">
              {STATUSES.map((s) => <option key={s} value={s}>{GOAL_STATUS_LABEL[s]}</option>)}
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
          <span className="text-zinc-400">{dash.overview.projectCounts.completed}/{dash.overview.projectCounts.total} projects · {dash.overview.milestones.done}/{dash.overview.milestones.total} milestones</span>
        </div>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <Panel title="Projects" action={<Link href={`/projects?new=1&goal=${goal.id}`} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">＋ New</Link>}>
          {dash.projects.length === 0 ? <Empty>No projects yet — add one to make this goal concrete.</Empty> : (
            <ul className="space-y-2">
              {dash.projects.map((p) => (
                <li key={p.ref.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <Link href={projectHref(p.ref.id)} className="truncate hover:underline">{p.ref.title}</Link>
                    <span className="shrink-0 text-[10px] text-zinc-400">{p.progress}% · {p.milestones.done}/{p.milestones.total}</span>
                  </div>
                  <div className="mt-1"><ProgressBar percent={p.progress} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

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
