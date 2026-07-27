"use client";

/**
 * Workspace dashboard (LIFEOS-030, Features 4, 6, 7, 8, 9).
 *
 * One deterministic projection of a workspace: overview, goals, pinned, recent
 * work / documents / decisions / captures, themes, reading progress, the session
 * timeline (Today / Yesterday / This Week / Past), and a graph-neighbor frontier.
 * You can start a thinking session in any mode, resume exactly where you left
 * off, search only inside this workspace, keep session notes, and add existing
 * entities to the workspace (grouping, never copying). No AI, no recommendations.
 */

import { use, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addToWorkspace, addWorkspaceGoal, appendSessionNote, endSession, removeFromWorkspace,
  removeWorkspaceGoal, startSession, toggleWorkspaceGoal, updateSessionNotes, useStore,
} from "@/lib/mvpStore";
import { makeEntityContext, entityRef, ENTITY_LABEL, type EntityRef } from "@/lib/entities/entity";
import EntityLink from "@/components/entity/EntityLink";
import { openInspector } from "@/lib/entities/inspector";
import { findWorkspace, workspaceHref } from "@/lib/workspaces/workspace";
import { workspaceDashboard } from "@/lib/workspaces/dashboard";
import {
  SESSION_TYPES, SESSION_TYPE_LABEL, SESSION_TYPE_ICON, activeSession, formatDuration,
  sessionOutputs, sessionDuration, sessionTypeLabel,
} from "@/lib/workspaces/sessions";
import { resumeTarget, hasResume } from "@/lib/workspaces/resume";
import { buildIndex } from "@/lib/command/search";
import { searchWorkspaceFlat } from "@/lib/workspaces/search";
import { searchFlat } from "@/lib/command/search";
import type { SessionType, WorkspaceSession } from "@/types/mvp";
import SyncStatus from "@/components/SyncStatus";

function Dashboard({ id }: { id: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [wsQuery, setWsQuery] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const ws = findWorkspace(state, id);
  const index = useMemo(() => buildIndex(state), [state]);
  const dash = useMemo(() => (ws ? workspaceDashboard(ctx, ws) : null), [ctx, ws]);
  const active = activeSession(state);
  const activeHere = active && active.workspaceId === id ? active : undefined;

  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening workspace…</p></main>;
  if (!ws || !dash) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <p className="text-sm text-zinc-500">This workspace doesn’t exist.</p>
        <Link href="/workspaces" className="mt-2 inline-block text-sm underline">← All workspaces</Link>
      </main>
    );
  }

  const start = (type: SessionType) => { startSession(ws.id, type, goal.trim()); setGoal(""); };
  const resume = () => {
    const target = resumeTarget(ctx, ws);
    if (target.search) setWsQuery(target.search);
    if (target.inspect) openInspector(target.inspect.kind, target.inspect.id);
    if (target.href && !target.inspect) router.push(target.href);
  };

  const wsResults = wsQuery.trim() ? searchWorkspaceFlat(index, state, ws, wsQuery, 30) : [];
  const memberKeys = new Set(ws.members.map((m) => `${m.kind}:${m.id}`));
  const addResults = addQuery.trim()
    ? searchFlat(index, addQuery, 20).filter((r) => !memberKeys.has(`${r.entry.kind}:${r.entry.id}`) && r.entry.kind !== "workspace")
    : [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-2"><Link href="/workspaces" className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">← Workspaces</Link></div>
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{ws.name}</h1>
            {ws.description && <p className="mt-1 max-w-xl text-sm text-zinc-500">{ws.description}</p>}
          </div>
          <div className="text-right text-xs text-zinc-400">
            <SyncStatus />
            <p className="mt-1">{dash.overview.memberCount} entities · {dash.overview.sessionCount} sessions · {formatDuration(dash.overview.totalMs)}</p>
          </div>
        </div>
      </header>

      {/* Session controls (Feature 2/3) + Resume (Feature 6) */}
      <section aria-label="Session" className="mb-6 rounded-xl border border-black/10 p-4 dark:border-white/12">
        {activeHere ? (
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{SESSION_TYPE_ICON[activeHere.type]} {SESSION_TYPE_LABEL[activeHere.type]} in progress{activeHere.goal ? ` — ${activeHere.goal}` : ""}</p>
              <button type="button" onClick={() => endSession(activeHere.id)} className="rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700">End session</button>
            </div>
            <SessionNotes session={activeHere} />
          </div>
        ) : active ? (
          <p className="text-sm text-zinc-500">
            A {sessionTypeLabel(active.type).toLowerCase()} is active in another workspace.{" "}
            <Link href={workspaceHref(active.workspaceId)} className="underline">Go to it</Link>{" "}or end it to start one here.
          </p>
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Start a session:</span>
              {SESSION_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => start(t)} data-session-type={t}
                  className="rounded-full border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">
                  {SESSION_TYPE_ICON[t]} {SESSION_TYPE_LABEL[t].replace(" Session", "")}
                </button>
              ))}
            </div>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Session goal (optional)" aria-label="Session goal"
              className="mt-2 w-full rounded-lg border border-black/10 px-3 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
          </div>
        )}
        {hasResume(ws) && !activeHere && (
          <button type="button" onClick={resume} data-resume className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">
            ▸ {resumeTarget(ctx, ws).label}
          </button>
        )}
      </section>

      {/* Workspace-scoped search (Feature 9) */}
      <section aria-label="Search this workspace" className="mb-6">
        <input value={wsQuery} onChange={(e) => setWsQuery(e.target.value)} placeholder="Search inside this workspace…" aria-label="Search inside this workspace"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
        {wsQuery.trim() && (
          <ul className="mt-2 divide-y divide-black/[.06] rounded-lg border border-black/10 dark:divide-white/[.06] dark:border-white/12">
            {wsResults.length === 0 ? (
              <li className="px-3 py-2 text-xs text-zinc-400">No matches inside this workspace.</li>
            ) : wsResults.map((r) => (
              <li key={`${r.entry.kind}:${r.entry.id}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <EntityLink kind={r.entry.kind} id={r.entry.id} className="truncate text-left hover:underline">{r.entry.title}</EntityLink>
                <span className="shrink-0 text-[10px] text-zinc-400">{ENTITY_LABEL[r.entry.kind] ?? r.entry.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Goals (Feature 4) */}
        <Panel title="Goals">
          <ul className="space-y-1.5">
            {ws.goals.length === 0 && <li className="text-xs text-zinc-400">No goals yet.</li>}
            {ws.goals.map((g) => (
              <li key={g.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={g.done} onChange={() => toggleWorkspaceGoal(ws.id, g.id)} aria-label={`Goal: ${g.text}`} className="mt-1" />
                <span className={g.done ? "flex-1 text-zinc-400 line-through" : "flex-1"}>{g.text}</span>
                <button type="button" onClick={() => removeWorkspaceGoal(ws.id, g.id)} aria-label="Remove goal" className="text-xs text-zinc-300 hover:text-red-500">✕</button>
              </li>
            ))}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newGoal.trim()) { addWorkspaceGoal(ws.id, newGoal); setNewGoal(""); } }}>
            <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="Add a goal…" aria-label="Add a goal"
              className="flex-1 rounded-lg border border-black/10 px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
            <button type="submit" className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Add</button>
          </form>
        </Panel>

        {/* Pinned (Feature 4) */}
        <Panel title="Pinned">
          <RefList refs={dash.pinned} empty="Nothing pinned yet." />
        </Panel>

        {/* Add existing work (Feature 1 — grouping) */}
        <Panel title="Members" action={<button type="button" onClick={() => setShowAdd((v) => !v)} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">{showAdd ? "Done" : "＋ Add"}</button>}>
          {showAdd && (
            <div className="mb-2">
              <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Search all your work to add…" aria-label="Add existing work"
                className="w-full rounded-lg border border-black/10 px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20" />
              {addQuery.trim() && (
                <ul className="mt-1 max-h-48 divide-y divide-black/[.06] overflow-auto rounded-lg border border-black/10 dark:divide-white/[.06] dark:border-white/12">
                  {addResults.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-zinc-400">No matches.</li> :
                    addResults.map((r) => (
                      <li key={`${r.entry.kind}:${r.entry.id}`} className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs">
                        <span className="truncate">{r.entry.title} <span className="text-zinc-400">· {ENTITY_LABEL[r.entry.kind] ?? r.entry.kind}</span></span>
                        <button type="button" aria-label={`Add ${r.entry.title} to workspace`} onClick={() => addToWorkspace(ws.id, r.entry.kind, r.entry.id)} className="shrink-0 rounded-full border border-black/10 px-2 py-0.5 hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Add</button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
          <ul className="space-y-1">
            {ws.members.length === 0 && <li className="text-xs text-zinc-400">No entities grouped yet — add existing work above.</li>}
            {ws.members.map((m) => (
              <li key={`${m.kind}:${m.id}`} className="flex items-center justify-between gap-2 text-sm">
                <EntityLink kind={m.kind} id={m.id} className="truncate text-left hover:underline">{entityRef(ctx, m.kind, m.id).title}</EntityLink>
                <button type="button" onClick={() => removeFromWorkspace(ws.id, m.kind, m.id)} aria-label="Remove from workspace" className="shrink-0 text-xs text-zinc-300 hover:text-red-500">✕</button>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Recent work (Feature 4/5) */}
        <Panel title="Recent work">
          <EntityRows entities={dash.recentWork} empty="No recent work in this workspace yet." />
        </Panel>

        {/* Reading (Feature 4) */}
        <Panel title="Reading">
          {dash.reading.length === 0 ? <Empty>No documents in this workspace.</Empty> : (
            <ul className="space-y-1.5">
              {dash.reading.map((d) => (
                <li key={d.ref.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <EntityLink kind="document" id={d.ref.id} className="truncate text-left hover:underline">{d.ref.title}</EntityLink>
                    <span className="shrink-0 text-[10px] text-zinc-400">{d.percent}%</span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
                    <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, d.percent)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Themes (Feature 4) */}
        <Panel title="Themes">
          <EntityRows entities={dash.themes} empty="No concepts in this workspace." />
        </Panel>

        {/* Recent decisions */}
        <Panel title="Recent decisions">
          <EntityRows entities={dash.recentDecisions} empty="No decisions here yet." />
        </Panel>

        {/* Recent captures */}
        <Panel title="Recent captures">
          <EntityRows entities={dash.recentCaptures} empty="No captures here yet." />
        </Panel>

        {/* Referenced by workspace (Feature 10 — graph frontier) */}
        <Panel title="Referenced by this workspace">
          {dash.referenced.length === 0 ? <Empty>Nothing linked out yet.</Empty> : (
            <ul className="space-y-1">
              {dash.referenced.slice(0, 10).map((r) => (
                <li key={`${r.ref.kind}:${r.ref.id}`} className="flex items-center justify-between gap-2 text-sm">
                  <EntityLink kind={r.ref.kind} id={r.ref.id} className="truncate text-left hover:underline">{r.ref.title}</EntityLink>
                  <span className="shrink-0 text-[10px] text-zinc-400">{r.relation}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Session timeline (Feature 7) */}
      <SessionTimeline groups={dash.sessions} />
    </main>
  );
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 p-4 dark:border-white/12">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-400">{children}</p>;
}

function RefList({ refs, empty }: { refs: EntityRef[]; empty: string }) {
  if (refs.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-1">
      {refs.map((r) => (
        <li key={`${r.kind}:${r.id}`} className="flex items-center justify-between gap-2 text-sm">
          <EntityLink kind={r.kind} id={r.id} className="truncate text-left hover:underline">{r.title}</EntityLink>
          <span className="shrink-0 text-[10px] text-zinc-400">{ENTITY_LABEL[r.kind] ?? r.kind}</span>
        </li>
      ))}
    </ul>
  );
}

function EntityRows({ entities, empty }: { entities: import("@/lib/entities/entity").Entity[]; empty: string }) {
  if (entities.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-1">
      {entities.map((e) => (
        <li key={`${e.ref.kind}:${e.ref.id}`} className="flex items-center justify-between gap-2 text-sm">
          <EntityLink kind={e.ref.kind} id={e.ref.id} className="truncate text-left hover:underline">{e.ref.title}</EntityLink>
          <span className="shrink-0 text-[10px] text-zinc-400">{ENTITY_LABEL[e.ref.kind] ?? e.ref.kind}</span>
        </li>
      ))}
    </ul>
  );
}

function SessionNotes({ session }: { session: WorkspaceSession }) {
  const insertTimestamp = () => appendSessionNote(session.id, "");
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor="session-notes" className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Session notes</label>
        <button type="button" onClick={insertTimestamp} className="text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">⏱ timestamp</button>
      </div>
      <textarea
        id="session-notes" value={session.notes} onChange={(e) => updateSessionNotes(session.id, e.target.value)}
        placeholder="A scratchpad for this session — markdown, independent from your captures."
        rows={4}
        className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20"
      />
    </div>
  );
}

const BUCKETS: { key: "today" | "yesterday" | "thisWeek" | "older"; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This Week" },
  { key: "older", label: "Past Sessions" },
];

function SessionTimeline({ groups }: { groups: import("@/lib/workspaces/sessions").SessionGroups }) {
  const any = BUCKETS.some((b) => groups[b.key].length > 0);
  return (
    <section aria-label="Session timeline" className="mt-8">
      <h2 className="mb-3 text-sm font-semibold tracking-tight">Session timeline</h2>
      {!any ? <Empty>No sessions yet — start one above to begin tracking your work.</Empty> : (
        <div className="space-y-4">
          {BUCKETS.map((b) => groups[b.key].length > 0 && (
            <div key={b.key}>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{b.label}</h3>
              <ul className="space-y-1.5">
                {groups[b.key].map((s) => {
                  const out = sessionOutputs(s);
                  return (
                    <li key={s.id} className="rounded-lg border border-black/[.06] px-3 py-2 text-sm dark:border-white/[.08]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{SESSION_TYPE_ICON[s.type]} {SESSION_TYPE_LABEL[s.type]}{s.goal ? ` — ${s.goal}` : ""}</span>
                        <span className="shrink-0 text-xs text-zinc-400">{formatDuration(sessionDuration(s))}{!s.endedAt ? " · active" : ""}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {out.entitiesOpened} opened · {out.documentsRead} read · {out.capturesCreated} captured · {out.decisionsMade} decisions · {out.events} events
                      </p>
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

export default function WorkspaceDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Dashboard id={id} />;
}
