"use client";

/**
 * Project actions section (LIFEOS-036, Feature 13). A compact panel on the
 * project dashboard: action counts by bucket (open / in progress / completed /
 * blocked), a grouping by milestone, and a quick create pre-filled with the
 * project hierarchy. Milestone/project completion stays manual and separate.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { projectActionSummary, actionsForProject } from "@/lib/actions/relationships";
import { STATUS_LABEL } from "@/lib/actions/status";
import { inheritFromProject } from "@/lib/actions/action";
import ActionCreator from "@/components/actions/ActionCreator";

export default function ProjectActions({ projectId }: { projectId: string }) {
  const state = useStore();
  const [creating, setCreating] = useState(false);
  const summary = useMemo(() => projectActionSummary(state, projectId), [state, projectId]);
  const actions = useMemo(() => actionsForProject(state, projectId), [state, projectId]);

  const chips: { label: string; n: number }[] = [
    { label: "Open", n: summary.open }, { label: "In progress", n: summary.inProgress },
    { label: "Waiting", n: summary.waiting }, { label: "Completed", n: summary.completed }, { label: "Blocked", n: summary.blocked },
  ];

  return (
    <section className="mt-8" aria-label="Project actions" data-project-actions>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Next actions</h2>
        <button type="button" onClick={() => setCreating((v) => !v)} className="text-[11px] text-sky-600 dark:text-sky-400">{creating ? "Close" : "+ Add action"}</button>
      </div>

      {creating && (
        <div className="mb-3 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
          <ActionCreator prefill={inheritFromProject(state, projectId)} sourceLabel="this project" onCreated={() => setCreating(false)} onCancel={() => setCreating(false)} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {chips.map((c) => <span key={c.label} className="rounded-full border border-black/[.10] px-2 py-0.5 text-zinc-500 dark:border-white/[.12]">{c.label}: {c.n}</span>)}
      </div>

      {actions.length === 0 ? <p className="text-xs text-zinc-400">No actions for this project yet.</p> : (
        <ul className="flex flex-col gap-1">
          {actions.slice(0, 12).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <Link href={`/actions/${a.id}`} className={`truncate hover:underline ${a.status === "completed" || a.status === "cancelled" ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-200"}`}>{a.title || "(untitled action)"}</Link>
              <span className="shrink-0 text-[10px] text-zinc-400">{STATUS_LABEL[a.status]}{a.milestoneId ? " · milestone" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
