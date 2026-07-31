/**
 * Reading activity (LIFEOS-039, Feature 8).
 *
 * Documents opened, reading events (highlights/annotations), citations created,
 * entities/beliefs linked, last-opened dates, and unfinished reading selected in
 * planning. Comprehension is never inferred; no reading-quality score. Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { countType } from "@/lib/insights/metrics";

export interface ReadingActivity {
  documentsOpened: number;
  highlights: number;
  annotations: number;
  citationsCreated: number;
  entitiesLinked: number;
  beliefsLinked: number;
  /** Documents with a recorded last-opened date, most recent first. */
  lastOpened: { id: string; title: string; at: string }[];
  /** Documents currently selected in planning (unfinished reading the user chose to plan). */
  unfinishedPlanned: { id: string; title: string }[];
}

export function readingActivity(state: StoreState, index: ActivityEvent[], range: ResolvedRange): ReadingActivity {
  const ev = eventsInRange(index, range);
  const citationsCreated = ev.filter((e) => e.type === "citation_added").length;
  // Beliefs linked via a citation created in range; entities linked via highlight/annotation.
  const beliefsLinked = ev.filter((e) => e.type === "citation_added" && e.recordKind === "belief").length;
  const entitiesLinked = ev.filter((e) => e.type === "citation_added" && (e.recordKind === "concept" || e.recordKind === "belief")).length;

  const docs = state.documents ?? [];
  const lastOpened = docs
    .filter((d) => d.progress?.lastOpenedAt)
    .map((d) => ({ id: d.id, title: d.title, at: d.progress!.lastOpenedAt! }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  const plannedDocIds = new Set((state.planningAssignments ?? []).filter((p) => p.ref.kind === "document").map((p) => p.ref.id));
  const unfinishedPlanned = docs
    .filter((d) => plannedDocIds.has(d.id) && d.status !== "completed")
    .map((d) => ({ id: d.id, title: d.title }));

  return {
    documentsOpened: new Set(ev.filter((e) => e.type === "document_opened").map((e) => e.recordId)).size,
    highlights: countType(ev, "highlight_created"),
    annotations: countType(ev, "annotation_created"),
    citationsCreated,
    entitiesLinked,
    beliefsLinked,
    lastOpened,
    unfinishedPlanned,
  };
}
