/**
 * Citation integrity (LIFEOS-038, Feature 9).
 *
 * Deterministically detects duplicate citations, missing/deleted citation
 * targets, and citations owned by a record that no longer exists — and offers
 * REPAIR affordances (remove the broken citation, or open the target). Never
 * fabricates a citation, never repairs automatically. Pure and indexed.
 */

import type { StoreState, Citation, RecordRefLite } from "@/types/mvp";
import { type MaintenanceIndex } from "@/lib/maintenance/integrity";

export type CitationIssueKind =
  | "duplicate_citation"
  | "missing_target"
  | "deleted_location"
  | "invalid_owner";

export const CITATION_ISSUE_LABEL: Record<CitationIssueKind, string> = {
  duplicate_citation: "Duplicate citation",
  missing_target: "Citation target document is missing",
  deleted_location: "Cited passage/section was deleted",
  invalid_owner: "Citation owned by a record that no longer exists",
};

export type CitationRepair = "remove" | "open_target" | "relink";

export interface CitationIssue {
  id: string;
  citationId: string;
  kind: CitationIssueKind;
  detail?: string;
  /** The owning record, for navigation. */
  owner: RecordRefLite;
  documentId: string;
  /** Suggested repairs (the user chooses; nothing is applied automatically). */
  repairs: CitationRepair[];
}

/** A stable signature for duplicate detection: same owner + document + location. */
function citationSignature(c: Citation): string {
  return [c.recordKind, c.recordId, c.documentId, c.sectionId ?? "", c.passageId ?? "", c.page ?? "", c.location ?? "", c.highlightId ?? ""].join("|");
}

/** Deterministic citation-integrity report. */
export function citationIssues(state: StoreState, index: MaintenanceIndex): CitationIssue[] {
  const out: CitationIssue[] = [];
  const bySig = new Map<string, Citation[]>();

  for (const c of state.citations ?? []) {
    const owner: RecordRefLite = { kind: c.recordKind, id: c.recordId };
    // Missing target document.
    if (!index.documentIds.has(c.documentId)) {
      out.push({ id: `mt:${c.id}`, citationId: c.id, kind: "missing_target", detail: `document ${c.documentId}`, owner, documentId: c.documentId, repairs: ["remove"] });
    } else {
      // Deleted section/passage within an existing document.
      if (c.passageId && !index.passageIds.has(c.passageId)) out.push({ id: `dl:${c.id}`, citationId: c.id, kind: "deleted_location", detail: `passage ${c.passageId}`, owner, documentId: c.documentId, repairs: ["remove", "relink", "open_target"] });
      else if (c.sectionId && !index.sectionIds.has(c.sectionId)) out.push({ id: `dl:${c.id}:s`, citationId: c.id, kind: "deleted_location", detail: `section ${c.sectionId}`, owner, documentId: c.documentId, repairs: ["remove", "relink", "open_target"] });
    }
    // Owner record no longer exists.
    if (!index.has(owner)) out.push({ id: `io:${c.id}`, citationId: c.id, kind: "invalid_owner", detail: `${c.recordKind} ${c.recordId}`, owner, documentId: c.documentId, repairs: ["remove"] });
    // Bucket for duplicate detection.
    const sig = citationSignature(c);
    (bySig.get(sig) ?? bySig.set(sig, []).get(sig)!).push(c);
  }

  // Duplicate citations: identical signature, more than once. All but the first are flagged.
  for (const group of bySig.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || a.id.localeCompare(b.id));
    for (const dup of sorted.slice(1)) {
      out.push({ id: `dup:${dup.id}`, citationId: dup.id, kind: "duplicate_citation", detail: `copy of ${sorted[0].id}`, owner: { kind: dup.recordKind, id: dup.recordId }, documentId: dup.documentId, repairs: ["remove"] });
    }
  }

  return out;
}

/** Count of citation-integrity issues. */
export function citationIssueCount(state: StoreState, index: MaintenanceIndex): number {
  return citationIssues(state, index).length;
}
