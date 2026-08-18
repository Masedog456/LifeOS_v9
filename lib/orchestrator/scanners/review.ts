/**
 * Review scanner (LIFEOS-024).
 *
 * Inspects the Belief Ledger's review cadence only. A belief the user still holds
 * but hasn't touched or judged in months is a candidate for review. Emits
 * `review_belief`. Deterministic against the store's own timestamps.
 */

import type { Belief, StoreState } from "@/types/mvp";
import { proposal, type RecommendationProposal, type Scanner } from "@/lib/orchestrator/types";

const STALE_DAYS = 90;

function lastTouched(b: Belief): number {
  const times = [b.updatedAt, ...b.judgments.map((j) => j.at), ...b.revisions.map((r) => r.at)]
    .map((t) => Date.parse(t))
    .filter((n) => !Number.isNaN(n));
  return times.length ? Math.max(...times) : Date.parse(b.createdAt);
}

export const reviewScanner: Scanner = (state: StoreState): RecommendationProposal[] => {
  const out: RecommendationProposal[] = [];
  const now = Date.now();
  const cutoff = STALE_DAYS * 24 * 60 * 60 * 1000;

  for (const b of state.beliefs) {
    if (b.status !== "accepted") continue;
    const ageMs = now - lastTouched(b);
    if (ageMs < cutoff) continue;
    const months = Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000));
    out.push(proposal({
      type: "review_belief",
      priority: months >= 6 ? "medium" : "low",
      confidence: "high",
      subsystem: "review",
      rationale: `You've held “${b.text}” for about ${months} month(s) without reviewing it. A belief unexamined for that long is worth revisiting.`,
      suggestedAction: "Review the belief in your Constitution.",
      actionHref: `/beliefs`,
      affected: [{ kind: "belief", id: b.id, label: b.text }],
    }));
  }
  return out;
};
