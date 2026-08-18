/**
 * Knowledge graph service (LIFEOS-021, Phase 3 + 7).
 *
 * ONE deterministic relationship API over the store, built on the unified
 * reference index. Provides lookup, forward/back references, dependency
 * traversal, citation traversal, provenance, and integrity checks. Replaces
 * ad-hoc reverse-lookup code scattered across modules. No AI, no embeddings,
 * no visualization — a pure query layer over explicit references.
 */

import type { StoreState } from "@/types/mvp";
import { buildGraphEdges, categorize, type BackReferences, type GraphEdge, type RecordKind } from "@/lib/graph/references";

export type { RecordKind, RefRelation, GraphEdge, BackReferences } from "@/lib/graph/references";

export interface GraphNode {
  id: string;
  kind: RecordKind;
  label: string;
}

export interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  byFrom: Map<string, GraphEdge[]>;
  byTo: Map<string, GraphEdge[]>;
}

function snippet(s: string, n = 60): string {
  // Resilient to partially-malformed records (a record may carry a valid id but
  // be missing its label field) — the graph is a read-only query layer and must
  // never crash on imperfect store data (LIFEOS-033, Feature 10).
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** Build the node registry (id → kind + label) for every record. */
function buildNodes(state: StoreState): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  const add = (id: string, kind: RecordKind, label: string) => { if (id) nodes.set(id, { id, kind, label: snippet(label) }); };
  for (const s of state.sources ?? []) add(s.id, "source", s.title);
  for (const c of state.captures ?? []) add(c.id, "capture", c.text);
  for (const p of state.proposals ?? []) add(p.id, "proposal", p.claim);
  for (const b of state.beliefs ?? []) add(b.id, "belief", b.text);
  for (const c of state.comparisons ?? []) add(c.id, "comparison", c.title);
  for (const i of state.inquiries ?? []) add(i.id, "inquiry", i.question);
  for (const t of state.megathreads ?? []) add(t.id, "megathread", t.title);
  for (const r of state.reflections ?? []) add(r.id, "reflection", r.response);
  for (const p of state.practices ?? []) add(p.id, "practice", p.userWording || p.title);
  for (const r of state.reviews ?? []) add(r.id, "review", `${r.type} review`);
  for (const q of state.reasonings ?? []) add(q.id, "reasoning", q.question);
  for (const d of state.decisions ?? []) add(d.id, "decision", d.title);
  for (const f of state.formationSessions ?? []) add(f.id, "formation", f.title);
  for (const c of state.concepts ?? []) add(c.id, "concept", c.name);
  for (const p of state.principles ?? []) add(p.id, "principle", p.statement);
  for (const f of state.frameworks ?? []) add(f.id, "framework", f.name);
  for (const k of state.knowledgeProjects ?? []) add(k.id, "knowledge_project", k.title);
  for (const rp of state.researchProjects ?? []) add(rp.id, "research_project", rp.title);
  // Life-side records (LIFEOS-056). Registering them is what makes a
  // Constitution → Practice/Action/Note link RESOLVE rather than land in
  // `brokenReferences`. Constitution elements are registered in every status:
  // a retired element still has real history and real links, and hiding it
  // would turn its edges into silent garbage — exactly what a graph must not do.
  for (const e of state.constitutionElements ?? []) add(e.id, "constitution_element", e.statement);
  for (const a of state.nextActions ?? []) add(a.id, "action", a.title);
  for (const n of state.notes ?? []) add(n.id, "note", n.title || n.body);
  for (const p of state.protocols ?? []) add(p.id, "protocol", `When ${p.trigger} → ${p.response}`);
  for (const w of state.workspaces ?? []) add(w.id, "workspace", w.name);
  for (const g of state.goals ?? []) add(g.id, "goal", g.title);
  for (const pr of state.projects ?? []) add(pr.id, "project", pr.title);
  for (const d of state.documents ?? []) add(d.id, "document", d.title);
  return nodes;
}

/** Build the whole graph once (call, then reuse for many queries). */
export function buildGraph(state: StoreState): KnowledgeGraph {
  const nodes = buildNodes(state);
  const edges = buildGraphEdges(state);
  const byFrom = new Map<string, GraphEdge[]>();
  const byTo = new Map<string, GraphEdge[]>();
  const bucket = (m: Map<string, GraphEdge[]>, k: string, e: GraphEdge) => {
    const arr = m.get(k);
    if (arr) arr.push(e); else m.set(k, [e]);
  };
  for (const e of edges) {
    bucket(byFrom, e.from, e);
    bucket(byTo, e.to, e);
  }
  return { nodes, edges, byFrom, byTo };
}

export function lookup(graph: KnowledgeGraph, id: string): GraphNode | undefined {
  return graph.nodes.get(id);
}

/** Outgoing references (records this one points at). */
export function forwardReferences(graph: KnowledgeGraph, id: string): GraphEdge[] {
  return graph.byFrom.get(id) ?? [];
}

/** Incoming references, grouped into the reverse-reference categories. */
export function backReferences(graph: KnowledgeGraph, id: string): BackReferences {
  return categorize(graph.byTo.get(id) ?? []);
}

/** Every edge touching a record (either direction). */
export function relationshipsOf(graph: KnowledgeGraph, id: string): GraphEdge[] {
  return [...(graph.byFrom.get(id) ?? []), ...(graph.byTo.get(id) ?? [])];
}

/**
 * Dependency chain: follow outgoing edges of the given relations transitively
 * (default: derivation/citation). Returns ordered, de-duplicated node ids.
 */
export function dependencyChain(graph: KnowledgeGraph, id: string, relations: Set<string> = new Set(["derived_from", "cites", "references"]), maxDepth = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let frontier = [id];
  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const e of graph.byFrom.get(cur) ?? []) {
        if (!relations.has(e.relation) || seen.has(e.to)) continue;
        seen.add(e.to);
        out.push(e.to);
        next.push(e.to);
      }
    }
    frontier = next;
    depth++;
  }
  return out;
}

/** Provenance: the root sources a record ultimately derives from. */
export function provenance(graph: KnowledgeGraph, id: string): string[] {
  return dependencyChain(graph, id, new Set(["derived_from", "cites", "references"]))
    .filter((x) => graph.nodes.get(x)?.kind === "source");
}

/** Concept parents/children (from approved part_of relationships). */
export function parents(graph: KnowledgeGraph, id: string): GraphNode[] {
  return (graph.byFrom.get(id) ?? []).filter((e) => e.relation === "part_of").map((e) => graph.nodes.get(e.to)).filter((n): n is GraphNode => !!n);
}
export function children(graph: KnowledgeGraph, id: string): GraphNode[] {
  return (graph.byTo.get(id) ?? []).filter((e) => e.relation === "part_of").map((e) => graph.nodes.get(e.from)).filter((n): n is GraphNode => !!n);
}

// ---- integrity (Phase 8 diagnostics) ----

export interface GraphIntegrity {
  brokenReferences: GraphEdge[];
  orphanRecords: GraphNode[];
  duplicateIds: { id: string; kinds: RecordKind[] }[];
  edgeCount: number;
  nodeCount: number;
}

/** Deterministic integrity report. */
export function graphIntegrity(state: StoreState, graph?: KnowledgeGraph): GraphIntegrity {
  const g = graph ?? buildGraph(state);

  // Broken: an edge whose target id resolves to no record.
  const brokenReferences = g.edges.filter((e) => !g.nodes.has(e.to));

  // Orphan: a record with no edges in or out (nothing references it, it
  // references nothing). Captures/proposals are excluded (pipeline artifacts).
  const orphanRecords: GraphNode[] = [];
  for (const node of g.nodes.values()) {
    if (node.kind === "capture" || node.kind === "proposal") continue;
    // A Constitution element with no links is not a defect — it is an element
    // the user has not operationalized yet, which is a normal and honest state.
    if (node.kind === "constitution_element") continue;
    if (!g.byFrom.has(node.id) && !g.byTo.has(node.id)) orphanRecords.push(node);
  }

  // Duplicate ids: the same id claimed by more than one record kind.
  const kindsById = new Map<string, Set<RecordKind>>();
  const eachRecord = (id: string, kind: RecordKind) => {
    const set = kindsById.get(id) ?? new Set<RecordKind>();
    set.add(kind);
    kindsById.set(id, set);
  };
  for (const node of g.nodes.values()) eachRecord(node.id, node.kind);
  const duplicateIds = [...kindsById.entries()].filter(([, kinds]) => kinds.size > 1).map(([id, kinds]) => ({ id, kinds: [...kinds] }));

  return { brokenReferences, orphanRecords, duplicateIds, edgeCount: g.edges.length, nodeCount: g.nodes.size };
}
