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
import {
  GOAL_HORIZONS, GOAL_HORIZON_GUIDANCE, GOAL_HORIZON_LABEL, GOAL_HORIZON_PROMPT,
  groupGoalsByHorizon, isGoalHorizon,
} from "@/lib/execution/horizons";
import type { GoalHorizon } from "@/types/mvp";
import SyncStatus from "@/components/SyncStatus";
import { ProgressOrNot, Pill } from "@/components/execution/Bits";

function GoalsHome() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [horizon, setHorizon] = useState<GoalHorizon | "">("");

  const goals = useMemo(() => listGoals(state), [state]);
  // Grouped for display only — `listGoals` still decides the order inside each
  // group, and horizon never reorders anything.
  const groups = useMemo(() => groupGoalsByHorizon(goals).filter((g) => g.goals.length > 0), [goals]);
  /**
   * Horizons with nothing at them — the fact the page exists to show.
   *
   * Only once the user has actually placed a goal somewhere. Listing five empty
   * horizons to someone who has never used the feature would be a product
   * telling a person their life is empty, which is not a fact about their data.
   */
  const emptyHorizons = useMemo(() => {
    const used = new Set(goals.map((g) => g.horizon).filter(isGoalHorizon));
    return used.size === 0 ? [] : GOAL_HORIZONS.filter((h) => !used.has(h));
  }, [goals]);

  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening your goals…</p></main>;

  const create = () => {
    const t = title.trim();
    if (!t) return;
    const gid = createGoal({ title: t, description: description.trim(), horizon: horizon || undefined });
    setTitle(""); setDescription(""); setHorizon(""); setShowNew(false);
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
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="new-goal-horizon" className="text-xs text-zinc-500">{GOAL_HORIZON_PROMPT}</label>
              <select id="new-goal-horizon" data-new-goal-horizon value={horizon} onChange={(e) => setHorizon(e.target.value as GoalHorizon | "")}
                className="rounded-lg border border-black/10 px-2 py-1 text-xs dark:border-white/12 dark:bg-black/20">
                <option value="">Not sure yet</option>
                {GOAL_HORIZONS.map((h) => <option key={h} value={h}>{GOAL_HORIZON_LABEL[h]}</option>)}
              </select>
              {horizon && <span className="text-[11px] text-zinc-400">{GOAL_HORIZON_GUIDANCE[horizon]}</span>}
            </div>
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
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.horizon ?? "unset"} data-horizon-group={group.horizon ?? "unset"}>
              <div className="mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{group.label}</h2>
                {group.horizon && <p className="mt-0.5 text-[11px] text-zinc-400">{GOAL_HORIZON_GUIDANCE[group.horizon]}</p>}
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.goals.map((g) => {
                  const pct = goalProgress(g, state.projects);
                  const n = goalProjects(state, g.id).length;
                  return (
                    <li key={g.id}>
                      <Link href={goalHref(g.id)} data-goal-card={g.id} className="block h-full rounded-xl border border-black/10 p-4 transition-colors hover:border-black/25 dark:border-white/12 dark:hover:border-white/25">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-medium tracking-tight">{g.title}</h3>
                          <Pill>{PRIORITY_LABEL[g.priority]}</Pill>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{g.description || `${n} project${n === 1 ? "" : "s"}`}</p>
                        <div className="mt-3"><ProgressOrNot percent={pct} none="Not measured yet." /></div>
                        <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400">
                          <span>{GOAL_STATUS_LABEL[g.status]}</span>
                          <span>{pct === null ? "" : `${pct}% · `}{n} project{n === 1 ? "" : "s"}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {/* The absence, stated once and without a verdict attached. */}
          {emptyHorizons.length > 0 && (
            <p className="text-xs text-zinc-400" data-empty-horizons>
              No goals at: {emptyHorizons.map((h) => GOAL_HORIZON_LABEL[h]).join(", ")}.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

export default function GoalsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" />}><GoalsHome /></Suspense>;
}
