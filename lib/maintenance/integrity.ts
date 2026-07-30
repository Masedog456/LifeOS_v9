/**
 * Maintenance index (LIFEOS-038).
 *
 * ONE deterministic, indexed pass over `StoreState` that every maintenance
 * projection reuses. Built for scale: existence is O(1) via `Set`s, citations
 * are grouped once, incoming-reference presence is a single `Set`, and archive /
 * review state is folded from the append-only maintenance-event log. Pure — no
 * AI, no scores, no mutation. Deleting a record never cascades; an orphaned
 * reference degrades gracefully (projections are orphan-safe).
 */

import type { StoreState, RecordRefLite, Citation } from "@/types/mvp";

export type Ref = RecordRefLite;

/** Canonical reference key. */
export function refKey(ref: Ref): string {
  return `${ref.kind}:${ref.id}`;
}

export interface MaintenanceIndex {
  /** Does this reference resolve to a live record? */
  has(ref: Ref): boolean;
  documentIds: Set<string>;
  sectionIds: Set<string>;
  passageIds: Set<string>;
  citationsByRecord: Map<string, Citation[]>;
  citationsByDocument: Map<string, Citation[]>;
  /** Ref keys that at least one other record points to (incoming reference present). */
  referenced: Set<string>;
  /** Ref key → latest archived state (true archived / false unarchived), from events. */
  archived: Set<string>;
  /** Ref key → ISO of the most recent `reviewed` event. */
  lastReviewed: Map<string, string>;
  /** Duplicate-candidate ids the user has already decided on (ignored / merged). */
  decidedDuplicateIds: Set<string>;
  /** Ref keys the user explicitly asked to review (open `review_requested`). */
  reviewRequested: Set<string>;
}

/** Existence set per kind, plus a resolver closure. */
function buildExistence(state: StoreState): {
  has: (ref: Ref) => boolean;
  documentIds: Set<string>;
  sectionIds: Set<string>;
  passageIds: Set<string>;
} {
  const conceptIds = new Set((state.concepts ?? []).map((c) => c.id));
  const beliefIds = new Set((state.beliefs ?? []).map((b) => b.id));
  const documentIds = new Set((state.documents ?? []).map((d) => d.id));
  const sourceIds = new Set((state.sources ?? []).map((s) => s.id));
  const researchIds = new Set((state.researchProjects ?? []).map((r) => r.id));
  const projectIds = new Set((state.projects ?? []).map((p) => p.id));
  const goalIds = new Set((state.goals ?? []).map((g) => g.id));
  const actionIds = new Set((state.nextActions ?? []).map((a) => a.id));
  const workspaceIds = new Set((state.workspaces ?? []).map((w) => w.id));
  const sessionIds = new Set((state.sessions ?? []).map((s) => s.id));
  const relationshipIds = new Set((state.conceptRelationships ?? []).map((r) => r.id));
  const decisionIds = new Set((state.decisions ?? []).map((d) => d.id));
  const dialogueIds = new Set((state.dialogueSessions ?? []).map((d) => d.id));
  const captureIds = new Set((state.captures ?? []).map((c) => c.id));

  const milestoneIds = new Set<string>();
  const sectionIds = new Set<string>();
  const passageIds = new Set<string>();
  for (const p of state.projects ?? []) for (const m of p.milestones ?? []) milestoneIds.add(m.id);
  for (const d of state.documents ?? []) for (const s of d.sections ?? []) {
    sectionIds.add(s.id);
    for (const pg of s.passages ?? []) passageIds.add(pg.id);
  }

  const has = (ref: Ref): boolean => {
    switch (ref.kind) {
      case "concept": case "theme": return conceptIds.has(ref.id);
      case "belief": return beliefIds.has(ref.id);
      case "document": return documentIds.has(ref.id);
      case "source": return sourceIds.has(ref.id);
      case "research_project": case "research": return researchIds.has(ref.id);
      case "project": return projectIds.has(ref.id);
      case "goal": return goalIds.has(ref.id);
      case "action": return actionIds.has(ref.id);
      case "milestone": return milestoneIds.has(ref.id);
      case "workspace": return workspaceIds.has(ref.id);
      case "session": return sessionIds.has(ref.id);
      case "relationship": return relationshipIds.has(ref.id);
      case "decision": return decisionIds.has(ref.id);
      case "dialogue": return dialogueIds.has(ref.id);
      case "capture": return captureIds.has(ref.id);
      case "section": return sectionIds.has(ref.id);
      case "passage": return passageIds.has(ref.id);
      case "custom": return true;
      default: return false;
    }
  };
  return { has, documentIds, sectionIds, passageIds };
}

/** Build the shared index. One pass; safe on partial/legacy state. */
export function buildMaintenanceIndex(state: StoreState): MaintenanceIndex {
  const ex = buildExistence(state);

  // Citations grouped by target document and by owning record.
  const citationsByRecord = new Map<string, Citation[]>();
  const citationsByDocument = new Map<string, Citation[]>();
  for (const c of state.citations ?? []) {
    const rk = `${c.recordKind}:${c.recordId}`;
    (citationsByRecord.get(rk) ?? citationsByRecord.set(rk, []).get(rk)!).push(c);
    (citationsByDocument.get(c.documentId) ?? citationsByDocument.set(c.documentId, []).get(c.documentId)!).push(c);
  }

  // Incoming-reference presence: any record that points AT another record marks
  // the target as "referenced" (used for orphan detection). Bounded by the total
  // number of references, not the square of record counts.
  const referenced = new Set<string>();
  const mark = (kind: string, id: string | undefined | null) => { if (id) referenced.add(`${kind}:${id}`); };
  for (const c of state.concepts ?? []) {
    for (const id of c.relatedBeliefs ?? []) mark("belief", id);
    for (const id of c.relatedConcepts ?? []) mark("concept", id);
    for (const id of c.parentConcepts ?? []) mark("concept", id);
    for (const id of c.childConcepts ?? []) mark("concept", id);
    for (const id of c.opposingConcepts ?? []) mark("concept", id);
    for (const id of c.relatedSources ?? []) mark("source", id);
  }
  for (const r of state.conceptRelationships ?? []) { if (r.approved) { mark("concept", r.fromConceptId); mark("concept", r.toConceptId); } }
  for (const c of state.citations ?? []) { mark("document", c.documentId); mark(c.recordKind, c.recordId); }
  for (const w of state.workspaces ?? []) for (const m of w.members ?? []) mark(m.kind, m.id);
  for (const a of state.planningAssignments ?? []) mark(a.ref.kind, a.ref.id);
  for (const f of state.focusSessions ?? []) mark(f.ref.kind, f.ref.id);
  for (const a of state.nextActions ?? []) { mark("project", a.projectId); mark("milestone", a.milestoneId); }
  for (const p of state.projects ?? []) { for (const g of (p as { linkedGoalIds?: string[] }).linkedGoalIds ?? []) mark("goal", g); }

  // Archive + review state folded from the append-only event log (latest wins).
  const archived = new Set<string>();
  const lastReviewed = new Map<string, string>();
  const reviewRequested = new Set<string>();
  const resolvedReview = new Map<string, string>();
  const archiveAt = new Map<string, string>();
  const events = [...(state.maintenanceEvents ?? [])].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  for (const e of events) {
    const k = refKey(e.ref);
    if (e.kind === "archived") { archived.add(k); archiveAt.set(k, e.at); }
    else if (e.kind === "unarchived") { archived.delete(k); archiveAt.set(k, e.at); }
    else if (e.kind === "reviewed") { lastReviewed.set(k, e.at); reviewRequested.delete(k); }
    else if (e.kind === "review_requested") { reviewRequested.add(k); }
    else if (e.kind === "maintenance_resolved") { resolvedReview.set(k, e.at); }
  }

  const decidedDuplicateIds = new Set(
    (state.duplicateCandidates ?? []).filter((d) => d.status !== "open").map((d) => d.id),
  );

  return {
    has: ex.has,
    documentIds: ex.documentIds,
    sectionIds: ex.sectionIds,
    passageIds: ex.passageIds,
    citationsByRecord,
    citationsByDocument,
    referenced,
    archived,
    lastReviewed,
    decidedDuplicateIds,
    reviewRequested,
  };
}

/** Is a record archived (per the latest archive/unarchive event)? */
export function isArchived(index: MaintenanceIndex, ref: Ref): boolean {
  return index.archived.has(refKey(ref));
}

/** The most recent maintenance-event that touched a record's `reviewed` state. */
export function lastReviewedAt(index: MaintenanceIndex, ref: Ref): string | undefined {
  return index.lastReviewed.get(refKey(ref));
}

// ---- Orphan projections (Feature 1) — deterministic, no age, no score ----

/**
 * Concepts nothing points at AND that link to nothing themselves (no approved
 * relationship, no related beliefs/concepts/sources). Excludes archived.
 */
export function orphanConcepts(state: StoreState, index: MaintenanceIndex): Ref[] {
  const out: Ref[] = [];
  for (const c of state.concepts ?? []) {
    const ref: Ref = { kind: "concept", id: c.id };
    if (index.archived.has(refKey(ref))) continue;
    const hasOwn =
      (c.relatedBeliefs?.length ?? 0) + (c.relatedConcepts?.length ?? 0) + (c.parentConcepts?.length ?? 0) +
      (c.childConcepts?.length ?? 0) + (c.opposingConcepts?.length ?? 0) + (c.relatedSources?.length ?? 0) > 0;
    if (!hasOwn && !index.referenced.has(refKey(ref))) out.push(ref);
  }
  return out;
}

/** Documents with no incoming citation and no highlights/annotations derived. */
export function orphanDocuments(state: StoreState, index: MaintenanceIndex): Ref[] {
  const out: Ref[] = [];
  for (const d of state.documents ?? []) {
    const ref: Ref = { kind: "document", id: d.id };
    if (index.archived.has(refKey(ref))) continue;
    const incoming = index.citationsByDocument.get(d.id)?.length ?? 0;
    const hasHighlights = (d.sections ?? []).some((s) => (s.passages ?? []).some((p) => (p.highlights ?? []).length > 0 || (p.annotations ?? []).length > 0));
    if (incoming === 0 && !hasHighlights) out.push(ref);
  }
  return out;
}

/** Beliefs nothing references and that carry no citation. Excludes archived. */
export function orphanBeliefs(state: StoreState, index: MaintenanceIndex): Ref[] {
  const out: Ref[] = [];
  for (const b of state.beliefs ?? []) {
    const ref: Ref = { kind: "belief", id: b.id };
    if (index.archived.has(refKey(ref)) || b.status === "rejected") continue;
    const cited = (index.citationsByRecord.get(refKey(ref))?.length ?? 0) > 0;
    if (!cited && !index.referenced.has(refKey(ref))) out.push(ref);
  }
  return out;
}
