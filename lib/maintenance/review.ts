/**
 * Knowledge review queue (LIFEOS-038, Feature 5).
 *
 * ONE deterministic queue that aggregates every maintenance candidate —
 * orphans, duplicates, stale records, uncited claims, broken references,
 * inactive projects, archive candidates, relationship/reference issues, and
 * records the user asked to review. Everything is manual: the queue lists
 * candidates; dismiss / archive / link / merge / ignore / resolve are explicit
 * user actions recorded as maintenance events. Pure, indexed, orphan-safe.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { type MaintenanceIndex, refKey, orphanConcepts, orphanDocuments, orphanBeliefs } from "@/lib/maintenance/integrity";
import { duplicateCandidates } from "@/lib/maintenance/duplicates";
import { relationshipIssues } from "@/lib/maintenance/relationships";
import { citationIssues } from "@/lib/maintenance/citations";
import { evidenceReview, researchIntegrity } from "@/lib/maintenance/evidence";
import { archiveCandidates } from "@/lib/maintenance/archive";
import { ageDays } from "@/lib/maintenance/staleness";

export type ReviewReason =
  | "orphan"
  | "duplicate"
  | "stale"
  | "uncited"
  | "broken"
  | "inactive"
  | "archive_candidate"
  | "relationship_issue"
  | "reference_issue"
  | "review_requested";

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  orphan: "Orphan — nothing links to it",
  duplicate: "Possible duplicate",
  stale: "Stale — untouched for a long time",
  uncited: "Uncited claim",
  broken: "Broken reference",
  inactive: "Inactive project",
  archive_candidate: "Archive candidate",
  relationship_issue: "Relationship issue",
  reference_issue: "Reference issue",
  review_requested: "You marked this for review",
};

export type ReviewAction = "dismiss" | "archive" | "link" | "merge" | "ignore" | "resolve" | "review";

export interface ReviewItem {
  id: string;
  ref: RecordRefLite;
  reason: ReviewReason;
  detail?: string;
  actions: ReviewAction[];
}

/** How old an active project (no update, no open action) counts as inactive. */
export const INACTIVE_PROJECT_DAYS = 60;

/** Active projects that look dormant: no open/in-progress action and untouched a while. */
export function inactiveProjects(state: StoreState, index: MaintenanceIndex, nowMs: number = Date.now()): RecordRefLite[] {
  const openByProject = new Set<string>();
  for (const a of state.nextActions ?? []) if ((a.status === "open" || a.status === "in_progress") && a.projectId) openByProject.add(a.projectId);
  const out: RecordRefLite[] = [];
  for (const p of state.projects ?? []) {
    if (p.status !== "active") continue;
    const ref: RecordRefLite = { kind: "project", id: p.id };
    if (index.archived.has(refKey(ref))) continue;
    const age = ageDays(p.updatedAt, nowMs);
    if (!openByProject.has(p.id) && age >= INACTIVE_PROJECT_DAYS && age !== Number.POSITIVE_INFINITY) out.push(ref);
  }
  return out;
}

export interface ReviewQueueOptions {
  /** Review-item ids the user dismissed (from prefs) — suppressed from the queue. */
  dismissed?: string[];
  nowMs?: number;
}

/**
 * Build the full review queue. Deterministic order (by reason group, then ref).
 * Dismissed items are suppressed. Each record appears once per distinct reason.
 */
export function reviewQueue(state: StoreState, index: MaintenanceIndex, opts: ReviewQueueOptions = {}): ReviewItem[] {
  const nowMs = opts.nowMs ?? Date.now();
  const dismissed = new Set(opts.dismissed ?? []);
  const items: ReviewItem[] = [];
  const push = (id: string, ref: RecordRefLite, reason: ReviewReason, actions: ReviewAction[], detail?: string) => {
    if (dismissed.has(id)) return;
    items.push({ id, ref, reason, detail, actions });
  };

  // Orphans.
  for (const r of orphanConcepts(state, index)) push(`orphan:${refKey(r)}`, r, "orphan", ["archive", "link", "dismiss", "review"]);
  for (const r of orphanDocuments(state, index)) push(`orphan:${refKey(r)}`, r, "orphan", ["archive", "link", "dismiss", "review"]);
  for (const r of orphanBeliefs(state, index)) push(`orphan:${refKey(r)}`, r, "orphan", ["archive", "link", "dismiss", "review"]);

  // Duplicates (open only).
  for (const d of duplicateCandidates(state, index)) push(`duplicate:${d.id}`, d.members[0], "duplicate", ["merge", "ignore", "dismiss"], d.key);

  // Uncited / evidence.
  for (const e of evidenceReview(state, index)) {
    if (e.kind === "belief_uncited" || e.kind === "outdated_citation") push(`uncited:${refKey(e.ref)}`, e.ref, "uncited", ["link", "archive", "ignore", "dismiss"], e.detail);
  }

  // Relationship + citation issues.
  for (const i of relationshipIssues(state, index)) push(`rel:${i.id}`, i.ref, "relationship_issue", ["resolve", "dismiss"], i.detail);
  for (const i of citationIssues(state, index)) push(`cite:${i.id}`, { kind: "citation", id: i.citationId }, "reference_issue", ["resolve", "dismiss"], i.detail);

  // Inactive projects.
  for (const r of inactiveProjects(state, index, nowMs)) push(`inactive:${refKey(r)}`, r, "inactive", ["archive", "review", "dismiss"]);

  // Archive candidates.
  for (const a of archiveCandidates(state, index, nowMs)) push(`archive:${a.id}`, a.ref, "archive_candidate", ["archive", "dismiss"], a.detail);

  // Stale research.
  for (const i of researchIntegrity(state, index, nowMs)) if (i.kind === "untouched") push(`stale:${refKey(i.ref)}`, i.ref, "stale", ["review", "archive", "dismiss"], i.detail);

  // Explicitly review-requested records that have not since been reviewed.
  for (const key of index.reviewRequested) {
    const idx = key.indexOf(":");
    const ref: RecordRefLite = { kind: key.slice(0, idx), id: key.slice(idx + 1) };
    push(`requested:${key}`, ref, "review_requested", ["review", "resolve", "dismiss"]);
  }

  return items;
}

/** Count of unresolved review items (dashboard headline). */
export function reviewQueueCount(state: StoreState, index: MaintenanceIndex, opts: ReviewQueueOptions = {}): number {
  return reviewQueue(state, index, opts).length;
}
