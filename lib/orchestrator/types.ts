/**
 * Shared scanner contract (LIFEOS-024).
 *
 * A scanner is a PURE, deterministic function of the store that inspects ONLY
 * its own subsystem and returns recommendation proposals. Scanners never import
 * one another and never mutate anything — the orchestrator merges their output.
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type {
  ConfidenceLevel,
  OrchestratorSubsystem,
  RecommendationPriority,
  RecommendationTarget,
  RecommendationType,
  StoreState,
} from "@/types/mvp";

/** A proposal is a recommendation without the store-managed lifecycle fields. */
export interface RecommendationProposal {
  type: RecommendationType;
  priority: RecommendationPriority;
  confidence: ConfidenceLevel;
  rationale: string;
  subsystem: OrchestratorSubsystem;
  suggestedAction: string;
  actionHref?: string;
  affected: RecommendationTarget[];
  signature: string;
}

/**
 * `graph` is an OPTIONAL, already-built view of the same store. It exists purely
 * so one analysis pass does not rebuild an identical graph once per scanner —
 * `runScanners` builds it once and threads it down. A scanner given no graph
 * builds its own, so every existing call signature keeps working and scanners
 * stay independently callable. It is not a cache: nothing is stored, nothing is
 * invalidated, and the graph is a pure function of the state passed alongside it.
 */
export type Scanner = (state: StoreState, graph?: KnowledgeGraph) => RecommendationProposal[];

/** Stable dedupe signature: type + the sorted ids of the affected objects. */
export function signatureOf(type: RecommendationType, affected: RecommendationTarget[]): string {
  return `${type}:${affected.map((a) => a.id).filter(Boolean).sort().join("|")}`;
}

/** Build a proposal, computing its signature from the affected objects. */
export function proposal(p: Omit<RecommendationProposal, "signature">): RecommendationProposal {
  return { ...p, signature: signatureOf(p.type, p.affected) };
}
