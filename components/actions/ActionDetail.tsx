"use client";

/**
 * Action detail (LIFEOS-036, Features 5, 6, 7, 8, 9). The focused single-action
 * screen: full context (project hierarchy, workspace, milestone, source records),
 * lifecycle actions (start / complete / defer / wait / resume / cancel / restore /
 * duplicate), dependencies, sessions, history, and completion evidence. Completion
 * is always manual and never cascades to a milestone/project/goal.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useStore, updateAction, startAction, completeAction, deferAction, markActionWaiting,
  pauseAction, cancelAction, restoreAction, reopenAction, duplicateAction,
  deleteAction, linkActionRef, unlinkActionRef, addActionTag, removeActionTag,
} from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { entityBacklinks } from "@/lib/entities/backlinks";
import { SIZE_LABEL, ENERGY_LABEL, userFacingStatus, statusTone } from "@/lib/actions/status";
import { WAITING_SUGGESTIONS } from "@/lib/actions/waiting";
import { actionSessions, actionContribution } from "@/lib/actions/tracking";
import { actionSources, dependencyNeighbours } from "@/lib/actions/relationships";
import { dependencyImpact } from "@/lib/actions/dependencies";
import { useUnsavedGuard } from "@/lib/ux/dirty-state";
import { toast } from "@/lib/ux/feedback";
import { writeActionMemory } from "@/lib/actions/memory";
import EntityPicker from "@/components/reviews/EntityPicker";
import ActionHistory from "@/components/actions/ActionHistory";
import ActionDependencies from "@/components/actions/ActionDependencies";

type Panel = "links" | "dependencies" | "history";

/** Friendly panel labels (LIFEOS-042A) — "Prerequisites" reads more plainly
 * than "Dependencies" for someone who has never seen LifeOS. */
const PANEL_LABEL: Record<Panel, string> = { links: "Links", dependencies: "Prerequisites", history: "History" };

export default function ActionDetail({ actionId }: { actionId: string }) {
  const state = useStore();
  const router = useRouter();
  const search = useSearchParams();
  const action = state.nextActions.find((a) => a.id === actionId);
  const ctx = useMemo(() => makeEntityContext(state), [state]);

  const [panel, setPanel] = useState<Panel>("links");
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [seenId, setSeenId] = useState<string | undefined>();
  const [tag, setTag] = useState("");
  // `?do=complete|defer|wait` deep-links a panel open (read once at mount).
  const doParam = search.get("do");
  const [deferOpen, setDeferOpen] = useState(doParam === "defer");
  const [waitOpen, setWaitOpen] = useState(doParam === "wait");
  const [completeOpen, setCompleteOpen] = useState(doParam === "complete");
  const [completeNote, setCompleteNote] = useState("");
  const [waitOn, setWaitOn] = useState("");
  const [waitDate, setWaitDate] = useState("");
  const [deferDate, setDeferDate] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (action && seenId !== action.id) { setSeenId(action.id); setTitleDraft(action.title); setDescDraft(action.description); setNotesDraft(action.notes); }
  useEffect(() => { writeActionMemory({ activeActionId: actionId }); }, [actionId]);

  const dirty = !!action && (titleDraft.trim() !== action.title || descDraft !== action.description || notesDraft !== action.notes);
  useUnsavedGuard(`action-${actionId}`, dirty);

  if (!action) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Action not found. <Link href="/actions" className="underline">Back to the queue</Link></p></main>;

  const saveEdits = () => { if (dirty) { updateAction(action.id, { title: titleDraft.trim(), description: descDraft, notes: notesDraft }); toast({ kind: "success", message: "Saved" }); } };
  const links = action.linkedEntityRefs ?? [];
  const backlinks = entityBacklinks(ctx, "action", action.id);
  const sessions = actionSessions(state, action.id);
  const contrib = actionContribution(sessions);
  const sources = actionSources(action);
  const { blockers } = dependencyNeighbours(state, action.id);
  // "Blocked" means at least one prerequisite action is still unfinished. An
  // empty/all-finished prerequisite set is NOT blocked — this is what keeps the
  // header honest with the Prerequisites panel.
  const blockedByPrereq = blockers.some((b) => b.status !== "completed" && b.status !== "cancelled");
  const statusText = userFacingStatus(action, blockedByPrereq);
  const tone = statusTone(action, blockedByPrereq);
  const toneClass = tone === "ready" ? "text-emerald-600 dark:text-emerald-400" : tone === "active" ? "text-sky-600 dark:text-sky-400" : tone === "waiting" ? "text-amber-600 dark:text-amber-400" : "text-zinc-400";
  const impact = dependencyImpact(action.id, state.actionDependencies ?? [], new Map(state.nextActions.map((a) => [a.id, a])));

  const ctxRow = (kind: string, id?: string) => id ? (() => { const r = entityRef(ctx, kind, id); return <Link key={`${kind}:${id}`} href={r.href} className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] text-sky-700 hover:bg-black/[.08] dark:bg-white/[.08] dark:text-sky-300">{entityKindLabel(kind)}: {r.title}</Link>; })() : null;

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-5 px-4 py-8 sm:px-6 md:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Action</h1>
            <p className="mt-0.5 text-xs text-zinc-500">{new Date(action.createdAt).toLocaleString()} · <span data-action-status={action.status} className={`font-medium ${toneClass}`}>{statusText}</span></p>
          </div>
          <Link href="/actions" className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">← Queue</Link>
        </header>

        {/* Editable title/description. */}
        <section className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
          <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={saveEdits} aria-label="Title" className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-lg font-medium outline-none focus-visible:border-black/10 dark:focus-visible:border-white/12" />
          <textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} onBlur={saveEdits} rows={2} placeholder="Details…" aria-label="Description" className="mt-1 w-full resize-y rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm outline-none focus-visible:border-black/10 dark:focus-visible:border-white/12" />
        </section>

        {/* Primary lifecycle actions. */}
        <section className="mb-4 flex flex-wrap items-center gap-2">
          {(action.status === "open" || action.status === "waiting" || action.status === "deferred") && <button type="button" onClick={() => { startAction(action.id, { startSession: false }); toast({ kind: "success", message: "Started" }); }} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Start</button>}
          {(action.status === "open" || action.status === "waiting" || action.status === "deferred") && <button type="button" onClick={() => { startAction(action.id, { startSession: true }); toast({ kind: "success", message: "Started with a session" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Start + session</button>}
          {action.status === "in_progress" && <button type="button" onClick={() => { pauseAction(action.id); toast({ kind: "info", message: "Paused" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Pause</button>}
          {action.status !== "completed" && action.status !== "cancelled" && <button type="button" onClick={() => setCompleteOpen((v) => !v)} className="rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">Complete</button>}
          {action.status !== "completed" && action.status !== "cancelled" && <button type="button" onClick={() => setDeferOpen((v) => !v)} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Defer</button>}
          {action.status !== "completed" && action.status !== "cancelled" && action.status !== "waiting" && <button type="button" onClick={() => setWaitOpen((v) => !v)} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Wait on…</button>}
          {(action.status === "completed" || action.status === "cancelled") && <button type="button" onClick={() => { reopenAction(action.id); toast({ kind: "success", message: "Reopened" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Reopen</button>}
          {(action.status === "completed" || action.status === "cancelled" || action.status === "deferred") && <button type="button" onClick={() => { restoreAction(action.id); toast({ kind: "success", message: "Restored" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Restore</button>}
          <button type="button" onClick={() => { const id = duplicateAction(action.id); if (id) { toast({ kind: "success", message: "Duplicated" }); router.push(`/actions/${id}`); } }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Duplicate</button>
          {action.status !== "cancelled" && <button type="button" onClick={() => { cancelAction(action.id); toast({ kind: "info", message: "Cancelled (reversible)" }); }} className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400">Cancel</button>}
        </section>

        {/* Complete evidence. */}
        {completeOpen && action.status !== "completed" && (
          <section className="mb-4 rounded-2xl border border-emerald-500/30 p-4 dark:border-emerald-500/20">
            <p className="mb-1 text-xs text-zinc-500">Completion is manual and won&apos;t complete the milestone, project, or any other action.</p>
            <textarea value={completeNote} onChange={(e) => setCompleteNote(e.target.value)} rows={2} placeholder="Completion note (optional)" aria-label="Completion note" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/12" />
            <button type="button" onClick={() => { completeAction(action.id, { note: completeNote }); setCompleteOpen(false); setCompleteNote(""); toast({ kind: "success", message: "Completed" }); }} className="mt-2 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white">Mark complete</button>
          </section>
        )}

        {/* Defer options. */}
        {deferOpen && (
          <section className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
            <div className="flex flex-wrap items-center gap-2">
              {(["tomorrow", "next_week", "someday"] as const).map((o) => <button key={o} type="button" onClick={() => { deferAction(action.id, o); setDeferOpen(false); toast({ kind: "info", message: "Deferred" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">{o === "next_week" ? "Next week" : o[0].toUpperCase() + o.slice(1)}</button>)}
              <input type="date" value={deferDate} onChange={(e) => setDeferDate(e.target.value)} aria-label="Defer to date" className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
              <button type="button" onClick={() => { if (deferDate) { deferAction(action.id, { date: deferDate }); setDeferOpen(false); toast({ kind: "info", message: "Deferred" }); } }} className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Defer to date</button>
            </div>
          </section>
        )}

        {/* Waiting. */}
        {waitOpen && (
          <section className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
            <div className="flex flex-wrap items-center gap-2">
              <input list="waiting-suggest" value={waitOn} onChange={(e) => setWaitOn(e.target.value)} placeholder="Waiting on…" aria-label="Waiting on" className="min-w-40 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12" />
              <datalist id="waiting-suggest">{WAITING_SUGGESTIONS.map((w) => <option key={w} value={w} />)}</datalist>
              <input type="date" value={waitDate} onChange={(e) => setWaitDate(e.target.value)} aria-label="Follow-up date" className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
              <button type="button" onClick={() => { markActionWaiting(action.id, waitOn, waitDate || undefined); setWaitOpen(false); setWaitOn(""); setWaitDate(""); toast({ kind: "info", message: "Marked waiting" }); }} className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Mark waiting</button>
            </div>
          </section>
        )}

        {/* Panels: links / dependencies / history. */}
        <nav aria-label="Action panels" className="mb-3 -mx-1 flex gap-1 overflow-x-auto pb-1">
          {(["links", "dependencies", "history"] as Panel[]).map((p) => (
            <button key={p} type="button" onClick={() => setPanel(p)} data-panel={p} aria-current={panel === p ? "true" : undefined} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${panel === p ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]"}`}>{PANEL_LABEL[p]}</button>
          ))}
        </nav>
        <section aria-label={`${panel} panel`} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          {panel === "links" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-500">Connect this action to existing records.</p>
              {links.length > 0 && <p className="flex flex-wrap gap-1">{links.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <button key={`${r.kind}:${r.id}`} type="button" onClick={() => unlinkActionRef(action.id, r)} className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{entityKindLabel(r.kind)}: {ref.title} ✕</button>; })}</p>}
              <EntityPicker onPick={(r) => { linkActionRef(action.id, r); toast({ kind: "success", message: "Linked" }); }} placeholder="Link a workspace / goal / project / document / entity…" />
            </div>
          )}
          {panel === "dependencies" && <ActionDependencies action={action} />}
          {panel === "history" && <ActionHistory action={action} />}
        </section>

        {/* Notes + delete. */}
        <section className="mt-4 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Notes</label>
          <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} onBlur={saveEdits} rows={2} aria-label="Notes" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          <div className="mt-3">
            {!confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} className="text-[11px] text-zinc-400 hover:text-rose-500">Delete permanently…</button>
              : <span className="flex items-center gap-2 text-xs"><span className="text-rose-600 dark:text-rose-400">Delete? {impact.removedEdges > 0 ? `Removes ${impact.removedEdges} dependency edge(s); ${impact.unblocks.length} action(s) become eligible.` : "This cannot be undone (cancel is reversible; delete is not)."}</span><button type="button" onClick={() => { deleteAction(action.id); toast({ kind: "info", message: "Deleted" }); router.push("/actions"); }} className="rounded-full bg-rose-600 px-3 py-1 font-medium text-white">Yes, delete</button><button type="button" onClick={() => setConfirmDelete(false)} className="text-zinc-400">No</button></span>}
          </div>
        </section>
      </div>

      {/* Context sidebar. */}
      <aside className="flex flex-col gap-4 text-xs">
        <Panel title="Attributes">
          <div className="flex flex-col gap-1 text-zinc-500">
            <span>Size: {SIZE_LABEL[action.estimatedSize]}</span>
            <span>Energy: {ENERGY_LABEL[action.energy]}</span>
            {action.context && <span>Context: {action.context}</span>}
            {action.status === "waiting" && action.waitingOn && <span>Waiting on: {action.waitingOn}{action.followUpDate ? ` · follow up ${action.followUpDate}` : ""}</span>}
            {action.status === "deferred" && <span>Returns: {action.deferredUntil ?? "someday"}</span>}
          </div>
        </Panel>
        {(action.goalId || action.projectId || action.milestoneId || action.workspaceId) && (
          <Panel title="Hierarchy">
            <div className="flex flex-wrap gap-1">{[ctxRow("goal", action.goalId), ctxRow("project", action.projectId), ctxRow("milestone", action.milestoneId), ctxRow("workspace", action.workspaceId)].filter(Boolean)}</div>
          </Panel>
        )}
        <Panel title="Tags">
          <div className="flex flex-wrap gap-1">{action.tags.map((t) => <button key={t} type="button" onClick={() => removeActionTag(action.id, t)} className="rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.08]">{t} ✕</button>)}</div>
          <div className="mt-1.5"><input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tag.trim()) { addActionTag(action.id, tag.trim()); setTag(""); } }} placeholder="Add tag…" aria-label="Add tag" className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" /></div>
        </Panel>
        {sources.length > 0 && <Panel title="Source">{sources.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <p key={`${r.kind}:${r.id}`} className="truncate"><Link href={ref.href} className="text-sky-600 dark:text-sky-400">{entityKindLabel(r.kind)}: {ref.title}</Link></p>; })}</Panel>}
        {sessions.length > 0 && <Panel title="Sessions"><p className="text-zinc-500">{sessions.length} session{sessions.length === 1 ? "" : "s"} · {contrib.capturesWhileActing} capture(s) while acting</p></Panel>}
        {backlinks.length > 0 && <Panel title="Backlinks">{backlinks.flatMap((g) => g.items).slice(0, 8).map((r) => <p key={`${r.kind}:${r.id}`} className="truncate"><Link href={r.href} className="text-sky-600 dark:text-sky-400">{r.title}</Link></p>)}</Panel>}
      </aside>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/[.06] p-3 dark:border-white/[.08]">
      <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}
