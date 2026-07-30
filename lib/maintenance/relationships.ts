/**
 * Relationship integrity (LIFEOS-038, Feature 3).
 *
 * REPORT ONLY — deterministically finds structural gaps and dangling references
 * and never repairs anything automatically. Verifies missing parents/children,
 * broken backlinks, deleted references, dangling planning/focus references,
 * dangling citations, orphan sessions, and invalid milestone references. Pure
 * and indexed (O(references), not O(records²)).
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { type MaintenanceIndex, refKey } from "@/lib/maintenance/integrity";

export type RelationshipIssueKind =
  | "missing_parent"
  | "missing_child"
  | "broken_backlink"
  | "dangling_planning"
  | "dangling_focus"
  | "dangling_citation"
  | "orphan_session"
  | "invalid_milestone"
  | "broken_relationship_endpoint";

export const RELATIONSHIP_ISSUE_LABEL: Record<RelationshipIssueKind, string> = {
  missing_parent: "Missing parent",
  missing_child: "Missing child",
  broken_backlink: "Broken backlink",
  dangling_planning: "Planning assignment to a missing record",
  dangling_focus: "Focus reference to a missing record",
  dangling_citation: "Citation to a missing target",
  orphan_session: "Session pointing at a missing workspace/goal/project",
  invalid_milestone: "Action references a missing milestone",
  broken_relationship_endpoint: "Relationship endpoint no longer exists",
};

export interface RelationshipIssue {
  id: string;
  ref: RecordRefLite;
  kind: RelationshipIssueKind;
  detail?: string;
  relatedRef?: RecordRefLite;
}

/** Deterministic relationship-integrity report. Report-only; nothing is repaired. */
export function relationshipIssues(state: StoreState, index: MaintenanceIndex): RelationshipIssue[] {
  const out: RelationshipIssue[] = [];
  const has = index.has;

  // Concepts: parent/child/backlink references that no longer resolve.
  for (const c of state.concepts ?? []) {
    const ref: RecordRefLite = { kind: "concept", id: c.id };
    for (const pid of c.parentConcepts ?? []) if (!has({ kind: "concept", id: pid })) out.push({ id: `mp:${c.id}:${pid}`, ref, kind: "missing_parent", detail: pid, relatedRef: { kind: "concept", id: pid } });
    for (const cid of c.childConcepts ?? []) if (!has({ kind: "concept", id: cid })) out.push({ id: `mc:${c.id}:${cid}`, ref, kind: "missing_child", detail: cid, relatedRef: { kind: "concept", id: cid } });
    for (const bid of c.relatedBeliefs ?? []) if (!has({ kind: "belief", id: bid })) out.push({ id: `bl:${c.id}:${bid}`, ref, kind: "broken_backlink", detail: `belief ${bid}`, relatedRef: { kind: "belief", id: bid } });
    for (const sid of c.relatedConcepts ?? []) if (!has({ kind: "concept", id: sid })) out.push({ id: `bl:${c.id}:c:${sid}`, ref, kind: "broken_backlink", detail: `concept ${sid}`, relatedRef: { kind: "concept", id: sid } });
    for (const sid of c.relatedSources ?? []) if (!has({ kind: "source", id: sid })) out.push({ id: `bl:${c.id}:s:${sid}`, ref, kind: "broken_backlink", detail: `source ${sid}`, relatedRef: { kind: "source", id: sid } });
  }

  // Concept relationships: an endpoint that no longer exists.
  for (const r of state.conceptRelationships ?? []) {
    const ref: RecordRefLite = { kind: "relationship", id: r.id };
    if (!has({ kind: "concept", id: r.fromConceptId })) out.push({ id: `re:${r.id}:from`, ref, kind: "broken_relationship_endpoint", detail: `from ${r.fromConceptId}`, relatedRef: { kind: "concept", id: r.fromConceptId } });
    if (!has({ kind: "concept", id: r.toConceptId })) out.push({ id: `re:${r.id}:to`, ref, kind: "broken_relationship_endpoint", detail: `to ${r.toConceptId}`, relatedRef: { kind: "concept", id: r.toConceptId } });
  }

  // Planning assignments + focus sessions pointing at a now-missing record.
  for (const a of state.planningAssignments ?? []) if (!has(a.ref)) out.push({ id: `dp:${a.id}`, ref: a.ref, kind: "dangling_planning", detail: refKey(a.ref) });
  for (const f of state.focusSessions ?? []) if (f.ref.kind !== "custom" && !has(f.ref)) out.push({ id: `df:${f.id}`, ref: f.ref, kind: "dangling_focus", detail: refKey(f.ref) });

  // Citations whose target document / section / passage no longer exists.
  for (const c of state.citations ?? []) {
    if (!index.documentIds.has(c.documentId)) out.push({ id: `dc:${c.id}`, ref: { kind: "citation", id: c.id }, kind: "dangling_citation", detail: `document ${c.documentId}`, relatedRef: { kind: "document", id: c.documentId } });
    else if (c.passageId && !index.passageIds.has(c.passageId)) out.push({ id: `dcp:${c.id}`, ref: { kind: "citation", id: c.id }, kind: "dangling_citation", detail: `passage ${c.passageId}`, relatedRef: { kind: "document", id: c.documentId } });
  }

  // Sessions pointing at a missing workspace / goal / project.
  for (const s of state.sessions ?? []) {
    const ref: RecordRefLite = { kind: "session", id: s.id };
    if (s.workspaceId && !has({ kind: "workspace", id: s.workspaceId })) out.push({ id: `os:${s.id}:w`, ref, kind: "orphan_session", detail: `workspace ${s.workspaceId}` });
    if (s.goalId && !has({ kind: "goal", id: s.goalId })) out.push({ id: `os:${s.id}:g`, ref, kind: "orphan_session", detail: `goal ${s.goalId}` });
    if (s.projectId && !has({ kind: "project", id: s.projectId })) out.push({ id: `os:${s.id}:p`, ref, kind: "orphan_session", detail: `project ${s.projectId}` });
  }

  // Actions referencing a milestone that no longer exists.
  for (const a of state.nextActions ?? []) if (a.milestoneId && !has({ kind: "milestone", id: a.milestoneId })) out.push({ id: `im:${a.id}`, ref: { kind: "action", id: a.id }, kind: "invalid_milestone", detail: a.milestoneId, relatedRef: { kind: "milestone", id: a.milestoneId } });

  return out;
}

/** Count of relationship-integrity issues (dashboard: broken references). */
export function relationshipIssueCount(state: StoreState, index: MaintenanceIndex): number {
  return relationshipIssues(state, index).length;
}
