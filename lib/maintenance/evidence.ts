/**
 * Evidence & research integrity (LIFEOS-038, Features 4 & 10).
 *
 * REVIEW ONLY. Surfaces knowledge whose evidentiary support may have thinned —
 * beliefs without citations, claims whose citations point at deleted documents,
 * research without sources, documents never referenced, notes with no context —
 * and research projects missing a hypothesis / citations / conclusion / linked
 * entities, or untouched for a long time. No automatic credibility scores, no
 * automatic repair. Pure and indexed.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { type MaintenanceIndex, refKey } from "@/lib/maintenance/integrity";
import { ageDays } from "@/lib/maintenance/staleness";

export type EvidenceIssueKind =
  | "belief_uncited"
  | "outdated_citation"
  | "research_no_sources"
  | "document_unreferenced"
  | "note_no_context";

export const EVIDENCE_ISSUE_LABEL: Record<EvidenceIssueKind, string> = {
  belief_uncited: "Belief with no citation",
  outdated_citation: "Claim whose citation target is gone",
  research_no_sources: "Research with no sources",
  document_unreferenced: "Document never referenced",
  note_no_context: "Note with no context",
};

export type EvidenceAction = "add_citation" | "link_evidence" | "archive" | "ignore";

export interface EvidenceIssue {
  id: string;
  ref: RecordRefLite;
  kind: EvidenceIssueKind;
  detail?: string;
  actions: EvidenceAction[];
}

const DEFAULT_ACTIONS: EvidenceAction[] = ["add_citation", "link_evidence", "archive", "ignore"];

/** Evidence-review projection (Feature 4). Archived records are excluded. */
export function evidenceReview(state: StoreState, index: MaintenanceIndex): EvidenceIssue[] {
  const out: EvidenceIssue[] = [];
  const isArchived = (ref: RecordRefLite) => index.archived.has(refKey(ref));

  // Beliefs with no citation (skip archived/rejected).
  for (const b of state.beliefs ?? []) {
    const ref: RecordRefLite = { kind: "belief", id: b.id };
    if (isArchived(ref)) continue;
    if (b.status === "rejected") continue;
    const cites = index.citationsByRecord.get(refKey(ref)) ?? [];
    if (cites.length === 0) out.push({ id: `bu:${b.id}`, ref, kind: "belief_uncited", actions: DEFAULT_ACTIONS });
    else if (cites.every((c) => !index.documentIds.has(c.documentId))) out.push({ id: `oc:${b.id}`, ref, kind: "outdated_citation", detail: "all cited documents are gone", actions: DEFAULT_ACTIONS });
  }

  // Research with no sources / citations.
  for (const r of state.researchProjects ?? []) {
    const ref: RecordRefLite = { kind: "research_project", id: r.id };
    if (isArchived(ref) || r.status === "archived" || r.status === "abandoned") continue;
    const cites = index.citationsByRecord.get(refKey(ref)) ?? [];
    const sources = (r.assembly?.sourceIds?.length ?? 0) + cites.length;
    if (sources === 0) out.push({ id: `rns:${r.id}`, ref, kind: "research_no_sources", actions: ["add_citation", "link_evidence", "ignore"] });
  }

  // Documents never referenced (no incoming citation, no highlights derived).
  for (const d of state.documents ?? []) {
    const ref: RecordRefLite = { kind: "document", id: d.id };
    if (isArchived(ref)) continue;
    const incoming = index.citationsByDocument.get(d.id) ?? [];
    const hasHighlights = (d.sections ?? []).some((s) => (s.passages ?? []).some((p) => (p.highlights ?? []).length > 0 || (p.annotations ?? []).length > 0));
    if (incoming.length === 0 && !hasHighlights) out.push({ id: `du:${d.id}`, ref, kind: "document_unreferenced", actions: ["link_evidence", "archive", "ignore"] });
  }

  // Notes (captures) with no context — processed but linked to nothing.
  for (const c of state.captures ?? []) {
    const ref: RecordRefLite = { kind: "capture", id: c.id };
    if (isArchived(ref)) continue;
    const links = (c.linkedProjectIds?.length ?? 0) + (c.linkedGoalIds?.length ?? 0) + (c.linkedWorkspaceIds?.length ?? 0) + (c.linkedEntityRefs?.length ?? 0);
    if (c.processingStatus === "processed" && links === 0) out.push({ id: `nc:${c.id}`, ref, kind: "note_no_context", actions: ["link_evidence", "archive", "ignore"] });
  }

  return out;
}

export type ResearchIssueKind = "no_hypothesis" | "no_citations" | "no_conclusion" | "no_linked_entities" | "untouched";

export const RESEARCH_ISSUE_LABEL: Record<ResearchIssueKind, string> = {
  no_hypothesis: "No hypothesis",
  no_citations: "No citations",
  no_conclusion: "No conclusion",
  no_linked_entities: "No linked entities",
  untouched: "Untouched for a long time",
};

export interface ResearchIssue {
  id: string;
  ref: RecordRefLite;
  title: string;
  kind: ResearchIssueKind;
  detail?: string;
}

/** How many days of no update counts as "untouched" for research review (fact, not verdict). */
export const RESEARCH_STALE_DAYS = 180;

/** Research-integrity projection (Feature 10). Review only. */
export function researchIntegrity(state: StoreState, index: MaintenanceIndex, nowMs: number = Date.now()): ResearchIssue[] {
  const out: ResearchIssue[] = [];
  for (const r of state.researchProjects ?? []) {
    if (r.status === "archived") continue;
    const ref: RecordRefLite = { kind: "research_project", id: r.id };
    const title = r.title || r.question || "Research";
    const cites = index.citationsByRecord.get(refKey(ref)) ?? [];
    const a = r.assembly;
    const linkedCount = a ? a.sourceIds.length + a.beliefIds.length + a.conceptIds.length + a.threadIds.length + a.reasoningIds.length + a.frameworkIds.length + a.principleIds.length + a.formationIds.length + a.decisionIds.length : 0;
    if ((r.hypotheses?.length ?? 0) === 0) out.push({ id: `rh:${r.id}`, ref, title, kind: "no_hypothesis" });
    if (cites.length === 0 && (a?.sourceIds.length ?? 0) === 0) out.push({ id: `rc:${r.id}`, ref, title, kind: "no_citations" });
    if ((r.status === "investigating" || r.status === "synthesizing") && (r.argumentNodes?.length ?? 0) === 0) out.push({ id: `rcn:${r.id}`, ref, title, kind: "no_conclusion" });
    if (linkedCount === 0) out.push({ id: `rle:${r.id}`, ref, title, kind: "no_linked_entities" });
    const age = ageDays(r.updatedAt, nowMs);
    if (age >= RESEARCH_STALE_DAYS && age !== Number.POSITIVE_INFINITY) out.push({ id: `ru:${r.id}`, ref, title, kind: "untouched", detail: `${age} days` });
  }
  return out;
}

/** Count of research projects with at least one integrity note (dashboard: stale research). */
export function staleResearchCount(state: StoreState, index: MaintenanceIndex, nowMs: number = Date.now()): number {
  const flagged = new Set(researchIntegrity(state, index, nowMs).map((i) => i.ref.id));
  return flagged.size;
}

/** Count of uncited beliefs (dashboard: uncited claims). */
export function uncitedClaimCount(state: StoreState, index: MaintenanceIndex): number {
  return evidenceReview(state, index).filter((i) => i.kind === "belief_uncited" || i.kind === "outdated_citation").length;
}
