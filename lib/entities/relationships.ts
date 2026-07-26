/**
 * Relationship explorer (LIFEOS-029, Features 2 & 3).
 *
 * Deterministic, grouped relationships for any entity — References / Referenced
 * by / Supports / Contradicts / Derived from / Related, plus the cross-domain
 * groups Related documents / authors / themes / decisions and Citations. Built
 * from the LIFEOS-021 graph edges (both directions) + LIFEOS-028 citations +
 * domain links (dialogue/tension/synthesis/reading). Results are memoized per
 * graph so repeated inspector opens are O(1). No new storage, no AI.
 */

import type { KnowledgeGraph, GraphEdge } from "@/lib/graph";
import { lookup } from "@/lib/graph";
import { citationsForRecord } from "@/lib/library/citations";
import { describeEntity, entityRef, type EntityContext, type EntityRef } from "@/lib/entities/entity";

export interface RelItem { ref: EntityRef; relation: string }
export interface RelationshipGroup { key: string; label: string; items: RelItem[] }

// relation → forward / backward display group.
const FWD: Record<string, string> = {
  references: "References", cites: "References", used_in: "References", investigated_by: "References",
  authored_from: "Derived from", mentioned_in: "Mentions", supports: "Supports", contradicts: "Contradicts",
  derived_from: "Derived from", part_of: "Part of", related_to: "Related",
};
const BACK: Record<string, string> = {
  references: "Referenced by", cites: "Referenced by", used_in: "Used in", investigated_by: "Investigated by",
  authored_from: "Basis for", mentioned_in: "Mentioned in", supports: "Supported by", contradicts: "Contradicted by",
  derived_from: "Basis for", part_of: "Contains", related_to: "Related",
};

const cache = new WeakMap<KnowledgeGraph, Map<string, RelationshipGroup[]>>();

function otherEnd(ctx: EntityContext, edge: GraphEdge, selfId: string): { kind: string; id: string } | null {
  if (edge.from === selfId) { const n = lookup(ctx.graph, edge.to); return { kind: n?.kind ?? "record", id: edge.to }; }
  if (edge.to === selfId) return { kind: edge.fromKind, id: edge.from };
  return null;
}

/** All grouped relationships for an entity (memoized per graph). */
export function entityRelationships(ctx: EntityContext, kind: string, id: string): RelationshipGroup[] {
  let byId = cache.get(ctx.graph);
  if (!byId) { byId = new Map(); cache.set(ctx.graph, byId); }
  const memoKey = `${kind}:${id}`;
  const hit = byId.get(memoKey);
  if (hit) return hit;

  const groups = new Map<string, RelItem[]>();
  const seen = new Set<string>();
  const add = (label: string, otherKind: string, otherId: string, relation: string) => {
    const dedup = `${label}|${otherKind}:${otherId}`;
    if (seen.has(dedup)) return;
    const ref = entityRef(ctx, otherKind, otherId);
    if (!ref.exists) return;
    seen.add(dedup);
    const arr = groups.get(label) ?? [];
    arr.push({ ref, relation });
    groups.set(label, arr);
  };

  // 1. Graph edges (both directions).
  for (const edge of [...(ctx.graph.byFrom.get(id) ?? []), ...(ctx.graph.byTo.get(id) ?? [])]) {
    const other = otherEnd(ctx, edge, id);
    if (!other || other.id === id) continue;
    const label = edge.from === id ? (FWD[edge.relation] ?? "Related") : (BACK[edge.relation] ?? "Related");
    add(label, other.kind, other.id, edge.relation);
  }

  // 2. Domain links the reference index doesn't cover.
  domainLinks(ctx, kind, id, add);

  // 3. Cross-domain kind groups (Related documents / authors / themes / decisions),
  //    derived from citations + the union of related items so they're first-class.
  crossDomain(ctx, kind, id, add);

  const order = [
    "References", "Referenced by", "Supports", "Supported by", "Contradicts", "Contradicted by",
    "Derived from", "Basis for", "Part of", "Contains", "Mentions", "Mentioned in", "Used in",
    "Investigated by", "Related themes", "Related documents", "Related authors", "Related decisions",
    "Citations", "Related",
  ];
  const out: RelationshipGroup[] = [];
  for (const label of order) { const items = groups.get(label); if (items?.length) out.push({ key: label, label, items }); }
  for (const [label, items] of groups) if (!order.includes(label) && items.length) out.push({ key: label, label, items });

  byId.set(memoKey, out);
  return out;
}

function domainLinks(ctx: EntityContext, kind: string, id: string, add: (l: string, k: string, i: string, r: string) => void): void {
  const { state } = ctx;
  if (kind === "dialogue") {
    const d = state.dialogueSessions.find((x) => x.id === id);
    for (const ref of d?.seedRefs ?? []) { const n = lookup(ctx.graph, ref); add("References", n?.kind ?? "belief", ref, "seed"); }
    for (const t of state.tensions.filter((t) => t.dialogueId === id)) add("Contains", "tension", t.id, "hosts");
    for (const s of state.syntheses.filter((s) => s.dialogueId === id)) add("Contains", "synthesis", s.id, "hosts");
  }
  if (kind === "tension") {
    const t = state.tensions.find((x) => x.id === id);
    if (t) { add("Part of", "dialogue", t.dialogueId, "in dialogue"); for (const r of [...t.thesisRefs, ...t.antithesisRefs]) { const n = lookup(ctx.graph, r); add("References", n?.kind ?? "belief", r, "grounds"); } }
    for (const s of state.syntheses.filter((s) => s.tensionIds.includes(id))) add("Referenced by", "synthesis", s.id, "integrates");
  }
  if (kind === "synthesis") {
    const s = state.syntheses.find((x) => x.id === id);
    if (s) { add("Part of", "dialogue", s.dialogueId, "in dialogue"); for (const tid of s.tensionIds) add("References", "tension", tid, "integrates"); for (const e of s.evidenceLinks) { const n = lookup(ctx.graph, e.refId); add("References", n?.kind ?? "belief", e.refId, "evidence"); } }
  }
  if (kind === "document") {
    // Records generated from this document (via citations) + its authors.
    for (const c of state.citations.filter((c) => c.documentId === id)) add("Referenced by", c.recordKind, c.recordId, "cited from");
    const doc = state.documents.find((d) => d.id === id);
    for (const a of doc?.authors ?? []) add("Related authors", "author", a, "author");
  }
  if (kind === "passage" || kind === "highlight") {
    for (const d of state.documents) for (const sec of d.sections) for (const p of sec.passages) {
      if (kind === "passage" && p.id === id) { add("Part of", "document", d.id, "in document"); for (const l of p.linked) add("Referenced by", l.kind, l.id, "converted"); }
      if (kind === "highlight") for (const h of p.highlights) if (h.id === id) { add("Part of", "document", d.id, "in document"); for (const l of h.linked) add("Referenced by", l.kind, l.id, "converted"); }
    }
  }
  if (kind === "author") {
    for (const d of state.documents.filter((d) => d.authors.some((a) => a.toLowerCase() === id.toLowerCase()))) add("Related documents", "document", d.id, "authored");
  }
  if (kind === "theme" || kind === "concept") {
    const c = state.concepts.find((x) => x.id === id);
    for (const bid of c?.relatedBeliefs ?? []) add("Related", "belief", bid, "concept link");
  }
}

function crossDomain(ctx: EntityContext, kind: string, id: string, add: (l: string, k: string, i: string, r: string) => void): void {
  // A record produced from reading → the documents it came from (Citations).
  if (["belief", "concept", "capture", "research_project", "dialogue", "inquiry"].includes(kind)) {
    for (const c of citationsForRecord(ctx.state, kind, id)) {
      add("Citations", "document", c.documentId, "source");
      const doc = ctx.state.documents.find((d) => d.id === c.documentId);
      for (const a of doc?.authors ?? []) add("Related authors", "author", a, "source author");
    }
  }
}

/** Flat, de-duplicated list of every related entity (for the graph preview). */
export function relatedEntities(ctx: EntityContext, kind: string, id: string): RelItem[] {
  const seen = new Set<string>();
  const out: RelItem[] = [];
  for (const g of entityRelationships(ctx, kind, id)) for (const it of g.items) {
    const key = `${it.ref.kind}:${it.ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** Total relationship count (hover cards / summaries). */
export function relationshipCount(ctx: EntityContext, kind: string, id: string): number {
  return relatedEntities(ctx, kind, id).length;
}

export { describeEntity };
