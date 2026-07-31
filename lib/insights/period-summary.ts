/**
 * Period summary (LIFEOS-039, Feature 13).
 *
 * A deterministic, sectioned summary of a period — Started, Continued,
 * Completed, Changed, Reviewed, Learned, Deferred, Waiting, Archived — each
 * generated from EXPLICIT event rules. No generated prose, no interpretive
 * narrative, no recommendations. Pure.
 */

import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";

export interface PeriodSummaryItem { kind: string; id: string; at: string; type: string }
export interface PeriodSummarySection { key: string; label: string; count: number; items: PeriodSummaryItem[] }

const item = (e: ActivityEvent): PeriodSummaryItem => ({ kind: e.recordKind, id: e.recordId, at: e.at, type: e.type });

/** Deterministic section rules over the range slice. Every rule is an event filter. */
export function periodSummary(index: ActivityEvent[], range: ResolvedRange): PeriodSummarySection[] {
  const ev = eventsInRange(index, range);
  const pick = (types: string[]) => ev.filter((e) => types.includes(e.type)).map(item);
  const sections: Omit<PeriodSummarySection, "count">[] = [
    { key: "started", label: "Started", items: pick(["action_started", "focus_started", "session_started", "research_created"]) },
    { key: "continued", label: "Continued", items: pick(["research_touched", "belief_revised", "document_opened"]) },
    { key: "completed", label: "Completed", items: pick(["action_completed"]) },
    { key: "changed", label: "Changed", items: pick(["planning_moved", "maintenance_merged", "belief_revised"]) },
    { key: "reviewed", label: "Reviewed", items: pick(["review_completed", "belief_reviewed", "maintenance_reviewed"]) },
    { key: "learned", label: "Learned", items: pick(["citation_added", "highlight_created", "annotation_created", "entity_created"]) },
    { key: "deferred", label: "Deferred", items: pick(["action_deferred"]) },
    { key: "waiting", label: "Waiting", items: pick(["action_waiting"]) },
    { key: "archived", label: "Archived", items: pick(["maintenance_archived", "action_cancelled"]) },
  ];
  return sections.map((s) => ({ ...s, count: s.items.length }));
}
