/**
 * Belief scanner (LIFEOS-024).
 *
 * Inspects the Belief Ledger only. Emits `open_dialogue` when two accepted
 * beliefs are in tension and no dialogue is already investigating them. The
 * tension signal is EXPLICIT: either a direct `contradicts` edge between the two
 * beliefs, or the two beliefs rest on concepts the user has declared as opposing
 * in the World Model. Reads the shared graph service (a read-only query layer,
 * not a subsystem) — never another subsystem's mutations.
 */

import type { StoreState } from "@/types/mvp";
import { buildGraph, relationshipsOf, type KnowledgeGraph } from "@/lib/graph";
import { proposal, type RecommendationProposal, type Scanner } from "@/lib/orchestrator/types";

export const beliefScanner: Scanner = (state: StoreState, graph?: KnowledgeGraph): RecommendationProposal[] => {
  const out: RecommendationProposal[] = [];
  const seen = new Set<string>();
  const accepted = new Map(state.beliefs.filter((b) => b.status !== "rejected").map((b) => [b.id, b]));
  if (accepted.size === 0) return out;
  const g = graph ?? buildGraph(state);

  const dialogueCovers = (a: string, b: string) =>
    state.dialogueSessions.some((d) => d.seedRefs.includes(a) && d.seedRefs.includes(b));

  const emit = (aId: string, bId: string, why: string) => {
    const a = accepted.get(aId), b = accepted.get(bId);
    if (!a || !b) return;
    const pair = [aId, bId].sort().join("|");
    if (seen.has(pair)) return;
    seen.add(pair);
    if (dialogueCovers(aId, bId)) return; // already being investigated
    out.push(proposal({
      type: "open_dialogue",
      priority: "high",
      confidence: "high",
      subsystem: "belief",
      rationale: `“${a.text}” and “${b.text}” ${why}, but no dialogue is investigating the tension.`,
      suggestedAction: "Open a dialogue to investigate the contradiction.",
      actionHref: `/dialogue?belief=${aId}&topic=${encodeURIComponent(a.text)}`,
      affected: [
        { kind: "belief", id: aId, label: a.text },
        { kind: "belief", id: bId, label: b.text },
      ],
    }));
  };

  // (a) Direct contradicts edge between two beliefs.
  for (const bid of accepted.keys()) {
    for (const e of relationshipsOf(g, bid)) {
      if (e.relation !== "contradicts") continue;
      const other = e.from === bid ? e.to : e.from;
      if (accepted.has(other)) emit(bid, other, "are marked as contradicting each other");
    }
  }

  // (b) Beliefs resting on concepts the user has declared as opposing.
  const conceptById = new Map(state.concepts.map((c) => [c.id, c]));
  for (const c of state.concepts) {
    for (const oid of c.opposingConcepts ?? []) {
      const o = conceptById.get(oid);
      if (!o) continue;
      for (const aId of c.relatedBeliefs) {
        for (const bId of o.relatedBeliefs) {
          if (aId !== bId) emit(aId, bId, `rest on the opposing concepts “${c.name}” and “${o.name}”`);
        }
      }
    }
  }

  return out;
};
