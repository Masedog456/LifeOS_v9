"use client";

/**
 * Relationship integrity (LIFEOS-038, Feature 3). Reports structural gaps and
 * dangling references. The user chooses to mark each repaired; nothing is fixed
 * automatically.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, repairRelationship } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { relationshipIssues, RELATIONSHIP_ISSUE_LABEL } from "@/lib/maintenance/relationships";
import { toast } from "@/lib/ux/feedback";

export default function RelationshipIntegrity() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const issues = useMemo(() => relationshipIssues(state, index), [state, index]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Relationship integrity</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Missing parents, broken backlinks, and dangling references. This reports only — mark an item repaired once you&apos;ve fixed it.</p>
      </header>

      {issues.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No relationship issues.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {issues.map((i) => {
            const e = entityRef(ctx, i.ref.kind, i.ref.id);
            return (
              <li key={i.id} data-issue={i.id} className="flex items-center justify-between gap-2 rounded-xl border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.07]">
                <span className="min-w-0">
                  <Link href={e.href} className="truncate font-medium hover:underline">{e.title}</Link>
                  <span className="ml-2 text-[11px] text-zinc-400">{RELATIONSHIP_ISSUE_LABEL[i.kind]}{i.detail ? ` · ${i.detail}` : ""}</span>
                </span>
                <button type="button" data-repair onClick={() => { repairRelationship(i.ref, i.relatedRef, i.kind); toast({ kind: "success", message: "Marked repaired" }); }} className="shrink-0 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Mark repaired</button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
