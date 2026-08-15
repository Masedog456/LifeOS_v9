/**
 * Provenance contract (LIFEOS-050).
 *
 * The smallest vocabulary that lets Conqify answer four questions about any
 * record — **what is this, who produced it, where did it come from, and may it
 * ground a claim?** — without a new storage system, a provider registry, or a
 * speculative ontology.
 *
 * The product principle this enforces: **Conqify refuses to flatten.** These are
 * permanently different things and must never collapse into one another:
 *
 *   ORIGINAL SOURCE  ≠  USER THOUGHT  ≠  AI INTERPRETATION  ≠  DERIVED OUTPUT
 *
 * Design commitments:
 *   - **Structural truth over duplicated metadata.** A Capture is user-authored
 *     because of what a Capture *is*; we classify it at runtime rather than
 *     stamping a redundant field on every row (see `classify.ts`).
 *   - **Uncertainty fails safe.** `unknown` is a real state. An unclassifiable
 *     record never gets promoted to `original_source` or `user_authored` just to
 *     avoid a null — it simply cannot ground external claims.
 *   - **Grounding is not one boolean.** Conqify already has two distinct kinds of
 *     evidence: "what the source says" and "what I previously thought". A
 *     reflection is excellent evidence of the second and no evidence of the
 *     first, so `groundingAuthority` returns both axes.
 *   - **No migration.** Nothing here requires a schema change; provenance is
 *     derived from structure, or carried on existing jsonb/`source` fields.
 */

import type { RecordRefLite } from "@/types/mvp";

/**
 * What a piece of material fundamentally is.
 *
 * `imported_user_authored` is deliberately distinct from `user_authored`: a
 * Readwise highlight or an exported note is genuinely the user's own judgement,
 * but it was made in another system and its fidelity depends on that import —
 * a difference worth keeping even though both carry the same grounding rights.
 */
export type OriginType =
  | "original_source"        // the actual text of a source the user is reading
  | "user_authored"          // written by the user, inside Conqify
  | "imported_user_authored" // written by the user, elsewhere, brought in
  | "external_ai"            // produced by an AI system outside Conqify
  | "conqify_ai"             // produced by Conqify's own AI layer
  | "derived"                // produced by deterministic Conqify processing
  | "unknown";               // honestly unclassifiable — fails safe

export const ORIGIN_TYPES: readonly OriginType[] = [
  "original_source", "user_authored", "imported_user_authored",
  "external_ai", "conqify_ai", "derived", "unknown",
];

/**
 * Which system produced the material. Deliberately a free string, not an enum:
 * a new AI product must never require a migration or a code change to be
 * representable. `"conqify"` is the only value this codebase asserts itself.
 */
export type OriginSystem = string;

/** Plain-language labels for the few places provenance is surfaced (§13). */
export const ORIGIN_LABEL: Record<OriginType, string> = {
  original_source: "From your document",
  user_authored: "Written by you",
  imported_user_authored: "Written by you elsewhere",
  external_ai: "AI-generated",
  conqify_ai: "AI-generated",
  derived: "Generated from your document",
  unknown: "Source unavailable",
};

// ------------------------------------------------------------- grounding ----

/**
 * The two independent kinds of evidence Conqify recognises.
 *
 *   `source` — may be cited as what an external source actually says.
 *   `self`   — may be cited as what the USER previously thought.
 *
 * These are orthogonal, which is why a single `canGround` boolean would be
 * wrong: a reflection has full `self` authority and zero `source` authority, and
 * conflating them is how "I once thought X" turns into "the book says X".
 */
export interface GroundingAuthority {
  /** May ground a claim about an external source. */
  source: boolean;
  /** May ground a claim about the user's own prior thinking. */
  self: boolean;
}

const AUTHORITY: Record<OriginType, GroundingAuthority> = {
  original_source: { source: true, self: false },
  user_authored: { source: false, self: true },
  imported_user_authored: { source: false, self: true },
  external_ai: { source: false, self: false },
  conqify_ai: { source: false, self: false },
  derived: { source: false, self: false },
  unknown: { source: false, self: false },
};

/** Deterministic grounding rights for an origin type. Total and testable. */
export function groundingAuthority(origin: OriginType): GroundingAuthority {
  return AUTHORITY[origin] ?? AUTHORITY.unknown;
}

/**
 * May this material be cited as evidence of what a SOURCE says? This is the
 * single most important predicate in the system: AI prose must never answer
 * `true`, no matter which record type it was saved into.
 */
export function canGroundSource(origin: OriginType): boolean {
  return groundingAuthority(origin).source;
}

/** May this be cited as evidence of the user's own prior thinking? */
export function canGroundSelf(origin: OriginType): boolean {
  return groundingAuthority(origin).self;
}

/** True for anything produced by a machine — AI or deterministic derivation. */
export function isMachineProduced(origin: OriginType): boolean {
  return origin === "external_ai" || origin === "conqify_ai" || origin === "derived";
}

/** True for AI-generated prose specifically (excludes deterministic derivation). */
export function isAiGenerated(origin: OriginType): boolean {
  return origin === "external_ai" || origin === "conqify_ai";
}

// --------------------------------------------------------------- lineage ----

/**
 * How a record relates to what it came from. Deliberately three relations, not a
 * graph ontology:
 *
 *   quoted_from  — contains the source's own words (preserves source authority)
 *   derived_from — produced BY processing that material (does not)
 *   imported_from— the same material, carried in from another system
 */
export type LineageRelation = "quoted_from" | "derived_from" | "imported_from";

/** One provenance edge, built on the existing typed record reference. */
export interface LineageLink {
  relation: LineageRelation;
  /** The record this came from — reuses `RecordRefLite`, not a new primitive. */
  ref: RecordRefLite;
  /** Optional page/passage locator when the target is a reading location. */
  locator?: string;
}

/**
 * Whether a chain of lineage preserves source authority. Only `quoted_from`
 * carries the source's own words forward; a single `derived_from` anywhere in
 * the chain permanently removes source-grounding rights. This is the general
 * form of the LIFEOS-049 rule that a part summary can never be a final citation.
 */
export function lineagePreservesSource(chain: readonly LineageLink[]): boolean {
  return chain.length > 0 && chain.every((l) => l.relation === "quoted_from");
}

/** Resolve the ultimate origin refs of a lineage chain (its roots). */
export function lineageRoots(chain: readonly LineageLink[]): RecordRefLite[] {
  return chain.map((l) => l.ref);
}

// -------------------------------------------------------------- segments ----

/**
 * Segment-level provenance (§4). Artifact-level labelling is insufficient for
 * mixed-authorship material: an AI conversation interleaves the user's own
 * prompts with the model's replies, and labelling the whole thing `external_ai`
 * would erase the user's contribution — exactly the flattening we forbid.
 *
 * Nothing imports conversations yet; this exists so the model can REPRESENT
 * mixed authorship when an importer is eventually justified.
 */
export interface ProvenanceSegment {
  /** Character offsets into the artifact's text, when spans are meaningful. */
  start?: number;
  end?: number;
  originType: OriginType;
  originSystem?: OriginSystem;
  /** Optional speaker/role label ("user", "assistant") for conversational material. */
  role?: string;
}

/** The provenance of one record: an overall claim plus optional finer detail. */
export interface Provenance {
  originType: OriginType;
  originSystem?: OriginSystem;
  /** Stable id in the system it came from — makes re-import idempotent later. */
  externalId?: string;
  /** What this was made from. */
  lineage?: LineageLink[];
  /** Finer-grained authorship for mixed material. */
  segments?: ProvenanceSegment[];
  /** When it entered Conqify (distinct from when it was authored). */
  importedAt?: string;
}

/**
 * The effective origin of a record, accounting for mixed authorship. A mixed
 * artifact is reported as its **least privileged** constituent, so an answer
 * assembled from a conversation can never inherit the user's authority for the
 * model's sentences.
 */
export function effectiveOrigin(p: Provenance): OriginType {
  if (!p.segments || p.segments.length === 0) return p.originType;
  const kinds = new Set<OriginType>(p.segments.map((s) => s.originType));
  kinds.add(p.originType);
  // Least-privileged wins: unknown < machine < user < source.
  if (kinds.has("unknown")) return "unknown";
  if (kinds.has("external_ai")) return "external_ai";
  if (kinds.has("conqify_ai")) return "conqify_ai";
  if (kinds.has("derived")) return "derived";
  if (kinds.has("imported_user_authored")) return "imported_user_authored";
  if (kinds.has("user_authored")) return "user_authored";
  return "original_source";
}

/** Grounding rights for a whole record, respecting mixed authorship. */
export function recordGrounding(p: Provenance): GroundingAuthority {
  return groundingAuthority(effectiveOrigin(p));
}

/**
 * Segments of an artifact that may ground source claims — the safe subset of a
 * mixed document. Returns `[]` unless the material genuinely quotes a source.
 */
export function sourceGroundableSegments(p: Provenance): ProvenanceSegment[] {
  return (p.segments ?? []).filter((s) => canGroundSource(s.originType));
}
