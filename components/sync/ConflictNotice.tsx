"use client";

/**
 * The place a refused write is handed back to the person (LIFEOS-076 §9, §10).
 *
 * It appears inline, on the record itself, because that is where the person is
 * when they discover their edit did not stick. A global banner would tell them
 * something went wrong somewhere; this tells them what, and lets them fix it in
 * the same breath.
 *
 * ## Nothing here bypasses the guard
 *
 * Both decisions go through the ORDINARY mutators — `updateNote`,
 * `updateAction`, `completeAction`. There is no privileged path, no forced
 * write, no flag that switches migration 0045 off. "Use my version instead" is
 * a NEW, intentional write made against the version the server actually holds
 * (the adapter learned that version from the rejection itself), so it is
 * accepted the same way any deliberate edit is. §9 requires exactly that.
 *
 * ## Nothing here merges
 *
 * No automatic merge, no AI, no field-level guessing. Two versions are shown
 * and a person chooses. D-8 stays dormant.
 */

import { useState } from "react";
import { updateNote, updateAction, completeAction, reopenAction } from "@/lib/mvpStore";
import { resolveConflict, type GuardedDomain, type StaleConflict } from "@/lib/sync/conflicts-store";
import { useConflictFor } from "@/lib/sync/use-conflicts";
import { describeConflict, CONFLICT_ACTIONS } from "@/lib/sync/conflict-view";
import { toast } from "@/lib/ux/feedback";
import type { NextAction, Note } from "@/types/mvp";

/** Re-apply the rejected local record as a fresh, deliberate edit. */
function reapply(c: StaleConflict): void {
  if (c.domain === "notes") {
    const n = (c.local ?? {}) as Partial<Note>;
    updateNote(c.id, {
      body: n.body ?? "",
      title: n.title ?? "",
      workspaceId: n.workspaceId ?? null,
      tags: n.tags ?? [],
    });
    return;
  }
  const a = (c.local ?? {}) as Partial<NextAction>;
  updateAction(c.id, {
    title: a.title ?? "",
    description: a.description ?? "",
    notes: a.notes,
    tags: a.tags,
  });
  // Status is not part of `updateAction`'s patch — it has its own lifecycle
  // transitions, and going through them keeps history honest instead of
  // stamping a status field directly.
  if (a.status === "completed") completeAction(c.id);
  else if (a.status === "open") reopenAction(c.id);
}

/** Take the version the server holds, and stop offering the rejected one. */
function acceptSaved(c: StaleConflict): void {
  if (c.domain === "notes") {
    const n = (c.remote ?? {}) as Partial<Note>;
    updateNote(c.id, {
      body: n.body ?? "",
      title: n.title ?? "",
      workspaceId: n.workspaceId ?? null,
      tags: n.tags ?? [],
    });
    return;
  }
  const a = (c.remote ?? {}) as Partial<NextAction>;
  updateAction(c.id, { title: a.title ?? "", description: a.description ?? "" });
  if (a.status === "completed") completeAction(c.id);
  else if (a.status === "open") reopenAction(c.id);
}

function yoursAsText(c: StaleConflict): string {
  const v = describeConflict(c);
  return v.fields.map((f) => `${f.label}: ${f.yours}`).join("\n\n");
}

export default function ConflictNotice({ domain, id }: { domain: GuardedDomain; id: string }) {
  const conflict = useConflictFor(domain, id);
  const [copied, setCopied] = useState(false);
  if (!conflict) return null;

  const view = describeConflict(conflict);

  return (
    <section
      data-conflict-notice={domain}
      data-conflict-id={id}
      role="alert"
      className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/[.06] p-3 text-xs"
    >
      <p className="font-medium text-amber-900 dark:text-amber-200">Not saved on your other devices</p>
      <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">{view.headline}</p>

      {view.trivial ? (
        <p className="mt-2 text-amber-900/70 dark:text-amber-100/70">
          Both versions say the same thing, so there is nothing to choose.
        </p>
      ) : (
        <dl className="mt-2 flex flex-col gap-2">
          {view.fields.map((f, i) => (
            <div key={i} className="rounded-lg bg-white/50 p-2 dark:bg-black/20">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{f.label}</dt>
              <dd className="mt-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">Saved everywhere</span>
                <p data-conflict-saved className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">{f.saved}</p>
              </dd>
              <dd className="mt-1.5">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">Your version</span>
                <p data-conflict-yours className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">{f.yours}</p>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          data-conflict-keep
          onClick={() => { acceptSaved(conflict); resolveConflict(domain, id); toast({ kind: "info", message: "Kept the saved version" }); }}
          className="min-h-[36px] rounded-full border border-black/[.15] px-3 py-1.5 text-xs dark:border-white/[.2]"
        >{CONFLICT_ACTIONS.keepSaved}</button>
        <button
          type="button"
          data-conflict-use-mine
          onClick={() => { reapply(conflict); resolveConflict(domain, id); toast({ kind: "success", message: "Your version is being saved" }); }}
          className="min-h-[36px] rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >{CONFLICT_ACTIONS.useMine}</button>
        {/*
          Copy exists so the person is never forced to pick before they have
          somewhere to put their text. It deliberately does NOT resolve the
          conflict — losing the only remaining copy on a failed clipboard write
          would be the very loss this whole sprint exists to stop.
        */}
        <button
          type="button"
          data-conflict-copy
          onClick={() => {
            const t = yoursAsText(conflict);
            void navigator.clipboard?.writeText(t).then(() => setCopied(true)).catch(() => setCopied(false));
          }}
          className="min-h-[36px] rounded-full border border-black/[.15] px-3 py-1.5 text-xs dark:border-white/[.2]"
        >{copied ? "Copied" : CONFLICT_ACTIONS.copyMine}</button>
      </div>
    </section>
  );
}
