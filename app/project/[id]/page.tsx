"use client";

/**
 * Project dashboard (LIFEOS-031, Feature 5).
 *
 * One deterministic projection of a project: overview + derived progress, its
 * workspace and goal, milestones (add / toggle done manually / remove), recent
 * sessions, related entities and documents, reading, an activity timeline, and
 * notes. You can start a thinking session attributed to this project. No AI, no
 * auto-progress — milestone completion is a manual act.
 */

import { use, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addMilestone, addProjectRelated, deleteProject, removeMilestone, removeProjectRelated,
  setProjectProgress, startProjectSession, toggleMilestone, updateProject, useStore,
} from "@/lib/mvpStore";
import { makeEntityContext, ENTITY_LABEL, type Entity, type EntityRef } from "@/lib/entities/entity";
import ProjectActions from "@/components/actions/ProjectActions";
import EntityLink from "@/components/entity/EntityLink";
import { findProject, PROJECT_STATUS_LABEL } from "@/lib/execution/projects";
import { projectDashboard } from "@/lib/execution/dashboard";
import { sortedMilestones } from "@/lib/execution/milestones";
import { goalHref } from "@/lib/execution/goals";
import { workspaceHref } from "@/lib/workspaces/workspace";
import { SESSION_TYPES, SESSION_TYPE_ICON, SESSION_TYPE_LABEL, formatDuration, sessionOutputs, sessionDuration } from "@/lib/workspaces/sessions";
import { buildIndex, searchFlat } from "@/lib/command/search";
import type { ExecProjectStatus, ExecutionPriority, SessionType } from "@/types/mvp";
import SyncStatus from "@/components/SyncStatus";
import { ProgressBar, Panel, Empty } from "@/components/execution/Bits";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { buildImpact } from "@/lib/ux/confirmations";
import { toast } from "@/lib/ux/feedback";

const STATUSES: ExecProjectStatus[] = ["planned", "active", "paused", "completed", "abandoned"];
const PRIORITIES: ExecutionPriority[] = ["high", "medium", "low"];

function ProjectDashboard({ id }: { id: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [relQuery, setRelQuery] = useState("");
  const [showRel, setShowRel] = useState(false);

  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const project = findProject(state, id);
  const index = useMemo(() => buildIndex(state), [state]);
  const dash = useMemo(() => (project ? projectDashboard(ctx, project) : null), [ctx, project]);

  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening project…</p></main>;
  if (!project || !dash) {
    return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-500">This project doesn’t exist.</p><Link href="/projects" className="mt-2 inline-block text-sm underline">← All projects</Link></main>;
  }

  const relatedKeys = new Set([...project.relatedEntities, ...project.relatedDocuments].map((r) => `${r.kind}:${r.id}`));
  const relResults = relQuery.trim()
    ? searchFlat(index, relQuery, 15).filter((r) => !relatedKeys.has(`${r.entry.kind}:${r.entry.id}`) && !["goal", "project", "milestone"].includes(r.entry.kind))
    : [];
  const startSession = (type: SessionType) => {
    const sid = startProjectSession(project.id, type, project.title);
    if (!sid) toast({ kind: "warning", message: "Assign a workspace first", detail: "Sessions run inside a workspace — set one on this project." });
  };
  const onToggleMilestone = (mid: string, title: string, wasDone: boolean) => {
    toggleMilestone(project.id, mid);
    if (!wasDone) toast({ kind: "success", message: "Milestone completed", detail: title, dedupeKey: `milestone:${mid}` });
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-2"><Link href="/projects" className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">← Projects</Link></div>
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
            {project.description && <p className="mt-1 max-w-xl text-sm text-zinc-500">{project.description}</p>}
            <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-zinc-400">
              {dash.goal && <Link href={goalHref(dash.goal.id)} className="hover:underline">◎ {dash.goal.title}</Link>}
              {dash.workspace && <Link href={workspaceHref(dash.workspace.id)} className="hover:underline">◲ {dash.workspace.title}</Link>}
            </p>
          </div>
          <div className="text-right text-xs text-zinc-400"><SyncStatus /></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><ProgressBar percent={dash.progress} label="Project progress" /></div>
          <span className="text-sm font-medium tabular-nums" data-project-progress={dash.progress}>{dash.progress}%</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Status
            <select value={project.status} onChange={(e) => updateProject(project.id, { status: e.target.value as ExecProjectStatus })} className="rounded-lg border border-black/10 px-2 py-1 dark:border-white/12 dark:bg-black/20">
              {STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Priority
            <select value={project.priority} onChange={(e) => updateProject(project.id, { priority: e.target.value as ExecutionPriority })} className="rounded-lg border border-black/10 px-2 py-1 dark:border-white/12 dark:bg-black/20">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Manual %
            <input type="number" min={0} max={100} value={project.manualProgress ?? ""} placeholder="auto" aria-label="Manual progress override"
              onChange={(e) => setProjectProgress(project.id, e.target.value === "" ? undefined : Number(e.target.value))}
              className="w-16 rounded-lg border border-black/10 px-2 py-1 dark:border-white/12 dark:bg-black/20" />
          </label>
        </div>
        {/* Start a session attributed to this project (Feature 6) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">Start session:</span>
          {SESSION_TYPES.slice(0, 5).map((t) => (
            <button key={t} type="button" data-session-type={t} onClick={() => startSession(t)}
              className="rounded-full border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">{SESSION_TYPE_ICON[t]} {SESSION_TYPE_LABEL[t].replace(" Session", "")}</button>
          ))}
        </div>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <Panel title="Milestones">
          <ul className="space-y-1.5">
            {project.milestones.length === 0 && <li className="text-xs text-zinc-400">No milestones yet.</li>}
            {sortedMilestones(project).map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={m.status === "done"} onChange={() => onToggleMilestone(m.id, m.title, m.status === "done")} aria-label={`Milestone: ${m.title}`} className="mt-1" />
                <span className={m.status === "done" ? "flex-1 text-zinc-400 line-through" : "flex-1"}>{m.title}{m.targetDate && <span className="ml-1 text-[10px] text-zinc-400">· {m.targetDate}</span>}</span>
                <button type="button" onClick={() => removeMilestone(project.id, m.id)} aria-label="Remove milestone" className="text-xs text-zinc-300 hover:text-red-500">✕</button>
              </li>
            ))}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (milestoneTitle.trim()) { addMilestone(project.id, milestoneTitle); setMilestoneTitle(""); } }}>
            <input value={milestoneTitle} onChange={(e) => setMilestoneTitle(e.target.value)} placeholder="Add a milestone…" aria-label="Add a milestone"
              className="flex-1 rounded-lg border border-black/10 px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
            <button type="submit" className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Add</button>
          </form>
        </Panel>

        <Panel title="Related work" action={<button type="button" onClick={() => setShowRel((v) => !v)} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">{showRel ? "Done" : "＋ Add"}</button>}>
          {showRel && (
            <div className="mb-2">
              <input value={relQuery} onChange={(e) => setRelQuery(e.target.value)} placeholder="Search work to relate…" aria-label="Add related work"
                className="w-full rounded-lg border border-black/10 px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
              {relQuery.trim() && (
                <ul className="mt-1 max-h-48 divide-y divide-black/[.06] overflow-auto rounded-lg border border-black/10 dark:divide-white/[.06] dark:border-white/12">
                  {relResults.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-zinc-400">No matches.</li> :
                    relResults.map((r) => (
                      <li key={`${r.entry.kind}:${r.entry.id}`} className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs">
                        <span className="truncate">{r.entry.title} <span className="text-zinc-400">· {ENTITY_LABEL[r.entry.kind] ?? r.entry.kind}</span></span>
                        <button type="button" aria-label={`Relate ${r.entry.title}`} onClick={() => addProjectRelated(project.id, r.entry.kind, r.entry.id)} className="shrink-0 rounded-full border border-black/10 px-2 py-0.5 hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Add</button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
          {dash.recentEntities.length === 0 ? <Empty>No related work yet.</Empty> : (
            <ul className="space-y-1">
              {dash.recentEntities.map((r: EntityRef) => (
                <li key={`${r.kind}:${r.id}`} className="flex items-center justify-between gap-2 text-sm">
                  <EntityLink kind={r.kind} id={r.id} className="truncate text-left hover:underline">{r.title}</EntityLink>
                  <button type="button" onClick={() => removeProjectRelated(project.id, r.kind, r.id)} aria-label="Remove related" className="shrink-0 text-xs text-zinc-300 hover:text-red-500">✕</button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Reading">
          {dash.reading.length === 0 ? <Empty>No documents related.</Empty> : (
            <ul className="space-y-1.5">{dash.reading.map((d) => (
              <li key={d.ref.id} className="text-sm">
                <div className="flex items-center justify-between gap-2"><EntityLink kind="document" id={d.ref.id} className="truncate text-left hover:underline">{d.ref.title}</EntityLink><span className="shrink-0 text-[10px] text-zinc-400">{d.percent}%</span></div>
                <div className="mt-1"><ProgressBar percent={d.percent} /></div>
              </li>))}</ul>
          )}
        </Panel>

        <Panel title="Documents"><EntityRows entities={dash.recentDocuments} empty="No documents yet." /></Panel>
      </div>

      <section className="mt-6">
        <label htmlFor="project-notes" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">Notes</label>
        <textarea id="project-notes" value={project.notes} onChange={(e) => updateProject(project.id, { notes: e.target.value })} rows={3} placeholder="Working notes for this project…"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
      </section>

      <ProjectActions projectId={project.id} />

      <SessionTimeline groups={dash.sessions} />

      <div className="mt-8 border-t border-black/[.06] pt-4 dark:border-white/[.08]">
        <button type="button" onClick={() => requestConfirm({ impact: buildImpact(state, "project", project.id), onConfirm: () => { deleteProject(project.id); toast({ kind: "success", message: "Project deleted" }); router.push("/projects"); } })} className="text-xs text-zinc-400 hover:text-red-500">Delete project</button>
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

const BUCKETS: { key: "today" | "yesterday" | "thisWeek" | "older"; label: string }[] = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "thisWeek", label: "This Week" }, { key: "older", label: "Past Sessions" },
];
function SessionTimeline({ groups }: { groups: import("@/lib/workspaces/sessions").SessionGroups }) {
  const any = BUCKETS.some((b) => groups[b.key].length > 0);
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold tracking-tight">Activity timeline</h2>
      {!any ? <Empty>No sessions have contributed to this project yet.</Empty> : (
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

export default function ProjectDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProjectDashboard id={id} />;
}
