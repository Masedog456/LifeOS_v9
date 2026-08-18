/**
 * Graph scanner (LIFEOS-024).
 *
 * Inspects the knowledge graph / World Model structure only. Emits
 * `elevate_concept` when a concept is referenced across many records yet has
 * little structure, and `merge_duplicate_concepts` when two active concepts look
 * like duplicates (same normalised name, or one names the other as an alias).
 */

import type { Concept, StoreState } from "@/types/mvp";
import { backReferences, buildGraph, type KnowledgeGraph } from "@/lib/graph";
import { proposal, type RecommendationProposal, type Scanner } from "@/lib/orchestrator/types";

const ELEVATE_THRESHOLD = 4;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function refCount(state: StoreState, graph: ReturnType<typeof buildGraph>, id: string): number {
  const b = backReferences(graph, id);
  const ids = new Set<string>();
  for (const bucket of [b.referencedBy, b.usedIn, b.investigatedBy, b.authoredFrom, b.mentionedIn, b.supports, b.contradicts, b.relatedTo]) {
    for (const e of bucket) ids.add(e.from);
  }
  return ids.size;
}

export const graphScanner: Scanner = (state: StoreState, graph?: KnowledgeGraph): RecommendationProposal[] => {
  const out: RecommendationProposal[] = [];
  const active = state.concepts.filter((c) => c.status !== "archived" && c.status !== "merged");
  if (active.length === 0) return out;
  const g = graph ?? buildGraph(state);

  // elevate_concept — well-connected but under-structured concepts.
  for (const c of active) {
    const count = refCount(state, g, c.id);
    const underStructured = c.principleIds.length === 0 || !c.definition.trim();
    if (count >= ELEVATE_THRESHOLD && underStructured) {
      out.push(proposal({
        type: "elevate_concept",
        priority: "medium",
        confidence: count >= ELEVATE_THRESHOLD + 2 ? "high" : "moderate",
        subsystem: "graph",
        rationale: `“${c.name}” is referenced by ${count} records but ${c.principleIds.length === 0 ? "isn't tied to a principle" : "lacks a definition"}. It may deserve a firmer place in your world model.`,
        suggestedAction: "Strengthen the concept — add a definition or derive a principle.",
        actionHref: `/world/concept/${c.id}`,
        affected: [{ kind: "concept", id: c.id, label: c.name }],
      }));
    }
  }

  // merge_duplicate_concepts — same normalised name, or alias overlap.
  const byName = new Map<string, Concept[]>();
  for (const c of active) {
    const key = norm(c.name);
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  const seen = new Set<string>();
  const emitMerge = (a: Concept, b: Concept, why: string) => {
    const pair = [a.id, b.id].sort().join("|");
    if (seen.has(pair)) return;
    seen.add(pair);
    out.push(proposal({
      type: "merge_duplicate_concepts",
      priority: "low",
      confidence: "moderate",
      subsystem: "graph",
      rationale: `“${a.name}” and “${b.name}” ${why}. They may be the same concept recorded twice.`,
      suggestedAction: "Review the two concepts and merge them if they are the same.",
      actionHref: `/world/concept/${a.id}`,
      affected: [
        { kind: "concept", id: a.id, label: a.name },
        { kind: "concept", id: b.id, label: b.name },
      ],
    }));
  };
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) emitMerge(group[i], group[j], "share the same name");
  }
  for (const a of active) {
    for (const b of active) {
      if (a.id === b.id) continue;
      if ((a.aliases ?? []).map(norm).includes(norm(b.name))) emitMerge(a, b, "one lists the other as an alias");
    }
  }
  return out;
};
