"use client";

/**
 * Projects index (LIFEOS-031, Feature 2).
 *
 * Lists projects — concrete work that belongs to a goal and lives in a workspace
 * — and creates new ones (optionally under a goal / workspace). Each card shows
 * derived progress, milestones, status, and its goal. Deterministic; no AI.
 */

import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createProject, useStore } from "@/lib/mvpStore";
import { listProjects, projectHref, PROJECT_STATUS_LABEL } from "@/lib/execution/projects";
import { findGoal, listGoals } from "@/lib/execution/goals";
import { projectProgress, milestoneCounts } from "@/lib/execution/progress";
import { activeWorkspaces } from "@/lib/workspaces/workspace";
import SyncStatus from "@/components/SyncStatus";
import { ProgressBar, Pill } from "@/components/execution/Bits";

function ProjectsHome() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [title, setTitle] = useState("");
  const [goalId, setGoalId] = useState(params.get("goal") ?? "");
  const [workspaceId, setWorkspaceId] = useState("");

  const projects = useMemo(() => listProjects(state), [state]);
  const goals = useMemo(() => listGoals(state), [state]);
  const workspaces = useMemo(() => activeWorkspaces(state), [state]);

  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening your projects…</p></main>;

  const create = () => {
    const t = title.trim();
    if (!t) return;
    const pid = createProject({ title: t, goalId: goalId || undefined, workspaceId: workspaceId || undefined });
    setTitle(""); setShowNew(false);
    router.push(projectHref(pid));
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">Concrete work toward a goal. A project holds milestones, lives in a workspace, and gathers the sessions and documents that advance it.</p>
          <div className="mt-1.5"><SyncStatus /></div>
        </div>
        <button type="button" onClick={() => setShowNew((v) => !v)} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">＋ New project</button>
      </header>

      {showNew && (
        <section className="mb-6 rounded-xl border border-black/10 p-4 dark:border-white/12">
          <div className="flex flex-col gap-3">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              placeholder="Project (e.g. Chapter 1 draft, MVP launch)" aria-label="Project title"
              className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
            <div className="flex flex-wrap gap-2">
              <select value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Goal" className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs dark:border-white/12 dark:bg-black/20">
                <option value="">No goal</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label="Workspace" className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs dark:border-white/12 dark:bg-black/20">
                <option value="">No workspace</option>
                {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Cancel</button>
              <button type="button" onClick={create} disabled={!title.trim()} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Create</button>
            </div>
          </div>
        </section>
      )}

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Turn an intention into real work.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">A project is a body of related work — it holds milestones and the next actions that move it forward. Create one, then break it into actions you can actually do.</p>
          {!showNew && <button type="button" onClick={() => setShowNew(true)} className="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Create your first project</button>}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => {
            const pct = projectProgress(p);
            const mc = milestoneCounts(p);
            const goal = p.goalId ? findGoal(state, p.goalId) : undefined;
            return (
              <li key={p.id}>
                <Link href={projectHref(p.id)} data-project-card={p.id} className="block h-full rounded-xl border border-black/10 p-4 transition-colors hover:border-black/25 dark:border-white/12 dark:hover:border-white/25">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-medium tracking-tight">{p.title}</h2>
                    <Pill>{PROJECT_STATUS_LABEL[p.status]}</Pill>
                  </div>
                  {goal && <p className="mt-0.5 text-[11px] text-zinc-400">◎ {goal.title}</p>}
                  <div className="mt-3"><ProgressBar percent={pct} /></div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400">
                    <span>{pct}%</span>
                    <span>{mc.done}/{mc.total} milestones</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function ProjectsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" />}><ProjectsHome /></Suspense>;
}
