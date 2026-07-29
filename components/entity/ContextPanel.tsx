"use client";

/**
 * ContextPanel (LIFEOS-029, Feature 1) — the inspector "Overview" tab.
 *
 * The universal context surface for any entity: summary, created/updated, tags,
 * status, notes, citations, relationship/backlink counts, pinned state, and
 * one-click cross-links (open the page, jump to source document/author). Pure
 * projection over the unified entity API.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, describeEntity, entityKindLabel } from "@/lib/entities/entity";
import { relationshipCount } from "@/lib/entities/relationships";
import { backlinkCount } from "@/lib/entities/backlinks";
import { lastActivityAt } from "@/lib/entities/timeline";
import { relativeTime } from "@/lib/entities/timeline";
import { citationsForRecord, citationHref, formatCitation } from "@/lib/library/citations";
import { isPinned, togglePin } from "@/lib/command/recent";
import EntityLink from "@/components/entity/EntityLink";
import { addToWorkspace } from "@/lib/mvpStore";
import { entityWorkspaces, findWorkspace, isMember, workspaceHref } from "@/lib/workspaces/workspace";
import { currentWorkspaceId, useWorkspacePointer } from "@/lib/workspaces/current";
import { entityExecutionLinks } from "@/lib/execution/relationships";
import InspectorPlanning from "@/components/planning/InspectorPlanning";

function fmt(iso?: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ContextPanel({ kind, id, onClose }: { kind: string; id: string; onClose: () => void }) {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const e = useMemo(() => describeEntity(ctx, kind, id), [ctx, kind, id]);
  const rels = relationshipCount(ctx, kind, id);
  const backs = backlinkCount(ctx, kind, id);
  const last = lastActivityAt(ctx, kind, id);
  const citations = useMemo(() => citationsForRecord(state, kind, id), [state, kind, id]);
  useWorkspacePointer(); // re-render when the current-workspace pointer changes
  const belongsTo = useMemo(() => (kind === "workspace" ? [] : entityWorkspaces(state, kind, id)), [state, kind, id]);
  const exec = useMemo(() => entityExecutionLinks(ctx, kind, id), [ctx, kind, id]);
  const hasExec = exec.contributesToGoals.length > 0 || exec.relatedProjects.length > 0 || Boolean(exec.parentGoal) || exec.childProjects.length > 0;
  const currentWs = kind === "workspace" ? undefined : findWorkspace(state, currentWorkspaceId());
  const [, bumpPin] = useState(0);
  const pinned = isPinned(kind, id); // re-read each render; bumpPin forces refresh after toggle

  if (!e.ref.exists) {
    return <p className="p-4 text-sm text-zinc-400">This record no longer exists.</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {e.summary && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Summary</h3>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">{e.summary}</p>
        </section>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div><dt className="text-zinc-400">Type</dt><dd className="text-zinc-700 dark:text-zinc-200">{entityKindLabel(kind)}</dd></div>
        {e.status && <div><dt className="text-zinc-400">Status</dt><dd className="text-zinc-700 dark:text-zinc-200">{e.status}</dd></div>}
        <div><dt className="text-zinc-400">Created</dt><dd className="text-zinc-700 dark:text-zinc-200">{fmt(e.createdAt)}</dd></div>
        <div><dt className="text-zinc-400">Updated</dt><dd className="text-zinc-700 dark:text-zinc-200">{fmt(e.updatedAt)}</dd></div>
        <div><dt className="text-zinc-400">Relationships</dt><dd className="text-zinc-700 dark:text-zinc-200">{rels}</dd></div>
        <div><dt className="text-zinc-400">Backlinks</dt><dd className="text-zinc-700 dark:text-zinc-200">{backs}</dd></div>
        {last && <div className="col-span-2"><dt className="text-zinc-400">Last activity</dt><dd className="text-zinc-700 dark:text-zinc-200">{relativeTime(last)}</dd></div>}
      </dl>

      {e.tags.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Tags</h3>
          <p className="flex flex-wrap gap-1">{e.tags.map((t) => <span key={t} className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-white/[.06] dark:text-zinc-300">{t}</span>)}</p>
        </section>
      )}

      {e.notes && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Notes</h3>
          <p className="whitespace-pre-wrap text-[13px] text-zinc-600 dark:text-zinc-300">{e.notes}</p>
        </section>
      )}

      {citations.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Citations — where this came from</h3>
          <ul className="flex flex-col gap-1">
            {citations.map((c) => (
              <li key={c.id}><Link href={citationHref(c)} onClick={onClose} className="text-[12px] text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300">{formatCitation(c)}</Link></li>
            ))}
          </ul>
        </section>
      )}

      {kind !== "workspace" && (belongsTo.length > 0 || currentWs) && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Workspaces</h3>
          {belongsTo.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {belongsTo.map((w) => (
                <li key={w.id}>
                  <Link href={workspaceHref(w.id)} onClick={onClose} className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] text-zinc-600 hover:underline dark:bg-white/[.06] dark:text-zinc-300">◲ {w.name}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-zinc-400">Not in any workspace yet.</p>
          )}
          {currentWs && !isMember(currentWs, kind, id) && (
            <button
              type="button"
              onClick={() => addToWorkspace(currentWs.id, kind, id)}
              className="mt-1.5 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
            >
              ＋ Add to {currentWs.name}
            </button>
          )}
        </section>
      )}

      {hasExec && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Goals &amp; projects</h3>
          {exec.parentGoal && <p className="text-sm"><EntityLink kind={exec.parentGoal.kind} id={exec.parentGoal.id} className="hover:underline">◎ {exec.parentGoal.title}</EntityLink></p>}
          {exec.contributesToGoals.map((r) => (
            <p key={`g:${r.id}`} className="text-sm"><EntityLink kind={r.kind} id={r.id} className="hover:underline">Contributes to ◎ {r.title}</EntityLink></p>
          ))}
          {exec.relatedProjects.map((r) => (
            <p key={`p:${r.id}`} className="text-sm"><EntityLink kind={r.kind} id={r.id} className="hover:underline">Related to ▤ {r.title}</EntityLink></p>
          ))}
          {exec.childProjects.map((r) => (
            <p key={`c:${r.id}`} className="text-sm"><EntityLink kind={r.kind} id={r.id} className="hover:underline">▤ {r.title}</EntityLink></p>
          ))}
        </section>
      )}

      <InspectorPlanning kind={kind} id={id} />

      <section className="flex flex-wrap gap-2 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
        <Link href={e.ref.href} onClick={onClose} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Open page →</Link>
        <button type="button" onClick={() => { togglePin(kind, id, e.ref.title); bumpPin((t) => t + 1); }} aria-pressed={pinned} className={`rounded-full border px-3 py-1.5 text-[11px] ${pinned ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "border-black/[.12] dark:border-white/[.15]"}`}>
          {pinned ? "★ Pinned" : "☆ Pin"}
        </button>
        {kind === "document" && <EntityLink kind="document" id={id} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] dark:border-white/[.15]" showCard={false}>Open document</EntityLink>}
      </section>
    </div>
  );
}
