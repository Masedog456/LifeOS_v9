/**
 * Unified reference index (LIFEOS-021, Phase 2).
 *
 * A deterministic reverse-reference engine. Enumerates every EXPLICIT reference
 * across every record type — one place, one pass — so each record can answer
 * "what references me, uses me, investigates me, is authored from me, mentions
 * me, supports/contradicts/relates-to me". Nothing is inferred: an edge exists
 * only where a record literally stores another record's id. Pure and offline;
 * no AI, no embeddings, no visualization.
 */

import type { StoreState } from "@/types/mvp";

export type RecordKind =
  | "source" | "capture" | "proposal" | "belief" | "comparison" | "inquiry"
  | "megathread" | "reflection" | "practice" | "review" | "reasoning"
  | "decision" | "formation" | "concept" | "principle" | "framework"
  | "knowledge_project" | "research_project";

export type RefRelation =
  | "references" | "used_in" | "investigated_by" | "authored_from"
  | "mentioned_in" | "supports" | "contradicts" | "related_to"
  | "derived_from" | "cites" | "part_of";

/** A single explicit reference: `from` (the record that stores the id) → `to`. */
export interface GraphEdge {
  from: string;
  fromKind: RecordKind;
  to: string;
  relation: RefRelation;
  label?: string;
}

/** Reverse references for one record, grouped into the ticket's categories. */
export interface BackReferences {
  referencedBy: GraphEdge[];
  usedIn: GraphEdge[];
  investigatedBy: GraphEdge[];
  authoredFrom: GraphEdge[];
  mentionedIn: GraphEdge[];
  supports: GraphEdge[];
  contradicts: GraphEdge[];
  relatedTo: GraphEdge[];
}

/** Build every explicit edge in the store. Deterministic ordering. */
export function buildGraphEdges(state: StoreState): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const push = (from: string, fromKind: RecordKind, to: string | undefined, relation: RefRelation, label?: string) => {
    if (!to || from === to) return;
    edges.push({ from, fromKind, to, relation, label });
  };
  const many = (from: string, fromKind: RecordKind, tos: string[] | undefined, relation: RefRelation, label?: string) => {
    for (const to of tos ?? []) push(from, fromKind, to, relation, label);
  };

  for (const c of state.captures ?? []) push(c.id, "capture", c.sourceId, "derived_from", "captured from source");
  for (const p of state.proposals ?? []) push(p.id, "proposal", p.captureId, "derived_from", "proposed from capture");
  for (const b of state.beliefs ?? []) {
    push(b.id, "belief", b.captureId, "derived_from", "formed from capture");
    push(b.id, "belief", b.proposalId, "derived_from", "formed from proposal");
  }
  for (const c of state.comparisons ?? []) {
    many(c.id, "comparison", c.sourceIds, "references");
    many(c.id, "comparison", c.beliefIds, "references");
  }
  for (const i of state.inquiries ?? []) {
    many(i.id, "inquiry", i.sourceIds, "references");
    many(i.id, "inquiry", i.beliefIds, "references");
    many(i.id, "inquiry", i.comparisonIds, "references");
  }
  for (const t of state.megathreads ?? []) {
    for (const m of t.members ?? []) push(t.id, "megathread", m.id, "mentioned_in", `thread member (${m.type})`);
  }
  for (const r of state.reflections ?? []) {
    many(r.id, "reflection", r.beliefIds, "mentioned_in");
    many(r.id, "reflection", r.threadIds, "mentioned_in");
    many(r.id, "reflection", r.sourceIds, "mentioned_in");
  }
  for (const p of state.practices ?? []) {
    many(p.id, "practice", p.derivedFrom?.beliefIds, "derived_from");
    many(p.id, "practice", p.derivedFrom?.threadIds, "derived_from");
    many(p.id, "practice", p.derivedFrom?.inquiryIds, "derived_from");
  }
  for (const r of state.reviews ?? []) {
    many(r.id, "review", r.reflectionIds, "references");
    for (const h of r.synthesis?.highlights ?? []) many(r.id, "review", h.recordIds, "cites");
  }
  for (const q of state.reasonings ?? []) for (const e of q.evidence ?? []) push(q.id, "reasoning", e.id, "cites");
  for (const d of state.decisions ?? []) {
    for (const e of d.evidence ?? []) push(d.id, "decision", e.id, "cites");
    many(d.id, "decision", d.seedRefs, "references");
  }
  for (const f of state.formationSessions ?? []) {
    many(f.id, "formation", f.linkedBeliefs, "references");
    many(f.id, "formation", f.linkedDecisions, "references");
    many(f.id, "formation", f.linkedThreads, "references");
    many(f.id, "formation", f.linkedInquiries, "references");
    many(f.id, "formation", f.linkedSources, "references");
    many(f.id, "formation", f.linkedPractices, "references");
    many(f.id, "formation", f.linkedReflections, "references");
    for (const e of f.evidence ?? []) push(f.id, "formation", e.id, "cites");
  }
  for (const c of state.concepts ?? []) {
    many(c.id, "concept", c.relatedBeliefs, "references");
    many(c.id, "concept", c.relatedThreads, "references");
    many(c.id, "concept", c.relatedSources, "references");
    many(c.id, "concept", c.relatedPractices, "references");
    many(c.id, "concept", c.principleIds, "references");
  }
  // Concept↔concept semantics come ONLY from approved relationships (avoids
  // double-counting the denormalized parent/child/related/opposing arrays).
  for (const r of state.conceptRelationships ?? []) {
    if (!r.approved) continue;
    const rel: RefRelation = r.type === "supports" ? "supports" : r.type === "contradicts" ? "contradicts" : r.type === "part_of" || r.type === "contains" ? "part_of" : "related_to";
    push(r.fromConceptId, "concept", r.toConceptId, rel, r.type);
  }
  for (const p of state.principles ?? []) {
    many(p.id, "principle", p.conceptIds, "references");
    many(p.id, "principle", p.beliefIds, "supports");
  }
  for (const f of state.frameworks ?? []) {
    many(f.id, "framework", f.conceptIds, "references", "organizes");
    many(f.id, "framework", f.principleIds, "references", "organizes");
  }
  for (const k of state.knowledgeProjects ?? []) {
    for (const id of assemblyIds(k.assembly)) push(k.id, "knowledge_project", id, "authored_from");
    for (const s of k.sections ?? []) for (const pa of s.paragraphs ?? []) many(k.id, "knowledge_project", pa.citations, "cites");
  }
  for (const rp of state.researchProjects ?? []) {
    for (const id of assemblyIds(rp.assembly)) push(rp.id, "research_project", id, "investigated_by");
    for (const h of rp.hypotheses ?? []) {
      many(rp.id, "research_project", h.supportingEvidence, "supports");
      many(rp.id, "research_project", h.contradictingEvidence, "contradicts");
    }
    for (const n of rp.argumentNodes ?? []) push(rp.id, "research_project", n.recordId, "cites");
    push(rp.id, "research_project", rp.seededProjectId, "authored_from", "seeded authoring project");
  }
  return edges;
}

function assemblyIds(a: import("@/types/mvp").ProjectAssembly | undefined): string[] {
  if (!a) return [];
  return [
    ...(a.sourceIds ?? []), ...(a.beliefIds ?? []), ...(a.conceptIds ?? []), ...(a.threadIds ?? []),
    ...(a.reasoningIds ?? []), ...(a.frameworkIds ?? []), ...(a.principleIds ?? []),
    ...(a.formationIds ?? []), ...(a.decisionIds ?? []),
  ];
}

/** Group incoming edges for one record into the reverse-reference categories. */
export function categorize(incoming: GraphEdge[]): BackReferences {
  return {
    referencedBy: incoming,
    usedIn: incoming.filter((e) => e.fromKind === "knowledge_project" || e.fromKind === "research_project"),
    investigatedBy: incoming.filter((e) => e.fromKind === "research_project"),
    authoredFrom: incoming.filter((e) => e.fromKind === "knowledge_project" || e.relation === "authored_from"),
    mentionedIn: incoming.filter((e) => e.relation === "mentioned_in"),
    supports: incoming.filter((e) => e.relation === "supports"),
    contradicts: incoming.filter((e) => e.relation === "contradicts"),
    relatedTo: incoming.filter((e) => e.relation === "related_to"),
  };
}
