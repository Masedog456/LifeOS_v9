/**
 * Per-record maintenance health (LIFEOS-038, Feature 11).
 *
 * Everything the inspector needs about ONE record: staleness, review &
 * maintenance history, citation integrity, relationship integrity, archive
 * status, and duplicate candidates that include it. Pure projection over the
 * shared index — deterministic, no scores, no mutation.
 */

import type { StoreState, RecordRefLite, MaintenanceEvent, DuplicateCandidate } from "@/types/mvp";
import { buildMaintenanceIndex, type MaintenanceIndex, refKey, isArchived } from "@/lib/maintenance/integrity";
import { stalenessFor, type Staleness } from "@/lib/maintenance/staleness";
import { maintenanceHistoryFor } from "@/lib/maintenance/history";
import { citationIssues, type CitationIssue } from "@/lib/maintenance/citations";
import { relationshipIssues, type RelationshipIssue } from "@/lib/maintenance/relationships";
import { duplicateCandidates } from "@/lib/maintenance/duplicates";

export interface RecordHealth {
  ref: RecordRefLite;
  archived: boolean;
  staleness: Staleness;
  history: MaintenanceEvent[];
  reviewedAt?: string;
  citationIssues: CitationIssue[];
  relationshipIssues: RelationshipIssue[];
  duplicates: DuplicateCandidate[];
  /** True when nothing needs attention for this record. */
  clean: boolean;
}

export function recordHealth(state: StoreState, ref: RecordRefLite, index?: MaintenanceIndex): RecordHealth {
  const idx = index ?? buildMaintenanceIndex(state);
  const key = refKey(ref);
  const staleness = stalenessFor(state, idx, ref);
  const history = maintenanceHistoryFor(state.maintenanceEvents ?? [], ref);
  const cIssues = citationIssues(state, idx).filter((i) => refKey(i.owner) === key || (ref.kind === "document" && i.documentId === ref.id) || (ref.kind === "citation" && i.citationId === ref.id));
  const rIssues = relationshipIssues(state, idx).filter((i) => refKey(i.ref) === key || (i.relatedRef && refKey(i.relatedRef) === key));
  const dups = duplicateCandidates(state, idx).filter((d) => d.members.some((m) => refKey(m) === key));
  const archived = isArchived(idx, ref);
  const clean = cIssues.length === 0 && rIssues.length === 0 && dups.length === 0;
  return { ref, archived, staleness, history, reviewedAt: staleness.lastReviewed, citationIssues: cIssues, relationshipIssues: rIssues, duplicates: dups, clean };
}
