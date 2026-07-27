/**
 * Resume-where-I-left-off (LIFEOS-030, Feature 6).
 *
 * A workspace remembers the last entity inspected, document read, inspector
 * target, command search, scroll, and graph focus. "Resume" returns the user to
 * exactly that spot. All pure derivations over the stored `WorkspaceResume` and
 * the LIFEOS-029 entity API — no store mutation here; the store writes resume
 * memory as activity is tracked. No AI, no heuristics beyond "the last place you
 * were".
 */

import type { StoreState, Workspace, WorkspaceResume } from "@/types/mvp";
import { entityRef, type EntityContext, type EntityRef } from "@/lib/entities/entity";
import { workspaceHref } from "@/lib/workspaces/workspace";

export function emptyResume(): WorkspaceResume {
  return {};
}

/** Merge a resume patch onto existing memory (undefined fields don't clobber). */
export function mergeResume(existing: WorkspaceResume, patch: Partial<WorkspaceResume>): WorkspaceResume {
  const next: WorkspaceResume = { ...existing };
  for (const [k, v] of Object.entries(patch) as [keyof WorkspaceResume, unknown][]) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

/** Whether a workspace has anything to resume to. */
export function hasResume(ws: Workspace): boolean {
  const r = ws.resume ?? {};
  return Boolean(r.lastEntity || r.lastDocumentId || r.lastInspector || r.lastSearch);
}

export interface ResumeTarget {
  /** Where "Resume" navigates. */
  href: string;
  /** A human label ("Resume reading The Attention Essays"). */
  label: string;
  /** The entity to re-open in the inspector, if any. */
  inspect?: { kind: string; id: string };
  /** A search string to re-run, if that's the freshest memory. */
  search?: string;
  scroll?: number;
}

/**
 * Resolve the best resume destination for a workspace. Preference order matches
 * "where were you last": a document you were reading, then the last inspected
 * entity, then the last search, else the workspace dashboard. Non-existent
 * targets are skipped so a deleted record never dead-ends the user.
 */
export function resumeTarget(ctx: EntityContext, ws: Workspace): ResumeTarget {
  const state: StoreState = ctx.state;
  const r = ws.resume ?? {};
  const fallback: ResumeTarget = { href: workspaceHref(ws.id), label: `Open ${ws.name || "workspace"}` };

  if (r.lastDocumentId) {
    const doc = state.documents.find((d) => d.id === r.lastDocumentId);
    if (doc) return { href: `/document/${doc.id}`, label: `Resume reading “${doc.title}”`, scroll: r.lastScroll };
  }
  const inspectRef: EntityRef | undefined = r.lastInspector
    ? entityRef(ctx, r.lastInspector.kind, r.lastInspector.id)
    : r.lastEntity
      ? entityRef(ctx, r.lastEntity.kind, r.lastEntity.id)
      : undefined;
  if (inspectRef?.exists) {
    return {
      href: inspectRef.href,
      label: `Resume with ${inspectRef.title}`,
      inspect: { kind: inspectRef.kind, id: inspectRef.id },
      scroll: r.lastScroll,
    };
  }
  if (r.lastSearch) {
    return { href: workspaceHref(ws.id), label: `Resume search “${r.lastSearch}”`, search: r.lastSearch };
  }
  return fallback;
}

/** A one-line human description of a workspace's resume memory (or empty). */
export function resumeSummary(ctx: EntityContext, ws: Workspace): string {
  return hasResume(ws) ? resumeTarget(ctx, ws).label : "";
}
