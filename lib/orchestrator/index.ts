/**
 * Cognitive orchestrator (LIFEOS-024).
 *
 * The one place every subsystem's scanner output is coordinated. No subsystem
 * depends on another: each scanner is a pure, deterministic read over the store,
 * and the orchestrator is the sole merge point. The orchestrator generates
 * OPPORTUNITIES (recommendations) — it never generates content and never mutates
 * knowledge. It is intentionally lightweight: run scanners, merge by signature,
 * preserve the user's decisions on recommendations that persist.
 */

import type { Recommendation, StoreState } from "@/types/mvp";
import { buildGraph } from "@/lib/graph";
import type { RecommendationProposal, Scanner } from "@/lib/orchestrator/types";
import { beliefScanner } from "@/lib/orchestrator/scanners/belief";
import { researchScanner } from "@/lib/orchestrator/scanners/research";
import { graphScanner } from "@/lib/orchestrator/scanners/graph";
import { dialogueScanner } from "@/lib/orchestrator/scanners/dialogue";
import { reviewScanner } from "@/lib/orchestrator/scanners/review";
import { formationScanner } from "@/lib/orchestrator/scanners/formation";
import { decisionScanner } from "@/lib/orchestrator/scanners/decision";
import { worldScanner } from "@/lib/orchestrator/scanners/world";

/** Every registered scanner, one per subsystem. Order is stable and inspectable. */
export const SCANNERS: { name: string; scan: Scanner }[] = [
  { name: "belief", scan: beliefScanner },
  { name: "research", scan: researchScanner },
  { name: "graph", scan: graphScanner },
  { name: "dialogue", scan: dialogueScanner },
  { name: "review", scan: reviewScanner },
  { name: "formation", scan: formationScanner },
  { name: "decision", scan: decisionScanner },
  { name: "world", scan: worldScanner },
];

/** Run every scanner over the store and collect their proposals (deterministic). */
export function runScanners(state: StoreState): RecommendationProposal[] {
  const all: RecommendationProposal[] = [];
  // Built ONCE for this pass. Two scanners read the graph and each used to build
  // its own identical copy; the graph is a pure function of `state`, which does
  // not change during a scan, so one build is exactly equivalent to N builds.
  const graph = buildGraph(state);
  for (const s of SCANNERS) {
    try {
      all.push(...s.scan(state, graph));
    } catch {
      // A misbehaving scanner must never take down the orchestrator.
    }
  }
  // Dedupe within a single run by signature (two scanners could, in principle,
  // surface the same opportunity).
  const seen = new Set<string>();
  return all.filter((p) => (seen.has(p.signature) ? false : (seen.add(p.signature), true)));
}

const PRIORITY_RANK: Record<Recommendation["priority"], number> = { high: 0, medium: 1, low: 2 };

/**
 * Merge freshly-scanned proposals with the recommendations already stored:
 *  - an existing recommendation keeps its lifecycle (dismissed/accepted/
 *    completed/snoozed) and id/timestamp, but refreshes its rationale/priority;
 *  - a proposal with no match becomes a new, open recommendation;
 *  - stored recommendations whose signal has DISAPPEARED are kept only if the
 *    user already engaged with them (accepted/completed/dismissed) — otherwise a
 *    stale open recommendation is dropped so the inbox reflects reality.
 * Returns the merged list, most-actionable first.
 */
export function mergeRecommendations(
  existing: Recommendation[],
  proposals: RecommendationProposal[],
  now: string,
  makeId: () => string,
): Recommendation[] {
  const bySig = new Map(existing.map((r) => [r.signature, r]));
  const proposalSigs = new Set(proposals.map((p) => p.signature));
  const merged: Recommendation[] = [];

  for (const p of proposals) {
    const prior = bySig.get(p.signature);
    if (prior) {
      merged.push({ ...prior, rationale: p.rationale, priority: p.priority, confidence: p.confidence, suggestedAction: p.suggestedAction, actionHref: p.actionHref, affected: p.affected });
    } else {
      merged.push({ ...p, id: makeId(), createdAt: now, dismissed: false, accepted: false, completed: false });
    }
  }
  // Keep engaged-with recommendations whose signal is gone (history/audit trail).
  for (const r of existing) {
    if (proposalSigs.has(r.signature)) continue;
    if (r.accepted || r.completed || r.dismissed) merged.push(r);
  }

  return merged.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    if (a.createdAt === b.createdAt) return 0;   // stable — preserve scanner order
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

/** Is a recommendation currently actionable (open and not snoozed)? */
export function isActive(r: Recommendation, now = Date.now()): boolean {
  if (r.dismissed || r.completed) return false;
  if (r.snoozedUntil && Date.parse(r.snoozedUntil) > now) return false;
  return true;
}
