/**
 * Recommendation explanation (LIFEOS-026, Feature 4).
 *
 * Turns any orchestrator Recommendation into the shared MemoryExplanation shape
 * so EVERY recommendation, everywhere it appears, shows a visible, structured
 * "Because: …" — never an unexplained suggestion. Derived entirely from the
 * recommendation's own fields (type, rationale, affected records, confidence,
 * timestamp); nothing is invented or stored.
 */

import type { Recommendation, StoreState } from "@/types/mvp";
import { explain, type MemoryExplanation, type MemoryRecordRef } from "@/lib/memory/explanation";

const HREF: Record<string, (id: string) => string> = {
  belief: () => "/constitution",
  concept: (id) => `/world/concept/${id}`,
  dialogue: (id) => `/dialogue/${id}`,
  tension: () => "/dialogue",
  synthesis: () => "/dialogue",
  research_project: (id) => `/research/${id}`,
  decision: (id) => `/decisions/${id}`,
  practice: () => "/formation",
  record: () => "/",
};

const TYPE_BECAUSE: Record<Recommendation["type"], string> = {
  open_dialogue: "two of your beliefs are in tension and no dialogue investigates them",
  create_synthesis: "research evidence conflicts with an accepted belief",
  create_research_question: "a tension's syntheses keep failing",
  elevate_concept: "a concept is well-connected but under-structured",
  merge_duplicate_concepts: "two concepts look like duplicates",
  new_principle: "a concept underpins several beliefs but isn't a principle yet",
  formation_exercise: "a conflict keeps recurring across dialogues",
  review_belief: "a belief hasn't been reviewed in months",
  import_source: "a dialogue references a record that no longer exists",
  unresolved_tension: "a tension has stayed open",
  confidence_decline: "a synthesis's confidence keeps dropping",
  repeat_reflection: "a recurring practice invites another reflection",
  revisit_decision: "a decision was made but never outcome-reviewed",
};

/** Derive a complete explanation for a recommendation from its own fields. */
export function explainRecommendation(_state: StoreState, rec: Recommendation): MemoryExplanation {
  const evidence: MemoryRecordRef[] = rec.affected.map((a) => ({
    kind: a.kind,
    id: a.id,
    label: a.label,
    href: rec.actionHref ?? HREF[a.kind]?.(a.id),
  }));
  return explain({
    triggers: [
      { rule: rec.type, label: TYPE_BECAUSE[rec.type] ?? rec.type.replace(/_/g, " ") },
      { rule: `subsystem_${rec.subsystem}`, label: `surfaced by the ${rec.subsystem} scanner` },
    ],
    evidence,
    confidence: rec.confidence,
    generatedAt: rec.createdAt,
  });
}
