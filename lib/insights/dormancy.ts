/**
 * Dormancy view (LIFEOS-039, Feature 15).
 *
 * Records with NO recorded activity within a user-chosen inactivity window.
 * Wording is strictly neutral — "No recorded activity in 90 days." — and records
 * are NEVER called abandoned, stale, neglected, or unhealthy unless that is an
 * explicit stored status. Pure.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { todayKey, dayBoundsLocal, type DayKey } from "@/lib/reviews/dates";

export type DormancyKind = "project" | "goal" | "milestone" | "action" | "document" | "research_project" | "belief" | "concept";

export const DORMANCY_KINDS: DormancyKind[] = ["project", "goal", "milestone", "action", "document", "research_project", "belief", "concept"];

export const DORMANCY_KIND_LABEL: Record<DormancyKind, string> = {
  project: "Projects", goal: "Goals", milestone: "Milestones", action: "Actions",
  document: "Documents", research_project: "Research", belief: "Beliefs", concept: "Entities",
};

export interface DormantRecord {
  kind: string;
  id: string;
  title: string;
  /** Whole days since the most recent recorded activity (Infinity → never). */
  inactiveDays: number;
  lastActivity?: string;
}

/**
 * Most-recent activity instant per `kind:id` across the whole index. An event
 * credits its own record AND the project/goal/milestone/workspace it is
 * attributed to, so a project with a linked action counts as touched (matching
 * the "touched = at least one linked event" rule). Built once.
 */
export function lastActivityByRecord(index: ActivityEvent[]): Map<string, string> {
  const last = new Map<string, string>();
  const bump = (kind: string, id: string | undefined, at: string) => { if (id) { const k = `${kind}:${id}`; const cur = last.get(k); if (!cur || at > cur) last.set(k, at); } };
  for (const e of index) {
    bump(e.recordKind, e.recordId, e.at);
    bump("project", e.projectId, e.at);
    bump("goal", e.goalId, e.at);
    bump("milestone", e.milestoneId, e.at);
    bump("workspace", e.workspaceId, e.at);
  }
  return last;
}

function records(state: StoreState, kind: DormancyKind): { id: string; title: string }[] {
  switch (kind) {
    case "project": return (state.projects ?? []).map((p) => ({ id: p.id, title: p.title }));
    case "goal": return (state.goals ?? []).map((g) => ({ id: g.id, title: g.title }));
    case "milestone": return (state.projects ?? []).flatMap((p) => (p.milestones ?? []).map((m) => ({ id: m.id, title: m.title })));
    case "action": return (state.nextActions ?? []).map((a) => ({ id: a.id, title: a.title }));
    case "document": return (state.documents ?? []).map((d) => ({ id: d.id, title: d.title }));
    case "research_project": return (state.researchProjects ?? []).map((r) => ({ id: r.id, title: r.title || r.question || "Research" }));
    case "belief": return (state.beliefs ?? []).map((b) => ({ id: b.id, title: b.text.slice(0, 60) }));
    case "concept": return (state.concepts ?? []).map((c) => ({ id: c.id, title: c.name }));
    default: return [];
  }
}

/**
 * Records of the given kinds with no activity within `thresholdDays`. Sorted by
 * inactivity descending (longest-untouched first) — a neutral ordering, not a
 * ranking of neglect.
 */
export function dormancyView(state: StoreState, index: ActivityEvent[], thresholdDays: number, kinds: DormancyKind[] = DORMANCY_KINDS, today: DayKey = todayKey()): DormantRecord[] {
  const last = lastActivityByRecord(index);
  const nowMs = dayBoundsLocal(today).end.getTime();
  const cutoffMs = nowMs - thresholdDays * 86400000;
  const out: DormantRecord[] = [];
  for (const kind of kinds) {
    for (const r of records(state, kind)) {
      const lastAt = last.get(`${kind}:${r.id}`);
      const lastMs = lastAt ? Date.parse(lastAt) : NaN;
      const dormant = Number.isNaN(lastMs) || lastMs < cutoffMs;
      if (!dormant) continue;
      const inactiveDays = Number.isNaN(lastMs) ? Number.POSITIVE_INFINITY : Math.floor((nowMs - lastMs) / 86400000);
      out.push({ kind, id: r.id, title: r.title, inactiveDays, lastActivity: lastAt });
    }
  }
  return out.sort((a, b) => b.inactiveDays - a.inactiveDays || a.title.localeCompare(b.title));
}

/** Neutral phrasing, e.g. "No recorded activity in 90 days." */
export function dormancyPhrase(rec: DormantRecord): string {
  if (rec.inactiveDays === Number.POSITIVE_INFINITY) return "No recorded activity.";
  return `No recorded activity in ${rec.inactiveDays} day${rec.inactiveDays === 1 ? "" : "s"}.`;
}

/** As a ref for entity resolution. */
export function dormantRef(rec: DormantRecord): RecordRefLite { return { kind: rec.kind, id: rec.id }; }
