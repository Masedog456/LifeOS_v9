/**
 * LifeOS MVP adapter types (LIFEOS-002 — Belief Thread MVP).
 *
 * These are intentionally NARROW, localStorage-friendly shapes for the
 * three-screen prototype. They do NOT replace the full domain model in
 * `types/lifeos.ts` — that broader ontology stays intact for later. Each
 * type notes how it maps to the ontology.
 *
 * A localStorage prototype has no relational tables, so `Revision` and
 * `UserJudgment` (separate first-class objects in the ontology) are
 * flattened into arrays embedded on `Belief`. That is a deliberate MVP
 * simplification, not a change to the ontology.
 */

import type { SourceType } from "@/types/lifeos";

export type ISO = string;

/** Maps to ontology `Source`/`Quote`: the raw, immutable thing the user captured. */
export interface Capture {
  id: string;
  /** Verbatim captured text. Immutable once created — never edited in place. */
  text: string;
  createdAt: ISO;
  /** Optional link back to a Knowledge Library source this capture came from. */
  sourceId?: string;
}

/** Maps to ontology `Claim` (status `proposed`): an AI/mock-proposed first-person belief. */
export interface Proposal {
  id: string;
  captureId: string;
  /** Proposed first-person belief statement. */
  claim: string;
  theme?: string;
  /** Character span in the capture text that inspired the claim (best-effort). */
  spanStart?: number;
  spanEnd?: number;
  source: "ai" | "mock";
  createdAt: ISO;
  /** True once the user has made a judgment on it (accept/rewrite/reject/question). */
  resolved: boolean;
}

export type BeliefStatus = "accepted" | "questioned" | "revised" | "rejected";

/** Maps to ontology `Revision`: one point in a belief's wording history (append-only). */
export interface RevisionEntry {
  text: string;
  at: ISO;
  reason: "proposed" | "accepted" | "rewritten" | "reaffirmed" | "questioned";
}

/** Maps to ontology `UserJudgment`: one human verdict on the belief (append-only). */
export interface JudgmentEntry {
  decision: "accepted" | "rewritten" | "rejected" | "questioned" | "reaffirmed";
  at: ISO;
  note?: string;
}

/** Maps to ontology `ConstitutionEntry`: a belief the user currently holds (or has archived). */
export interface Belief {
  id: string;
  captureId: string;
  proposalId: string;
  /** Current wording of the belief — the user's version once rewritten. */
  text: string;
  theme?: string;
  status: BeliefStatus;
  createdAt: ISO;
  updatedAt: ISO;
  /** Append-only wording history — the "thread" the user watches bend over time. */
  revisions: RevisionEntry[];
  /** Append-only judgment history. */
  judgments: JudgmentEntry[];
}

// ---------- Knowledge Library (LIFEOS-003) ----------

/** Reuse the ontology's SourceType (types/lifeos.ts) — no parallel enum. */
export type { SourceType } from "@/types/lifeos";

/** How the source was brought in. Drives which ingestion adapter ran. */
export type SourceInput = "text" | "pdf" | "url";

/** Pipeline progress for a source (see lib/pipeline.ts). */
export type ProcessingState =
  | "captured"
  | "not_started"
  | "queued"
  | "processing"
  | "extracting_text"
  | "chunking"
  | "summarizing"
  | "extracting_quotes"
  | "extracting_concepts"
  | "generating_beliefs"
  | "partial"
  | "ready"
  | "needs_text"
  | "cancelled"
  | "error";

/** User-facing reading status, distinct from pipeline processing state. */
export type SourceStatus = "unread" | "reading" | "read";

/** A chunk of a source's text — the operational unit for long-source analysis. */
export interface KnowledgeChunk {
  id: string;
  index: number;
  text: string;
  /** Char offsets into the normalized source text (present for chunks built ≥ LIFEOS-007). */
  start?: number;
  end?: number;
  /** Page range this chunk spans (PDF sources, LIFEOS-008). */
  pageStart?: number;
  pageEnd?: number;
  /** Optional section/chapter label. */
  label?: string;
}

// ---------- PDF ingestion (LIFEOS-008) ----------

/** Char range of one page within the normalized extracted text. */
export interface PageSpan {
  page: number;
  start: number;
  end: number;
}

export type ExtractionStatus =
  | "text_extracted"
  | "partial_text"
  | "scanned_ocr_required"
  | "extraction_failed";

/** Original PDF metadata (the binary itself is never stored). */
export interface PdfMeta {
  filename: string;
  size: number;
  pageCount: number;
  mime: string;
  uploadedAt: ISO;
  /** Number of pages actually extracted (may be < pageCount if capped). */
  extractedPages: number;
}

// ---------- Long-source analysis (LIFEOS-007) ----------

export type ProcessingMode = "quick" | "full" | "stage";
export type Coverage = "sampled" | "full";
export type StageName = "summary" | "quotes" | "concepts" | "beliefs";
export type StageStatus = "not_started" | "processing" | "processed" | "failed" | "cancelled";

/** A map-stage result for a single chunk. Retains chunk provenance. */
export interface ChunkResult {
  chunkId: string;
  index: number;
  summary: string;
  concepts: string[];
  /** Candidate quotes with best-effort offsets within the source. */
  quotes: { text: string; start?: number; end?: number }[];
  claims: string[];
  source: "ai" | "mock";
}

/** Coverage + provenance metadata for the latest analysis run. */
export interface AnalysisMeta {
  mode: ProcessingMode | null;
  coverage: Coverage | null;
  chunksAnalyzed: number;
  totalChunks: number;
  /** Whether derived artifacts came from real AI or the deterministic mock. */
  source: "ai" | "mock" | null;
  /** Count of AI-returned quotes dropped because they didn't match source text. */
  unmatchedQuotes?: number;
  updatedAt?: ISO;
}

export function emptyStages(): Record<StageName, StageStatus> {
  return { summary: "not_started", quotes: "not_started", concepts: "not_started", beliefs: "not_started" };
}

export function emptyAnalysis(): AnalysisMeta {
  return { mode: null, coverage: null, chunksAnalyzed: 0, totalChunks: 0, source: null };
}

/**
 * Maps to ontology `Source` (+ derived `Quote`/`Concept`/`Claim`). The
 * repository entry from which beliefs are eventually formed. Distinct from
 * the Constitution: this is the library, not the worldview.
 */
export interface KnowledgeSource {
  id: string;
  type: SourceType;
  input: SourceInput;
  title: string;
  author?: string;
  /** Provenance of the material: a URL, a filename, or free text. */
  origin?: string;
  addedAt: ISO;
  status: SourceStatus;
  processingState: ProcessingState;
  processingError?: string;
  /** The immutable original text. Never edited in place once set. */
  originalText: string;
  chunks: KnowledgeChunk[];
  summary?: string;
  /** AI/mock-extracted verbatim key quotes (+ any the user saved in the reader). */
  keyQuotes: string[];
  keyConcepts: string[];
  /** Draft first-person belief claims — sent to the Belief Inbox on user action, never auto. */
  candidateBeliefs: string[];
  /** Whether the derived fields above came from real AI or the deterministic mock. */
  derivedSource?: "ai" | "mock";
  // ---- Long-source analysis (LIFEOS-007) ----
  /** Per-chunk map-stage results (provenance for source-wide artifacts). */
  chunkResults?: ChunkResult[];
  /** Independent per-stage status so one failure doesn't erase other results. */
  stages?: Record<StageName, StageStatus>;
  /** Coverage + provenance of the latest analysis run. */
  analysis?: AnalysisMeta;
  // ---- PDF ingestion (LIFEOS-008) ----
  pdfMeta?: PdfMeta;
  /** Page → char-range map into the (immutable) extracted text. */
  pageMap?: PageSpan[];
  extractionStatus?: ExtractionStatus;
}

// ---------- Retrieval (LIFEOS-009) ----------

export type RecordType =
  | "source"
  | "chunk"
  | "summary"
  | "concept"
  | "quote"
  | "capture"
  | "proposal"
  | "belief"
  | "revision";

/** A normalized, searchable view over existing data — built in memory, not persisted. */
export interface RetrievalRecord {
  id: string;
  type: RecordType;
  text: string;
  title?: string;
  sourceId?: string;
  captureId?: string;
  beliefId?: string;
  page?: number;
  status?: string;
  concepts?: string[];
  createdAt?: ISO;
  updatedAt?: ISO;
  href?: string;
}

export type FeedbackVerdict = "relevant" | "not_relevant" | "dismissed" | "snoozed";

/** User feedback on a surfaced retrieval record — tunes future deterministic ranking. */
export interface FeedbackEntry {
  recordId: string;
  verdict: FeedbackVerdict;
  at: ISO;
  /** Set when verdict is "snoozed": hidden until this time. */
  snoozeUntil?: ISO;
}

// ---------- Comparative intelligence (LIFEOS-010) ----------

/** What kind of material was selected into a comparison. */
export type ComparisonInputKind = "source" | "belief" | "passage";

/** A single selected material in a comparison, with enough to rebuild evidence. */
export interface ComparisonInputRef {
  kind: ComparisonInputKind;
  /** Display label (source title / belief snippet / passage preview). */
  label: string;
  sourceId?: string;
  beliefId?: string;
  /** For passage inputs: the exact selected quote + provenance. */
  quote?: string;
  page?: number;
}

export type EvidenceKind =
  | "metadata"
  | "summary"
  | "chunk_summary"
  | "quote"
  | "concept"
  | "claim"
  | "belief"
  // ---- dialectical inquiry (LIFEOS-011) ----
  | "revision"
  | "comparison_finding"
  | "terminology";

/**
 * One deterministic, provenance-bearing evidence item. Built from existing
 * data (never fabricated) and referenced by id from the comparison result.
 */
export interface EvidenceItem {
  /** Stable packet id, e.g. "E1". */
  id: string;
  kind: EvidenceKind;
  /** Which selected material this belongs to (label). */
  group: string;
  sourceId?: string;
  beliefId?: string;
  chunkId?: string;
  page?: number;
  start?: number;
  end?: number;
  /** Exact text (verbatim for quotes). */
  text: string;
  /** Whether the underlying artifact came from real AI or the mock. */
  origin?: "ai" | "mock";
}

/** Evidence grouped per selected material, with coverage honesty. */
export interface EvidenceGroup {
  /** A comparison input, or (LIFEOS-011) a dialectical-inquiry input. */
  ref: ComparisonInputRef | InquiryInputRef;
  coverage: Coverage | null;
  /** True when only part of the source was analyzed/extracted. */
  partial: boolean;
  items: EvidenceItem[];
}

/** A synthesized point that MUST cite evidence ids. */
export interface ComparisonPoint {
  statement: string;
  evidenceIds: string[];
}

/** Same term used differently, or different terms with similar function. */
export interface TerminologyDifference {
  term: string;
  note: string;
  evidenceIds: string[];
}

export type ContradictionKind =
  | "logical"
  | "practical"
  | "definitional"
  | "level_of_analysis"
  | "historical"
  | "ambiguity";

export interface Disagreement extends ComparisonPoint {
  /** Not every difference is a contradiction — classify it. */
  kind: ContradictionKind;
}

export interface PositionEvidence {
  position: string;
  evidenceIds: string[];
}

/** Strict structured comparison result (Phase 4). */
export interface ComparisonResultData {
  title: string;
  question: string;
  sourcesCompared: string[];
  sharedConcepts: string[];
  agreements: ComparisonPoint[];
  disagreements: Disagreement[];
  terminologyDifferences: TerminologyDifference[];
  assumptions: ComparisonPoint[];
  strongestEvidence: PositionEvidence[];
  unresolvedTensions: ComparisonPoint[];
  questionsForUser: string[];
  relationToBeliefs: ComparisonPoint[];
  limitations: string[];
  coverageNote: string;
  /** Points dropped in verification for citing missing/invalid evidence. */
  flagged?: string[];
}

export type ComparisonDecision = "accepted" | "rewritten" | "questioned" | "rejected";

/** A human verdict on one comparison insight (append-only). */
export interface ComparisonJudgment {
  /** Which insight, e.g. "agreement:0" or "disagreement:2". */
  insightRef: string;
  decision: ComparisonDecision;
  at: ISO;
  note?: string;
}

/** A saved comparison — a PROPOSAL, never an automatic conclusion. */
export interface Comparison {
  id: string;
  title: string;
  question: string;
  inputs: ComparisonInputRef[];
  sourceIds: string[];
  beliefIds: string[];
  /** Flat evidence packet the result references by id. */
  evidence: EvidenceItem[];
  result: ComparisonResultData;
  /** Model label ("mock" or the configured model). */
  aiModel: string;
  source: "ai" | "mock";
  coverage: Coverage | null;
  partial: boolean;
  /** Whether a second verification pass ran. */
  verified: boolean;
  createdAt: ISO;
  /** Append-only human judgments on the insights. */
  judgments: ComparisonJudgment[];
  /** Evidence fingerprint for freshness detection (LIFEOS-015). */
  fingerprint?: SavedFingerprint;
  /** Append-only prior results from reruns (LIFEOS-015). */
  history?: { at: ISO; result: ComparisonResultData; source: "ai" | "mock" }[];
}

// ---------- Dialectical intelligence (LIFEOS-011) ----------

export type InquiryInputKind = "source" | "belief" | "passage" | "comparison";

export interface InquiryInputRef {
  kind: InquiryInputKind;
  label: string;
  sourceId?: string;
  beliefId?: string;
  comparisonId?: string;
  quote?: string;
  page?: number;
}

/** Argument taxonomy (Phase 5) — not every disagreement is a contradiction. */
export type ArgumentType =
  | "premise"
  | "conclusion"
  | "objection"
  | "rebuttal"
  | "qualification"
  | "analogy"
  | "definition"
  | "empirical"
  | "interpretive"
  | "theological"
  | "personal_judgment";

/** Reasoning defects the dialectic may name (Phase 5) — cautiously. */
export type FallacyType =
  | "invalid_inference"
  | "hidden_assumption"
  | "equivocation"
  | "circular_reasoning"
  | "unsupported_generalization";

/** A grounded dialectical assertion — MUST cite evidence. */
export interface DialecticPoint {
  statement: string;
  evidenceIds: string[];
  /** Optional argument-type tag. */
  argType?: ArgumentType;
}

export interface DialecticDefinition {
  term: string;
  definition: string;
}

export interface ReasoningIssue {
  kind: FallacyType;
  note: string;
  evidenceIds: string[];
}

/** Strict structured dialectic (Phase 4). Substantive assertions cite evidence. */
export interface DialecticResultData {
  question: string;
  definitions: DialecticDefinition[];
  assumptions: DialecticPoint[];
  affirmativeCase: DialecticPoint[];
  negativeCase: DialecticPoint[];
  supportingEvidence: PositionEvidence[];
  counterarguments: DialecticPoint[];
  rebuttals: DialecticPoint[];
  terminologyDisputes: TerminologyDifference[];
  distinctions: string[];
  unresolvedAmbiguities: string[];
  possibleSyntheses: DialecticPoint[];
  evidenceThatWouldChange: string[];
  questionsForHuman: string[];
  relationToBeliefs: DialecticPoint[];
  reasoningIssues: ReasoningIssue[];
  limitations: string[];
  coverageNote: string;
  /** Assertions dropped in verification for citing missing/invalid evidence. */
  flagged?: string[];
}

export type InquiryStatus = "open" | "provisional" | "unresolved" | "resolved";

/** One append-only prior state of an inquiry (never overwritten). */
export interface InquiryRevision {
  at: ISO;
  result: DialecticResultData;
  source: "ai" | "mock";
  /** Labels of materials newly added at this step. */
  addedInputs?: string[];
  note?: string;
}

/** A saved dialectical inquiry — a reasoning aid, never an automatic verdict. */
export interface Inquiry {
  id: string;
  question: string;
  inputs: InquiryInputRef[];
  sourceIds: string[];
  beliefIds: string[];
  comparisonIds: string[];
  evidence: EvidenceItem[];
  /** Latest structured dialectic. */
  result: DialecticResultData;
  /** Append-only history of prior results (older first). */
  history: InquiryRevision[];
  aiModel: string;
  source: "ai" | "mock";
  coverage: Coverage | null;
  partial: boolean;
  verified: boolean;
  status: InquiryStatus;
  /** The user's own provisional conclusion, if written. */
  provisionalConclusion?: string;
  /** Append-only human judgments on the insights. */
  judgments: ComparisonJudgment[];
  createdAt: ISO;
  updatedAt: ISO;
  /** Evidence fingerprint for freshness detection (LIFEOS-015). */
  fingerprint?: SavedFingerprint;
}

// ---------- Megathreads & longitudinal knowledge (LIFEOS-012) ----------

export type MegathreadStatus = "active" | "dormant" | "archived";

export type MegathreadSeedType =
  | "concept"
  | "belief"
  | "question"
  | "source"
  | "comparison"
  | "inquiry"
  | "manual";

export type ThreadMemberType =
  | "source"
  | "capture"
  | "belief"
  | "proposal"
  | "comparison"
  | "inquiry";

/** A member points to an existing record — no source text is duplicated. */
export interface ThreadMemberRef {
  type: ThreadMemberType;
  id: string;
  /** Whether the item was auto-suggested (deterministically) or user-added. */
  addedBy: "auto" | "user";
  /** Explainable reason it was associated (deterministic). */
  reason?: string;
  at?: ISO;
}

export type TimelineItemType =
  | "capture"
  | "source_added"
  | "quote"
  | "proposal"
  | "judgment"
  | "revision"
  | "comparison"
  | "inquiry"
  | "provisional_conclusion"
  | "belief_status";

/** A derived, read-only timeline event (built from existing records, never stored). */
export interface TimelineItem {
  id: string;
  type: TimelineItemType;
  at: ISO;
  title: string;
  detail?: string;
  origin?: "human" | "ai" | "mock";
  sourceId?: string;
  beliefId?: string;
  page?: number;
  href?: string;
  /** Relationship to the thread seed / why it belongs. */
  relation?: string;
}

/** Cautious thread synthesis (Phase 5). Substantive points cite evidence ids. */
export interface ThreadSynthesisData {
  currentUnderstanding: string;
  majorPositions: DialecticPoint[];
  agreements: ComparisonPoint[];
  disagreements: ComparisonPoint[];
  terminologyDifferences: TerminologyDifference[];
  beliefEvolution: string[];
  strongestSupport: PositionEvidence[];
  strongestChallenge: PositionEvidence[];
  unresolvedQuestions: string[];
  recentChanges: string[];
  limitations: string[];
  coverageNote: string;
  flagged?: string[];
}

export interface ThreadQuestion {
  text: string;
  resolved: boolean;
}

/** A living, provenance-grounded timeline of understanding (not a folder). */
export interface Megathread {
  id: string;
  title: string;
  description?: string;
  status: MegathreadStatus;
  seedType: MegathreadSeedType;
  seedId?: string;
  seedLabel?: string;
  /** Explicit member references (auto-suggested + user-added). */
  members: ThreadMemberRef[];
  /** Member ids featured/pinned (also drives featured order). */
  pinned: string[];
  /** Record ids the user explicitly excluded (never re-suggested). */
  excluded: string[];
  synthesis?: ThreadSynthesisData;
  synthesisSource?: "ai" | "mock" | "user";
  /** The evidence packet the current synthesis cites. */
  synthesisEvidence?: EvidenceItem[];
  unresolvedQuestions: ThreadQuestion[];
  notes?: string;
  /** Append-only human judgments on synthesis insights. */
  judgments: ComparisonJudgment[];
  /** Append-only change log (never rewritten). */
  revisions: { at: ISO; note: string }[];
  createdAt: ISO;
  updatedAt: ISO;
  /** Freshness fingerprint of the synthesis's evidence (LIFEOS-015). */
  fingerprint?: SavedFingerprint;
}

// ---------- Daily formation & review (LIFEOS-013) ----------

/** A later note on a reflection, stored SEPARATELY from the immutable original. */
export interface ReflectionAnnotation {
  text: string;
  at: ISO;
}

/** A written reflection. `response` is immutable; annotations are append-only. */
export interface Reflection {
  id: string;
  prompt: string;
  /** The user's original response — never edited in place. */
  response: string;
  createdAt: ISO;
  beliefIds?: string[];
  threadIds?: string[];
  sourceIds?: string[];
  /** Optional mood/context the user attached. */
  context?: string;
  /** Later notes/revisions kept separate from the original. */
  annotations: ReflectionAnnotation[];
}

export type PracticeStatus = "proposed" | "accepted" | "paused" | "completed" | "rejected";
/** A cadence SUGGESTION only — LifeOS never schedules or tracks streaks. */
export type PracticeCadence = "once" | "daily" | "weekly" | "occasional";

export interface PracticeHistoryEntry {
  at: ISO;
  status: PracticeStatus;
  note?: string;
}

/** Which records a practice was derived from (provenance is required). */
export interface PracticeDerivation {
  beliefIds?: string[];
  threadIds?: string[];
  inquiryIds?: string[];
}

/** A small, modest, reviewable practice proposed from a belief/thread. */
export interface PracticeCandidate {
  id: string;
  title: string;
  description: string;
  rationale: string;
  derivedFrom: PracticeDerivation;
  cadence?: PracticeCadence;
  status: PracticeStatus;
  /** The user's own wording once edited. */
  userWording?: string;
  source: "ai" | "mock" | "user";
  createdAt: ISO;
  updatedAt: ISO;
  /** Append-only status history. */
  history: PracticeHistoryEntry[];
}

export type ReviewType = "daily" | "weekly" | "monthly";

export type SurfacedItemKind =
  | "stale_belief"
  | "questioned_belief"
  | "unresolved_question"
  | "quote"
  | "capture"
  | "thread_change";

/** One deterministically-selected item surfaced in a review, with its reason. */
export interface ReviewSurfacedItem {
  id: string;
  kind: SurfacedItemKind;
  refId?: string;
  beliefId?: string;
  sourceId?: string;
  threadId?: string;
  title: string;
  /** Why this surfaced — always shown to the user. */
  reason: string;
  href?: string;
}

export type ReviewDecision =
  | "affirmed"
  | "revised"
  | "questioned"
  | "dismissed"
  | "postponed"
  | "reflected";

export interface ReviewJudgment {
  itemId: string;
  decision: ReviewDecision;
  at: ISO;
  note?: string;
}

/** A cited claim in a weekly synthesis / alignment reflection. */
export interface CitedClaim {
  statement: string;
  recordIds: string[];
}

export interface WeeklySynthesisData {
  narrative: string;
  highlights: CitedClaim[];
  recurringConcepts: string[];
  unresolvedTensions: string[];
  changesFromLastWeek: string[];
  limitations: string[];
  flagged?: string[];
}

export interface AlignmentData {
  observations: CitedClaim[];
  questions: string[];
  limitations: string[];
  flagged?: string[];
}

export interface ReviewSession {
  id: string;
  type: ReviewType;
  surfaced: ReviewSurfacedItem[];
  prompts?: string[];
  reflectionIds: string[];
  judgments: ReviewJudgment[];
  acceptedPracticeIds: string[];
  unresolvedQuestions: string[];
  /** Weekly narrative (weekly reviews only). */
  synthesis?: WeeklySynthesisData;
  synthesisSource?: "ai" | "mock";
  alignment?: AlignmentData;
  alignmentSource?: "ai" | "mock";
  startedAt: ISO;
  completedAt?: ISO;
  /** Freshness fingerprint of the weekly synthesis's evidence (LIFEOS-015). */
  fingerprint?: SavedFingerprint;
}

// ---------- Reasoning engine (LIFEOS-014) ----------

export type ReasoningMode =
  | "support_audit"
  | "contradiction_audit"
  | "influence_trace"
  | "assumption_audit"
  | "belief_impact"
  | "unresolved_synthesis"
  | "change_over_time"
  | "open_inquiry";

export type ReasoningScopeKind =
  | "all"
  | "sources"
  | "beliefs"
  | "threads"
  | "comparisons"
  | "inquiries";

export interface ReasoningScope {
  kind: ReasoningScopeKind;
  sourceIds?: string[];
  beliefIds?: string[];
  threadIds?: string[];
  comparisonIds?: string[];
  inquiryIds?: string[];
  /** For belief_impact: a proposed belief NOT yet in the Constitution. */
  proposedBelief?: string;
}

/** Internal reasoning-graph node (never rendered as a graph). */
export type ReasoningNodeType =
  | "source" | "chunk" | "quote" | "concept" | "capture" | "proposal"
  | "belief" | "revision" | "comparison" | "inquiry" | "megathread"
  | "reflection" | "practice" | "review";

export interface ReasoningNode {
  id: string;
  type: ReasoningNodeType;
  refId: string;
  label: string;
  at?: ISO;
}

export type ReasoningEdgeType =
  | "supports" | "challenges" | "derived_from" | "revised_from" | "references"
  | "belongs_to" | "influenced_by" | "questioned_by" | "compared_with" | "investigated_by";

export interface ReasoningEdge {
  from: string;
  to: string;
  type: ReasoningEdgeType;
}

/** A finding that MUST cite record/evidence ids. */
export interface ReasoningFinding {
  statement: string;
  evidenceIds: string[];
}

/** A cautiously-classified tension — never all flattened to "contradiction". */
export interface ReasoningTension extends ReasoningFinding {
  kind: ContradictionKind;
}

export interface InfluenceChain {
  /** Ordered labels, e.g. ["Source: X", "Quote", "Belief: Y"]. */
  chain: string[];
  evidenceIds: string[];
}

/** Deterministic support-audit counts for one belief (no truth score). */
export interface SupportAudit {
  beliefId: string;
  beliefText: string;
  supportingSources: number;
  challengingSources: number;
  supportingQuotes: number;
  revisions: number;
  unresolvedQuestions: number;
  evidenceDiversity: number;
  evidenceIds: string[];
}

export interface ReasoningResultData {
  question: string;
  mode: ReasoningMode;
  scopeSummary: string;
  keyFindings: ReasoningFinding[];
  supportingEvidence: PositionEvidence[];
  challengingEvidence: PositionEvidence[];
  candidateContradictions: ReasoningTension[];
  assumptions: ReasoningFinding[];
  influenceChains: InfluenceChain[];
  affectedBeliefs: ReasoningFinding[];
  supportAudits: SupportAudit[];
  unresolvedQuestions: string[];
  alternativeInterpretations: string[];
  limitations: string[];
  coverageNote: string;
  questionsForHuman: string[];
  flagged?: string[];
}

export type ReasoningStatus = "open" | "provisional" | "resolved";

export interface ReasoningRevision {
  at: ISO;
  result: ReasoningResultData;
  source: "ai" | "mock";
  note?: string;
  scopeChanged?: boolean;
}

export interface ReasoningQuery {
  id: string;
  question: string;
  mode: ReasoningMode;
  scope: ReasoningScope;
  evidence: EvidenceItem[];
  result: ReasoningResultData;
  /** Append-only prior results (older first). */
  history: ReasoningRevision[];
  aiModel: string;
  source: "ai" | "mock";
  coverage: Coverage | null;
  partial: boolean;
  verified: boolean;
  status: ReasoningStatus;
  provisionalConclusion?: string;
  judgments: ComparisonJudgment[];
  createdAt: ISO;
  updatedAt: ISO;
  /** Evidence fingerprint for freshness detection (LIFEOS-015). */
  fingerprint?: SavedFingerprint;
}

// ---------- Semantic retrieval & freshness (LIFEOS-015) ----------

/** Record kinds eligible for embedding (Phase 3). */
export type EmbeddableType =
  | "chunk"
  | "summary"
  | "quote"
  | "capture"
  | "belief"
  | "revision"
  | "comparison_finding"
  | "inquiry_finding"
  | "thread_synthesis"
  | "reflection";

/**
 * A stored embedding for one record. The vector powers durable/cross-device
 * semantic recall; the content hash makes indexing idempotent (skip unchanged).
 * Never holds keys, auth data, or duplicate full-source text.
 */
export interface EmbeddingRecord {
  /** Stable id of the underlying record (e.g. `belief:<id>`, `quote:<sid>:<i>`). */
  recordId: string;
  type: EmbeddableType;
  sourceId?: string;
  /** Hash of the exact embedded text — changes ⇒ re-embed. */
  contentHash: string;
  provider: string;
  model: string;
  dimensions: number;
  generatedAt: ISO;
  /** The vector itself (kept compact for the local lexical embedder). */
  vector: number[];
}

export type FreshnessStatus = "current" | "potentially_stale" | "stale" | "unknown";

/** One dependency of a saved result, captured for freshness diffing. */
export interface FingerprintDep {
  id: string;
  kind: string;
  hash: string;
}

/**
 * Deterministic fingerprint of the evidence a saved result was built from
 * (Phase 7). Recomputing and diffing detects when the underlying knowledge
 * changed. No AI, no embeddings required.
 */
export interface SavedFingerprint {
  pipelineVersion: number;
  /** Embedding model/version, only when the result used the semantic index. */
  embeddingModel?: string;
  deps: FingerprintDep[];
  at: ISO;
}

// ---------- Decision intelligence (LIFEOS-016) ----------

export type DecisionStatus = "exploring" | "narrowed" | "decided" | "deferred" | "abandoned";

export type OptionKind = "named" | "do_nothing" | "defer" | "hybrid";

export type Reversibility = "easily_reversible" | "costly_to_reverse" | "irreversible" | "unknown";

/** One option under consideration. AI may suggest options; the user approves. */
export interface DecisionOption {
  id: string;
  name: string;
  kind: OptionKind;
  description?: string;
  benefits: string[];
  costs: string[];
  risks: string[];
  reversibility: Reversibility;
  timeHorizon?: string;
  evidenceIds: string[];
  assumptions: string[];
  openQuestions: string[];
  /** True while an AI-suggested option awaits user approval. */
  aiSuggested?: boolean;
}

/** An editable decision criterion. Weights are optional and NOT precise math. */
export interface DecisionCriterion {
  id: string;
  name: string;
  /** Optional 1–5 importance. Weighted outputs are one perspective, never "the answer". */
  weight?: number;
  note?: string;
}

/** A grounded analysis finding — must cite evidence ids. */
export interface DecisionFinding {
  statement: string;
  evidenceIds: string[];
  /** Which option it concerns, when applicable. */
  option?: string;
}

export type AlignmentVerdict = "supports" | "conflicts" | "mixed" | "unclear";

/** Where an option supports/conflicts with a stated belief. Cites the belief. */
export interface ValuesAlignment {
  option: string;
  verdict: AlignmentVerdict;
  statement: string;
  evidenceIds: string[];
}

export interface OptionScenarios {
  option: string;
  best: string;
  expected: string;
  worst: string;
  wildcard: string;
}

export interface PreMortemEntry {
  option: string;
  plausibleCauses: string[];
  preventableCauses: string[];
  earlyWarningSigns: string[];
}

export interface RegretAnalysis {
  regretDoing: string[];
  regretNotDoing: string[];
  recoverableRegrets: string[];
}

export interface OptionCase {
  option: string;
  statement: string;
  evidenceIds: string[];
}

/** Strict structured decision analysis (Phase 7). */
export interface DecisionAnalysisResult {
  question: string;
  options: string[];
  criteria: string[];
  tradeoffs: DecisionFinding[];
  valuesAlignment: ValuesAlignment[];
  assumptions: DecisionFinding[];
  missingEvidence: string[];
  risks: DecisionFinding[];
  reversibilityNotes: { option: string; assessment: Reversibility; note: string }[];
  regret: RegretAnalysis;
  preMortem: PreMortemEntry[];
  scenarios: OptionScenarios[];
  strongestFor: OptionCase[];
  strongestAgainst: OptionCase[];
  hybridSuggestion?: string;
  keyUncertainties: string[];
  whatWouldChange: string[];
  questionsForHuman: string[];
  limitations: string[];
  coverageNote: string;
  flagged?: string[];
}

/** A later, reflective look at how a decided option played out. Not a score. */
export interface OutcomeReview {
  at: ISO;
  whatHappened: string;
  expected?: string;
  surprises?: string;
  wrongAssumptions?: string;
  evidenceThatMattered?: string;
  doDifferently?: string;
  stillSound?: "yes" | "partly" | "no";
  /** Lessons the user may send to the Belief Inbox — never auto-added. */
  lessons: string[];
}

export type UserConfidence = "low" | "medium" | "high";

/** A structured decision — LifeOS clarifies tradeoffs; the USER chooses. */
export interface Decision {
  id: string;
  title: string;
  question: string;
  status: DecisionStatus;
  options: DecisionOption[];
  criteria: DecisionCriterion[];
  /** User ratings: optionId → criterionId → −2..+2 (unset = unrated). */
  ratings: Record<string, Record<string, number>>;
  constraints: string[];
  assumptions: string[];
  /** Record ids force-included in the evidence packet (entry-point seeds). */
  seedRefs: string[];
  evidence: EvidenceItem[];
  analysis?: DecisionAnalysisResult;
  analysisSource?: "ai" | "mock";
  /** Append-only prior analyses from reruns. */
  history: { at: ISO; analysis: DecisionAnalysisResult; source: "ai" | "mock"; note?: string }[];
  provisionalChoice?: string;
  finalChoice?: string;
  rationale?: string;
  /** Confidence STATED BY THE USER — never computed. */
  userConfidence?: UserConfidence;
  judgments: ComparisonJudgment[];
  /** Append-only change log. */
  revisions: { at: ISO; note: string }[];
  /** Append-only reflective outcome reviews. */
  outcomeReviews: OutcomeReview[];
  fingerprint?: SavedFingerprint;
  /** Sensitive-topic caution (medical/legal/financial/self-harm), if detected. */
  sensitive?: string;
  aiModel: string;
  source: "ai" | "mock";
  coverage: Coverage | null;
  partial: boolean;
  verified: boolean;
  createdAt: ISO;
  updatedAt: ISO;
}

// ---------- Reflective practice & daily formation (LIFEOS-017) ----------

/**
 * The kind of reflection. Built-in types shape the generated prompts and
 * evidence; `custom` lets the user name their own (stored in `customType`).
 */
export type FormationSessionType =
  | "morning"
  | "evening"
  | "decision_review"
  | "book_integration"
  | "conversation_review"
  | "failure_analysis"
  | "success_analysis"
  | "conflict_reflection"
  | "practice_reflection"
  | "open"
  | "custom";

export type FormationSessionStatus = "draft" | "reflecting" | "synthesized" | "closed";

/** A grounded synthesis finding — MUST cite record ids (evidence packet). */
export interface FormationFinding {
  statement: string;
  evidenceIds: string[];
}

/**
 * Structured synthesis of ONE reflection (Phase 5). Deterministic extraction
 * first, then a single AI pass. Grounded findings cite real record ids;
 * uncited ones are dropped. Every list is a SUGGESTION — nothing changes the
 * user's Constitution, decisions, or threads automatically.
 */
export interface FormationSynthesisData {
  themes: string[];
  recurringTensions: string[];
  /** Beliefs the reflection may bear on — cite the belief record. */
  possibleBeliefRevisions: FormationFinding[];
  possibleDecisionFollowups: string[];
  possibleInquiryFollowups: string[];
  possibleThreadAdditions: string[];
  possiblePractices: string[];
  questionsWorthRevisiting: string[];
  itemsNeedingEvidence: string[];
  limitations: string[];
  coverageNote: string;
  /** Findings dropped/softened in validation (uncited or over-reaching). */
  flagged?: string[];
}

/**
 * One reflection session — the bridge between experience and understanding.
 * The `reflection` is immutable once written; structured fields and links are
 * the user's; the synthesis is a derived, cited SUGGESTION with append-only
 * history. LifeOS asks and clarifies — it never concludes for the user.
 */
export interface FormationSession {
  id: string;
  createdAt: ISO;
  updatedAt: ISO;
  title: string;
  type: FormationSessionType;
  /** Present only when `type === "custom"`. */
  customType?: string;
  /** The primary reflection prompt the session opened with. */
  prompt: string;
  /** Deterministically generated prompt set (Phase 4) — inspiration, not tasks. */
  suggestedPrompts: string[];
  /** The user's written reflection — never edited in place once set. */
  reflection: string;
  // ---- explicit links to the rest of the system ----
  linkedDecisions: string[];
  linkedBeliefs: string[];
  linkedPractices: string[];
  linkedThreads: string[];
  linkedInquiries: string[];
  linkedSources: string[];
  linkedReflections: string[];
  /** Record ids force-included in the evidence packet (entry-point seeds). */
  seedRefs: string[];
  // ---- user-authored structured capture ----
  lessons: string[];
  unresolvedQuestions: string[];
  emotionalObservations: string[];
  revisedAssumptions: string[];
  /** First-person belief candidates the user may send to the Inbox — never auto. */
  beliefCandidates: string[];
  /** Prompts the user wants future-them to revisit. */
  followUpReflections: string[];
  // ---- derived synthesis (Phase 5) ----
  evidence: EvidenceItem[];
  synthesis?: FormationSynthesisData;
  synthesisSource?: "ai" | "mock";
  /** Append-only prior syntheses from reruns. */
  history: { at: ISO; synthesis: FormationSynthesisData; source: "ai" | "mock"; note?: string }[];
  fingerprint?: SavedFingerprint;
  /** Append-only human verdicts on synthesis insights. */
  judgments: ComparisonJudgment[];
  status: FormationSessionStatus;
  /** Sensitive-topic caution (medical/legal/financial/self-harm), if detected. */
  sensitive?: string;
  aiModel: string;
  source: "ai" | "mock";
  coverage: Coverage | null;
  partial: boolean;
  verified: boolean;
}

/** A derived, read-only formation-timeline event (built from records, never stored). */
export type FormationTimelineKind =
  | "reflection"
  | "belief_revision"
  | "decision"
  | "outcome_review"
  | "inquiry"
  | "practice_change"
  | "thread_created";

export interface FormationTimelineItem {
  id: string;
  kind: FormationTimelineKind;
  at: ISO;
  title: string;
  detail?: string;
  href?: string;
}

// ---------- Worldview & concept graph (LIFEOS-018) ----------

export type ConceptStatus = "proposed" | "active" | "archived" | "merged";

/** One append-only change to a concept — how understanding evolves (Phase 8). */
export interface ConceptHistoryEntry {
  at: ISO;
  kind: "created" | "definition" | "relationship" | "principle" | "framework" | "link" | "status" | "note";
  note: string;
}

/**
 * A concept the user is modeling — a node in their evolving understanding of
 * reality. Concept↔concept structure (parent/child/related/opposing) is
 * denormalized here but maintained ONLY through APPROVED `ConceptRelationship`s,
 * so nothing is inferred silently. Cross-type links (beliefs/threads/sources/
 * practices) are direct human-added references. Not a visualization; not an
 * embedding.
 */
export interface Concept {
  id: string;
  name: string;
  aliases: string[];
  definition: string;
  description: string;
  // ---- cross-type links (human-added references) ----
  relatedBeliefs: string[];
  relatedThreads: string[];
  relatedSources: string[];
  relatedPractices: string[];
  // ---- concept graph (derived from approved relationships) ----
  parentConcepts: string[];
  childConcepts: string[];
  relatedConcepts: string[];
  opposingConcepts: string[];
  // ---- principles + open questions ----
  principleIds: string[];
  questions: string[];
  history: ConceptHistoryEntry[];
  status: ConceptStatus;
  fingerprint?: SavedFingerprint;
  /** Provenance of the concept's creation. */
  source: "user" | "ai" | "mock" | "deterministic";
  createdAt: ISO;
  updatedAt: ISO;
}

/** The 12 supported relationship types (Phase 3). */
export type ConceptRelationshipType =
  | "supports"
  | "depends_on"
  | "contradicts"
  | "extends"
  | "refines"
  | "contains"
  | "requires"
  | "explains"
  | "analogous_to"
  | "historically_related"
  | "terminologically_related"
  | "part_of";

export type RelationshipConfidence = "low" | "medium" | "high";

/**
 * A first-class, richly-annotated edge between two concepts. Proposed edges
 * stay `approved: false` and never touch the concepts' structural arrays until
 * a human approves — nothing is inferred silently (Phase 3).
 */
export interface ConceptRelationship {
  id: string;
  fromConceptId: string;
  toConceptId: string;
  type: ConceptRelationshipType;
  /** Why this relationship holds — always required. */
  reason: string;
  /** Evidence/record ids grounding it. */
  citations: string[];
  confidence: RelationshipConfidence;
  /** Where the proposal came from. */
  source: "user" | "ai" | "mock" | "deterministic";
  /** False until a human approves; only approved edges shape the graph. */
  approved: boolean;
  createdAt: ISO;
  updatedAt: ISO;
  /** Append-only change log. */
  history: { at: ISO; note: string }[];
}

/**
 * A reusable principle (Phase 6). Many-to-many with beliefs and concepts:
 * principles support many beliefs; beliefs derive from many principles.
 */
export interface Principle {
  id: string;
  statement: string;
  description?: string;
  conceptIds: string[];
  /** Beliefs the user says derive from this principle (references, not owned). */
  beliefIds: string[];
  citations: string[];
  status: "proposed" | "active" | "archived";
  history: { at: ISO; note: string }[];
  source: "user" | "ai" | "mock" | "deterministic";
  fingerprint?: SavedFingerprint;
  createdAt: ISO;
  updatedAt: ISO;
}

export type FrameworkKind = "framework" | "tradition" | "school" | "paradigm" | "map";

/**
 * A worldview layer (Phase 5) — a framework/tradition/school/paradigm/map that
 * ORGANIZES concepts and principles. Frameworks never OWN beliefs; they only
 * organize them (a framework references concepts, which connect to beliefs).
 */
export interface Framework {
  id: string;
  name: string;
  kind: FrameworkKind;
  description: string;
  conceptIds: string[];
  principleIds: string[];
  status: "active" | "archived";
  /** Append-only membership history (Phase 8). */
  history: { at: ISO; note: string }[];
  source: "user" | "ai" | "mock" | "deterministic";
  createdAt: ISO;
  updatedAt: ISO;
}

/** One AI/deterministic proposal awaiting human review (Phase 4). */
export type WorldProposalKind =
  | "new_concept"
  | "missing_link"
  | "duplicate_concept"
  | "missing_definition"
  | "possible_principle"
  | "worldview_cluster";

export interface WorldProposal {
  kind: WorldProposalKind;
  /** Human-readable summary of the proposal. */
  statement: string;
  /** Concept names / ids involved (as applicable). */
  concepts: string[];
  /** For missing_link: the suggested relationship type. */
  relationshipType?: ConceptRelationshipType;
  /** Suggested definition (missing_definition) or principle text. */
  suggestion?: string;
  citations: string[];
}

/** A detected tension — surfaced deterministically, never auto-resolved (Phase 7). */
export type TensionKind =
  | "isolated_concept"
  | "unsupported_concept"
  | "duplicate_concept"
  | "circular_definition"
  | "contradictory_principle"
  | "framework_overlap";

export interface WorldTension {
  id: string;
  kind: TensionKind;
  title: string;
  /** Why this surfaced — always shown. */
  detail: string;
  conceptIds: string[];
  href?: string;
}

/** A derived, read-only concept-evolution timeline event (Phase 8). */
export interface WorldTimelineItem {
  id: string;
  at: ISO;
  kind: ConceptHistoryEntry["kind"] | "relationship_approved" | "framework" | "principle";
  title: string;
  detail?: string;
  href?: string;
}

// ---------- Knowledge synthesis & authoring (LIFEOS-019) ----------

/** The form of work being authored. Shapes outline templates and tone defaults. */
export type ProjectKind =
  | "book"
  | "essay"
  | "lecture"
  | "course"
  | "research_paper"
  | "blog_series"
  | "guide"
  | "philosophy";

export type ProjectStatus = "planning" | "outlining" | "drafting" | "revising" | "complete" | "archived";

/** Which record kinds a citation can point at (evidence ids ARE real record ids). */
export type CitationKind =
  | "source"
  | "belief"
  | "concept"
  | "thread"
  | "reasoning"
  | "decision"
  | "formation"
  | "principle"
  | "framework";

/** The user's chosen evidence for a project — everything keeps provenance (Phase 3). */
export interface ProjectAssembly {
  sourceIds: string[];
  beliefIds: string[];
  conceptIds: string[];
  threadIds: string[];
  reasoningIds: string[];
  frameworkIds: string[];
  principleIds: string[];
  formationIds: string[];
  decisionIds: string[];
}

/** One resolved evidence item in the assembled packet (id = real record id). */
export interface ProjectEvidence {
  id: string;
  kind: CitationKind;
  label: string;
  text: string;
}

/** Tone/length transforms a section draft supports (Phase 5). */
export type DraftTransform =
  | "rewrite"
  | "expand"
  | "compress"
  | "clarify"
  | "academic"
  | "popular"
  | "technical"
  | "conversational";

/** One paragraph. Every factual paragraph must cite evidence ids (Phase 6). */
export interface DraftParagraph {
  id: string;
  text: string;
  /** Evidence record ids grounding this paragraph. Empty ⇒ unsupported. */
  citations: string[];
}

/** One append-only prior state of a section (Phase 8). Never overwritten. */
export interface SectionVersion {
  at: ISO;
  paragraphs: DraftParagraph[];
  /** Who produced this version. */
  source: "human" | "ai" | "mock";
  note?: string;
}

/** A drafted section of the work. */
export interface DraftSection {
  id: string;
  heading: string;
  /** What this section is meant to do (from the outline). */
  purpose?: string;
  order: number;
  paragraphs: DraftParagraph[];
  /** Append-only version history. */
  versions: SectionVersion[];
  source: "human" | "ai" | "mock" | "empty";
  updatedAt: ISO;
  fingerprint?: SavedFingerprint;
}

/** One candidate outline (Phase 4). Several are generated; the human chooses one. */
export interface OutlineOption {
  id: string;
  kind: ProjectKind;
  title: string;
  rationale: string;
  sections: { heading: string; purpose: string }[];
  source: "deterministic" | "ai" | "mock";
}

/** A deterministic cross-reference suggestion while writing (Phase 7). Never auto-inserted. */
export type CrossRefKind =
  | "related_concept"
  | "missing_evidence"
  | "contradiction"
  | "older_draft"
  | "relevant_decision"
  | "formation_insight"
  | "duplicate_paragraph";

export interface CrossRef {
  id: string;
  kind: CrossRefKind;
  title: string;
  detail: string;
  /** Records/sections involved. */
  refs: string[];
  href?: string;
}

/**
 * A synthesis/authoring project — the user creates a book/essay/lecture/etc.
 * from everything they have learned. Evidence-first and human-directed: the
 * system assembles evidence, proposes outlines, and drafts one section at a
 * time on request; it never writes autonomously and never invents citations.
 */
export interface KnowledgeProject {
  id: string;
  title: string;
  description: string;
  purpose: string;
  audience: string;
  kind: ProjectKind;
  status: ProjectStatus;
  assembly: ProjectAssembly;
  /** Generated candidates (Phase 4). */
  outlineOptions: OutlineOption[];
  /** The chosen outline id, if one was selected. */
  chosenOutlineId?: string;
  sections: DraftSection[];
  /** Append-only project-level change log. */
  history: { at: ISO; note: string; source: "human" | "ai" | "mock" }[];
  fingerprint?: SavedFingerprint;
  aiModel: string;
  source: "ai" | "mock";
  createdAt: ISO;
  updatedAt: ISO;
}

// ---------- Research workspace (LIFEOS-020) ----------

export type ResearchStatus = "open" | "investigating" | "synthesizing" | "concluded" | "archived" | "abandoned";

/** A common append-only history entry (one dated note). */
export interface ResearchHistoryEntry {
  at: ISO;
  note: string;
}

/**
 * One tracked question-artifact (subquestion / unknown / assumption / success
 * criterion / open problem). Every one maintains its own history (Phase 3).
 */
export interface ResearchItem {
  id: string;
  text: string;
  resolved: boolean;
  history: ResearchHistoryEntry[];
  createdAt: ISO;
}

export interface ResearchDefinition {
  id: string;
  term: string;
  definition: string;
  history: ResearchHistoryEntry[];
  createdAt: ISO;
}

/** The structured question layer (Phase 3). The primary question lives on the project. */
export interface ResearchQuestionSet {
  subquestions: ResearchItem[];
  unknowns: ResearchItem[];
  assumptions: ResearchItem[];
  definitions: ResearchDefinition[];
  successCriteria: ResearchItem[];
  openProblems: ResearchItem[];
}

/** A project-local research note (Phase 4). Not a global record — never duplicated elsewhere. */
export interface ResearchNote {
  id: string;
  text: string;
  createdAt: ISO;
}

export type HypothesisStatus = "proposed" | "active" | "supported" | "weakened" | "refuted" | "abandoned";

/**
 * A competing explanation (Phase 5). Confidence is STATED BY THE USER, never
 * computed. Users may hold multiple competing hypotheses; LifeOS never selects
 * a winner automatically.
 */
export interface Hypothesis {
  id: string;
  statement: string;
  confidence: UserConfidence;
  /** Evidence record ids that support / contradict it (real records, not copies). */
  supportingEvidence: string[];
  contradictingEvidence: string[];
  openQuestions: string[];
  status: HypothesisStatus;
  history: ResearchHistoryEntry[];
  createdAt: ISO;
  updatedAt: ISO;
}

/** Argument-map node kinds (Phase 6). */
export type ArgumentNodeKind =
  | "claim"
  | "evidence"
  | "counterargument"
  | "objection"
  | "rebuttal"
  | "open_question"
  | "unknown";

export interface ArgumentNode {
  id: string;
  kind: ArgumentNodeKind;
  text: string;
  /** For evidence nodes: link to a real record id (provenance). */
  recordId?: string;
  history: ResearchHistoryEntry[];
  createdAt: ISO;
}

/** Argument-map edge kinds (Phase 6). Every edge is user-authored — nothing inferred. */
export type ArgumentEdgeKind =
  | "supports"
  | "contradicts"
  | "objects_to"
  | "rebuts"
  | "answers"
  | "raises"
  | "depends_on";

export interface ArgumentEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: ArgumentEdgeKind;
  reason?: string;
  createdAt: ISO;
}

/** A detected research gap — surfaced deterministically, never resolved (Phase 8). */
export type ResearchGapKind =
  | "unsupported_claim"
  | "missing_evidence"
  | "contradictory_evidence"
  | "duplicate_evidence"
  | "orphan_question"
  | "unresolved_hypothesis";

export interface ResearchGap {
  id: string;
  kind: ResearchGapKind;
  title: string;
  detail: string;
  refs: string[];
}

/** A derived, read-only research-timeline event (Phase 7). */
export interface ResearchTimelineItem {
  id: string;
  at: ISO;
  kind: "project" | "question" | "hypothesis" | "argument" | "evidence" | "discovery" | "decision";
  title: string;
  detail?: string;
}

/**
 * A structured investigation — the user researches a question BEFORE writing
 * conclusions. Not autonomous, not web-browsing, not an agent: evidence-first,
 * deterministic-first, human-directed. Reuses the authoring `assembly` shape
 * for its evidence workspace (references, never copies), and can seed the
 * Authoring Engine when complete.
 */
export interface ResearchProject {
  id: string;
  title: string;
  question: string;
  description: string;
  purpose: string;
  scope: string;
  status: ResearchStatus;
  questions: ResearchQuestionSet;
  /** Evidence workspace (Phase 4) — reuses ProjectAssembly across all record types. */
  assembly: ProjectAssembly;
  notes: ResearchNote[];
  hypotheses: Hypothesis[];
  argumentNodes: ArgumentNode[];
  argumentEdges: ArgumentEdge[];
  /** Append-only project change log. */
  history: ResearchHistoryEntry[];
  fingerprint?: SavedFingerprint;
  /** The KnowledgeProject id this research seeded, if any (Phase 10). */
  seededProjectId?: string;
  createdAt: ISO;
  updatedAt: ISO;
}

// ---------- Socratic dialogue & dialectical engine (LIFEOS-022) ----------

export type DialogueStatus = "open" | "active" | "paused" | "concluded" | "archived";

/** The kinds of turn in a structured dialogue (Phase 3). */
export type DialogueTurnKind =
  | "question"
  | "response"
  | "challenge"
  | "clarification"
  | "counterargument"
  | "evidence"
  | "reflection"
  | "summary";

/** Who authored a turn: the user, the deterministic Socratic engine, or a perspective. */
export type DialogueTurnAuthor = "you" | "socratic" | "perspective";

/** Timeline flags a turn may carry (Phase 8). */
export type DialogueTurnFlag = "insight" | "new_question" | "dead_end";

/** One dialogue turn. Every turn stores provenance (cited record ids). */
export interface DialogueTurn {
  id: string;
  kind: DialogueTurnKind;
  text: string;
  author: DialogueTurnAuthor;
  /** When author is "perspective": which participant spoke. */
  perspectiveId?: string;
  /** Evidence record ids grounding this turn (provenance). */
  citations: string[];
  flags: DialogueTurnFlag[];
  createdAt: ISO;
}

/** A viewpoint drawn from the user's own knowledge (Phase 5). Cites its evidence. */
export type PerspectiveKind =
  | "constitution"
  | "past_constitution"
  | "framework"
  | "principle"
  | "belief"
  | "research"
  | "author";

export interface Perspective {
  id: string;
  kind: PerspectiveKind;
  label: string;
  /** The record this perspective is sourced from (a framework/principle/belief/…). */
  refId?: string;
  createdAt: ISO;
}

/** A deterministic Socratic line of inquiry (Phase 4). A prompt, never an answer. */
export interface DialogueInquiry {
  id: string;
  prompt: string;
  rationale: string;
  /** Records this line of inquiry draws on (for grounding). */
  relatedIds: string[];
}

/** A derived, read-only dialogue-timeline event (Phase 8). */
export interface DialogueTimelineItem {
  id: string;
  at: ISO;
  kind: "turn" | "insight" | "new_question" | "dead_end" | "session";
  title: string;
  detail?: string;
}

/**
 * A structured Socratic dialogue — the user investigates an idea through
 * turn-based inquiry grounded in their own knowledge. NOT a chatbot, NOT
 * roleplay, NOT autonomous reasoning: the Socratic engine proposes deterministic
 * PROMPTS, perspectives cite the user's own records, and the graph surfaces
 * related evidence. Nothing changes automatically.
 */
export interface DialogueSession {
  id: string;
  title: string;
  topic: string;
  purpose: string;
  status: DialogueStatus;
  participants: Perspective[];
  /** Records the dialogue is "about" — force-included in graph context + freshness. */
  seedRefs: string[];
  turns: DialogueTurn[];
  /** Records this dialogue spawned (Phase 7), for provenance. */
  outcomes: { at: ISO; kind: string; recordId: string; label: string }[];
  /** Append-only project change log. */
  history: { at: ISO; note: string }[];
  fingerprint?: SavedFingerprint;
  createdAt: ISO;
  updatedAt: ISO;
}

// ---------- Dialectical synthesis & tension resolution (LIFEOS-023) ----------

/**
 * Confidence is tracked along FOUR independent axes and never collapsed into a
 * single score — false certainty most often comes from averaging away a weak
 * dimension. `unknown` is a first-class value: it is honest to say we don't know.
 */
export type ConfidenceLevel = "unknown" | "low" | "moderate" | "high";

export interface DialecticConfidence {
  /** How well-established the underlying facts are. */
  factual: ConfidenceLevel;
  /** Soundness / validity of the reasoning connecting the claims. */
  logical: ConfidenceLevel;
  /** Strength and independence of the cited evidence. */
  evidential: ConfidenceLevel;
  /** Support from the user's own lived / first-person experience. */
  experiential: ConfidenceLevel;
}

/** The kinds of tension the dialectical engine can represent (detected or user-authored). */
export type DialecticTensionKind =
  | "conflicting_beliefs"
  | "incompatible_assumptions"
  | "unresolved_paradox"
  | "competing_values"
  | "empirical_disagreement"
  | "logical_inconsistency"
  | "definition_mismatch";

/** How a tension or synthesis came to exist. */
export type DialecticOrigin = "detected" | "user";

/** A record cited in a tension or synthesis, with the role it plays. Never a copy. */
export interface DialecticEvidenceLink {
  id: string;
  /** The record id (belief / source / concept / reasoning / …). */
  refId: string;
  label: string;
  stance: "supports_thesis" | "supports_antithesis" | "qualifies" | "context";
  note?: string;
}

export type TensionStatus =
  | "open"
  | "under_synthesis"
  | "resolved"
  | "dissolved"
  | "accepted_as_paradox";

/**
 * An explicitly represented tension between two positions grounded in the user's
 * own records. A tension is never "won" — it is understood, and possibly
 * integrated. Detection is deterministic (explicit graph/record signals only);
 * nothing is inferred silently and nothing is auto-resolved.
 */
export interface Tension {
  id: string;
  dialogueId: string;
  kind: DialecticTensionKind;
  title: string;
  thesis: string;
  antithesis: string;
  /** Records the thesis rests on (beliefs / perspectives / turns / sources). */
  thesisRefs: string[];
  /** Records the antithesis rests on. */
  antithesisRefs: string[];
  evidence: DialecticEvidenceLink[];
  confidence: DialecticConfidence;
  unresolvedQuestions: string[];
  status: TensionStatus;
  origin: DialecticOrigin;
  /** Deterministic rationale for why the engine flagged this (inspectable). */
  detail?: string;
  /** Stable signature (kind + sorted member ids) — used to dedupe re-detection. */
  signature: string;
  history: { at: ISO; note: string }[];
  createdAt: ISO;
  updatedAt: ISO;
}

/** One point in a synthesis's wording/confidence history (append-only). */
export interface SynthesisRevision {
  at: ISO;
  statement: string;
  note?: string;
  confidence: DialecticConfidence;
}

export type SynthesisStatus = "candidate" | "accepted" | "rejected" | "superseded";

/**
 * A synthesis is a higher-order integration of a tension (or several) — NOT a
 * compromise and NOT a winner. It preserves the strongest insight from each
 * side, names the assumptions it discards, exposes hidden common ground, and
 * states what remains uncertain. Candidates are generated deterministically as
 * scaffolds; the user authors, edits, accepts, or rejects. Integrating a
 * synthesis into beliefs / world model / research is always an explicit action.
 */
export interface Synthesis {
  id: string;
  dialogueId: string;
  /** One or more tensions this integrates (higher-order syntheses span several). */
  tensionIds: string[];
  statement: string;
  preservedInsights: string[];
  discardedAssumptions: string[];
  commonGround: string[];
  remainingUncertainty: string[];
  confidence: DialecticConfidence;
  evidenceLinks: DialecticEvidenceLink[];
  status: SynthesisStatus;
  origin: "generated" | "user";
  /** The synthesis this one supersedes (revision lineage across syntheses). */
  supersedesId?: string;
  revisions: SynthesisRevision[];
  /** Records this synthesis was integrated into (provenance) — never auto-mutated. */
  outcomes: { at: ISO; kind: string; recordId: string; label: string }[];
  createdAt: ISO;
  updatedAt: ISO;
}

// ---------- Cognitive orchestration & active intelligence (LIFEOS-024) ----------

/**
 * The subsystems the orchestrator coordinates. A recommendation names the
 * subsystem that ORIGINATED it (the scanner that produced it). Scanners never
 * depend on one another — they read the store and emit proposals; the
 * orchestrator merges them.
 */
export type OrchestratorSubsystem =
  | "belief"
  | "research"
  | "graph"
  | "dialogue"
  | "review"
  | "formation"
  | "decision"
  | "world";

/**
 * What a recommendation proposes. The orchestrator generates OPPORTUNITIES, not
 * content — every type maps to a subsystem the user may choose to engage.
 */
export type RecommendationType =
  | "open_dialogue"            // a belief contradicts another → investigate in dialogue
  | "create_synthesis"        // research evidence conflicts with an accepted belief → synthesise
  | "create_research_question"// a synthesis keeps failing → open a research question
  | "elevate_concept"         // a concept appears in many places → strengthen it in the world model
  | "merge_duplicate_concepts"// two concepts look like duplicates → merge
  | "new_principle"           // a concept underpins many beliefs → consider a principle
  | "formation_exercise"      // a conflict recurs across dialogues → a formation reflection
  | "review_belief"           // a belief has not been reviewed for months → review
  | "import_source"           // a dialogue references a missing record → import a source
  | "unresolved_tension"      // a tension has stayed open → return to it
  | "confidence_decline"      // confidence keeps decreasing → surface it
  | "repeat_reflection"       // a daily practice suggests repeating today's reflection
  | "revisit_decision";       // a decided decision is due for an outcome review

export type RecommendationPriority = "low" | "medium" | "high";

/** An object a recommendation concerns — a reference, never a copy. */
export interface RecommendationTarget {
  kind: string;
  id: string;
  label: string;
}

/**
 * A single deterministic recommendation produced by a scanner and surfaced in
 * the LifeOS Inbox. LifeOS never acts on a recommendation automatically — the
 * user accepts, dismisses, snoozes, or completes it. Nothing here modifies
 * knowledge.
 */
export interface Recommendation {
  id: string;
  type: RecommendationType;
  priority: RecommendationPriority;
  /** How strongly the deterministic signal fired (qualitative, never a fake score). */
  confidence: ConfidenceLevel;
  rationale: string;
  /** The subsystem whose scanner produced this. */
  subsystem: OrchestratorSubsystem;
  suggestedAction: string;
  /** Where "act on this" / "jump to" navigates (an existing route). */
  actionHref?: string;
  affected: RecommendationTarget[];
  /** Stable dedupe key (type + sorted affected ids) — re-scanning never duplicates. */
  signature: string;
  createdAt: ISO;
  dismissed: boolean;
  accepted: boolean;
  completed: boolean;
  /** ISO date until which the recommendation is hidden (snoozed). */
  snoozedUntil?: ISO;
}

// ---------- Workspaces, sessions & thinking modes (LIFEOS-030) ----------

/**
 * A first-class Workspace: a durable, user-owned grouping of EXISTING entities
 * (beliefs, documents, decisions, dialogues, …) around a project or life area —
 * "Philosophy Thesis", "Pool Business", "Peace Corps". A workspace never copies
 * or duplicates the entities it groups; `members` and `pinned` hold typed
 * references only. Deterministic and offline: no AI, no recommendations, no
 * background work — a workspace is exactly what the user put in it plus views
 * derived from it. `resume` is per-workspace navigation memory so the user can
 * pick up exactly where they left off (Feature 6).
 */
export interface Workspace {
  id: string;
  name: string;
  description: string;
  /** A subtle accent color key for the dashboard/banner (optional, cosmetic). */
  color?: string;
  goals: WorkspaceGoal[];
  /** Entities explicitly grouped into this workspace (references, never copies). */
  members: RecordRefLite[];
  /** Entities the user pinned to the top of this workspace (references). */
  pinned: RecordRefLite[];
  /** Per-workspace "resume where I left off" navigation memory (Feature 6). */
  resume: WorkspaceResume;
  archived: boolean;
  createdAt: ISO;
  updatedAt: ISO;
}

/** A simple, checkable workspace goal (deterministic; no scoring, no AI). */
export interface WorkspaceGoal {
  id: string;
  text: string;
  done: boolean;
  createdAt: ISO;
}

/**
 * The last place the user was in a workspace, so "Resume" returns them exactly
 * there: the last entity inspected, last document read, last inspector target,
 * last command search, last scroll, and last graph focus. Pure UI memory — all
 * fields are references or scalars, never copies of records.
 */
export interface WorkspaceResume {
  lastEntity?: RecordRefLite;
  lastDocumentId?: string;
  lastInspector?: RecordRefLite;
  lastSearch?: string;
  lastScroll?: number;
  lastGraphFocus?: RecordRefLite;
  at?: ISO;
}

/** The kind of active thinking session the user has begun (Feature 2). */
export type SessionType =
  | "thinking" | "reading" | "research" | "writing"
  | "planning" | "decision" | "review" | "reflection";

/**
 * An active (or completed) thinking session inside a workspace. Only ONE session
 * is active at a time (endedAt === undefined). A session records its goal, a rich
 * markdown scratchpad (independent of captures), and a deterministic activity
 * timeline of what the user opened, searched, captured, read, and edited while it
 * was open (Feature 5). Outputs (entities opened, documents read, captures
 * created, decisions made) are DERIVED from `activity` — never a second source of
 * truth. No analytics, no scoring.
 */
export interface WorkspaceSession {
  id: string;
  workspaceId: string;
  type: SessionType;
  goal: string;
  /** Rich markdown scratchpad; timestamp-insertable; independent from captures. */
  notes: string;
  startedAt: ISO;
  /** Undefined while the session is active; set once when ended. */
  endedAt?: ISO;
  activity: SessionActivityEvent[];
}

/** What kind of thing happened during a session (timeline only, no analytics). */
export type SessionActivityKind =
  | "opened_entity" | "opened_document" | "search" | "capture_created"
  | "belief_edited" | "reading" | "inspector" | "command"
  | "decision_edited" | "note";

/** A single deterministic activity event inside a session's timeline. */
export interface SessionActivityEvent {
  id: string;
  at: ISO;
  type: SessionActivityKind;
  /** The entity this event concerns, when applicable (a reference, never a copy). */
  entityKind?: string;
  entityId?: string;
  label: string;
  detail?: string;
}

export interface StoreState {
  captures: Capture[];
  proposals: Proposal[];
  beliefs: Belief[];
  sources: KnowledgeSource[];
  feedback: FeedbackEntry[];
  comparisons: Comparison[];
  inquiries: Inquiry[];
  megathreads: Megathread[];
  reflections: Reflection[];
  practices: PracticeCandidate[];
  reviews: ReviewSession[];
  reasonings: ReasoningQuery[];
  embeddings: EmbeddingRecord[];
  decisions: Decision[];
  formationSessions: FormationSession[];
  concepts: Concept[];
  conceptRelationships: ConceptRelationship[];
  principles: Principle[];
  frameworks: Framework[];
  knowledgeProjects: KnowledgeProject[];
  researchProjects: ResearchProject[];
  dialogueSessions: DialogueSession[];
  tensions: Tension[];
  syntheses: Synthesis[];
  recommendations: Recommendation[];
  documents: ReadingDocument[];
  citations: Citation[];
  workspaces: Workspace[];
  sessions: WorkspaceSession[];
}

// ---------- Reading companion foundation (LIFEOS-028) ----------

/**
 * The canonical document model for all future reading, research, and study.
 * A ReadingDocument is a first-class, user-owned entity that can be gradually
 * transformed into captures/beliefs/concepts/questions/research/syntheses while
 * every derived record keeps a Citation back to the exact originating location.
 * Deterministic and offline: no LLM, no OCR, no format parsing beyond the plain
 * importer. `authors` are plain names (deduped by normalized name) — LifeOS has
 * no separate Author entity, so no duplicate author objects are created.
 */
export type DocumentKind =
  | "book" | "article" | "essay" | "paper" | "transcript"
  | "lecture_notes" | "journal_article" | "report" | "other";

export type ReadingStatus =
  | "not_started" | "reading" | "paused" | "completed" | "abandoned";

/** A deterministic highlight over a passage's text (character span). */
export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "orange";
export interface Highlight {
  id: string;
  passageId: string;
  color: HighlightColor;
  /** The highlighted substring (a copy for display; span is the source of truth). */
  text: string;
  /** Character offsets into the passage text. */
  start: number;
  end: number;
  note?: string;
  /** Knowledge records generated from this highlight (references, never copies). */
  linked: RecordRefLite[];
  createdAt: ISO;
  updatedAt: ISO;
}

/** A lightweight typed reference to any knowledge record. */
export interface RecordRefLite { kind: string; id: string }

/** A markdown annotation attached to a passage (a note; never edits the source). */
export interface Annotation {
  id: string;
  passageId: string;
  /** Markdown body. */
  text: string;
  createdAt: ISO;
  updatedAt: ISO;
}

/** A meaningful reading unit within a section. Text is immutable once imported. */
export interface Passage {
  id: string;
  sectionId: string;
  heading?: string;
  text: string;
  page?: number;
  /** A free-form locator (e.g. "loc 1423", "0:14:30", "¶3"). */
  location?: string;
  order: number;
  highlights: Highlight[];
  annotations: Annotation[];
  /** Knowledge records linked to this passage (both auto-citation targets and manual links). */
  linked: RecordRefLite[];
}

export interface DocumentSection {
  id: string;
  title: string;
  order: number;
  passages: Passage[];
  /** Section-level markdown note (never mutates passages). */
  note?: string;
}

export interface ReadingProgress {
  status: ReadingStatus;
  currentSectionId?: string;
  currentPassageId?: string;
  /** 0–100, whole number. Derived deterministically from passages marked read. */
  percent: number;
  /** Passage ids the user has marked read (drives percent + estimated remaining). */
  readPassageIds: string[];
  lastOpenedAt?: ISO;
  startedAt?: ISO;
  finishedAt?: ISO;
}

export interface DocumentSourceMeta {
  /** Which importer produced this document. */
  importFormat: "plain" | "markdown" | "paste" | "pdf" | "epub" | "html";
  importedFrom?: string;
  originalLength?: number;
}

export interface ReadingDocument {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publication?: string;
  publicationDate?: string;
  language?: string;
  description?: string;
  kind: DocumentKind;
  status: ReadingStatus;
  /** 0–5 user rating (optional). */
  rating?: number;
  /** A deterministic placeholder cover tint (no image storage). */
  coverColor?: string;
  tags: string[];
  /** General document-level markdown notes. */
  notes: string;
  sections: DocumentSection[];
  progress: ReadingProgress;
  sourceMetadata: DocumentSourceMeta;
  createdAt: ISO;
  updatedAt: ISO;
}

/**
 * A source reference from a generated knowledge record back to the exact place
 * it came from. The canonical answer to "where did this come from?". Stored once
 * (no duplication) and reversible in both directions (record→citation and
 * passage→linked records).
 */
export interface Citation {
  id: string;
  recordKind: string;
  recordId: string;
  documentId: string;
  /** Cached for display/citation formatting; live values re-resolve from the store. */
  documentTitle: string;
  author?: string;
  sectionId?: string;
  sectionTitle?: string;
  page?: number;
  passageId?: string;
  location?: string;
  highlightId?: string;
  createdAt: ISO;
}
