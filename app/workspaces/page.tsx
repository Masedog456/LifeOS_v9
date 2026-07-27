"use client";

/**
 * Workspaces index (LIFEOS-030, Feature 1).
 *
 * Lists the user's workspaces — first-class groupings of existing work — and
 * creates new ones. Each card summarizes members, open goals, and session
 * activity, and links to the workspace dashboard. Deterministic projection over
 * the store; no AI, no recommendations.
 */

import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createWorkspace, useStore } from "@/lib/mvpStore";
import { makeEntityContext } from "@/lib/entities/entity";
import { activeWorkspaces, workspaceHref, workspaceSummary, memberBreakdown } from "@/lib/workspaces/workspace";
import { sessionsForWorkspace, activeSession } from "@/lib/workspaces/sessions";
import { ENTITY_LABEL } from "@/lib/entities/entity";
import SyncStatus from "@/components/SyncStatus";

function WorkspacesHome() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const workspaces = useMemo(() => activeWorkspaces(state), [state]);
  const active = activeSession(state);

  if (!mounted) {
    return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening your workspaces…</p></main>;
  }

  const create = () => {
    const n = name.trim();
    if (!n) return;
    const wsId = createWorkspace({ name: n, description: description.trim() });
    setName(""); setDescription(""); setShowNew(false);
    router.push(workspaceHref(wsId));
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Group existing work — beliefs, documents, decisions, dialogues — around a project or life area, and begin focused thinking sessions inside it. Nothing is duplicated; a workspace only references what you already have.
          </p>
          <div className="mt-1.5"><SyncStatus /></div>
        </div>
        <button type="button" onClick={() => setShowNew((v) => !v)} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">
          ＋ New workspace
        </button>
      </header>

      {showNew && (
        <section className="mb-6 rounded-xl border border-black/10 p-4 dark:border-white/12">
          <div className="flex flex-col gap-3">
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              placeholder="Workspace name (e.g. Philosophy Thesis, Pool Business)"
              aria-label="Workspace name"
              className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20"
            />
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this workspace for? (optional)"
              aria-label="Workspace description" rows={2}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Cancel</button>
              <button type="button" onClick={create} disabled={!name.trim()} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Create</button>
            </div>
          </div>
        </section>
      )}

      {workspaces.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
          <p className="text-sm text-zinc-500">No workspaces yet.</p>
          <p className="mt-1 text-xs text-zinc-400">Create one to answer “what am I working on right now?” — then start a thinking session inside it.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => {
            const sessions = sessionsForWorkspace(state, w.id);
            const isActive = active?.workspaceId === w.id;
            const breakdown = memberBreakdown(ctx, w).slice(0, 3);
            return (
              <li key={w.id}>
                <Link
                  href={workspaceHref(w.id)}
                  data-workspace-card={w.id}
                  className="block h-full rounded-xl border border-black/10 p-4 transition-colors hover:border-black/25 dark:border-white/12 dark:hover:border-white/25"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-medium tracking-tight">{w.name}</h2>
                    {isActive && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">● active</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{workspaceSummary(ctx, w)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {breakdown.map((b) => (
                      <span key={b.kind} className="rounded-full bg-black/[.04] px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.06]">
                        {b.count} {ENTITY_LABEL[b.kind] ?? b.kind}
                      </span>
                    ))}
                    {sessions.length > 0 && (
                      <span className="rounded-full bg-black/[.04] px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.06]">
                        {sessions.length} session{sessions.length === 1 ? "" : "s"}
                      </span>
                    )}
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

export default function WorkspacesPage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" />}>
      <WorkspacesHome />
    </Suspense>
  );
}
