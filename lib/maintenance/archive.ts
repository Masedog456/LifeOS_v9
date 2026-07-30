/**
 * Archive review (LIFEOS-038, Feature 7).
 *
 * Surfaces ARCHIVE CANDIDATES — records that look finished (completed projects
 * and milestones, cancelled actions, old planning assignments, abandoned
 * documents, concluded research, long-processed captures). Archiving is a
 * conscious act: candidates are only ever suggested, every archive REQUIRES
 * confirmation (a store action), and archive state is a reversible, additive
 * maintenance event — nothing is deleted. Pure and indexed.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { type MaintenanceIndex, refKey } from "@/lib/maintenance/integrity";
import { ageDays } from "@/lib/maintenance/staleness";

export type ArchiveCandidateReason =
  | "completed_project"
  | "completed_milestone"
  | "cancelled_action"
  | "old_planning_assignment"
  | "obsolete_document"
  | "resolved_research"
  | "old_capture";

export const ARCHIVE_REASON_LABEL: Record<ArchiveCandidateReason, string> = {
  completed_project: "Completed project",
  completed_milestone: "Completed milestone",
  cancelled_action: "Cancelled action",
  old_planning_assignment: "Old planning assignment",
  obsolete_document: "Abandoned document",
  resolved_research: "Concluded research",
  old_capture: "Long-processed capture",
};

export interface ArchiveCandidate {
  id: string;
  ref: RecordRefLite;
  title: string;
  reason: ArchiveCandidateReason;
  detail?: string;
}

/** How old a planning assignment / capture must be to be an archive candidate. */
export const OLD_ASSIGNMENT_DAYS = 90;
export const OLD_CAPTURE_DAYS = 180;

/** Archive candidates. Records already archived are excluded. Pure. */
export function archiveCandidates(state: StoreState, index: MaintenanceIndex, nowMs: number = Date.now()): ArchiveCandidate[] {
  const out: ArchiveCandidate[] = [];
  const archived = (ref: RecordRefLite) => index.archived.has(refKey(ref));
  const add = (ref: RecordRefLite, title: string, reason: ArchiveCandidateReason, detail?: string) => { if (!archived(ref)) out.push({ id: `${reason}:${ref.id}`, ref, title, reason, detail }); };

  for (const p of state.projects ?? []) {
    if (p.status === "completed") add({ kind: "project", id: p.id }, p.title, "completed_project");
    for (const m of p.milestones ?? []) if (m.status === "done") add({ kind: "milestone", id: m.id }, m.title, "completed_milestone", p.title);
  }
  for (const a of state.nextActions ?? []) if (a.status === "cancelled") add({ kind: "action", id: a.id }, a.title, "cancelled_action");
  for (const r of state.researchProjects ?? []) if (r.status === "concluded") add({ kind: "research_project", id: r.id }, r.title || r.question || "Research", "resolved_research");
  for (const d of state.documents ?? []) if (d.status === "abandoned") add({ kind: "document", id: d.id }, d.title, "obsolete_document");

  for (const asg of state.planningAssignments ?? []) {
    const age = ageDays(asg.updatedAt, nowMs);
    if (age >= OLD_ASSIGNMENT_DAYS && age !== Number.POSITIVE_INFINITY) add(asg.ref, `Planning: ${asg.ref.kind}`, "old_planning_assignment", `${age} days`);
  }
  for (const c of state.captures ?? []) {
    if (c.processingStatus !== "processed") continue;
    const age = ageDays(c.processedAt ?? c.createdAt, nowMs);
    if (age >= OLD_CAPTURE_DAYS && age !== Number.POSITIVE_INFINITY) add({ kind: "capture", id: c.id }, (c.workingText ?? c.text ?? "Capture").slice(0, 60), "old_capture", `${age} days`);
  }

  return out;
}

/** Records the user has consciously archived (dashboard: archived items). */
export function archivedItems(state: StoreState, index: MaintenanceIndex): RecordRefLite[] {
  const refs: RecordRefLite[] = [];
  for (const key of index.archived) {
    const i = key.indexOf(":");
    if (i > 0) refs.push({ kind: key.slice(0, i), id: key.slice(i + 1) });
  }
  return refs;
}

export function archiveCandidateCount(state: StoreState, index: MaintenanceIndex, nowMs: number = Date.now()): number {
  return archiveCandidates(state, index, nowMs).length;
}
