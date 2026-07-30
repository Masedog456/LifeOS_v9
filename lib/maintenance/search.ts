/**
 * Maintenance search filters (LIFEOS-038, Feature 14).
 *
 * Deterministic ref-key sets for the maintenance flags a user can filter by —
 * needs review, orphan, duplicate, archived, uncited, inactive, maintenance
 * resolved. Built from the shared index so the global search (or the review
 * page) can intersect a text result set with any flag. Pure.
 */

import type { StoreState } from "@/types/mvp";
import { buildMaintenanceIndex, type MaintenanceIndex, refKey, orphanConcepts, orphanDocuments, orphanBeliefs } from "@/lib/maintenance/integrity";
import { duplicateCandidates } from "@/lib/maintenance/duplicates";
import { evidenceReview } from "@/lib/maintenance/evidence";
import { reviewQueue, inactiveProjects } from "@/lib/maintenance/review";

export type MaintenanceFilter =
  | "needs_review" | "orphan" | "duplicate" | "archived" | "uncited" | "inactive" | "maintenance_resolved";

export const MAINTENANCE_FILTER_LABEL: Record<MaintenanceFilter, string> = {
  needs_review: "Needs review",
  orphan: "Orphan",
  duplicate: "Duplicate",
  archived: "Archived",
  uncited: "Uncited",
  inactive: "Inactive",
  maintenance_resolved: "Maintenance resolved",
};

/** Ref-key sets per maintenance filter. Reused by search and the review page. */
export function maintenanceFilterSets(state: StoreState, index?: MaintenanceIndex, nowMs: number = Date.now()): Record<MaintenanceFilter, Set<string>> {
  const idx = index ?? buildMaintenanceIndex(state);
  const orphan = new Set<string>();
  for (const r of orphanConcepts(state, idx)) orphan.add(refKey(r));
  for (const r of orphanDocuments(state, idx)) orphan.add(refKey(r));
  for (const r of orphanBeliefs(state, idx)) orphan.add(refKey(r));

  const duplicate = new Set<string>();
  for (const d of duplicateCandidates(state, idx)) for (const m of d.members) duplicate.add(refKey(m));

  const uncited = new Set<string>();
  for (const e of evidenceReview(state, idx)) if (e.kind === "belief_uncited" || e.kind === "outdated_citation") uncited.add(refKey(e.ref));

  const inactive = new Set(inactiveProjects(state, idx, nowMs).map(refKey));
  const needsReview = new Set(reviewQueue(state, idx, { nowMs }).map((i) => refKey(i.ref)));

  const resolved = new Set<string>();
  for (const ev of state.maintenanceEvents ?? []) if (ev.kind === "maintenance_resolved") resolved.add(refKey(ev.ref));

  return {
    needs_review: needsReview,
    orphan,
    duplicate,
    archived: new Set(index?.archived ?? idx.archived),
    uncited,
    inactive,
    maintenance_resolved: resolved,
  };
}
