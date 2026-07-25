/**
 * Memory Explanation API (LIFEOS-026, Feature 7).
 *
 * The shared, deterministic explanation service used by EVERY surfaced memory
 * — Living Memory candidates, orchestrator recommendations, Daily Home
 * sections, reflection prompts, and future systems. Nothing here is opaque:
 * an explanation always exposes the exact triggers that fired, the supporting
 * records (references — never copies), a qualitative confidence, and the moment
 * it was generated. There is no AI, no inference beyond what the records
 * themselves state, and nothing is mutated.
 */

import type { ConfidenceLevel, ISO } from "@/types/mvp";
import { levelFromCount, CONFIDENCE_ORDER } from "@/lib/dialectic/confidence";

/** One reason a memory surfaced — a stable machine id plus a human label. */
export interface MemoryTrigger {
  rule: string;
  label: string;
}

/** A record cited as supporting evidence (a reference, never a copy). */
export interface MemoryRecordRef {
  kind: string;
  id: string;
  label: string;
  href?: string;
  note?: string;
}

/**
 * A complete, transparent explanation for why something was surfaced. Every
 * field is required so no surfaced item can ever be unexplained.
 */
export interface MemoryExplanation {
  triggers: MemoryTrigger[];
  evidence: MemoryRecordRef[];
  confidence: ConfidenceLevel;
  generatedAt: ISO;
  /** One-line "Suggested because: …" summary derived from the triggers. */
  summary: string;
}

/**
 * Build an explanation. Confidence, when not given, is derived deterministically
 * from the number of independent triggers that fired (more corroborating
 * reasons → higher confidence), never from a model. `generatedAt` is injectable
 * so the same inputs produce the same explanation in tests.
 */
export function explain(input: {
  triggers: MemoryTrigger[];
  evidence?: MemoryRecordRef[];
  confidence?: ConfidenceLevel;
  generatedAt?: ISO;
}): MemoryExplanation {
  const triggers = input.triggers;
  const evidence = input.evidence ?? [];
  const confidence = input.confidence ?? levelFromCount(triggers.length);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const summary =
    triggers.length === 0
      ? "Surfaced from your existing records."
      : "Suggested because: " + triggers.map((t) => t.label).join("; ") + ".";
  return { triggers, evidence, confidence, generatedAt, summary };
}

/** True when an explanation is well-formed (used by integrity + self-tests). */
export function isCompleteExplanation(e: MemoryExplanation | undefined | null): boolean {
  return Boolean(
    e &&
      Array.isArray(e.triggers) && e.triggers.length > 0 &&
      e.triggers.every((t) => t.rule && t.label) &&
      Array.isArray(e.evidence) &&
      CONFIDENCE_ORDER.includes(e.confidence) &&
      typeof e.generatedAt === "string" && !Number.isNaN(Date.parse(e.generatedAt)) &&
      typeof e.summary === "string" && e.summary.length > 0,
  );
}

/** Days between an ISO timestamp and `now` (whole days, never negative). */
export function daysSince(iso: string, now = Date.now()): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86400000));
}
