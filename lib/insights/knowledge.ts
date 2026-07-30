/**
 * Knowledge activity (LIFEOS-039, Feature 9).
 *
 * Entities/beliefs created, beliefs reviewed, citations & relationships added,
 * research touched, maintenance events, merged/archived records, and the
 * most-referenced records by RAW backlink count. Raw counts are labelled
 * clearly; frequently-referenced records are never called "important". Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { countType } from "@/lib/insights/metrics";

export interface KnowledgeActivity {
  entitiesCreated: number;
  beliefsCreated: number;
  beliefsReviewed: number;
  citationsAdded: number;
  relationshipsAdded: number;
  researchTouched: number;
  maintenanceEvents: number;
  merged: number;
  archived: number;
  /** Records with the highest RAW backlink count (all-time, not range-bounded). */
  mostReferenced: { kind: string; id: string; backlinks: number }[];
}

/**
 * Raw backlink counts: how many records point AT each target. Bounded by the
 * total number of references; the same indexing approach as maintenance.
 */
function backlinkCounts(state: StoreState): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (kind: string, id: string | undefined | null) => { if (id) { const k = `${kind}:${id}`; counts.set(k, (counts.get(k) ?? 0) + 1); } };
  for (const c of state.concepts ?? []) {
    for (const id of c.relatedBeliefs ?? []) bump("belief", id);
    for (const id of c.relatedConcepts ?? []) bump("concept", id);
    for (const id of c.relatedSources ?? []) bump("source", id);
  }
  for (const r of state.conceptRelationships ?? []) if (r.approved) { bump("concept", r.fromConceptId); bump("concept", r.toConceptId); }
  for (const c of state.citations ?? []) { bump("document", c.documentId); bump(c.recordKind, c.recordId); }
  return counts;
}

export function knowledgeActivity(state: StoreState, index: ActivityEvent[], range: ResolvedRange): KnowledgeActivity {
  const ev = eventsInRange(index, range);
  const counts = backlinkCounts(state);
  const mostReferenced = [...counts.entries()]
    .map(([k, backlinks]) => { const i = k.indexOf(":"); return { kind: k.slice(0, i), id: k.slice(i + 1), backlinks }; })
    .sort((a, b) => b.backlinks - a.backlinks || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
    .slice(0, 15);

  return {
    entitiesCreated: countType(ev, "entity_created"),
    beliefsCreated: countType(ev, "belief_created"),
    beliefsReviewed: countType(ev, "belief_reviewed"),
    citationsAdded: countType(ev, "citation_added"),
    relationshipsAdded: countType(ev, "relationship_added"),
    researchTouched: new Set(ev.filter((e) => e.type === "research_touched" || e.type === "research_created").map((e) => e.recordId)).size,
    maintenanceEvents: ev.filter((e) => e.type.startsWith("maintenance_")).length,
    merged: countType(ev, "maintenance_merged"),
    archived: countType(ev, "maintenance_archived"),
    mostReferenced,
  };
}
