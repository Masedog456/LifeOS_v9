/**
 * The unified activity index (LIFEOS-039).
 *
 * ONE deterministic, time-sorted stream of normalized `ActivityEvent`s flattened
 * from the compact histories already recorded across LifeOS — sessions, focus
 * sessions, actions, planning, captures, reading, citations, beliefs, concepts,
 * research, daily reviews, and maintenance events. Built ONCE per store snapshot
 * (memoize at the call site); every insight view derives from a range-bounded
 * slice of it rather than re-scanning every record array per card. Pure — no AI,
 * no interpretation, no new persisted events (this only reads existing history).
 */

import type { StoreState } from "@/types/mvp";
import type { ResolvedRange } from "@/lib/insights/range";

/** A normalized, attributed activity event. `at` is an ISO instant. */
export interface ActivityEvent {
  at: string;
  type: string;
  recordKind: string;
  recordId: string;
  workspaceId?: string;
  goalId?: string;
  projectId?: string;
  milestoneId?: string;
  /** Recorded duration in ms (sessions / focus sessions only). */
  durationMs?: number;
  /** Compact, safe descriptor (a status, a category, a reason) — never full text. */
  detail?: string;
}

const num = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/**
 * Flatten every recorded history into one sorted event stream. Deterministic and
 * bounded by the total number of history events already stored.
 */
export function buildActivityIndex(state: StoreState): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const push = (e: ActivityEvent) => { if (e.at && !Number.isNaN(num(e.at))) out.push(e); };

  // Sessions (LIFEOS-030): started/ended + attribution; open sessions have no end event.
  for (const s of state.sessions ?? []) {
    const attr = { workspaceId: s.workspaceId, goalId: s.goalId, projectId: s.projectId };
    push({ at: s.startedAt, type: "session_started", recordKind: "session", recordId: s.id, ...attr, detail: s.type });
    if (s.endedAt) {
      const d = num(s.endedAt) - num(s.startedAt);
      push({ at: s.endedAt, type: "session_ended", recordKind: "session", recordId: s.id, ...attr, durationMs: d > 0 ? d : 0, detail: s.type });
    }
    for (const a of s.activity ?? []) {
      if (a.type === "opened_entity" || a.type === "inspector") push({ at: a.at, type: "entity_opened", recordKind: a.entityKind || "entity", recordId: a.entityId || a.id, ...attr });
      else if (a.type === "search") push({ at: a.at, type: "search_performed", recordKind: "search", recordId: a.id, ...attr });
    }
  }

  // Focus sessions (LIFEOS-037): started/ended (with duration) + interruptions.
  for (const f of state.focusSessions ?? []) {
    const projectId = f.targetKind === "project" ? f.ref.id : undefined;
    const milestoneId = f.targetKind === "milestone" ? f.ref.id : undefined;
    push({ at: f.startedAt, type: "focus_started", recordKind: f.ref.kind, recordId: f.ref.id, projectId, milestoneId, detail: f.targetKind });
    if (f.endedAt) {
      const d = num(f.endedAt) - num(f.startedAt);
      push({ at: f.endedAt, type: "focus_ended", recordKind: f.ref.kind, recordId: f.ref.id, projectId, milestoneId, durationMs: d > 0 ? d : 0, detail: f.targetKind });
    }
    for (const i of f.interruptions ?? []) push({ at: i.at, type: "interruption_logged", recordKind: f.ref.kind, recordId: f.ref.id, projectId, milestoneId, detail: i.category });
  }

  // Next actions (LIFEOS-036): each compact history event + completion.
  for (const a of state.nextActions ?? []) {
    const attr = { projectId: a.projectId, milestoneId: a.milestoneId };
    push({ at: a.createdAt, type: "action_created", recordKind: "action", recordId: a.id, ...attr });
    for (const e of a.history ?? []) {
      // `returned` joins the map in LIFEOS-070. It was the one recorded action
      // transition the shared index dropped, which meant a deferral coming back
      // was invisible to every consumer built on this stream — dormancy, the
      // Return card, Week in Review and commitment awareness alike.
      const map: Record<string, string> = { started: "action_started", completed: "action_completed", deferred: "action_deferred", returned: "action_returned", waiting: "action_waiting", cancelled: "action_cancelled", restored: "action_restored", reopened: "action_restored" };
      let t = map[e.action];
      // LIFEOS-073 §12. `stopWaiting` records leaving a wait as a GENERIC
      // `edited` event — deliberately, because no existing kind means "stopped
      // waiting" and LIFEOS-071 was told not to invent one. The transition is
      // still structural: `fromStatus: "waiting"` is on the event. Read the
      // fields, never the detail string, so a reworded detail cannot silently
      // drop the fact.
      if (!t && e.action === "edited" && e.fromStatus === "waiting" && e.toStatus !== "waiting") {
        t = "action_waiting_stopped";
      }
      // §10: date facts the index dropped. Both are explicit recorded events.
      if (!t && (e.action === "due_set" || e.action === "due_cleared")) {
        t = e.action === "due_set" ? "action_due_set" : "action_due_cleared";
      }
      // §11: `unblocked` is written by `removeActionDependency` for EVERY edge
      // removal, whether or not it was the last blocker, and the far commoner
      // route to being unblocked — the blocker being completed — writes nothing
      // here at all. So this proves "a prerequisite link was removed", and it is
      // named for that. It must never be read as "became unblocked".
      if (!t && e.action === "unblocked") t = "action_prerequisite_removed";
      if (t) push({ at: e.at, type: t, recordKind: "action", recordId: a.id, ...attr, detail: e.detail });
    }
  }

  // Planning assignments (LIFEOS-037): plan/move/reorder history.
  for (const p of state.planningAssignments ?? []) {
    for (const e of p.history ?? []) {
      const map: Record<string, string> = { planned: "planning_planned", moved: "planning_moved", reordered: "planning_reordered", unplanned: "planning_unplanned" };
      const t = map[e.action];
      if (t) push({ at: e.at, type: t, recordKind: p.ref.kind, recordId: p.ref.id, projectId: p.ref.kind === "project" ? p.ref.id : undefined, detail: e.toHorizon });
    }
  }

  // Captures (LIFEOS-035): created / processed + processing history.
  for (const c of state.captures ?? []) {
    const projectId = (c.linkedProjectIds ?? [])[0];
    const goalId = (c.linkedGoalIds ?? [])[0];
    const workspaceId = (c.linkedWorkspaceIds ?? [])[0];
    const attr = { projectId, goalId, workspaceId };
    push({ at: c.createdAt, type: "capture_created", recordKind: "capture", recordId: c.id, ...attr });
    if (c.processedAt) push({ at: c.processedAt, type: "capture_processed", recordKind: "capture", recordId: c.id, ...attr, detail: c.processingStatus });
    for (const e of c.history ?? []) {
      const t = (e as { action?: string; type?: string }).action || (e as { type?: string }).type;
      const at = (e as { at?: string }).at;
      if (t && at) push({ at, type: `capture_${t}`, recordKind: "capture", recordId: c.id, ...attr });
    }
  }

  // Reading (LIFEOS-028): opened, highlights, annotations.
  for (const d of state.documents ?? []) {
    if (d.progress?.lastOpenedAt) push({ at: d.progress.lastOpenedAt, type: "document_opened", recordKind: "document", recordId: d.id });
    for (const sec of d.sections ?? []) for (const p of sec.passages ?? []) {
      for (const h of p.highlights ?? []) push({ at: h.createdAt, type: "highlight_created", recordKind: "document", recordId: d.id });
      for (const an of p.annotations ?? []) push({ at: an.createdAt, type: "annotation_created", recordKind: "document", recordId: d.id });
    }
  }

  // Citations (LIFEOS-028): created, attributed to the owning record.
  for (const c of state.citations ?? []) push({ at: c.createdAt, type: "citation_added", recordKind: c.recordKind, recordId: c.recordId, detail: c.documentId });

  // Beliefs (LIFEOS-002): created + reviewed (judgments) + revised (revisions).
  for (const b of state.beliefs ?? []) {
    push({ at: b.createdAt, type: "belief_created", recordKind: "belief", recordId: b.id });
    for (const j of b.judgments ?? []) if ((j as { at?: string }).at) push({ at: (j as { at: string }).at, type: "belief_reviewed", recordKind: "belief", recordId: b.id });
    for (const r of b.revisions ?? []) if ((r as { at?: string }).at) push({ at: (r as { at: string }).at, type: "belief_revised", recordKind: "belief", recordId: b.id });
  }

  // Concepts (LIFEOS-005) + approved relationships (LIFEOS-039 knowledge activity).
  for (const c of state.concepts ?? []) push({ at: c.createdAt, type: "entity_created", recordKind: "concept", recordId: c.id });
  for (const r of state.conceptRelationships ?? []) if (r.approved) push({ at: r.createdAt, type: "relationship_added", recordKind: "relationship", recordId: r.id });

  // Research (LIFEOS-024): each history entry counts as a touch.
  for (const r of state.researchProjects ?? []) {
    push({ at: r.createdAt, type: "research_created", recordKind: "research_project", recordId: r.id });
    for (const e of r.history ?? []) if ((e as { at?: string }).at) push({ at: (e as { at: string }).at, type: "research_touched", recordKind: "research_project", recordId: r.id });
  }

  // Daily reviews (LIFEOS-034): completion.
  for (const rv of state.dailyReviews ?? []) push({ at: rv.createdAt || `${rv.date}T12:00:00.000Z`, type: "review_completed", recordKind: "daily_review", recordId: rv.id });

  // Maintenance (LIFEOS-038): the flat event log — one normalized event each.
  for (const e of state.maintenanceEvents ?? []) push({ at: e.at, type: `maintenance_${e.kind}`, recordKind: e.ref.kind, recordId: e.ref.id, detail: e.detail });

  // Sort by precomputed numeric timestamp (avoids O(n log n) Date.parse calls).
  const withTs = out.map((e) => ({ e, t: num(e.at) }));
  withTs.sort((a, b) => a.t - b.t || a.e.type.localeCompare(b.e.type));
  return withTs.map((x) => x.e);
}

/**
 * Range-bounded slice of a sorted index (binary-searched by `at`). The index is
 * ascending, so we find the first in-range event and take the contiguous run.
 */
export function eventsInRange(index: ActivityEvent[], range: ResolvedRange): ActivityEvent[] {
  // Lower bound: first event with at >= startMs.
  let lo = 0, hi = index.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (num(index[mid].at) < range.startMs) lo = mid + 1; else hi = mid; }
  const out: ActivityEvent[] = [];
  for (let i = lo; i < index.length; i++) {
    const t = num(index[i].at);
    if (t >= range.endMs) break;
    out.push(index[i]);
  }
  return out;
}

/** Convenience: all events touching a given record (any time). */
export function eventsForRecord(index: ActivityEvent[], kind: string, id: string): ActivityEvent[] {
  return index.filter((e) => e.recordKind === kind && e.recordId === id);
}

/** The earliest recorded event instant (for coverage). */
export function earliestEvent(index: ActivityEvent[]): string | undefined {
  return index.length ? index[0].at : undefined;
}
