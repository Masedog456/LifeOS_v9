"use client";

/**
 * Goals index (LIFEOS-031, Feature 1).
 *
 * Lists the user's goals — the highest-level "what am I trying to accomplish?"
 * objects — and creates new ones. Each card shows derived progress, project
 * count, status, and priority, and links to the goal dashboard. Deterministic
 * projection over the store; no AI.
 */

import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createGoal, useStore } from "@/lib/mvpStore";
import { listGoals, goalHref, goalProjects, GOAL_STATUS_LABEL, PRIORITY_LABEL } from "@/lib/execution/goals";
import { goalProgress } from "@/lib/execution/progress";
import SyncStatus from "@/components/SyncStatus";
import { ProgressBar, Pill } from "@/components/execution/Bits";

function GoalsHome() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const goals = useMemo(() => listGoals(state), [state]);

  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening your goals…</p></main>;

  const create = () => {
    const t = title.trim();
    if (!t) return;
    const gid = createGoal({ title: t, description: description.trim() });
    setTitle(""); setDescription(""); setShowNew(false);
    router.push(goalHref(gid));
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">The highest level of intention — what you are trying to accomplish. Goals hold projects; projects hold milestones; sessions and knowledge support them. Progress is derived from what you actually complete.</p>
          <div className="mt-1.5"><SyncStatus /></div>
        </div>
        <button type="button" onClick={() => setShowNew((v) => !v)} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">＋ New goal</button>
      </header>

      {showNew && (
        <section className="mb-6 rounded-xl border border-black/10 p-4 dark:border-white/12">
          <div className="flex flex-col gap-3">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              placeholder="Goal (e.g. Finish Philosophy Thesis, Grow Pool Business)" aria-label="Goal title"
              className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does accomplishing this look like? (optional)" aria-label="Goal description" rows={2}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Cancel</button>
              <button type="button" onClick={create} disabled={!title.trim()} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Create</button>
            </div>
          </div>
        </section>
      )}

      {goals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Start with something you want to accomplish.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">A goal is the highest level of intention. It holds your projects, and progress is measured by what you actually finish — nothing here is scored or nagged.</p>
          {!showNew && <button type="button" onClick={() => setShowNew(true)} className="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Create your first goal</button>}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => {
            const pct = goalProgress(g, state.projects);
            const n = goalProjects(state, g.id).length;
            return (
              <li key={g.id}>
                <Link href={goalHref(g.id)} data-goal-card={g.id} className="block h-full rounded-xl border border-black/10 p-4 transition-colors hover:border-black/25 dark:border-white/12 dark:hover:border-white/25">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-medium tracking-tight">{g.title}</h2>
                    <Pill>{PRIORITY_LABEL[g.priority]}</Pill>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{g.description || `${n} project${n === 1 ? "" : "s"}`}</p>
                  <div className="mt-3"><ProgressBar percent={pct} /></div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400">
                    <span>{GOAL_STATUS_LABEL[g.status]}</span>
                    <span>{pct}% · {n} project{n === 1 ? "" : "s"}</span>
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

export default function GoalsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" />}><GoalsHome /></Suspense>;
}
