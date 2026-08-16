"use client";

/**
 * Capture processor (LIFEOS-035, Features 3, 4, 8, 10).
 *
 * The focused single-capture screen. The ORIGINAL text is always shown and never
 * hidden. Clarify into a working version (original stays recoverable, explicit
 * save + revert, unsaved-change protection); convert, link, split, merge, defer,
 * archive, discard, or mark processed. Backlinks, nearby captures, context, and
 * processing history are visible throughout.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useStore, rewriteCapture, revertRewrite, linkCaptureRef, unlinkCaptureRef,
  markCaptureProcessed, archiveCapture, discardCapture, restoreCapture, setCaptureNotes,
  addCaptureTag, removeCaptureTag, setPlanningHorizon,
} from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { entityBacklinks } from "@/lib/entities/backlinks";
import { captureStatus, effectiveText, captureLinks, captureTags, STATUS_LABEL } from "@/lib/inbox/capture-status";
import { nearbyCaptures } from "@/lib/inbox/queue";
import { captureLineage } from "@/lib/inbox/relationships";
import { useUnsavedGuard } from "@/lib/ux/dirty-state";
import { toast } from "@/lib/ux/feedback";
import { writeInboxMemory } from "@/lib/inbox/memory";
import EntityPicker from "@/components/reviews/EntityPicker";
import ConversionPreview from "@/components/inbox/ConversionPreview";
import CaptureSuggestion from "@/components/inbox/CaptureSuggestion";
import SplitCapture from "@/components/inbox/SplitCapture";
import MergeCaptures from "@/components/inbox/MergeCaptures";
import DeferCapture from "@/components/inbox/DeferCapture";
import ProcessingHistory from "@/components/inbox/ProcessingHistory";

type Panel = "convert" | "link" | "rewrite" | "split" | "merge" | "defer" | "history";

export default function CaptureProcessor({ captureId, initialAction }: { captureId: string; initialAction?: string }) {
  const state = useStore();
  const router = useRouter();
  const capture = state.captures.find((c) => c.id === captureId);
  const ctx = useMemo(() => makeEntityContext(state), [state]);

  const [panel, setPanel] = useState<Panel>((["convert", "link", "rewrite", "split", "merge", "defer", "history"].includes(initialAction ?? "") ? initialAction : "rewrite") as Panel);
  const [draft, setDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [seenId, setSeenId] = useState<string | undefined>();
  const [tag, setTag] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (capture && seenId !== capture.id) { setSeenId(capture.id); setDraft(capture.workingText ?? ""); setNotesDraft(capture.processingNotes ?? ""); }
  useEffect(() => { writeInboxMemory({ activeCaptureId: captureId }); }, [captureId]);

  const rewriteDirty = !!capture && draft.trim() !== (capture.workingText ?? "").trim() && draft.trim() !== "";
  const notesDirty = !!capture && notesDraft !== (capture.processingNotes ?? "");
  useUnsavedGuard(`capture-${captureId}`, rewriteDirty || notesDirty);

  if (!capture) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Capture not found. <Link href="/process" className="underline">Back to inbox</Link></p></main>;

  const status = captureStatus(capture);
  const links = captureLinks(capture);
  const nearby = nearbyCaptures(state, capture);
  const backlinks = entityBacklinks(ctx, "capture", capture.id);
  const lineage = captureLineage(state, capture);

  const saveRewrite = () => { rewriteCapture(capture.id, draft); toast({ kind: "success", message: "Working version saved" }); };
  const saveNotes = () => { if (notesDirty) setCaptureNotes(capture.id, notesDraft); };

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-5 px-4 py-8 sm:px-6 md:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Process capture</h1>
            <p className="mt-0.5 text-xs text-zinc-500">{new Date(capture.createdAt).toLocaleString()} · <span data-capture-status={status}>{STATUS_LABEL[status]}</span></p>
          </div>
          <Link href="/process" className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">← Inbox</Link>
        </header>

        {/* Original — always visible, never hidden. */}
        <section aria-label="Original capture" className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Original</p>
          <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">{capture.text}</p>
        </section>

        {/* Action panels. */}
        <nav aria-label="Processing actions" className="mb-3 -mx-1 flex gap-1 overflow-x-auto pb-1">
          {(["rewrite", "convert", "link", "split", "merge", "defer", "history"] as Panel[]).map((p) => (
            <button key={p} type="button" onClick={() => setPanel(p)} data-panel={p} aria-current={panel === p ? "true" : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium capitalize ${panel === p ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]"}`}>{p}</button>
          ))}
        </nav>

        <section aria-label={`${panel} panel`} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          {panel === "rewrite" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-500">Clarify a working version. The original above is always preserved.</p>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (rewriteDirty) saveRewrite(); }} rows={4} aria-label="Working text" placeholder="A clearer version…" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:border-white/12" />
              <div className="flex items-center gap-2">
                <button type="button" onClick={saveRewrite} disabled={!rewriteDirty} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Save working version</button>
                {capture.workingText !== undefined && <button type="button" onClick={() => { revertRewrite(capture.id); setDraft(""); toast({ kind: "info", message: "Reverted to original" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Revert to original</button>}
              </div>
            </div>
          )}
          {panel === "convert" && (
            <div className="mb-3">
              {/* Suggestion first — the manual destination list stays right below. */}
              <CaptureSuggestion capture={capture} onHandled={() => router.push("/process")} />
            </div>
          )}
          {panel === "convert" && <ConversionPreview capture={capture} onConverted={() => toast({ kind: "success", message: "Converted — source capture preserved" })} />}
          {panel === "link" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-500">Link this capture to existing records without converting it.</p>
              {links.length > 0 && <p className="flex flex-wrap gap-1">{links.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <button key={`${r.kind}:${r.id}`} type="button" onClick={() => unlinkCaptureRef(capture.id, r)} className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{entityKindLabel(r.kind)}: {ref.title} ✕</button>; })}</p>}
              <EntityPicker onPick={(r) => { linkCaptureRef(capture.id, r); toast({ kind: "success", message: "Linked" }); }} placeholder="Link a workspace / goal / project / document / entity…" />
            </div>
          )}
          {panel === "split" && <SplitCapture capture={capture} onDone={() => router.push("/process")} />}
          {panel === "merge" && <MergeCaptures capture={capture} onMerged={(id) => router.push(`/process/${id}`)} />}
          {panel === "defer" && <DeferCapture capture={capture} onDone={() => router.push("/process")} />}
          {panel === "history" && <ProcessingHistory capture={capture} />}
        </section>

        {/* Notes + terminal actions. */}
        <section className="mt-4 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Processing notes</label>
          <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} onBlur={saveNotes} rows={2} aria-label="Processing notes" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Create a next action from this capture (LIFEOS-036, Feature 15). The
                capture is preserved; the creator opens pre-filled with its context. */}
            <button type="button" onClick={() => router.push(`/actions?fromCapture=${capture.id}`)} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">→ Next action</button>
            {/* Plan this capture into a horizon (LIFEOS-037, Feature 14) — explicit; the capture is preserved. */}
            <select defaultValue="" onChange={(e) => { if (e.target.value) { setPlanningHorizon({ kind: "capture", id: capture.id }, e.target.value as "today" | "this_week" | "later" | "someday"); toast({ kind: "success", message: "Planned" }); e.target.value = ""; } }} aria-label="Plan capture" className="rounded-full border border-black/[.12] bg-transparent px-3 py-1.5 text-xs dark:border-white/[.15]">
              <option value="">Plan…</option>
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="later">Later</option>
              <option value="someday">Someday</option>
            </select>
            {status !== "processed" && status !== "archived" && status !== "discarded" && <button type="button" onClick={() => { markCaptureProcessed(capture.id); toast({ kind: "success", message: "Marked processed" }); }} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Mark processed</button>}
            {status !== "archived" && <button type="button" onClick={() => { archiveCapture(capture.id); toast({ kind: "info", message: "Archived (reversible)" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Archive</button>}
            {(status === "archived" || status === "processed" || status === "deferred" || status === "discarded") && <button type="button" onClick={() => { restoreCapture(capture.id); toast({ kind: "success", message: "Restored to inbox" }); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Restore to inbox</button>}
            {!confirmDiscard ? <button type="button" onClick={() => setConfirmDiscard(true)} className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400">Discard</button>
              : <span className="flex items-center gap-1 text-xs"><span className="text-rose-600 dark:text-rose-400">Discard? (reversible)</span><button type="button" onClick={() => { discardCapture(capture.id); setConfirmDiscard(false); toast({ kind: "info", message: "Discarded — restore from the Discarded view" }); }} className="rounded-full bg-rose-600 px-3 py-1 font-medium text-white">Yes</button><button type="button" onClick={() => setConfirmDiscard(false)} className="text-zinc-400">No</button></span>}
          </div>
        </section>
      </div>

      {/* Context sidebar. */}
      <aside className="flex flex-col gap-4 text-xs">
        <Panel title="Tags">
          <div className="flex flex-wrap gap-1">{captureTags(capture).map((t) => <button key={t} type="button" onClick={() => removeCaptureTag(capture.id, t)} className="rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.08]">{t} ✕</button>)}</div>
          <div className="mt-1.5 flex gap-1"><input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tag.trim()) { addCaptureTag(capture.id, tag.trim()); setTag(""); } }} placeholder="Add tag…" aria-label="Add tag" className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" /></div>
        </Panel>
        {(capture.sourceContext?.workspaceId || capture.sourceContext?.sessionId || capture.sourceId) && (
          <Panel title="Context">
            {capture.sourceContext?.workspaceId && (() => { const r = entityRef(ctx, "workspace", capture.sourceContext!.workspaceId!); return <p><Link href={r.href} className="text-sky-600 dark:text-sky-400">{r.title}</Link></p>; })()}
            {capture.sourceContext?.sessionId && <p className="text-zinc-500">From a session</p>}
            {capture.sourceId && <p className="text-zinc-500">From a source</p>}
          </Panel>
        )}
        {links.length > 0 && <Panel title="Links">{links.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <p key={`${r.kind}:${r.id}`} className="truncate"><Link href={ref.href} className="text-sky-600 dark:text-sky-400">{entityKindLabel(r.kind)}: {ref.title}</Link></p>; })}</Panel>}
        {(lineage.splitFrom || lineage.splitChildren.length > 0 || lineage.mergedFrom.length > 0 || lineage.conversions.length > 0) && (
          <Panel title="Lineage">
            {lineage.splitFrom && <p><Link href={`/process/${lineage.splitFrom.id}`} className="text-sky-600 dark:text-sky-400">Split from a capture</Link></p>}
            {lineage.splitChildren.map((c) => <p key={c.id} className="truncate"><Link href={`/process/${c.id}`} className="text-sky-600 dark:text-sky-400">Split → {effectiveText(c).slice(0, 40)}</Link></p>)}
            {lineage.mergedFrom.map((c) => <p key={c.id} className="truncate">Merged from {effectiveText(c).slice(0, 40)}</p>)}
            {lineage.conversions.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <p key={`${r.kind}:${r.id}`} className="truncate"><Link href={ref.href} className="text-sky-600 dark:text-sky-400">→ {entityKindLabel(r.kind)}: {ref.title}</Link></p>; })}
          </Panel>
        )}
        {backlinks.length > 0 && <Panel title="Backlinks">{backlinks.flatMap((g) => g.items).slice(0, 8).map((r) => <p key={`${r.kind}:${r.id}`} className="truncate"><Link href={r.href} className="text-sky-600 dark:text-sky-400">{r.title}</Link></p>)}</Panel>}
        {nearby.length > 0 && <Panel title="Nearby captures">{nearby.map((c) => <p key={c.id} className="truncate"><Link href={`/process/${c.id}`} className="text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300">{effectiveText(c).slice(0, 44)}</Link></p>)}</Panel>}
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
