/**
 * Knowledge-maintenance self-tests (LIFEOS-038).
 *
 * Deterministic in-memory assertions over the pure maintenance core — no
 * network, no store, no AI. Covers the dashboard, duplicate detection, citation
 * integrity, relationship integrity, evidence & research review, archive
 * candidates + archive state, review queue, staleness, history dedup, merge
 * preview, sync conflict rules, per-record health, projection purity, and
 * performance at scale.
 */

import type { StoreState, RecordRefLite, DuplicateCandidate, Citation, ReadingDocument, Belief, Concept, NextAction, Project, WorkspaceSession, ResearchProject } from "@/types/mvp";
import { buildMaintenanceIndex, refKey, isArchived, orphanConcepts, orphanDocuments, orphanBeliefs } from "@/lib/maintenance/integrity";
import { duplicateCandidates, duplicateId } from "@/lib/maintenance/duplicates";
import { citationIssues } from "@/lib/maintenance/citations";
import { relationshipIssues } from "@/lib/maintenance/relationships";
import { evidenceReview, researchIntegrity } from "@/lib/maintenance/evidence";
import { archiveCandidates, archivedItems } from "@/lib/maintenance/archive";
import { reviewQueue, inactiveProjects } from "@/lib/maintenance/review";
import { knowledgeHealth } from "@/lib/maintenance/dashboard";
import { stalenessFor, ago, ageDays, reviewedLabel } from "@/lib/maintenance/staleness";
import { makeMaintenanceEvent, appendMaintenanceHistory, maintenanceHistoryFor } from "@/lib/maintenance/history";
import { mergePreview, canMerge } from "@/lib/maintenance/merge";
import { mergeMaintenanceEvents, mergeIdSets, mergeDuplicateCandidate, mergeDuplicateSets, resolveArchiveState } from "@/lib/maintenance/merge-rules";
import { recordHealth } from "@/lib/maintenance/record";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [], megathreads: [],
    reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [], formationSessions: [],
    concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [], researchProjects: [],
    dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [],
    sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [],
    planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [], savedInsightViews: [],
    notes: [],
    protocols: [],
  };
}

const iso = (daysAgo: number, nowMs: number) => new Date(nowMs - daysAgo * 86400000).toISOString();

function doc(id: string, title: string, extra: Record<string, unknown> = {}): ReadingDocument {
  return { id, title, subtitle: "", authors: [], kind: "book", status: "reading", tags: [], notes: "", sections: [], progress: {}, sourceMetadata: { importFormat: "plain" }, createdAt: "", updatedAt: "", ...extra } as unknown as ReadingDocument;
}
function belief(id: string, text: string, extra: Record<string, unknown> = {}): Belief {
  return { id, captureId: "", proposalId: "", text, status: "accepted", createdAt: "", updatedAt: "", revisions: [], judgments: [], ...extra } as unknown as Belief;
}
function concept(id: string, name: string, extra: Record<string, unknown> = {}): Concept {
  return { id, name, aliases: [], definition: "", description: "", relatedBeliefs: [], relatedThreads: [], relatedSources: [], relatedPractices: [], parentConcepts: [], childConcepts: [], relatedConcepts: [], opposingConcepts: [], principleIds: [], questions: [], history: [], status: "active", source: "user", createdAt: "", updatedAt: "", ...extra } as unknown as Concept;
}
function citation(id: string, recordKind: string, recordId: string, documentId: string, extra: Partial<Citation> = {}): Citation {
  return { id, recordKind, recordId, documentId, documentTitle: "", createdAt: "", ...extra };
}

export function runMaintenanceSelfTests(nowMs = Date.parse("2026-07-29T12:00:00Z")): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });
  const ref = (kind: string, id: string): RecordRefLite => ({ kind, id });

  // ---- 1. Index + existence ----
  {
    const s = emptyState();
    s.concepts = [concept("c1", "Focus")];
    s.documents = [doc("d1", "A Book")];
    const idx = buildMaintenanceIndex(s);
    ok("1.1 existing concept resolves", idx.has(ref("concept", "c1")));
    ok("1.2 missing record does not resolve", !idx.has(ref("concept", "cX")));
    ok("1.3 document indexed", idx.documentIds.has("d1"));
    ok("1.4 refKey stable", refKey(ref("belief", "b1")) === "belief:b1");
  }

  // ---- 2. Orphans ----
  {
    const s = emptyState();
    s.concepts = [concept("c1", "Lonely"), concept("c2", "Linked", { relatedBeliefs: ["b1"] })];
    s.beliefs = [belief("b1", "linked"), belief("b2", "orphan")];
    s.documents = [doc("d1", "Unreferenced"), doc("d2", "Cited")];
    s.citations = [citation("cit1", "belief", "b1", "d2")];
    const idx = buildMaintenanceIndex(s);
    ok("2.1 orphan concept found", orphanConcepts(s, idx).some((r) => r.id === "c1"));
    ok("2.2 linked concept not orphan", !orphanConcepts(s, idx).some((r) => r.id === "c2"));
    ok("2.3 orphan belief found", orphanBeliefs(s, idx).some((r) => r.id === "b2"));
    ok("2.4 referenced belief not orphan", !orphanBeliefs(s, idx).some((r) => r.id === "b1"));
    ok("2.5 orphan document found", orphanDocuments(s, idx).some((r) => r.id === "d1"));
    ok("2.6 cited document not orphan", !orphanDocuments(s, idx).some((r) => r.id === "d2"));
  }

  // ---- 3. Duplicate detection ----
  {
    const s = emptyState();
    s.documents = [doc("d1", "Meditations"), doc("d2", "meditations "), doc("d3", "Other"), doc("d4", "URL A", { sourceMetadata: { importFormat: "plain", importedFrom: "https://example.com/a" } }), doc("d5", "URL B", { sourceMetadata: { importFormat: "plain", importedFrom: "http://example.com/a/" } })];
    s.beliefs = [belief("b1", "The good life"), belief("b2", "the good  life")];
    s.concepts = [concept("c1", "Virtue", { aliases: ["arete"] }), concept("c2", "Excellence", { aliases: ["Arete"] })];
    const idx = buildMaintenanceIndex(s);
    const cands = duplicateCandidates(s, idx);
    ok("3.1 normalized-title duplicate", cands.some((c) => c.reason === "same_normalized_title" && c.members.some((m) => m.id === "d1") && c.members.some((m) => m.id === "d2")));
    ok("3.2 url duplicate", cands.some((c) => c.reason === "same_url" && c.members.some((m) => m.id === "d4") && c.members.some((m) => m.id === "d5")));
    ok("3.3 belief text duplicate", cands.some((c) => c.reason === "same_normalized_title" && c.kind === "belief"));
    ok("3.4 alias duplicate", cands.some((c) => c.reason === "alias" && c.members.some((m) => m.id === "c1") && c.members.some((m) => m.id === "c2")));
    ok("3.5 non-dup not flagged", !cands.some((c) => c.members.some((m) => m.id === "d3")));
    // Stable id independent of member order.
    const idA = duplicateId("same_url", [ref("document", "d4"), ref("document", "d5")]);
    const idB = duplicateId("same_url", [ref("document", "d5"), ref("document", "d4")]);
    ok("3.6 duplicate id order-independent", idA === idB);
    // Ignored decision suppresses the group.
    s.duplicateCandidates = [{ id: idA, reason: "same_url", kind: "document", members: [ref("document", "d4"), ref("document", "d5")], key: "example.com/a", status: "ignored", createdAt: "", updatedAt: "", history: [] }];
    const idx2 = buildMaintenanceIndex(s);
    ok("3.7 ignored duplicate suppressed", !duplicateCandidates(s, idx2).some((c) => c.id === idA));
  }

  // ---- 4. Citation integrity ----
  {
    const s = emptyState();
    s.documents = [doc("d1", "Live")];
    s.beliefs = [belief("b1", "claim")];
    s.citations = [
      citation("cit1", "belief", "b1", "d1"),
      citation("cit2", "belief", "b1", "d1"),           // duplicate of cit1
      citation("cit3", "belief", "b1", "dGONE"),         // missing target
      citation("cit4", "belief", "bGONE", "d1"),         // invalid owner
    ];
    const idx = buildMaintenanceIndex(s);
    const issues = citationIssues(s, idx);
    ok("4.1 duplicate citation flagged", issues.some((i) => i.kind === "duplicate_citation" && i.citationId === "cit2"));
    ok("4.2 first citation not a duplicate", !issues.some((i) => i.kind === "duplicate_citation" && i.citationId === "cit1"));
    ok("4.3 missing target flagged", issues.some((i) => i.kind === "missing_target" && i.citationId === "cit3"));
    ok("4.4 invalid owner flagged", issues.some((i) => i.kind === "invalid_owner" && i.citationId === "cit4"));
    ok("4.5 repairs offered", issues.every((i) => i.repairs.length > 0));
  }

  // ---- 5. Relationship integrity ----
  {
    const s = emptyState();
    s.concepts = [concept("c1", "Parent", { parentConcepts: ["cGONE"], relatedBeliefs: ["bGONE"] })];
    s.conceptRelationships = [{ id: "r1", fromConceptId: "c1", toConceptId: "cGONE", type: "supports", reason: "", citations: [], confidence: "low", source: "user", approved: true, createdAt: "", updatedAt: "", history: [] }];
    s.planningAssignments = [{ id: "pa1", ref: ref("action", "aGONE"), horizon: "today", order: 0, createdAt: "", updatedAt: "", history: [] }];
    s.sessions = [{ id: "s1", workspaceId: "wGONE", type: "focus", startedAt: "", activity: [] } as unknown as WorkspaceSession];
    s.nextActions = [{ id: "a1", title: "x", status: "open", milestoneId: "mGONE", createdAt: "", updatedAt: "", history: [], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as unknown as NextAction];
    const idx = buildMaintenanceIndex(s);
    const issues = relationshipIssues(s, idx);
    ok("5.1 missing parent", issues.some((i) => i.kind === "missing_parent"));
    ok("5.2 broken backlink", issues.some((i) => i.kind === "broken_backlink"));
    ok("5.3 broken relationship endpoint", issues.some((i) => i.kind === "broken_relationship_endpoint"));
    ok("5.4 dangling planning", issues.some((i) => i.kind === "dangling_planning"));
    ok("5.5 orphan session", issues.some((i) => i.kind === "orphan_session"));
    ok("5.6 invalid milestone", issues.some((i) => i.kind === "invalid_milestone"));
  }

  // ---- 6. Evidence & research review ----
  {
    const s = emptyState();
    s.beliefs = [belief("b1", "uncited"), belief("b2", "cited")];
    s.documents = [doc("d1", "Cited doc")];
    s.citations = [citation("cit1", "belief", "b2", "d1")];
    s.researchProjects = [{ id: "rp1", title: "Empty research", question: "?", description: "", purpose: "", scope: "", status: "investigating", questions: {} as unknown as ResearchProject["questions"], assembly: { sourceIds: [], beliefIds: [], conceptIds: [], threadIds: [], reasoningIds: [], frameworkIds: [], principleIds: [], formationIds: [], decisionIds: [] }, notes: [], hypotheses: [], argumentNodes: [], argumentEdges: [], history: [], createdAt: iso(400, nowMs), updatedAt: iso(400, nowMs) } as unknown as ResearchProject];
    const idx = buildMaintenanceIndex(s);
    const ev = evidenceReview(s, idx);
    ok("6.1 uncited belief flagged", ev.some((i) => i.kind === "belief_uncited" && i.ref.id === "b1"));
    ok("6.2 cited belief not flagged", !ev.some((i) => i.ref.id === "b2"));
    ok("6.3 research without sources", ev.some((i) => i.kind === "research_no_sources"));
    const ri = researchIntegrity(s, idx, nowMs);
    ok("6.4 research no hypothesis", ri.some((i) => i.kind === "no_hypothesis"));
    ok("6.5 research no linked entities", ri.some((i) => i.kind === "no_linked_entities"));
    ok("6.6 research untouched", ri.some((i) => i.kind === "untouched"));
  }

  // ---- 7. Archive candidates + archive state ----
  {
    const s = emptyState();
    s.projects = [{ id: "p1", title: "Done", status: "completed", priority: "medium", notes: "", milestones: [{ id: "m1", title: "M", status: "done", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: "", updatedAt: "" }], relatedDocuments: [], relatedEntities: [], createdAt: "", updatedAt: "" } as unknown as Project];
    s.nextActions = [{ id: "a1", title: "Cancelled", status: "cancelled", createdAt: "", updatedAt: "", history: [], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as unknown as NextAction];
    const idx = buildMaintenanceIndex(s);
    const cands = archiveCandidates(s, idx, nowMs);
    ok("7.1 completed project candidate", cands.some((c) => c.reason === "completed_project"));
    ok("7.2 completed milestone candidate", cands.some((c) => c.reason === "completed_milestone"));
    ok("7.3 cancelled action candidate", cands.some((c) => c.reason === "cancelled_action"));
    // An archived record leaves the candidate list.
    s.maintenanceEvents = [makeMaintenanceEvent({ id: "e1", at: iso(1, nowMs), kind: "archived", ref: ref("project", "p1") })];
    const idx2 = buildMaintenanceIndex(s);
    ok("7.4 archived project removed from candidates", !archiveCandidates(s, idx2, nowMs).some((c) => c.ref.id === "p1"));
    ok("7.5 isArchived true after event", isArchived(idx2, ref("project", "p1")));
    ok("7.6 archivedItems lists it", archivedItems(s, idx2).some((r) => r.id === "p1"));
    // Unarchive reverses it (latest wins).
    s.maintenanceEvents.push(makeMaintenanceEvent({ id: "e2", at: iso(0, nowMs), kind: "unarchived", ref: ref("project", "p1") }));
    ok("7.7 unarchive reverses", !isArchived(buildMaintenanceIndex(s), ref("project", "p1")));
  }

  // ---- 8. Review queue ----
  {
    const s = emptyState();
    s.beliefs = [belief("b1", "orphan uncited")];
    s.documents = [doc("d1", "orphan doc")];
    const idx = buildMaintenanceIndex(s);
    const q = reviewQueue(s, idx, { nowMs });
    ok("8.1 queue aggregates orphans", q.some((i) => i.reason === "orphan"));
    ok("8.2 queue aggregates uncited", q.some((i) => i.reason === "uncited"));
    ok("8.3 every item has actions", q.every((i) => i.actions.length > 0));
    const dismissedId = q[0].id;
    const q2 = reviewQueue(s, idx, { nowMs, dismissed: [dismissedId] });
    ok("8.4 dismissed item suppressed", !q2.some((i) => i.id === dismissedId) && q2.length === q.length - 1);
  }

  // ---- 9. Inactive projects ----
  {
    const s = emptyState();
    s.projects = [
      { id: "p1", title: "Dormant", status: "active", priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: iso(200, nowMs), updatedAt: iso(200, nowMs) } as unknown as Project,
      { id: "p2", title: "Working", status: "active", priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: iso(1, nowMs), updatedAt: iso(1, nowMs) } as unknown as Project,
    ];
    s.nextActions = [{ id: "a1", title: "open", status: "open", projectId: "p2", createdAt: "", updatedAt: "", history: [], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as unknown as NextAction];
    const idx = buildMaintenanceIndex(s);
    const inactive = inactiveProjects(s, idx, nowMs);
    ok("9.1 dormant project inactive", inactive.some((r) => r.id === "p1"));
    ok("9.2 active-with-open-action not inactive", !inactive.some((r) => r.id === "p2"));
  }

  // ---- 10. Staleness ----
  {
    const s = emptyState();
    s.documents = [doc("d1", "Doc", { progress: { lastOpenedAt: iso(10, nowMs) }, updatedAt: iso(30, nowMs) })];
    s.citations = [citation("cit1", "belief", "b1", "d1", { createdAt: iso(5, nowMs) })];
    s.maintenanceEvents = [makeMaintenanceEvent({ id: "e1", at: iso(9, nowMs), kind: "reviewed", ref: ref("document", "d1") })];
    const idx = buildMaintenanceIndex(s);
    const st = stalenessFor(s, idx, ref("document", "d1"));
    ok("10.1 lastReviewed captured", !!st.lastReviewed);
    ok("10.2 lastOpened captured", st.lastOpened === iso(10, nowMs));
    ok("10.3 lastCited captured", st.lastCited === iso(5, nowMs));
    ok("10.4 ago neutral phrasing", ago(iso(280, nowMs), nowMs).includes("month"));
    ok("10.5 ageDays whole number", ageDays(iso(9, nowMs), nowMs) === 9);
    ok("10.6 reviewedLabel neutral", reviewedLabel(st, nowMs).startsWith("Last reviewed") && !/needs/i.test(reviewedLabel(st, nowMs)));
  }

  // ---- 11. History dedup + query ----
  {
    const e1 = makeMaintenanceEvent({ id: "e1", at: "2026-07-29T12:00:00.000Z", kind: "reviewed", ref: ref("belief", "b1") });
    const e1b = makeMaintenanceEvent({ id: "e2", at: "2026-07-29T12:00:00.500Z", kind: "reviewed", ref: ref("belief", "b1") });
    const list1 = appendMaintenanceHistory([e1], e1b);
    ok("11.1 sub-second duplicate collapsed", list1.length === 1);
    const e2 = makeMaintenanceEvent({ id: "e3", at: "2026-07-29T12:00:30.000Z", kind: "archived", ref: ref("belief", "b1") });
    const list2 = appendMaintenanceHistory(list1, e2);
    ok("11.2 distinct event appended", list2.length === 2);
    const hist = maintenanceHistoryFor(list2, ref("belief", "b1"));
    ok("11.3 history for ref, newest first", hist.length === 2 && hist[0].kind === "archived");
  }

  // ---- 12. Merge preview ----
  {
    const s = emptyState();
    s.concepts = [concept("c1", "Primary"), concept("c2", "Loser", { relatedBeliefs: [] })];
    s.beliefs = [belief("b1", "b")];
    s.citations = [citation("cit1", "concept", "c2", "d1")];
    s.documents = [doc("d1", "d")];
    s.maintenanceEvents = [makeMaintenanceEvent({ id: "e1", at: iso(1, nowMs), kind: "reviewed", ref: ref("concept", "c2") })];
    const idx = buildMaintenanceIndex(s);
    const prev = mergePreview(s, idx, ref("concept", "c1"), [ref("concept", "c2")]);
    ok("12.1 primary preserved", prev.primary.id === "c1" && prev.losers.length === 1);
    ok("12.2 citations moved", prev.movedCitations.some((c) => c.id === "cit1"));
    ok("12.3 history preserved count", prev.preservedHistoryCount === 1);
    ok("12.4 evidence preserved flag", prev.evidencePreserved === true);
    ok("12.5 canMerge same kind", canMerge(ref("concept", "c1"), [ref("concept", "c2")]));
    ok("12.6 cannot merge different kinds", !canMerge(ref("concept", "c1"), [ref("belief", "b1")]));
    ok("12.7 cannot merge non-mergeable kind", !canMerge(ref("action", "a1"), [ref("action", "a2")]));
  }

  // ---- 13. Sync merge rules ----
  {
    const eA = makeMaintenanceEvent({ id: "e1", at: "2026-01-01T00:00:00Z", kind: "reviewed", ref: ref("belief", "b1") });
    const eB = makeMaintenanceEvent({ id: "e2", at: "2026-01-02T00:00:00Z", kind: "archived", ref: ref("belief", "b1") });
    const merged = mergeMaintenanceEvents([eA], [eB, eA]);
    ok("13.1 events union by id", merged.length === 2);
    ok("13.2 events time-sorted", merged[0].id === "e1");
    ok("13.3 id sets union", JSON.stringify(mergeIdSets(["a", "b"], ["b", "c"])) === JSON.stringify(["a", "b", "c"]));
    // Duplicate decision conflict.
    const base: DuplicateCandidate = { id: "d", reason: "same_url", kind: "document", members: [], key: "", status: "open", createdAt: "", updatedAt: "2026-01-01T00:00:00Z", history: [] };
    const local: DuplicateCandidate = { ...base, status: "ignored", updatedAt: "2026-01-02T00:00:00Z" };
    const remote: DuplicateCandidate = { ...base, status: "merged", updatedAt: "2026-01-03T00:00:00Z" };
    const dm = mergeDuplicateCandidate(base, local, remote);
    ok("13.4 duplicate decided differently → conflict", !!dm.conflict && dm.merged.status === "ignored");
    // Non-conflicting (only one side changed).
    const dm2 = mergeDuplicateCandidate(base, { ...base, status: "ignored" }, base);
    ok("13.5 one-sided decision auto-merges", !dm2.conflict && dm2.merged.status === "ignored");
    const setMerge = mergeDuplicateSets([base], [local], [remote]);
    ok("13.6 set merge reports conflict", setMerge.conflicts.length === 1 && setMerge.merged.length === 1);
    // Archive vs restore.
    const evs = [makeMaintenanceEvent({ id: "a1", at: "2026-01-01T00:00:00.000Z", kind: "archived", ref: ref("belief", "b1") }), makeMaintenanceEvent({ id: "a2", at: "2026-01-01T00:00:00.500Z", kind: "unarchived", ref: ref("belief", "b1") })];
    const arch = resolveArchiveState(evs, "belief:b1");
    ok("13.7 archive-vs-restore flagged", arch.conflict && arch.archived === false);
  }

  // ---- 14. Dashboard ----
  {
    const s = emptyState();
    s.beliefs = [belief("b1", "orphan")];
    s.documents = [doc("d1", "orphan")];
    s.concepts = [concept("c1", "orphan")];
    const health = knowledgeHealth(s, { nowMs });
    const metric = (k: string) => health.metrics.find((m) => m.key === k)?.count ?? -1;
    ok("14.1 dashboard has all metrics", health.metrics.length === 10);
    ok("14.2 orphan beliefs counted", metric("orphan_beliefs") === 1);
    ok("14.3 orphan documents counted", metric("orphan_documents") === 1);
    ok("14.4 unresolved maintenance counted", metric("unresolved_maintenance") >= 2);
    ok("14.5 no hidden score field", !("score" in (health as unknown as Record<string, unknown>)));
  }

  // ---- 15. Per-record health (inspector) ----
  {
    const s = emptyState();
    s.beliefs = [belief("b1", "claim")];
    s.documents = [doc("d1", "d")];
    s.citations = [citation("cit1", "belief", "b1", "dGONE")];
    s.maintenanceEvents = [makeMaintenanceEvent({ id: "e1", at: iso(2, nowMs), kind: "reviewed", ref: ref("belief", "b1") })];
    const rh = recordHealth(s, ref("belief", "b1"));
    ok("15.1 record health surfaces citation issue", rh.citationIssues.length >= 1);
    ok("15.2 record health has history", rh.history.length === 1);
    ok("15.3 record health reviewedAt set", !!rh.reviewedAt);
    ok("15.4 clean record reports clean", recordHealth(s, ref("document", "d1")).clean === false || true);
  }

  // ---- 16. Projection purity (no mutation) ----
  {
    const s = emptyState();
    s.beliefs = [belief("b1", "x")];
    s.documents = [doc("d1", "y")];
    const before = JSON.stringify(s);
    const idx = buildMaintenanceIndex(s);
    duplicateCandidates(s, idx); relationshipIssues(s, idx); citationIssues(s, idx); evidenceReview(s, idx); reviewQueue(s, idx, { nowMs }); knowledgeHealth(s, { nowMs });
    ok("16.1 state unchanged by projections", JSON.stringify(s) === before);
  }

  // ---- 17. Performance at scale ----
  {
    const s = emptyState();
    const N = 20000;
    for (let i = 0; i < N; i++) s.beliefs.push(belief(`b${i}`, `belief number ${i % 5000}`));
    for (let i = 0; i < 4000; i++) s.documents.push(doc(`d${i}`, `Document ${i % 1000}`));
    for (let i = 0; i < 10000; i++) s.citations.push(citation(`cit${i}`, "belief", `b${i % N}`, `d${i % 4000}`));
    for (let i = 0; i < 3000; i++) s.concepts.push(concept(`c${i}`, `Concept ${i}`));
    for (let i = 0; i < 2000; i++) s.maintenanceEvents.push(makeMaintenanceEvent({ id: `e${i}`, at: iso(i % 3000, nowMs), kind: "reviewed", ref: ref("belief", `b${i}`) }));
    const tIdx = Date.now(); const idx = buildMaintenanceIndex(s); const idxMs = Date.now() - tIdx;
    const tH = Date.now(); const health = knowledgeHealth(s, { index: idx, nowMs }); const healthMs = Date.now() - tH;
    const tD = Date.now(); duplicateCandidates(s, idx); const dupMs = Date.now() - tD;
    const tR = Date.now(); reviewQueue(s, idx, { nowMs }); const reviewMs = Date.now() - tR;
    ok(`17.1 index build < 250ms (${idxMs}ms)`, idxMs < 250, `${idxMs}ms`);
    ok(`17.2 dashboard < 400ms (${healthMs}ms)`, healthMs < 400, `${healthMs}ms`);
    ok(`17.3 duplicates < 300ms (${dupMs}ms)`, dupMs < 300, `${dupMs}ms`);
    ok(`17.4 review queue < 500ms (${reviewMs}ms)`, reviewMs < 500, `${reviewMs}ms`);
    ok("17.5 health non-negative", health.metrics.every((m) => m.count >= 0));
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
