/**
 * Knowledge Health dashboard (LIFEOS-038, Feature 1).
 *
 * A deterministic summary of what may need maintenance — counts only, each with
 * the underlying candidate list one click away. NEVER a hidden score, never a
 * grade, never "healthy/unhealthy". Age and emptiness are facts the user acts on
 * or ignores. Pure; one shared index drives every count.
 */

import type { StoreState } from "@/types/mvp";
import { buildMaintenanceIndex, type MaintenanceIndex, orphanConcepts, orphanDocuments, orphanBeliefs } from "@/lib/maintenance/integrity";
import { duplicateCandidates } from "@/lib/maintenance/duplicates";
import { relationshipIssues } from "@/lib/maintenance/relationships";
import { citationIssues } from "@/lib/maintenance/citations";
import { uncitedClaimCount, staleResearchCount } from "@/lib/maintenance/evidence";
import { archivedItems } from "@/lib/maintenance/archive";
import { reviewQueue, inactiveProjects } from "@/lib/maintenance/review";

export interface HealthMetric {
  key: string;
  label: string;
  count: number;
  /** Where the "review these" action goes. */
  href: string;
}

export interface KnowledgeHealth {
  metrics: HealthMetric[];
  generatedFor: string; // ISO of when it was computed (display only; not persisted)
}

/**
 * Compute the whole dashboard from one index. Deterministic and orphan-safe.
 * `dismissed` (from prefs) suppresses hidden review items from the unresolved count.
 */
export function knowledgeHealth(state: StoreState, opts: { index?: MaintenanceIndex; dismissed?: string[]; nowMs?: number } = {}): KnowledgeHealth {
  const index = opts.index ?? buildMaintenanceIndex(state);
  const nowMs = opts.nowMs ?? Date.now();
  const relIssues = relationshipIssues(state, index);
  const citIssues = citationIssues(state, index);

  const metrics: HealthMetric[] = [
    { key: "orphan_entities", label: "Orphan entities", count: orphanConcepts(state, index).length, href: "/maintenance/review?reason=orphan" },
    { key: "orphan_documents", label: "Orphan documents", count: orphanDocuments(state, index).length, href: "/maintenance/review?reason=orphan" },
    { key: "orphan_beliefs", label: "Orphan beliefs", count: orphanBeliefs(state, index).length, href: "/maintenance/review?reason=orphan" },
    { key: "uncited_claims", label: "Uncited claims", count: uncitedClaimCount(state, index), href: "/maintenance/evidence" },
    { key: "duplicate_candidates", label: "Duplicate candidates", count: duplicateCandidates(state, index).length, href: "/maintenance/duplicates" },
    { key: "archived_items", label: "Archived items", count: archivedItems(state, index).length, href: "/maintenance/archive" },
    { key: "unresolved_maintenance", label: "Unresolved maintenance items", count: reviewQueue(state, index, { dismissed: opts.dismissed, nowMs }).length, href: "/maintenance/review" },
    { key: "inactive_projects", label: "Inactive projects", count: inactiveProjects(state, index, nowMs).length, href: "/maintenance/review?reason=inactive" },
    { key: "stale_research", label: "Stale research", count: staleResearchCount(state, index, nowMs), href: "/maintenance/evidence" },
    { key: "broken_references", label: "Broken references", count: relIssues.length + citIssues.length, href: "/maintenance/relationships" },
  ];

  return { metrics, generatedFor: new Date(nowMs).toISOString() };
}

/** The single "needs attention" headline number (sum of actionable metrics). */
export function healthTotal(health: KnowledgeHealth): number {
  const attention = new Set(["orphan_entities", "orphan_documents", "orphan_beliefs", "uncited_claims", "duplicate_candidates", "broken_references"]);
  return health.metrics.filter((m) => attention.has(m.key)).reduce((n, m) => n + m.count, 0);
}
