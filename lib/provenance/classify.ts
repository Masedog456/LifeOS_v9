/**
 * Structural provenance classification (LIFEOS-050).
 *
 * Almost every record in LifeOS already proves its own authorship by EXISTING:
 * a Capture is something the user typed; a reading Passage is text extracted
 * from their document; a LIFEOS-049 part summary is machine-derived by
 * construction. Storing an `originType` on each of those would duplicate a fact
 * the schema already guarantees — and duplicated facts drift.
 *
 * So this module classifies at runtime from structure, and only consults stored
 * provenance where structure genuinely cannot decide (records that can contain
 * either the user's words or a machine's).
 *
 * The honest-uncertainty rule: when structure is ambiguous and nothing is
 * stored, the answer is `unknown` — never a flattering guess.
 */

import { detectAttribution } from "@/lib/provenance";
import type { OriginType, Provenance } from "@/lib/provenance";

/** Record kinds whose very existence guarantees the user wrote them. */
const USER_AUTHORED_KINDS = new Set([
  "capture", "annotation", "reflection", "note", "highlight_note",
  "document_note", "section_note", "processing_note",
]);

/** Record kinds that are always extracted source material. */
const SOURCE_KINDS = new Set(["passage", "document_passage", "highlight"]);

/**
 * Record kinds that are always machine-derived structure or output. Retrieval
 * chunks and embeddings are derived STRUCTURE (not prose); part summaries and
 * document syntheses are derived PROSE. Neither may ground a source claim.
 */
const DERIVED_KINDS = new Set([
  "retrieval_chunk", "embedding", "part_summary", "document_synthesis",
  "document_map", "study_material", "recommendation", "insight",
]);

/**
 * Records that may contain EITHER the user's words or AI prose, depending on how
 * they were created. These are the only kinds where classification must fall
 * back to stored provenance — and the only place the historical blur lived.
 */
export const AMBIGUOUS_KINDS = new Set([
  "belief", "concept", "research_project", "dialogue", "synthesis", "proposal",
]);

export interface ClassifyInput {
  /** The record kind, using the codebase's existing entity-kind strings. */
  kind: string;
  /** Explicit provenance, when the record carries it. */
  provenance?: Provenance;
  /**
   * Legacy per-model AI marker already present on several records
   * (`Concept.source`, `Decision.analysisSource`, `KnowledgeSource.derivedSource`).
   * Reused rather than replaced.
   */
  source?: string | null;
  /** True when the record is known to have been created from AI-generated text. */
  fromAiText?: boolean;
  /**
   * The record's text. Structurally user-authored kinds (capture, note) have
   * nowhere to store provenance, so machine prose saved into them carries an
   * attribution marker in the text itself — this is where it is read back
   * (LIFEOS-050A). Without it, AI prose saved as a note would classify as the
   * user's own words at read time.
   */
  text?: string;
}

/**
 * Classify a record's origin. Deterministic and total — every input yields a
 * definite `OriginType`, with `unknown` as the honest fallback.
 *
 * Precedence: explicit provenance → structural kind → legacy `source` marker →
 * unknown.
 */
export function classifyOrigin(input: ClassifyInput): OriginType {
  // 1. Explicit provenance always wins — it was recorded deliberately.
  if (input.provenance?.originType) return input.provenance.originType;

  // 2. A record created from AI text is machine prose regardless of its kind.
  if (input.fromAiText) return "conqify_ai";

  // 3. An attribution marker in the text overrides structural authorship. This
  //    is what stops machine prose saved into a Capture or a note from being
  //    read back later as the user's own thinking (LIFEOS-050A).
  const declared = detectAttribution(input.text);
  if (declared) return declared;

  // 4. Structural truth.
  if (SOURCE_KINDS.has(input.kind)) return "original_source";
  if (USER_AUTHORED_KINDS.has(input.kind)) return "user_authored";
  if (DERIVED_KINDS.has(input.kind)) return "derived";

  // 5. Legacy markers already carried by several models.
  if (input.source === "ai" || input.source === "mock") return "conqify_ai";
  if (input.source === "deterministic") return "derived";
  if (input.source === "user") return "user_authored";

  // 6. Ambiguous kinds with nothing recorded: honestly unknown. These predate
  //    LIFEOS-050 and we refuse to assert authorship we cannot verify.
  if (AMBIGUOUS_KINDS.has(input.kind)) return "unknown";

  return "unknown";
}

/**
 * The conservative default for records that existed before this sprint. We do
 * NOT rewrite user data: legacy records are classified at read time by the same
 * structural rules, which are correct for every kind whose authorship the schema
 * guarantees, and `unknown` for the genuinely ambiguous ones.
 */
export function classifyLegacy(kind: string, text?: string): OriginType {
  return classifyOrigin({ kind, text });
}

/** Convenience: does this record kind always guarantee user authorship? */
export function isStructurallyUserAuthored(kind: string): boolean {
  return USER_AUTHORED_KINDS.has(kind);
}

/** Convenience: does this record kind always hold source material? */
export function isStructurallySource(kind: string): boolean {
  return SOURCE_KINDS.has(kind);
}
