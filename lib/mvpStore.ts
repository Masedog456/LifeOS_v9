/**
 * LIFEOS-002 MVP store.
 *
 * A tiny module-level reactive store persisted to localStorage, shared
 * across all screens via `useSyncExternalStore`. No database, no external
 * state library. Everything here is client-side and survives reloads on
 * the same browser only — this is a prototype data layer, deliberately.
 */

import { useSyncExternalStore } from "react";
import type {
  Belief,
  Capture,
  Comparison,
  ComparisonDecision,
  FeedbackEntry,
  FeedbackVerdict,
  Inquiry,
  InquiryStatus,
  JudgmentEntry,
  KnowledgeChunk,
  KnowledgeSource,
  Megathread,
  MegathreadStatus,
  ProcessingState,
  Proposal,
  RevisionEntry,
  StoreState,
  ThreadMemberRef,
  ThreadSynthesisData,
  AlignmentData,
  PracticeCadence,
  PracticeCandidate,
  PracticeDerivation,
  PracticeStatus,
  Reflection,
  ReviewDecision,
  ReviewSession,
  ReviewSurfacedItem,
  ReviewType,
  WeeklySynthesisData,
  ReasoningQuery,
  ReasoningStatus,
  EmbeddingRecord,
  Decision,
  DecisionAnalysisResult,
  DecisionCriterion,
  DecisionOption,
  DecisionStatus,
  OutcomeReview,
  UserConfidence,
  FormationSession,
  FormationSessionStatus,
  FormationSessionType,
  FormationSynthesisData,
  Concept,
  ConceptRelationship,
  ConceptRelationshipType,
  ConceptStatus,
  Framework,
  FrameworkKind,
  Principle,
  RelationshipConfidence,
  KnowledgeProject,
  ProjectAssembly,
  ProjectKind,
  DraftSection,
  DraftParagraph,
  OutlineOption,
  ResearchProject,
  ResearchQuestionSet,
  ResearchItem,
  ResearchDefinition,
  ResearchNote,
  Hypothesis,
  ArgumentNode,
  ArgumentNodeKind,
  ArgumentEdge,
  ArgumentEdgeKind,
  UserConfidence as UserConfidenceType,
  DialogueSession,
  DialogueStatus,
  DialogueTurn,
  DialogueTurnKind,
  DialogueTurnAuthor,
  DialogueTurnFlag,
  Perspective,
  PerspectiveKind,
  Tension,
  Synthesis,
  SynthesisRevision,
  TensionStatus,
  DialecticTensionKind,
  DialecticConfidence,
  DialecticEvidenceLink,
  Recommendation,
  ReadingDocument,
  ReadingStatus,
  DocumentSection,
  Passage,
  Highlight,
  Annotation,
  RecordRefLite,
  Citation,
  Workspace,
  WorkspaceGoal,
  WorkspaceSession,
  SessionActivityEvent,
  SessionType,
  SessionActivityKind,
  Goal,
  Project,
  Milestone,
  ExecutionPriority,
} from "@/types/mvp";
import { emptyAnalysis, emptyStages } from "@/types/mvp";
import { assembleDocument, type NewDocumentInput } from "@/lib/library/documents";
import { withPassageRead, withPosition, withStatus } from "@/lib/library/progress";
import { makeHighlight } from "@/lib/library/highlights";
import { makeAnnotation } from "@/lib/library/annotations";
import { makeCitation } from "@/lib/library/citations";
import type { ProposalDraft } from "@/lib/proposals";
import { clearState, loadState, saveLocalOnly, saveState } from "@/lib/persistence";
import { makeFingerprint, threadDeps, weeklyDeps, conceptDeps, projectDeps, researchDeps, dialogueDeps } from "@/lib/freshness/fingerprint";
import { detectTensions } from "@/lib/dialectic/tensions";
import type { SynthesisCandidate } from "@/lib/dialectic/synthesis";
import { unknownConfidence } from "@/lib/dialectic/confidence";
import { runScanners, mergeRecommendations } from "@/lib/orchestrator";
import { structuralMapping, slotField } from "@/lib/world/relationships";
import { emptyAssembly } from "@/lib/authoring/assembly";
import { shouldRecord, appendActivity, resumePatchFor } from "@/lib/workspaces/activity";
import { mergeResume } from "@/lib/workspaces/resume";
import { setCurrentWorkspace, forgetWorkspace } from "@/lib/workspaces/current";
import { toggleMilestoneDone } from "@/lib/execution/progress";
import { setCurrentGoal, setCurrentProject, forgetGoal, forgetProject } from "@/lib/execution/current";
import { clearRollback, setRecovery } from "@/lib/sync/status-store";
import { isolateDomain, buildRecoveryReport, recordRecoveryEvent, type DomainRecovery } from "@/lib/sync/recovery";

/** Stable empty state — used for the server snapshot and pre-hydration client render. */
const EMPTY_STATE: StoreState = {
  captures: [],
  proposals: [],
  beliefs: [],
  sources: [],
  feedback: [],
  comparisons: [],
  inquiries: [],
  megathreads: [],
  reflections: [],
  practices: [],
  reviews: [],
  reasonings: [],
  embeddings: [],
  decisions: [],
  formationSessions: [],
  concepts: [],
  conceptRelationships: [],
  principles: [],
  frameworks: [],
  knowledgeProjects: [],
  researchProjects: [],
  dialogueSessions: [],
  tensions: [],
  syntheses: [],
  recommendations: [],
  documents: [],
  citations: [],
  workspaces: [],
  sessions: [],
  goals: [],
  projects: [],
};

let state: StoreState = EMPTY_STATE;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  saveState(state);
}

function setState(next: StoreState) {
  state = next;
  persist();
  emit();
  // Any mutation invalidates a pending restore rollback (LIFEOS-033): the
  // rollback is only valid "until the next successful mutation". The restore
  // itself sets the buffer AFTER its setState, so it survives that call.
  clearRollbackOnMutation();
}

/** Set true only while a restore is applying, so its own setState doesn't
 * immediately clear the rollback buffer it is about to set. */
let restoreInProgress = false;
function clearRollbackOnMutation() {
  if (restoreInProgress) return;
  try { clearRollback(); } catch { /* status store optional */ }
}

function now(): string {
  return new Date().toISOString();
}

function id(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function asArray<T>(value: unknown): T[] {
  // Guard against malformed localStorage where a field isn't an array
  // (e.g. hand-edited data) — a non-array would crash later map/filter.
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Hydrate once from the persistence layer (called from a client effect). */
export function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const parsed = loadState();
    if (parsed) {
      state = {
        captures: asArray<Capture>(parsed.captures),
        proposals: asArray<Proposal>(parsed.proposals),
        beliefs: asArray<Belief>(parsed.beliefs).map((b) => ({
          // Defensively ensure the append-only arrays exist, so the
          // Constitution/ThreadLine never read undefined.
          ...b,
          revisions: asArray<RevisionEntry>(b?.revisions),
          judgments: asArray<JudgmentEntry>(b?.judgments),
        })),
        sources: asArray<KnowledgeSource>(parsed.sources).map((s) => ({
          ...s,
          chunks: asArray<KnowledgeChunk>(s?.chunks),
          keyQuotes: asArray<string>(s?.keyQuotes),
          keyConcepts: asArray<string>(s?.keyConcepts),
          candidateBeliefs: asArray<string>(s?.candidateBeliefs),
        })),
        feedback: asArray<FeedbackEntry>(parsed.feedback),
        comparisons: asArray<Comparison>(parsed.comparisons).map((c) => ({
          ...c,
          judgments: asArray<Comparison["judgments"][number]>(c?.judgments),
        })),
        inquiries: asArray<Inquiry>(parsed.inquiries).map((i) => ({
          ...i,
          judgments: asArray<Inquiry["judgments"][number]>(i?.judgments),
          history: asArray<Inquiry["history"][number]>(i?.history),
        })),
        megathreads: asArray<Megathread>(parsed.megathreads).map((t) => ({
          ...t,
          members: asArray<ThreadMemberRef>(t?.members),
          pinned: asArray<string>(t?.pinned),
          excluded: asArray<string>(t?.excluded),
          unresolvedQuestions: asArray<Megathread["unresolvedQuestions"][number]>(t?.unresolvedQuestions),
          judgments: asArray<Megathread["judgments"][number]>(t?.judgments),
          revisions: asArray<Megathread["revisions"][number]>(t?.revisions),
        })),
        reflections: asArray<Reflection>(parsed.reflections).map((r) => ({
          ...r,
          annotations: asArray<Reflection["annotations"][number]>(r?.annotations),
        })),
        practices: asArray<PracticeCandidate>(parsed.practices).map((p) => ({
          ...p,
          history: asArray<PracticeCandidate["history"][number]>(p?.history),
        })),
        reviews: asArray<ReviewSession>(parsed.reviews).map((r) => ({
          ...r,
          surfaced: asArray<ReviewSurfacedItem>(r?.surfaced),
          reflectionIds: asArray<string>(r?.reflectionIds),
          judgments: asArray<ReviewSession["judgments"][number]>(r?.judgments),
          acceptedPracticeIds: asArray<string>(r?.acceptedPracticeIds),
          unresolvedQuestions: asArray<string>(r?.unresolvedQuestions),
        })),
        reasonings: asArray<ReasoningQuery>(parsed.reasonings).map((q) => ({
          ...q,
          evidence: asArray<ReasoningQuery["evidence"][number]>(q?.evidence),
          history: asArray<ReasoningQuery["history"][number]>(q?.history),
          judgments: asArray<ReasoningQuery["judgments"][number]>(q?.judgments),
        })),
        embeddings: asArray<EmbeddingRecord>(parsed.embeddings),
        decisions: asArray<Decision>(parsed.decisions).map((d) => ({
          ...d,
          options: asArray<DecisionOption>(d?.options),
          criteria: asArray<DecisionCriterion>(d?.criteria),
          ratings: d?.ratings && typeof d.ratings === "object" ? d.ratings : {},
          constraints: asArray<string>(d?.constraints),
          assumptions: asArray<string>(d?.assumptions),
          seedRefs: asArray<string>(d?.seedRefs),
          evidence: asArray<Decision["evidence"][number]>(d?.evidence),
          history: asArray<Decision["history"][number]>(d?.history),
          judgments: asArray<Decision["judgments"][number]>(d?.judgments),
          revisions: asArray<Decision["revisions"][number]>(d?.revisions),
          outcomeReviews: asArray<OutcomeReview>(d?.outcomeReviews),
        })),
        formationSessions: asArray<FormationSession>(parsed.formationSessions).map((f) => ({
          ...f,
          suggestedPrompts: asArray<string>(f?.suggestedPrompts),
          linkedDecisions: asArray<string>(f?.linkedDecisions),
          linkedBeliefs: asArray<string>(f?.linkedBeliefs),
          linkedPractices: asArray<string>(f?.linkedPractices),
          linkedThreads: asArray<string>(f?.linkedThreads),
          linkedInquiries: asArray<string>(f?.linkedInquiries),
          linkedSources: asArray<string>(f?.linkedSources),
          linkedReflections: asArray<string>(f?.linkedReflections),
          seedRefs: asArray<string>(f?.seedRefs),
          lessons: asArray<string>(f?.lessons),
          unresolvedQuestions: asArray<string>(f?.unresolvedQuestions),
          emotionalObservations: asArray<string>(f?.emotionalObservations),
          revisedAssumptions: asArray<string>(f?.revisedAssumptions),
          beliefCandidates: asArray<string>(f?.beliefCandidates),
          followUpReflections: asArray<string>(f?.followUpReflections),
          evidence: asArray<FormationSession["evidence"][number]>(f?.evidence),
          history: asArray<FormationSession["history"][number]>(f?.history),
          judgments: asArray<FormationSession["judgments"][number]>(f?.judgments),
        })),
        concepts: asArray<Concept>(parsed.concepts).map((c) => ({
          ...c,
          aliases: asArray<string>(c?.aliases),
          relatedBeliefs: asArray<string>(c?.relatedBeliefs),
          relatedThreads: asArray<string>(c?.relatedThreads),
          relatedSources: asArray<string>(c?.relatedSources),
          relatedPractices: asArray<string>(c?.relatedPractices),
          parentConcepts: asArray<string>(c?.parentConcepts),
          childConcepts: asArray<string>(c?.childConcepts),
          relatedConcepts: asArray<string>(c?.relatedConcepts),
          opposingConcepts: asArray<string>(c?.opposingConcepts),
          principleIds: asArray<string>(c?.principleIds),
          questions: asArray<string>(c?.questions),
          history: asArray<Concept["history"][number]>(c?.history),
        })),
        conceptRelationships: asArray<ConceptRelationship>(parsed.conceptRelationships).map((r) => ({
          ...r,
          citations: asArray<string>(r?.citations),
          history: asArray<ConceptRelationship["history"][number]>(r?.history),
        })),
        principles: asArray<Principle>(parsed.principles).map((p) => ({
          ...p,
          conceptIds: asArray<string>(p?.conceptIds),
          beliefIds: asArray<string>(p?.beliefIds),
          citations: asArray<string>(p?.citations),
          history: asArray<Principle["history"][number]>(p?.history),
        })),
        frameworks: asArray<Framework>(parsed.frameworks).map((f) => ({
          ...f,
          conceptIds: asArray<string>(f?.conceptIds),
          principleIds: asArray<string>(f?.principleIds),
          history: asArray<Framework["history"][number]>(f?.history),
        })),
        knowledgeProjects: asArray<KnowledgeProject>(parsed.knowledgeProjects).map((p) => ({
          ...p,
          assembly: { ...emptyAssembly(), ...(p?.assembly && typeof p.assembly === "object" ? p.assembly : {}) },
          outlineOptions: asArray<OutlineOption>(p?.outlineOptions),
          sections: asArray<DraftSection>(p?.sections).map((s) => ({
            ...s,
            paragraphs: asArray<DraftParagraph>(s?.paragraphs),
            versions: asArray<DraftSection["versions"][number]>(s?.versions),
          })),
          history: asArray<KnowledgeProject["history"][number]>(p?.history),
        })),
        researchProjects: asArray<ResearchProject>(parsed.researchProjects).map((p) => ({
          ...p,
          questions: {
            subquestions: asArray<ResearchItem>(p?.questions?.subquestions),
            unknowns: asArray<ResearchItem>(p?.questions?.unknowns),
            assumptions: asArray<ResearchItem>(p?.questions?.assumptions),
            definitions: asArray<ResearchDefinition>(p?.questions?.definitions),
            successCriteria: asArray<ResearchItem>(p?.questions?.successCriteria),
            openProblems: asArray<ResearchItem>(p?.questions?.openProblems),
          },
          assembly: { ...emptyAssembly(), ...(p?.assembly && typeof p.assembly === "object" ? p.assembly : {}) },
          notes: asArray<ResearchNote>(p?.notes),
          hypotheses: asArray<Hypothesis>(p?.hypotheses).map((h) => ({
            ...h,
            supportingEvidence: asArray<string>(h?.supportingEvidence),
            contradictingEvidence: asArray<string>(h?.contradictingEvidence),
            openQuestions: asArray<string>(h?.openQuestions),
            history: asArray<Hypothesis["history"][number]>(h?.history),
          })),
          argumentNodes: asArray<ArgumentNode>(p?.argumentNodes).map((n) => ({ ...n, history: asArray<ArgumentNode["history"][number]>(n?.history) })),
          argumentEdges: asArray<ArgumentEdge>(p?.argumentEdges),
          history: asArray<ResearchProject["history"][number]>(p?.history),
        })),
        dialogueSessions: asArray<DialogueSession>(parsed.dialogueSessions).map((d) => ({
          ...d,
          participants: asArray<Perspective>(d?.participants),
          seedRefs: asArray<string>(d?.seedRefs),
          turns: asArray<DialogueTurn>(d?.turns).map((t) => ({
            ...t,
            citations: asArray<string>(t?.citations),
            flags: asArray<DialogueTurnFlag>(t?.flags),
          })),
          outcomes: asArray<DialogueSession["outcomes"][number]>(d?.outcomes),
          history: asArray<DialogueSession["history"][number]>(d?.history),
        })),
        tensions: asArray<Tension>(parsed.tensions).map((t) => ({
          ...t,
          thesisRefs: asArray<string>(t?.thesisRefs),
          antithesisRefs: asArray<string>(t?.antithesisRefs),
          evidence: asArray<DialecticEvidenceLink>(t?.evidence),
          unresolvedQuestions: asArray<string>(t?.unresolvedQuestions),
          history: asArray<Tension["history"][number]>(t?.history),
        })),
        syntheses: asArray<Synthesis>(parsed.syntheses).map((s) => ({
          ...s,
          tensionIds: asArray<string>(s?.tensionIds),
          preservedInsights: asArray<string>(s?.preservedInsights),
          discardedAssumptions: asArray<string>(s?.discardedAssumptions),
          commonGround: asArray<string>(s?.commonGround),
          remainingUncertainty: asArray<string>(s?.remainingUncertainty),
          evidenceLinks: asArray<DialecticEvidenceLink>(s?.evidenceLinks),
          revisions: asArray<SynthesisRevision>(s?.revisions),
          outcomes: asArray<Synthesis["outcomes"][number]>(s?.outcomes),
        })),
        recommendations: asArray<Recommendation>(parsed.recommendations).map((r) => ({
          ...r,
          affected: asArray<Recommendation["affected"][number]>(r?.affected),
        })),
        documents: asArray<ReadingDocument>(parsed.documents).map((d) => ({
          ...d,
          authors: asArray<string>(d?.authors),
          tags: asArray<string>(d?.tags),
          sections: asArray<DocumentSection>(d?.sections).map((s) => ({
            ...s,
            passages: asArray<Passage>(s?.passages).map((p) => ({
              ...p,
              highlights: asArray<Highlight>(p?.highlights).map((h) => ({ ...h, linked: asArray<RecordRefLite>(h?.linked) })),
              annotations: asArray<Annotation>(p?.annotations),
              linked: asArray<RecordRefLite>(p?.linked),
            })),
          })),
          progress: {
            status: d?.progress?.status ?? "not_started",
            percent: d?.progress?.percent ?? 0,
            currentSectionId: d?.progress?.currentSectionId,
            currentPassageId: d?.progress?.currentPassageId,
            readPassageIds: asArray<string>(d?.progress?.readPassageIds),
            lastOpenedAt: d?.progress?.lastOpenedAt,
            startedAt: d?.progress?.startedAt,
            finishedAt: d?.progress?.finishedAt,
          },
          sourceMetadata: d?.sourceMetadata ?? { importFormat: "plain" },
        })),
        citations: asArray<Citation>(parsed.citations),
        workspaces: asArray<Workspace>(parsed.workspaces).map((w) => ({
          ...w,
          goals: asArray<WorkspaceGoal>(w?.goals),
          members: asArray<RecordRefLite>(w?.members),
          pinned: asArray<RecordRefLite>(w?.pinned),
          resume: (w?.resume && typeof w.resume === "object" ? w.resume : {}) as Workspace["resume"],
          archived: Boolean(w?.archived),
        })),
        sessions: asArray<WorkspaceSession>(parsed.sessions).map((s) => ({
          ...s,
          notes: typeof s?.notes === "string" ? s.notes : "",
          activity: asArray<SessionActivityEvent>(s?.activity),
        })),
        goals: asArray<Goal>(parsed.goals).map((g) => ({
          ...g,
          tags: asArray<string>(g?.tags),
          linkedWorkspaces: asArray<RecordRefLite>(g?.linkedWorkspaces),
          linkedKnowledge: asArray<RecordRefLite>(g?.linkedKnowledge),
        })),
        projects: asArray<Project>(parsed.projects).map((p) => ({
          ...p,
          milestones: asArray<Milestone>(p?.milestones).map((m) => ({
            ...m,
            linkedSessions: asArray<string>(m?.linkedSessions),
            linkedKnowledge: asArray<RecordRefLite>(m?.linkedKnowledge),
          })),
          relatedDocuments: asArray<RecordRefLite>(p?.relatedDocuments),
          relatedEntities: asArray<RecordRefLite>(p?.relatedEntities),
        })),
      };
      // Corruption isolation (LIFEOS-033, Feature 10): drop malformed rows from
      // the in-memory store so a single bad record (null / missing id) can never
      // crash a downstream consumer, while the source in localStorage is left
      // untouched. Skipped rows are counted per-domain and surfaced in
      // diagnostics / recovery mode. Domains with no malformed rows keep their
      // exact array reference (dirty-domain sync depends on reference equality).
      try {
        const recoveries: DomainRecovery[] = [];
        const s = state as unknown as Record<string, unknown>;
        for (const key of Object.keys(s)) {
          const val = s[key];
          if (!Array.isArray(val)) continue;
          const { valid, recovery } = isolateDomain(key, val);
          if (recovery.skipped > 0) { s[key] = valid; recoveries.push(recovery); }
        }
        const report = buildRecoveryReport(recoveries, now());
        setRecovery(report.totalSkipped > 0 ? report : null);
        recordRecoveryEvent(report);
      } catch { /* isolation is best-effort; never block hydration */ }
      emit();
    }
  } catch {
    // Corrupt storage → start clean rather than crash.
  }
}

/**
 * Replace the entire store with a validated snapshot (LIFEOS-032 restore). The
 * caller (BackupRestore) has already validated + previewed + confirmed; this
 * persists and re-renders. Arrays are defensively guarded via `asArray`-style
 * normalization on the next hydrate cycle.
 */
export function restoreState(next: StoreState): void {
  restoreInProgress = true;
  try { setState(next); } finally { restoreInProgress = false; }
}

/**
 * Apply a conflict-resolved record into its domain (LIFEOS-033): upsert by id.
 * Used by the conflict resolver for "keep remote" / "merge" / "duplicate". The
 * domain is a StoreState array key; the record carries its own id.
 */
export function applyResolvedRecord(domain: keyof StoreState, record: { id: string }): void {
  const arr = (state[domain] as unknown as { id: string }[]) ?? [];
  const i = arr.findIndex((r) => r.id === record.id);
  const next = i === -1 ? [record, ...arr] : arr.map((r) => (r.id === record.id ? record : r));
  setState({ ...state, [domain]: next } as StoreState);
}

/** Wipe all data (local + remote, if configured). */
export function resetStore() {
  clearState();
  setState({
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [],
    comparisons: [], inquiries: [], megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [], formationSessions: [],
    concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [], researchProjects: [], dialogueSessions: [],
    tensions: [], syntheses: [], recommendations: [], documents: [], citations: [],
    workspaces: [], sessions: [], goals: [], projects: [],
  });
}

/** Record user feedback on a surfaced retrieval record (append-only). */
export function recordFeedback(
  recordId: string,
  verdict: FeedbackVerdict,
  snoozeMinutes?: number,
): void {
  const entry: FeedbackEntry = {
    recordId,
    verdict,
    at: now(),
    ...(verdict === "snoozed" && snoozeMinutes
      ? { snoozeUntil: new Date(Date.now() + snoozeMinutes * 60_000).toISOString() }
      : {}),
  };
  setState({ ...state, feedback: [entry, ...state.feedback] });
}

/**
 * Replace the in-memory store with adopted remote data. Persists locally
 * only (no remote re-push) and notifies subscribers. Used by the
 * persistence bootstrap after loading from Supabase.
 */
export function replaceState(next: StoreState) {
  state = next;
  saveLocalOnly(next);
  emit();
}

// ---------- Subscription plumbing ----------

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): StoreState {
  return state;
}

function getServerSnapshot(): StoreState {
  return EMPTY_STATE;
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ---------- Actions ----------

/** Save a capture locally. Always call this before any AI work. Returns the new id. */
export function addCapture(text: string, sourceId?: string): string {
  const capture: Capture = {
    id: id(),
    text: text.trim(),
    createdAt: now(),
    ...(sourceId ? { sourceId } : {}),
  };
  setState({ ...state, captures: [capture, ...state.captures] });
  // Feed the active thinking session's activity timeline, if any (LIFEOS-030).
  recordSessionActivity({ type: "capture_created", entityKind: "capture", entityId: capture.id, label: "Captured a thought", detail: capture.text });
  return capture.id;
}

/** Attach proposals (from AI or mock) to an existing capture. */
export function attachProposals(
  captureId: string,
  drafts: ProposalDraft[],
  source: "ai" | "mock",
): void {
  const proposals: Proposal[] = drafts.map((d) => ({
    id: id(),
    captureId,
    claim: d.claim,
    theme: d.theme,
    spanStart: d.spanStart,
    spanEnd: d.spanEnd,
    source,
    createdAt: now(),
    resolved: false,
  }));
  setState({ ...state, proposals: [...proposals, ...state.proposals] });
}

function resolveProposal(proposalId: string): Proposal | undefined {
  const proposal = state.proposals.find((p) => p.id === proposalId);
  if (!proposal) return undefined;
  setState({
    ...state,
    proposals: state.proposals.map((p) =>
      p.id === proposalId ? { ...p, resolved: true } : p,
    ),
  });
  return proposal;
}

function addBelief(belief: Belief) {
  setState({ ...state, beliefs: [belief, ...state.beliefs] });
}

/**
 * Judge a proposal. `rewrite` supplies the user's own wording (the
 * primary action); the others use the proposed claim as-is.
 */
export function judgeProposal(
  proposalId: string,
  decision: "accepted" | "rewritten" | "rejected" | "questioned",
  rewriteText?: string,
): void {
  const proposal = resolveProposal(proposalId);
  if (!proposal) return;

  const at = now();
  const status: Belief["status"] =
    decision === "accepted"
      ? "accepted"
      : decision === "rewritten"
        ? "revised"
        : decision === "questioned"
          ? "questioned"
          : "rejected";

  const finalText =
    decision === "rewritten" && rewriteText?.trim()
      ? rewriteText.trim()
      : proposal.claim;

  const revisions: RevisionEntry[] = [
    { text: proposal.claim, at, reason: "proposed" },
  ];
  if (decision === "rewritten" && finalText !== proposal.claim) {
    revisions.push({ text: finalText, at, reason: "rewritten" });
  } else if (decision === "accepted") {
    revisions[0] = { text: proposal.claim, at, reason: "accepted" };
  }

  const belief: Belief = {
    id: id(),
    captureId: proposal.captureId,
    proposalId: proposal.id,
    text: finalText,
    theme: proposal.theme,
    status,
    createdAt: at,
    updatedAt: at,
    revisions,
    judgments: [{ decision, at }],
  };
  addBelief(belief);
}

function updateBelief(beliefId: string, update: (b: Belief) => Belief) {
  setState({
    ...state,
    beliefs: state.beliefs.map((b) => (b.id === beliefId ? update(b) : b)),
  });
}

/** Re-judge an existing belief over time (this is how a thread visibly bends). */
export function reviseBelief(beliefId: string, newText: string): void {
  const text = newText.trim();
  if (!text) return;
  const at = now();
  updateBelief(beliefId, (b) => ({
    ...b,
    text,
    status: "revised",
    updatedAt: at,
    revisions: [...b.revisions, { text, at, reason: "rewritten" }],
    judgments: [...b.judgments, { decision: "rewritten", at }],
  }));
}

export function affirmBelief(beliefId: string): void {
  const at = now();
  updateBelief(beliefId, (b) => ({
    ...b,
    status: "accepted",
    updatedAt: at,
    revisions: [...b.revisions, { text: b.text, at, reason: "reaffirmed" }],
    judgments: [...b.judgments, { decision: "reaffirmed", at }],
  }));
}

export function questionBelief(beliefId: string): void {
  const at = now();
  updateBelief(beliefId, (b) => ({
    ...b,
    status: "questioned",
    updatedAt: at,
    revisions: [...b.revisions, { text: b.text, at, reason: "questioned" }],
    judgments: [...b.judgments, { decision: "questioned", at }],
  }));
}

// ---------- Selectors ----------

export function captureById(s: StoreState, captureId: string): Capture | undefined {
  return s.captures.find((c) => c.id === captureId);
}

export function pendingProposals(s: StoreState): Proposal[] {
  // Oldest first, so the user reviews in the order thoughts arrived.
  return s.proposals
    .filter((p) => !p.resolved)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Pick one belief to resurface on Home: the least-recently-touched
 * non-rejected belief. Deterministic given the state.
 */
export function resurfacedBelief(s: StoreState): Belief | undefined {
  const active = s.beliefs.filter((b) => b.status !== "rejected");
  if (active.length === 0) return undefined;
  return [...active].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
}

// ---------- Knowledge Library actions (LIFEOS-003) ----------

/** Add a source to the library. Returns its id. Original text is immutable hereafter. */
export function addSource(
  fields: Pick<KnowledgeSource, "type" | "input" | "title" | "originalText"> &
    Partial<
      Pick<
        KnowledgeSource,
        | "author"
        | "origin"
        | "processingState"
        | "pdfMeta"
        | "pageMap"
        | "extractionStatus"
      >
    >,
): string {
  const source: KnowledgeSource = {
    id: id(),
    type: fields.type,
    input: fields.input,
    title: fields.title.trim() || "Untitled",
    author: fields.author?.trim() || undefined,
    origin: fields.origin?.trim() || undefined,
    addedAt: now(),
    status: "unread",
    processingState: fields.processingState ?? "captured",
    originalText: fields.originalText,
    chunks: [],
    keyQuotes: [],
    keyConcepts: [],
    candidateBeliefs: [],
    chunkResults: [],
    stages: emptyStages(),
    analysis: emptyAnalysis(),
    pdfMeta: fields.pdfMeta,
    pageMap: fields.pageMap,
    extractionStatus: fields.extractionStatus,
  };
  setState({ ...state, sources: [source, ...state.sources] });
  return source.id;
}

/** Non-hook read of the current source (for the pipeline, which isn't a component). */
export function getSource(sourceId: string): KnowledgeSource | undefined {
  return state.sources.find((s) => s.id === sourceId);
}

/** Non-hook read of the whole store (for orchestrators triggered from events). */
export function getStoreSnapshot(): StoreState {
  return state;
}

function updateSource(sourceId: string, update: (s: KnowledgeSource) => KnowledgeSource) {
  setState({
    ...state,
    sources: state.sources.map((s) => (s.id === sourceId ? update(s) : s)),
  });
}

/** Patch derived/metadata fields on a source. Never touches originalText. */
export function patchSource(
  sourceId: string,
  patch: Partial<
    Omit<KnowledgeSource, "id" | "originalText" | "input" | "addedAt">
  >,
): void {
  updateSource(sourceId, (s) => ({ ...s, ...patch }));
}

export function setProcessingState(
  sourceId: string,
  processingState: ProcessingState,
  processingError?: string,
): void {
  updateSource(sourceId, (s) => ({ ...s, processingState, processingError }));
}

export function setSourceStatus(sourceId: string, status: KnowledgeSource["status"]): void {
  updateSource(sourceId, (s) => ({ ...s, status }));
}

/**
 * Set the original text for a source that was created without it (a PDF or
 * URL awaiting its extracted/pasted body). Allowed only while originalText
 * is still empty — this is a one-time set, never an edit of existing
 * immutable text.
 */
export function setOriginalText(sourceId: string, text: string): boolean {
  const src = state.sources.find((s) => s.id === sourceId);
  if (!src || src.originalText.trim().length > 0) return false;
  updateSource(sourceId, (s) => ({ ...s, originalText: text, processingState: "captured" }));
  return true;
}

/** Save a highlighted quote from the reader into the source's key quotes (deduped). */
export function saveQuote(sourceId: string, quote: string): void {
  const q = quote.trim();
  if (!q) return;
  updateSource(sourceId, (s) =>
    s.keyQuotes.includes(q) ? s : { ...s, keyQuotes: [q, ...s.keyQuotes] },
  );
}

/**
 * Send text to the Belief Inbox: create a Capture (linked to the source)
 * and attach the given belief proposals. Reuses the exact same inbox
 * pipeline as Home — candidates never bypass the inbox into the
 * Constitution. Returns the capture id.
 */
export function sendToInbox(
  text: string,
  drafts: ProposalDraft[],
  aiSource: "ai" | "mock",
  sourceId?: string,
): string {
  const captureId = addCapture(text, sourceId);
  attachProposals(captureId, drafts, aiSource);
  return captureId;
}

// ---------- Knowledge Library selectors ----------

export function sourceById(s: StoreState, sourceId: string): KnowledgeSource | undefined {
  return s.sources.find((x) => x.id === sourceId);
}

export function searchSources(
  s: StoreState,
  query: string,
  type: string | "all",
): KnowledgeSource[] {
  const q = query.trim().toLowerCase();
  return s.sources
    .filter((src) => (type === "all" ? true : src.type === type))
    .filter(
      (src) =>
        !q ||
        src.title.toLowerCase().includes(q) ||
        (src.author?.toLowerCase().includes(q) ?? false),
    );
}

/** Beliefs formed from captures that trace back to a given source. */
export function beliefsFromSource(s: StoreState, sourceId: string): Belief[] {
  const captureIds = new Set(
    s.captures.filter((c) => c.sourceId === sourceId).map((c) => c.id),
  );
  return s.beliefs.filter((b) => captureIds.has(b.captureId));
}

// ---------- Comparative intelligence actions (LIFEOS-010) ----------

/** Persist a completed comparison (a proposal, never a Constitution change). */
export function saveComparison(comparison: Comparison): void {
  setState({ ...state, comparisons: [comparison, ...state.comparisons] });
}

/** Replace a comparison in place (used by rerun; history already appended). */
export function updateComparison(comparison: Comparison): void {
  setState({ ...state, comparisons: state.comparisons.map((c) => (c.id === comparison.id ? comparison : c)) });
}

/** Append a human judgment on one comparison insight (append-only). */
export function judgeComparisonInsight(
  comparisonId: string,
  insightRef: string,
  decision: ComparisonDecision,
  note?: string,
): void {
  const at = now();
  setState({
    ...state,
    comparisons: state.comparisons.map((c) =>
      c.id === comparisonId
        ? { ...c, judgments: [...c.judgments, { insightRef, decision, at, ...(note ? { note } : {}) }] }
        : c,
    ),
  });
}

export function comparisonById(s: StoreState, comparisonId: string): Comparison | undefined {
  return s.comparisons.find((c) => c.id === comparisonId);
}

// ---------- Dialectical intelligence actions (LIFEOS-011) ----------

/** Persist a completed inquiry (a reasoning aid, never a Constitution change). */
export function saveInquiry(inquiry: Inquiry): void {
  setState({ ...state, inquiries: [inquiry, ...state.inquiries] });
}

/**
 * Replace an inquiry with an evolved version (the evolver has already pushed
 * the prior result into append-only `history`). Preserves list position.
 */
export function updateInquiry(inquiry: Inquiry): void {
  setState({
    ...state,
    inquiries: state.inquiries.map((i) => (i.id === inquiry.id ? inquiry : i)),
  });
}

function patchInquiry(inquiryId: string, patch: (i: Inquiry) => Inquiry): void {
  setState({
    ...state,
    inquiries: state.inquiries.map((i) => (i.id === inquiryId ? patch(i) : i)),
  });
}

/** Append a human judgment on one inquiry insight (append-only). */
export function judgeInquiryInsight(
  inquiryId: string,
  insightRef: string,
  decision: ComparisonDecision,
  note?: string,
): void {
  const at = now();
  patchInquiry(inquiryId, (i) => ({
    ...i,
    judgments: [...i.judgments, { insightRef, decision, at, ...(note ? { note } : {}) }],
    updatedAt: at,
  }));
}

/** Write/replace the user's own provisional conclusion (also sets status). */
export function setInquiryConclusion(inquiryId: string, text: string, status: InquiryStatus = "provisional"): void {
  patchInquiry(inquiryId, (i) => ({ ...i, provisionalConclusion: text.trim() || undefined, status, updatedAt: now() }));
}

export function setInquiryStatus(inquiryId: string, status: InquiryStatus): void {
  patchInquiry(inquiryId, (i) => ({ ...i, status, updatedAt: now() }));
}

export function inquiryById(s: StoreState, inquiryId: string): Inquiry | undefined {
  return s.inquiries.find((i) => i.id === inquiryId);
}

// ---------- Megathread actions (LIFEOS-012) ----------

export function createMegathread(fields: {
  title: string;
  description?: string;
  seedType: Megathread["seedType"];
  seedId?: string;
  seedLabel?: string;
  members?: ThreadMemberRef[];
}): string {
  const at = now();
  const thread: Megathread = {
    id: id(),
    title: fields.title.trim() || "Untitled thread",
    description: fields.description?.trim() || undefined,
    status: "active",
    seedType: fields.seedType,
    seedId: fields.seedId,
    seedLabel: fields.seedLabel,
    members: fields.members ?? [],
    pinned: [],
    excluded: [],
    unresolvedQuestions: [],
    judgments: [],
    revisions: [{ at, note: "Thread created" }],
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, megathreads: [thread, ...state.megathreads] });
  return thread.id;
}

function patchThread(threadId: string, patch: (t: Megathread) => Megathread, logNote?: string): void {
  const at = now();
  setState({
    ...state,
    megathreads: state.megathreads.map((t) => {
      if (t.id !== threadId) return t;
      const next = patch(t);
      return {
        ...next,
        updatedAt: at,
        revisions: logNote ? [...t.revisions, { at, note: logNote }] : next.revisions,
      };
    }),
  });
}

export function updateMegathread(thread: Megathread): void {
  patchThread(thread.id, () => thread);
}

export function setThreadFields(
  threadId: string,
  fields: Partial<Pick<Megathread, "title" | "description" | "notes">>,
): void {
  patchThread(threadId, (t) => ({ ...t, ...fields }));
}

export function setThreadStatus(threadId: string, status: MegathreadStatus): void {
  patchThread(threadId, (t) => ({ ...t, status }), `Marked ${status}`);
}

export function addThreadMember(threadId: string, ref: ThreadMemberRef): void {
  patchThread(
    threadId,
    (t) =>
      t.members.some((m) => m.type === ref.type && m.id === ref.id)
        ? t
        : { ...t, members: [...t.members, { ...ref, at: now() }], excluded: t.excluded.filter((x) => x !== ref.id) },
    `Added ${ref.type}`,
  );
}

export function removeThreadMember(threadId: string, type: ThreadMemberRef["type"], memberId: string): void {
  patchThread(threadId, (t) => ({
    ...t,
    members: t.members.filter((m) => !(m.type === type && m.id === memberId)),
    pinned: t.pinned.filter((x) => x !== memberId),
  }));
}

/** Exclude a record: remove it as a member and never auto-suggest it again. */
export function excludeThreadItem(threadId: string, recordId: string): void {
  patchThread(threadId, (t) => ({
    ...t,
    members: t.members.filter((m) => m.id !== recordId),
    pinned: t.pinned.filter((x) => x !== recordId),
    excluded: t.excluded.includes(recordId) ? t.excluded : [...t.excluded, recordId],
  }));
}

export function toggleThreadPin(threadId: string, memberId: string): void {
  patchThread(threadId, (t) => ({
    ...t,
    pinned: t.pinned.includes(memberId) ? t.pinned.filter((x) => x !== memberId) : [...t.pinned, memberId],
  }));
}

export function setThreadSynthesis(
  threadId: string,
  synthesis: ThreadSynthesisData,
  source: "ai" | "mock" | "user",
  evidence?: Megathread["synthesisEvidence"],
): void {
  patchThread(
    threadId,
    (t) => ({
      ...t,
      synthesis,
      synthesisSource: source,
      synthesisEvidence: evidence ?? t.synthesisEvidence,
      fingerprint: makeFingerprint(state, threadDeps(t)),
    }),
    source === "user" ? "Synthesis rewritten by you" : "Synthesis regenerated",
  );
}

export function addThreadQuestion(threadId: string, text: string): void {
  const q = text.trim();
  if (!q) return;
  patchThread(threadId, (t) =>
    t.unresolvedQuestions.some((x) => x.text === q)
      ? t
      : { ...t, unresolvedQuestions: [...t.unresolvedQuestions, { text: q, resolved: false }] },
  );
}

export function toggleThreadQuestion(threadId: string, index: number): void {
  patchThread(threadId, (t) => ({
    ...t,
    unresolvedQuestions: t.unresolvedQuestions.map((q, i) => (i === index ? { ...q, resolved: !q.resolved } : q)),
  }));
}

export function judgeThreadInsight(
  threadId: string,
  insightRef: string,
  decision: ComparisonDecision,
  note?: string,
): void {
  const at = now();
  patchThread(threadId, (t) => ({
    ...t,
    judgments: [...t.judgments, { insightRef, decision, at, ...(note ? { note } : {}) }],
  }));
}

export function megathreadById(s: StoreState, threadId: string): Megathread | undefined {
  return s.megathreads.find((t) => t.id === threadId);
}

/** Existing threads seeded by the same record — used to warn about duplicates. */
export function threadsForSeed(s: StoreState, seedType: Megathread["seedType"], seedId?: string): Megathread[] {
  if (!seedId) return [];
  return s.megathreads.filter((t) => t.seedType === seedType && t.seedId === seedId);
}

// ---------- Formation actions (LIFEOS-013) ----------

/** Save a reflection. `response` is immutable; annotations are added separately. */
export function addReflection(fields: {
  prompt: string;
  response: string;
  beliefIds?: string[];
  threadIds?: string[];
  sourceIds?: string[];
  context?: string;
}): string {
  const reflection: Reflection = {
    id: id(),
    prompt: fields.prompt,
    response: fields.response.trim(),
    createdAt: now(),
    beliefIds: fields.beliefIds,
    threadIds: fields.threadIds,
    sourceIds: fields.sourceIds,
    context: fields.context?.trim() || undefined,
    annotations: [],
  };
  setState({ ...state, reflections: [reflection, ...state.reflections] });
  return reflection.id;
}

/** Append a later note to a reflection (kept separate from the immutable original). */
export function annotateReflection(reflectionId: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  setState({
    ...state,
    reflections: state.reflections.map((r) =>
      r.id === reflectionId ? { ...r, annotations: [...r.annotations, { text: t, at: now() }] } : r,
    ),
  });
}

export interface PracticeDraftInput {
  title: string;
  description: string;
  rationale: string;
  cadence?: PracticeCadence;
  derivedFrom: PracticeDerivation;
}

/** Create proposed practice candidates from validated drafts. Returns their ids. */
export function addPractices(drafts: PracticeDraftInput[], source: "ai" | "mock"): string[] {
  const at = now();
  const created: PracticeCandidate[] = drafts.map((d) => ({
    id: id(),
    title: d.title,
    description: d.description,
    rationale: d.rationale,
    derivedFrom: d.derivedFrom,
    cadence: d.cadence,
    status: "proposed",
    source,
    createdAt: at,
    updatedAt: at,
    history: [{ at, status: "proposed" }],
  }));
  setState({ ...state, practices: [...created, ...state.practices] });
  return created.map((p) => p.id);
}

function patchPractice(practiceId: string, patch: (p: PracticeCandidate) => PracticeCandidate): void {
  setState({
    ...state,
    practices: state.practices.map((p) => (p.id === practiceId ? patch(p) : p)),
  });
}

/** Change a practice's status (append-only history). Never scheduled or tracked. */
export function setPracticeStatus(practiceId: string, status: PracticeStatus, note?: string): void {
  const at = now();
  patchPractice(practiceId, (p) => ({
    ...p,
    status,
    updatedAt: at,
    history: [...p.history, { at, status, ...(note ? { note } : {}) }],
  }));
}

export function editPracticeWording(practiceId: string, wording: string): void {
  patchPractice(practiceId, (p) => ({ ...p, userWording: wording.trim() || undefined, source: "user", updatedAt: now() }));
}

/** Start a review session with the deterministically-surfaced items. Returns its id. */
export function startReview(type: ReviewType, surfaced: ReviewSurfacedItem[]): string {
  const session: ReviewSession = {
    id: id(),
    type,
    surfaced,
    reflectionIds: [],
    judgments: [],
    acceptedPracticeIds: [],
    unresolvedQuestions: [],
    startedAt: now(),
  };
  setState({ ...state, reviews: [session, ...state.reviews] });
  return session.id;
}

function patchReview(reviewId: string, patch: (r: ReviewSession) => ReviewSession): void {
  setState({
    ...state,
    reviews: state.reviews.map((r) => (r.id === reviewId ? patch(r) : r)),
  });
}

export function recordReviewJudgment(reviewId: string, itemId: string, decision: ReviewDecision, note?: string): void {
  patchReview(reviewId, (r) => ({
    ...r,
    judgments: [...r.judgments, { itemId, decision, at: now(), ...(note ? { note } : {}) }],
  }));
}

export function attachReflectionToReview(reviewId: string, reflectionId: string): void {
  patchReview(reviewId, (r) =>
    r.reflectionIds.includes(reflectionId) ? r : { ...r, reflectionIds: [...r.reflectionIds, reflectionId] },
  );
}

export function markPracticeAcceptedInReview(reviewId: string, practiceId: string): void {
  patchReview(reviewId, (r) =>
    r.acceptedPracticeIds.includes(practiceId) ? r : { ...r, acceptedPracticeIds: [...r.acceptedPracticeIds, practiceId] },
  );
}

export function setReviewSynthesis(reviewId: string, synthesis: WeeklySynthesisData, source: "ai" | "mock"): void {
  patchReview(reviewId, (r) => {
    const next = { ...r, synthesis, synthesisSource: source };
    return { ...next, fingerprint: makeFingerprint(state, weeklyDeps(next)) };
  });
}

// ---------- Semantic index actions (LIFEOS-015) ----------

/** Merge new embeddings, replacing any prior embedding for the same record. */
export function addEmbeddings(records: EmbeddingRecord[]): void {
  if (records.length === 0) return;
  const byId = new Map(state.embeddings.map((e) => [e.recordId, e]));
  for (const r of records) byId.set(r.recordId, r);
  setState({ ...state, embeddings: [...byId.values()] });
}

export function setReviewAlignment(reviewId: string, alignment: AlignmentData, source: "ai" | "mock"): void {
  patchReview(reviewId, (r) => ({ ...r, alignment, alignmentSource: source }));
}

export function completeReview(reviewId: string): void {
  patchReview(reviewId, (r) => (r.completedAt ? r : { ...r, completedAt: now() }));
}

export function reviewById(s: StoreState, reviewId: string): ReviewSession | undefined {
  return s.reviews.find((r) => r.id === reviewId);
}

// ---------- Reasoning engine actions (LIFEOS-014) ----------

/** Persist a completed reasoning query (a reasoning aid, never a Constitution change). */
export function saveReasoning(query: ReasoningQuery): void {
  setState({ ...state, reasonings: [query, ...state.reasonings] });
}

/** Replace a reasoning query with a re-run version (history already appended). */
export function updateReasoning(query: ReasoningQuery): void {
  setState({ ...state, reasonings: state.reasonings.map((q) => (q.id === query.id ? query : q)) });
}

function patchReasoning(reasoningId: string, patch: (q: ReasoningQuery) => ReasoningQuery): void {
  setState({ ...state, reasonings: state.reasonings.map((q) => (q.id === reasoningId ? patch(q) : q)) });
}

/** Append a human judgment on one reasoning finding (append-only). */
export function judgeReasoningInsight(
  reasoningId: string,
  insightRef: string,
  decision: ComparisonDecision,
  note?: string,
): void {
  const at = now();
  patchReasoning(reasoningId, (q) => ({
    ...q,
    judgments: [...q.judgments, { insightRef, decision, at, ...(note ? { note } : {}) }],
    updatedAt: at,
  }));
}

export function setReasoningConclusion(reasoningId: string, text: string, status: ReasoningStatus = "provisional"): void {
  patchReasoning(reasoningId, (q) => ({ ...q, provisionalConclusion: text.trim() || undefined, status, updatedAt: now() }));
}

export function setReasoningStatus(reasoningId: string, status: ReasoningStatus): void {
  patchReasoning(reasoningId, (q) => ({ ...q, status, updatedAt: now() }));
}

/** Attach a reasoning result to a Megathread (adds a note + logs a revision). */
export function attachReasoningToThread(reasoningId: string, threadId: string): void {
  const q = state.reasonings.find((x) => x.id === reasoningId);
  if (!q) return;
  const at = now();
  const note = `Reasoning attached: ${q.question || q.mode}`;
  setState({
    ...state,
    megathreads: state.megathreads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            notes: [t.notes, note].filter(Boolean).join("\n"),
            revisions: [...t.revisions, { at, note }],
            updatedAt: at,
          }
        : t,
    ),
  });
}

export function reasoningById(s: StoreState, reasoningId: string): ReasoningQuery | undefined {
  return s.reasonings.find((q) => q.id === reasoningId);
}

// ---------- Decision intelligence actions (LIFEOS-016) ----------

/** Create a decision shell. LifeOS never chooses; the user builds and decides. */
export function createDecision(fields: {
  title: string;
  question: string;
  seedRefs?: string[];
  sensitive?: string;
}): string {
  const at = now();
  const decision: Decision = {
    id: id(),
    title: fields.title.trim() || "Untitled decision",
    question: fields.question.trim(),
    status: "exploring",
    options: [],
    criteria: [],
    ratings: {},
    constraints: [],
    assumptions: [],
    seedRefs: fields.seedRefs ?? [],
    evidence: [],
    history: [],
    judgments: [],
    revisions: [{ at, note: "Decision created" }],
    outcomeReviews: [],
    sensitive: fields.sensitive,
    aiModel: "mock",
    source: "mock",
    coverage: null,
    partial: false,
    verified: false,
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, decisions: [decision, ...state.decisions] });
  return decision.id;
}

function patchDecision(decisionId: string, patch: (d: Decision) => Decision, logNote?: string): void {
  const at = now();
  setState({
    ...state,
    decisions: state.decisions.map((d) => {
      if (d.id !== decisionId) return d;
      const next = patch(d);
      return {
        ...next,
        updatedAt: at,
        revisions: logNote ? [...d.revisions, { at, note: logNote }] : next.revisions,
      };
    }),
  });
}

export function setDecisionFields(
  decisionId: string,
  fields: Partial<Pick<Decision, "title" | "question" | "constraints" | "assumptions" | "rationale" | "userConfidence" | "sensitive">>,
): void {
  patchDecision(decisionId, (d) => ({ ...d, ...fields }));
}

export function setDecisionStatus(decisionId: string, status: DecisionStatus): void {
  patchDecision(decisionId, (d) => ({ ...d, status }), `Marked ${status}`);
}

export function upsertDecisionOption(decisionId: string, option: DecisionOption): void {
  patchDecision(decisionId, (d) => {
    const exists = d.options.some((o) => o.id === option.id);
    return { ...d, options: exists ? d.options.map((o) => (o.id === option.id ? option : o)) : [...d.options, option] };
  });
}

export function removeDecisionOption(decisionId: string, optionId: string): void {
  patchDecision(decisionId, (d) => {
    const ratings = { ...d.ratings };
    delete ratings[optionId];
    return {
      ...d,
      options: d.options.filter((o) => o.id !== optionId),
      ratings,
      provisionalChoice: d.provisionalChoice === optionId ? undefined : d.provisionalChoice,
      finalChoice: d.finalChoice === optionId ? undefined : d.finalChoice,
    };
  });
}

export function upsertDecisionCriterion(decisionId: string, criterion: DecisionCriterion): void {
  patchDecision(decisionId, (d) => {
    const exists = d.criteria.some((c) => c.id === criterion.id);
    return { ...d, criteria: exists ? d.criteria.map((c) => (c.id === criterion.id ? criterion : c)) : [...d.criteria, criterion] };
  });
}

export function removeDecisionCriterion(decisionId: string, criterionId: string): void {
  patchDecision(decisionId, (d) => {
    const ratings: Decision["ratings"] = {};
    for (const [oid, row] of Object.entries(d.ratings)) {
      const next = { ...row };
      delete next[criterionId];
      ratings[oid] = next;
    }
    return { ...d, criteria: d.criteria.filter((c) => c.id !== criterionId), ratings };
  });
}

/** Set one option×criterion rating (−2..+2). The user's judgment, not math truth. */
export function setDecisionRating(decisionId: string, optionId: string, criterionId: string, rating: number): void {
  patchDecision(decisionId, (d) => ({
    ...d,
    ratings: { ...d.ratings, [optionId]: { ...(d.ratings[optionId] ?? {}), [criterionId]: rating } },
  }));
}

/** Store a fresh analysis, preserving the prior one in append-only history. */
export function setDecisionAnalysis(
  decisionId: string,
  analysis: DecisionAnalysisResult,
  meta: {
    evidence: Decision["evidence"];
    source: "ai" | "mock";
    coverage: Decision["coverage"];
    partial: boolean;
    verified: boolean;
    fingerprint: Decision["fingerprint"];
    note?: string;
  },
): void {
  const hadAnalysis = Boolean(state.decisions.find((d) => d.id === decisionId)?.analysis);
  patchDecision(
    decisionId,
    (d) => ({
      ...d,
      analysis,
      analysisSource: meta.source,
      evidence: meta.evidence,
      source: meta.source,
      aiModel: meta.source === "ai" ? (process.env.NEXT_PUBLIC_ANTHROPIC_MODEL ?? "anthropic") : "mock",
      coverage: meta.coverage,
      partial: meta.partial,
      verified: meta.verified,
      fingerprint: meta.fingerprint,
      history: d.analysis
        ? [...d.history, { at: d.updatedAt, analysis: d.analysis, source: d.analysisSource ?? d.source, note: meta.note }]
        : d.history,
    }),
    hadAnalysis ? "Analysis regenerated" : "Analysis generated",
  );
}

export function setProvisionalChoice(decisionId: string, optionId: string | undefined): void {
  patchDecision(decisionId, (d) => ({ ...d, provisionalChoice: optionId }), optionId ? "Provisional choice saved" : "Provisional choice cleared");
}

/** The FINAL choice — only ever via this explicit user action. */
export function setFinalChoice(
  decisionId: string,
  optionId: string,
  rationale: string,
  confidence: UserConfidence,
): void {
  patchDecision(
    decisionId,
    (d) => ({ ...d, finalChoice: optionId, rationale: rationale.trim() || d.rationale, userConfidence: confidence, status: "decided" }),
    "Final choice made by you",
  );
}

/** Reopen a decided/deferred/abandoned decision — nothing is lost. */
export function reopenDecision(decisionId: string): void {
  patchDecision(decisionId, (d) => ({ ...d, status: "exploring" }), "Reopened");
}

/** Append a reflective outcome review (never a score). */
export function addOutcomeReview(decisionId: string, review: OutcomeReview): void {
  patchDecision(decisionId, (d) => ({ ...d, outcomeReviews: [...d.outcomeReviews, review] }), "Outcome review added");
}

export function judgeDecisionInsight(
  decisionId: string,
  insightRef: string,
  decision: ComparisonDecision,
  note?: string,
): void {
  const at = now();
  patchDecision(decisionId, (d) => ({
    ...d,
    judgments: [...d.judgments, { insightRef, decision, at, ...(note ? { note } : {}) }],
  }));
}

/** Attach a decision to a Megathread (adds a note + logs a thread revision). */
export function attachDecisionToThread(decisionId: string, threadId: string): void {
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d) return;
  const at = now();
  const note = `Decision attached: ${d.title}`;
  setState({
    ...state,
    megathreads: state.megathreads.map((t) =>
      t.id === threadId
        ? { ...t, notes: [t.notes, note].filter(Boolean).join("\n"), revisions: [...t.revisions, { at, note }], updatedAt: at }
        : t,
    ),
  });
}

export function decisionById(s: StoreState, decisionId: string): Decision | undefined {
  return s.decisions.find((d) => d.id === decisionId);
}

// ---------- Reflective practice & formation actions (LIFEOS-017) ----------

/** Create a reflection session. LifeOS asks and clarifies; the user reflects and decides. */
export function createFormationSession(fields: {
  title: string;
  type: FormationSessionType;
  customType?: string;
  prompt: string;
  suggestedPrompts?: string[];
  seedRefs?: string[];
  linkedBeliefs?: string[];
  linkedDecisions?: string[];
  linkedThreads?: string[];
  linkedInquiries?: string[];
  linkedSources?: string[];
  linkedPractices?: string[];
  linkedReflections?: string[];
  sensitive?: string;
}): string {
  const at = now();
  const session: FormationSession = {
    id: id(),
    createdAt: at,
    updatedAt: at,
    title: fields.title.trim() || "Untitled reflection",
    type: fields.type,
    customType: fields.customType?.trim() || undefined,
    prompt: fields.prompt.trim(),
    suggestedPrompts: fields.suggestedPrompts ?? [],
    reflection: "",
    linkedDecisions: fields.linkedDecisions ?? [],
    linkedBeliefs: fields.linkedBeliefs ?? [],
    linkedPractices: fields.linkedPractices ?? [],
    linkedThreads: fields.linkedThreads ?? [],
    linkedInquiries: fields.linkedInquiries ?? [],
    linkedSources: fields.linkedSources ?? [],
    linkedReflections: fields.linkedReflections ?? [],
    seedRefs: fields.seedRefs ?? [],
    lessons: [],
    unresolvedQuestions: [],
    emotionalObservations: [],
    revisedAssumptions: [],
    beliefCandidates: [],
    followUpReflections: [],
    evidence: [],
    history: [],
    judgments: [],
    status: "draft",
    sensitive: fields.sensitive,
    aiModel: "mock",
    source: "mock",
    coverage: null,
    partial: false,
    verified: false,
  };
  setState({ ...state, formationSessions: [session, ...state.formationSessions] });
  return session.id;
}

function patchFormation(sessionId: string, patch: (f: FormationSession) => FormationSession): void {
  setState({
    ...state,
    formationSessions: state.formationSessions.map((f) =>
      f.id === sessionId ? { ...patch(f), updatedAt: now() } : f,
    ),
  });
}

/**
 * Write the reflection. Immutable once set — a non-empty reflection is never
 * silently overwritten (mirrors the append-only spirit of the rest of LifeOS).
 * Later thinking goes into follow-up reflections or a new session.
 */
export function setFormationReflection(sessionId: string, text: string): boolean {
  const s = state.formationSessions.find((f) => f.id === sessionId);
  if (!s || s.reflection.trim().length > 0) return false;
  const body = text.trim();
  if (!body) return false;
  patchFormation(sessionId, (f) => ({ ...f, reflection: body, status: "reflecting" }));
  return true;
}

/** Edit a session's structured capture arrays + title/prompt (not the reflection). */
export function setFormationFields(
  sessionId: string,
  fields: Partial<Pick<FormationSession,
    | "title" | "prompt" | "lessons" | "unresolvedQuestions" | "emotionalObservations"
    | "revisedAssumptions" | "beliefCandidates" | "followUpReflections" | "sensitive" | "customType">>,
): void {
  patchFormation(sessionId, (f) => ({ ...f, ...fields }));
}

export function setFormationStatus(sessionId: string, status: FormationSessionStatus): void {
  patchFormation(sessionId, (f) => ({ ...f, status }));
}

/** Add/remove an explicit link to another record. Deduped. */
export function toggleFormationLink(
  sessionId: string,
  field: "linkedDecisions" | "linkedBeliefs" | "linkedPractices" | "linkedThreads" | "linkedInquiries" | "linkedSources" | "linkedReflections",
  recordId: string,
): void {
  patchFormation(sessionId, (f) => {
    const has = f[field].includes(recordId);
    return { ...f, [field]: has ? f[field].filter((x) => x !== recordId) : [...f[field], recordId] };
  });
}

/** Store a fresh synthesis, preserving the prior one in append-only history. */
export function setFormationSynthesis(
  sessionId: string,
  synthesis: FormationSynthesisData,
  meta: {
    evidence: FormationSession["evidence"];
    source: "ai" | "mock";
    coverage: FormationSession["coverage"];
    partial: boolean;
    fingerprint: FormationSession["fingerprint"];
    note?: string;
  },
): void {
  patchFormation(sessionId, (f) => ({
    ...f,
    synthesis,
    synthesisSource: meta.source,
    evidence: meta.evidence,
    source: meta.source,
    aiModel: meta.source === "ai" ? (process.env.NEXT_PUBLIC_ANTHROPIC_MODEL ?? "anthropic") : "mock",
    coverage: meta.coverage,
    partial: meta.partial,
    status: f.status === "closed" ? "closed" : "synthesized",
    fingerprint: meta.fingerprint,
    history: f.synthesis
      ? [...f.history, { at: f.updatedAt, synthesis: f.synthesis, source: f.synthesisSource ?? f.source, note: meta.note }]
      : f.history,
  }));
}

/** Append a human verdict on one synthesis insight (append-only). */
export function judgeFormationInsight(
  sessionId: string,
  insightRef: string,
  decision: ComparisonDecision,
  note?: string,
): void {
  const at = now();
  patchFormation(sessionId, (f) => ({
    ...f,
    judgments: [...f.judgments, { insightRef, decision, at, ...(note ? { note } : {}) }],
  }));
}

/** Attach a reflection to a Megathread (adds a note + logs a thread revision). */
export function attachFormationToThread(sessionId: string, threadId: string): void {
  const s = state.formationSessions.find((x) => x.id === sessionId);
  if (!s) return;
  const at = now();
  const note = `Reflection attached: ${s.title}`;
  setState({
    ...state,
    megathreads: state.megathreads.map((t) =>
      t.id === threadId
        ? { ...t, notes: [t.notes, note].filter(Boolean).join("\n"), revisions: [...t.revisions, { at, note }], updatedAt: at }
        : t,
    ),
    formationSessions: state.formationSessions.map((f) =>
      f.id === sessionId && !f.linkedThreads.includes(threadId)
        ? { ...f, linkedThreads: [...f.linkedThreads, threadId], updatedAt: at }
        : f,
    ),
  });
}

export function formationSessionById(s: StoreState, sessionId: string): FormationSession | undefined {
  return s.formationSessions.find((f) => f.id === sessionId);
}

// ---------- Worldview & concept graph actions (LIFEOS-018) ----------

/** Create a concept. AI/deterministic proposals only become concepts via this explicit path. */
export function createConcept(fields: {
  name: string;
  definition?: string;
  description?: string;
  aliases?: string[];
  relatedBeliefs?: string[];
  relatedThreads?: string[];
  relatedSources?: string[];
  relatedPractices?: string[];
  source?: Concept["source"];
}): string {
  const at = now();
  const concept: Concept = {
    id: id(),
    name: fields.name.trim() || "Untitled concept",
    aliases: fields.aliases ?? [],
    definition: fields.definition?.trim() ?? "",
    description: fields.description?.trim() ?? "",
    relatedBeliefs: fields.relatedBeliefs ?? [],
    relatedThreads: fields.relatedThreads ?? [],
    relatedSources: fields.relatedSources ?? [],
    relatedPractices: fields.relatedPractices ?? [],
    parentConcepts: [],
    childConcepts: [],
    relatedConcepts: [],
    opposingConcepts: [],
    principleIds: [],
    questions: [],
    history: [{ at, kind: "created", note: "Concept created" }],
    status: "active",
    source: fields.source ?? "user",
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, concepts: [concept, ...state.concepts] });
  return concept.id;
}

function patchConcept(conceptId: string, patch: (c: Concept) => Concept, log?: Concept["history"][number]): void {
  const at = now();
  setState({
    ...state,
    concepts: state.concepts.map((c) => {
      if (c.id !== conceptId) return c;
      const next = patch(c);
      return { ...next, updatedAt: at, history: log ? [...c.history, { ...log, at }] : next.history };
    }),
  });
}

export function setConceptFields(
  conceptId: string,
  fields: Partial<Pick<Concept, "name" | "aliases" | "definition" | "description" | "questions">>,
): void {
  const changedDef = fields.definition !== undefined;
  patchConcept(
    conceptId,
    (c) => ({ ...c, ...fields }),
    changedDef ? { at: "", kind: "definition", note: "Definition revised" } : { at: "", kind: "note", note: "Edited" },
  );
}

export function setConceptStatus(conceptId: string, status: ConceptStatus): void {
  patchConcept(conceptId, (c) => ({ ...c, status }), { at: "", kind: "status", note: `Marked ${status}` });
}

/** Add/remove a cross-type link (belief/thread/source/practice). Deduped. */
export function toggleConceptLink(
  conceptId: string,
  field: "relatedBeliefs" | "relatedThreads" | "relatedSources" | "relatedPractices",
  recordId: string,
): void {
  patchConcept(
    conceptId,
    (c) => {
      const has = c[field].includes(recordId);
      return { ...c, [field]: has ? c[field].filter((x) => x !== recordId) : [...c[field], recordId] };
    },
    { at: "", kind: "link", note: "Link updated" },
  );
}

/** Record that the user has reviewed the concept — sets a fresh evidence fingerprint. */
export function markConceptReviewed(conceptId: string): void {
  const c = state.concepts.find((x) => x.id === conceptId);
  if (!c) return;
  patchConcept(conceptId, (cc) => ({ ...cc, fingerprint: makeFingerprint(state, conceptDeps(cc)) }));
}

/** Attach a principle to a concept (both sides), or detach. */
export function toggleConceptPrinciple(conceptId: string, principleId: string): void {
  const c = state.concepts.find((x) => x.id === conceptId);
  if (!c) return;
  const has = c.principleIds.includes(principleId);
  setState({
    ...state,
    concepts: state.concepts.map((x) =>
      x.id === conceptId
        ? { ...x, principleIds: has ? x.principleIds.filter((p) => p !== principleId) : [...x.principleIds, principleId], updatedAt: now(), history: [...x.history, { at: now(), kind: "principle", note: has ? "Principle detached" : "Principle attached" }] }
        : x,
    ),
    principles: state.principles.map((p) =>
      p.id === principleId
        ? { ...p, conceptIds: has ? p.conceptIds.filter((cid) => cid !== conceptId) : [...new Set([...p.conceptIds, conceptId])], updatedAt: now() }
        : p,
    ),
  });
}

export function conceptById(s: StoreState, conceptId: string): Concept | undefined {
  return s.concepts.find((c) => c.id === conceptId);
}

// ---- relationships (proposed → human-approved) ----

/** Propose a relationship. It is NOT part of the graph until a human approves. */
export function proposeConceptRelationship(fields: {
  fromConceptId: string;
  toConceptId: string;
  type: ConceptRelationshipType;
  reason: string;
  citations?: string[];
  confidence?: RelationshipConfidence;
  source?: ConceptRelationship["source"];
  approved?: boolean;
}): string {
  const at = now();
  const rel: ConceptRelationship = {
    id: id(),
    fromConceptId: fields.fromConceptId,
    toConceptId: fields.toConceptId,
    type: fields.type,
    reason: fields.reason.trim(),
    citations: fields.citations ?? [],
    confidence: fields.confidence ?? "medium",
    source: fields.source ?? "user",
    approved: false,
    createdAt: at,
    updatedAt: at,
    history: [{ at, note: "Proposed" }],
  };
  setState({ ...state, conceptRelationships: [rel, ...state.conceptRelationships] });
  // A user-created relationship marked approved is approved immediately.
  if (fields.approved) approveConceptRelationship(rel.id);
  return rel.id;
}

/** Write a relationship's structural mapping onto both concepts (add or remove). */
function applyStructural(rel: ConceptRelationship, add: boolean): void {
  const { fromSlot, toSlot } = structuralMapping(rel.type);
  const fromField = slotField(fromSlot);
  const toField = slotField(toSlot);
  setState({
    ...state,
    concepts: state.concepts.map((c) => {
      if (c.id === rel.fromConceptId) {
        const cur = c[fromField];
        const next = add ? [...new Set([...cur, rel.toConceptId])] : cur.filter((x) => x !== rel.toConceptId);
        return { ...c, [fromField]: next, updatedAt: now(), history: [...c.history, { at: now(), kind: "relationship", note: `${add ? "Linked" : "Unlinked"} (${rel.type})` }] };
      }
      if (c.id === rel.toConceptId) {
        const cur = c[toField];
        const next = add ? [...new Set([...cur, rel.fromConceptId])] : cur.filter((x) => x !== rel.fromConceptId);
        return { ...c, [toField]: next, updatedAt: now() };
      }
      return c;
    }),
  });
}

/** Approve a proposed relationship — the ONLY way an edge enters the graph. */
export function approveConceptRelationship(relId: string): void {
  const rel = state.conceptRelationships.find((r) => r.id === relId);
  if (!rel || rel.approved) return;
  const at = now();
  setState({
    ...state,
    conceptRelationships: state.conceptRelationships.map((r) =>
      r.id === relId ? { ...r, approved: true, updatedAt: at, history: [...r.history, { at, note: "Approved by you" }] } : r,
    ),
  });
  applyStructural({ ...rel, approved: true }, true);
}

export function editConceptRelationship(
  relId: string,
  fields: Partial<Pick<ConceptRelationship, "type" | "reason" | "confidence" | "citations">>,
): void {
  setState({
    ...state,
    conceptRelationships: state.conceptRelationships.map((r) =>
      r.id === relId ? { ...r, ...fields, updatedAt: now(), history: [...r.history, { at: now(), note: "Edited" }] } : r,
    ),
  });
}

/** Remove a relationship. If it was approved, also unwind its structural mapping. */
export function removeConceptRelationship(relId: string): void {
  const rel = state.conceptRelationships.find((r) => r.id === relId);
  if (!rel) return;
  if (rel.approved) applyStructural(rel, false);
  setState({ ...state, conceptRelationships: state.conceptRelationships.filter((r) => r.id !== relId) });
}

export function relationshipById(s: StoreState, relId: string): ConceptRelationship | undefined {
  return s.conceptRelationships.find((r) => r.id === relId);
}

// ---- principles ----

export function createPrinciple(fields: {
  statement: string;
  description?: string;
  conceptIds?: string[];
  beliefIds?: string[];
  citations?: string[];
  source?: Principle["source"];
}): string {
  const at = now();
  const principle: Principle = {
    id: id(),
    statement: fields.statement.trim(),
    description: fields.description?.trim() || undefined,
    conceptIds: fields.conceptIds ?? [],
    beliefIds: fields.beliefIds ?? [],
    citations: fields.citations ?? [],
    status: "active",
    history: [{ at, note: "Principle created" }],
    source: fields.source ?? "user",
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, principles: [principle, ...state.principles] });
  return principle.id;
}

function patchPrinciple(principleId: string, patch: (p: Principle) => Principle, note?: string): void {
  const at = now();
  setState({
    ...state,
    principles: state.principles.map((p) =>
      p.id === principleId ? { ...patch(p), updatedAt: at, history: note ? [...p.history, { at, note }] : patch(p).history } : p,
    ),
  });
}

export function setPrincipleFields(principleId: string, fields: Partial<Pick<Principle, "statement" | "description" | "status">>): void {
  patchPrinciple(principleId, (p) => ({ ...p, ...fields }), "Edited");
}

/** Toggle a belief that derives from this principle (many-to-many). */
export function togglePrincipleBelief(principleId: string, beliefId: string): void {
  patchPrinciple(principleId, (p) => {
    const has = p.beliefIds.includes(beliefId);
    return { ...p, beliefIds: has ? p.beliefIds.filter((b) => b !== beliefId) : [...p.beliefIds, beliefId] };
  }, "Belief link updated");
}

export function principleById(s: StoreState, principleId: string): Principle | undefined {
  return s.principles.find((p) => p.id === principleId);
}

// ---- frameworks (organize, never own beliefs) ----

export function createFramework(fields: {
  name: string;
  kind: FrameworkKind;
  description?: string;
  conceptIds?: string[];
  principleIds?: string[];
  source?: Framework["source"];
}): string {
  const at = now();
  const framework: Framework = {
    id: id(),
    name: fields.name.trim() || "Untitled framework",
    kind: fields.kind,
    description: fields.description?.trim() ?? "",
    conceptIds: fields.conceptIds ?? [],
    principleIds: fields.principleIds ?? [],
    status: "active",
    history: [{ at, note: `${fields.kind} created` }],
    source: fields.source ?? "user",
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, frameworks: [framework, ...state.frameworks] });
  return framework.id;
}

function patchFramework(frameworkId: string, patch: (f: Framework) => Framework, note?: string): void {
  const at = now();
  setState({
    ...state,
    frameworks: state.frameworks.map((f) =>
      f.id === frameworkId ? { ...patch(f), updatedAt: at, history: note ? [...f.history, { at, note }] : patch(f).history } : f,
    ),
  });
}

export function setFrameworkFields(frameworkId: string, fields: Partial<Pick<Framework, "name" | "description" | "status">>): void {
  patchFramework(frameworkId, (f) => ({ ...f, ...fields }), "Edited");
}

/** Add/remove a concept from a framework (append-only membership history). */
export function toggleFrameworkConcept(frameworkId: string, conceptId: string): void {
  patchFramework(frameworkId, (f) => {
    const has = f.conceptIds.includes(conceptId);
    return { ...f, conceptIds: has ? f.conceptIds.filter((c) => c !== conceptId) : [...f.conceptIds, conceptId] };
  }, "Concept membership changed");
}

export function toggleFrameworkPrinciple(frameworkId: string, principleId: string): void {
  patchFramework(frameworkId, (f) => {
    const has = f.principleIds.includes(principleId);
    return { ...f, principleIds: has ? f.principleIds.filter((p) => p !== principleId) : [...f.principleIds, principleId] };
  }, "Principle membership changed");
}

export function frameworkById(s: StoreState, frameworkId: string): Framework | undefined {
  return s.frameworks.find((f) => f.id === frameworkId);
}

// ---------- Knowledge authoring actions (LIFEOS-019) ----------

/** Create an authoring project. Evidence-first and human-directed. */
export function createKnowledgeProject(fields: {
  title: string;
  kind: ProjectKind;
  description?: string;
  purpose?: string;
  audience?: string;
  assembly?: Partial<ProjectAssembly>;
}): string {
  const at = now();
  const project: KnowledgeProject = {
    id: id(),
    title: fields.title.trim() || "Untitled project",
    description: fields.description?.trim() ?? "",
    purpose: fields.purpose?.trim() ?? "",
    audience: fields.audience?.trim() ?? "",
    kind: fields.kind,
    status: "planning",
    assembly: { ...emptyAssembly(), ...fields.assembly },
    outlineOptions: [],
    sections: [],
    history: [{ at, note: "Project created", source: "human" }],
    aiModel: "mock",
    source: "mock",
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, knowledgeProjects: [project, ...state.knowledgeProjects] });
  return project.id;
}

function patchProject(projectId: string, patch: (p: KnowledgeProject) => KnowledgeProject, log?: { note: string; source: "human" | "ai" | "mock" }): void {
  const at = now();
  setState({
    ...state,
    knowledgeProjects: state.knowledgeProjects.map((p) => {
      if (p.id !== projectId) return p;
      const next = patch(p);
      return { ...next, updatedAt: at, history: log ? [...p.history, { at, ...log }] : next.history };
    }),
  });
}

export function setProjectFields(
  projectId: string,
  fields: Partial<Pick<KnowledgeProject, "title" | "description" | "purpose" | "audience" | "kind" | "status">>,
): void {
  patchProject(projectId, (p) => ({ ...p, ...fields }));
}

/** Add/remove a record from the project's assembled evidence. */
export function toggleProjectEvidence(projectId: string, field: keyof ProjectAssembly, recordId: string): void {
  patchProject(projectId, (p) => {
    const has = p.assembly[field].includes(recordId);
    return { ...p, assembly: { ...p.assembly, [field]: has ? p.assembly[field].filter((x) => x !== recordId) : [...p.assembly[field], recordId] } };
  });
}

/** Store generated outline candidates (Phase 4). */
export function setProjectOutlines(projectId: string, options: OutlineOption[], source: "ai" | "mock"): void {
  patchProject(projectId, (p) => ({ ...p, outlineOptions: options, status: p.status === "planning" ? "outlining" : p.status }), { note: `Generated ${options.length} outline${options.length === 1 ? "" : "s"}`, source });
}

/** Choose an outline — builds empty sections from it (does not overwrite existing sections). */
export function chooseProjectOutline(projectId: string, outlineId: string): void {
  patchProject(
    projectId,
    (p) => {
      const outline = p.outlineOptions.find((o) => o.id === outlineId);
      if (!outline) return p;
      const sections: DraftSection[] = p.sections.length
        ? p.sections
        : outline.sections.map((s, i) => ({
            id: id(),
            heading: s.heading,
            purpose: s.purpose,
            order: i,
            paragraphs: [],
            versions: [],
            source: "empty" as const,
            updatedAt: now(),
          }));
      return { ...p, chosenOutlineId: outlineId, sections, status: "drafting" };
    },
    { note: "Outline chosen", source: "human" },
  );
}

/** Add a blank section to the end. */
export function addProjectSection(projectId: string, heading: string, purpose?: string): void {
  patchProject(projectId, (p) => ({
    ...p,
    sections: [...p.sections, { id: id(), heading: heading.trim() || "New section", purpose, order: p.sections.length, paragraphs: [], versions: [], source: "empty", updatedAt: now() }],
  }));
}

export function setSectionHeading(projectId: string, sectionId: string, heading: string): void {
  patchProject(projectId, (p) => ({ ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, heading: heading.trim() || s.heading, updatedAt: now() } : s)) }));
}

export function removeProjectSection(projectId: string, sectionId: string): void {
  patchProject(projectId, (p) => ({ ...p, sections: p.sections.filter((s) => s.id !== sectionId).map((s, i) => ({ ...s, order: i })) }));
}

/**
 * Replace a section's paragraphs with a fresh draft, pushing the prior version
 * into append-only history. Never discards earlier text.
 */
export function setSectionDraft(
  projectId: string,
  sectionId: string,
  paragraphs: DraftParagraph[],
  source: "ai" | "mock" | "human",
  fingerprint?: DraftSection["fingerprint"],
  note?: string,
): void {
  patchProject(
    projectId,
    (p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const versions = s.paragraphs.length
          ? [...s.versions, { at: s.updatedAt, paragraphs: s.paragraphs, source: (s.source === "empty" ? "human" : s.source) as "human" | "ai" | "mock", note }]
          : s.versions;
        return { ...s, paragraphs, versions, source, updatedAt: now(), fingerprint: fingerprint ?? s.fingerprint };
      }),
    }),
    { note: `Drafted “${state.knowledgeProjects.find((x) => x.id === projectId)?.sections.find((s) => s.id === sectionId)?.heading ?? "section"}”`, source },
  );
}

/** Edit one paragraph's text/citations (a human edit — versioned on next draft). */
export function editSectionParagraph(projectId: string, sectionId: string, paragraphId: string, fields: Partial<Pick<DraftParagraph, "text" | "citations">>): void {
  patchProject(projectId, (p) => ({
    ...p,
    sections: p.sections.map((s) =>
      s.id === sectionId
        ? { ...s, paragraphs: s.paragraphs.map((pg) => (pg.id === paragraphId ? { ...pg, ...fields } : pg)), source: "human", updatedAt: now() }
        : s,
    ),
  }));
}

/** Remove an (e.g. unsupported) paragraph. */
export function removeSectionParagraph(projectId: string, sectionId: string, paragraphId: string): void {
  patchProject(projectId, (p) => ({
    ...p,
    sections: p.sections.map((s) => (s.id === sectionId ? { ...s, paragraphs: s.paragraphs.filter((pg) => pg.id !== paragraphId), updatedAt: now() } : s)),
  }));
}

/** Record a fresh evidence fingerprint for the whole project. */
export function markProjectReviewed(projectId: string): void {
  const p = state.knowledgeProjects.find((x) => x.id === projectId);
  if (!p) return;
  patchProject(projectId, (pp) => ({ ...pp, fingerprint: makeFingerprint(state, projectDeps(pp)) }));
}

export function knowledgeProjectById(s: StoreState, projectId: string): KnowledgeProject | undefined {
  return s.knowledgeProjects.find((p) => p.id === projectId);
}

// ---------- Research workspace actions (LIFEOS-020) ----------

function emptyQuestionSet(): ResearchQuestionSet {
  return { subquestions: [], unknowns: [], assumptions: [], definitions: [], successCriteria: [], openProblems: [] };
}

/** Create a research project. Evidence-first, deterministic-first, human-directed. */
export function createResearchProject(fields: {
  title: string;
  question: string;
  description?: string;
  purpose?: string;
  scope?: string;
  assembly?: Partial<ProjectAssembly>;
}): string {
  const at = now();
  const project: ResearchProject = {
    id: id(),
    title: fields.title.trim() || "Untitled research",
    question: fields.question.trim(),
    description: fields.description?.trim() ?? "",
    purpose: fields.purpose?.trim() ?? "",
    scope: fields.scope?.trim() ?? "",
    status: "open",
    questions: emptyQuestionSet(),
    assembly: { ...emptyAssembly(), ...fields.assembly },
    notes: [],
    hypotheses: [],
    argumentNodes: [],
    argumentEdges: [],
    history: [{ at, note: "Research project created" }],
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, researchProjects: [project, ...state.researchProjects] });
  return project.id;
}

function patchResearch(projectId: string, patch: (p: ResearchProject) => ResearchProject, note?: string): void {
  const at = now();
  setState({
    ...state,
    researchProjects: state.researchProjects.map((p) => {
      if (p.id !== projectId) return p;
      const next = patch(p);
      return { ...next, updatedAt: at, history: note ? [...p.history, { at, note }] : next.history };
    }),
  });
}

export function setResearchFields(
  projectId: string,
  fields: Partial<Pick<ResearchProject, "title" | "question" | "description" | "purpose" | "scope" | "status">>,
): void {
  patchResearch(projectId, (p) => ({ ...p, ...fields }));
}

/** The ResearchItem-array fields of the question set. */
type ItemField = "subquestions" | "unknowns" | "assumptions" | "successCriteria" | "openProblems";

export function addResearchItem(projectId: string, field: ItemField, text: string): void {
  const t = text.trim();
  if (!t) return;
  const at = now();
  patchResearch(projectId, (p) => ({
    ...p,
    questions: { ...p.questions, [field]: [...p.questions[field], { id: id(), text: t, resolved: false, history: [{ at, note: "Added" }], createdAt: at }] },
  }), `Added ${field.replace(/s$/, "")}`);
}

export function editResearchItem(projectId: string, field: ItemField, itemId: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  const at = now();
  patchResearch(projectId, (p) => ({
    ...p,
    questions: { ...p.questions, [field]: p.questions[field].map((it) => (it.id === itemId ? { ...it, text: t, history: [...it.history, { at, note: "Revised" }] } : it)) },
  }));
}

export function toggleResearchItemResolved(projectId: string, field: ItemField, itemId: string): void {
  const at = now();
  patchResearch(projectId, (p) => ({
    ...p,
    questions: { ...p.questions, [field]: p.questions[field].map((it) => (it.id === itemId ? { ...it, resolved: !it.resolved, history: [...it.history, { at, note: it.resolved ? "Reopened" : "Marked resolved" }] } : it)) },
  }));
}

export function removeResearchItem(projectId: string, field: ItemField, itemId: string): void {
  patchResearch(projectId, (p) => ({ ...p, questions: { ...p.questions, [field]: p.questions[field].filter((it) => it.id !== itemId) } }));
}

export function addResearchDefinition(projectId: string, term: string, definition: string): void {
  const t = term.trim();
  if (!t) return;
  const at = now();
  patchResearch(projectId, (p) => ({
    ...p,
    questions: { ...p.questions, definitions: [...p.questions.definitions, { id: id(), term: t, definition: definition.trim(), history: [{ at, note: "Added" }], createdAt: at }] },
  }), "Added definition");
}

export function removeResearchDefinition(projectId: string, defId: string): void {
  patchResearch(projectId, (p) => ({ ...p, questions: { ...p.questions, definitions: p.questions.definitions.filter((d) => d.id !== defId) } }));
}

export function addResearchNote(projectId: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  patchResearch(projectId, (p) => ({ ...p, notes: [{ id: id(), text: t, createdAt: now() }, ...p.notes] }), "Added note");
}

export function removeResearchNote(projectId: string, noteId: string): void {
  patchResearch(projectId, (p) => ({ ...p, notes: p.notes.filter((n) => n.id !== noteId) }));
}

/** Add/remove a record from the research evidence workspace (reuses ProjectAssembly). */
export function toggleResearchEvidence(projectId: string, field: keyof ProjectAssembly, recordId: string): void {
  patchResearch(projectId, (p) => {
    const has = p.assembly[field].includes(recordId);
    return { ...p, assembly: { ...p.assembly, [field]: has ? p.assembly[field].filter((x) => x !== recordId) : [...p.assembly[field], recordId] } };
  }, "Evidence updated");
}

// ---- hypotheses (multiple competing; never auto-selected) ----

export function addHypothesis(projectId: string, statement: string, confidence: UserConfidenceType = "low"): void {
  const s = statement.trim();
  if (!s) return;
  const at = now();
  patchResearch(projectId, (p) => ({
    ...p,
    hypotheses: [...p.hypotheses, { id: id(), statement: s, confidence, supportingEvidence: [], contradictingEvidence: [], openQuestions: [], status: "proposed", history: [{ at, note: "Proposed" }], createdAt: at, updatedAt: at }],
  }), "Hypothesis proposed");
}

function patchHypothesisIn(projectId: string, hid: string, patch: (h: Hypothesis) => Hypothesis, note?: string): void {
  const at = now();
  patchResearch(projectId, (p) => ({
    ...p,
    hypotheses: p.hypotheses.map((h) => (h.id === hid ? { ...patch(h), updatedAt: at, history: note ? [...h.history, { at, note }] : patch(h).history } : h)),
  }));
}

export function setHypothesisFields(projectId: string, hid: string, fields: Partial<Pick<Hypothesis, "statement" | "confidence" | "status">>): void {
  patchHypothesisIn(projectId, hid, (h) => ({ ...h, ...fields }), fields.status ? `Marked ${fields.status}` : "Edited");
}

export function toggleHypothesisEvidence(projectId: string, hid: string, side: "supporting" | "contradicting", recordId: string): void {
  patchHypothesisIn(projectId, hid, (h) => {
    const key = side === "supporting" ? "supportingEvidence" : "contradictingEvidence";
    const has = h[key].includes(recordId);
    return { ...h, [key]: has ? h[key].filter((x) => x !== recordId) : [...h[key], recordId] };
  }, `Evidence ${side} updated`);
}

export function setHypothesisOpenQuestions(projectId: string, hid: string, questions: string[]): void {
  patchHypothesisIn(projectId, hid, (h) => ({ ...h, openQuestions: questions.map((q) => q.trim()).filter(Boolean) }));
}

export function removeHypothesis(projectId: string, hid: string): void {
  patchResearch(projectId, (p) => ({ ...p, hypotheses: p.hypotheses.filter((h) => h.id !== hid) }));
}

// ---- argument map (every edge user-authored — nothing inferred) ----

export function addArgumentNode(projectId: string, kind: ArgumentNodeKind, text: string, recordId?: string): void {
  const t = text.trim();
  if (!t) return;
  const at = now();
  patchResearch(projectId, (p) => ({
    ...p,
    argumentNodes: [...p.argumentNodes, { id: id(), kind, text: t, recordId, history: [{ at, note: "Added" }], createdAt: at }],
  }), `Added ${kind.replace(/_/g, " ")}`);
}

export function removeArgumentNode(projectId: string, nodeId: string): void {
  patchResearch(projectId, (p) => ({
    ...p,
    argumentNodes: p.argumentNodes.filter((n) => n.id !== nodeId),
    argumentEdges: p.argumentEdges.filter((e) => e.fromId !== nodeId && e.toId !== nodeId),
  }));
}

export function addArgumentEdge(projectId: string, fromId: string, toId: string, kind: ArgumentEdgeKind, reason?: string): void {
  if (fromId === toId) return;
  patchResearch(projectId, (p) => {
    if (p.argumentEdges.some((e) => e.fromId === fromId && e.toId === toId && e.kind === kind)) return p;
    return { ...p, argumentEdges: [...p.argumentEdges, { id: id(), fromId, toId, kind, reason: reason?.trim() || undefined, createdAt: now() }] };
  }, "Argument link added");
}

export function removeArgumentEdge(projectId: string, edgeId: string): void {
  patchResearch(projectId, (p) => ({ ...p, argumentEdges: p.argumentEdges.filter((e) => e.id !== edgeId) }));
}

/** Record a fresh evidence fingerprint for the research project. */
export function markResearchReviewed(projectId: string): void {
  const p = state.researchProjects.find((x) => x.id === projectId);
  if (!p) return;
  patchResearch(projectId, (pp) => ({ ...pp, fingerprint: makeFingerprint(state, researchDeps(pp)) }));
}

/**
 * Seed the Authoring Engine from a research project (Phase 10). Creates a
 * KnowledgeProject that REFERENCES the same evidence (no content duplication)
 * and records the handoff on both sides.
 */
export function seedAuthorFromResearch(projectId: string, kind: ProjectKind = "essay"): string | undefined {
  const p = state.researchProjects.find((x) => x.id === projectId);
  if (!p) return undefined;
  const authorId = createKnowledgeProject({
    title: p.title,
    kind,
    description: p.description,
    purpose: p.purpose || `Write up the findings of the research: ${p.question}`,
    assembly: { ...p.assembly },
  });
  patchResearch(projectId, (pp) => ({ ...pp, seededProjectId: authorId }), "Seeded an authoring project");
  return authorId;
}

export function researchProjectById(s: StoreState, projectId: string): ResearchProject | undefined {
  return s.researchProjects.find((p) => p.id === projectId);
}

// ---------- Socratic dialogue actions (LIFEOS-022) ----------

/** Create a dialogue session. Not a chatbot: the user drives; nothing auto-answers. */
export function createDialogue(fields: {
  title: string;
  topic: string;
  purpose?: string;
  seedRefs?: string[];
  participants?: Perspective[];
}): string {
  const at = now();
  const session: DialogueSession = {
    id: id(),
    title: fields.title.trim() || fields.topic.trim().slice(0, 60) || "Untitled dialogue",
    topic: fields.topic.trim(),
    purpose: fields.purpose?.trim() ?? "",
    status: "open",
    participants: fields.participants ?? [],
    seedRefs: fields.seedRefs ?? [],
    turns: [],
    outcomes: [],
    history: [{ at, note: "Dialogue opened" }],
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, dialogueSessions: [session, ...state.dialogueSessions] });
  return session.id;
}

function patchDialogue(dialogueId: string, patch: (d: DialogueSession) => DialogueSession, note?: string): void {
  const at = now();
  setState({
    ...state,
    dialogueSessions: state.dialogueSessions.map((d) => {
      if (d.id !== dialogueId) return d;
      const next = patch(d);
      return { ...next, updatedAt: at, history: note ? [...d.history, { at, note }] : next.history };
    }),
  });
}

export function setDialogueFields(dialogueId: string, fields: Partial<Pick<DialogueSession, "title" | "topic" | "purpose" | "status">>): void {
  patchDialogue(dialogueId, (d) => ({ ...d, ...fields }));
}

/** Add a perspective (a viewpoint sourced from the user's own knowledge). */
export function addPerspective(dialogueId: string, kind: PerspectiveKind, label: string, refId?: string): void {
  const l = label.trim();
  if (!l) return;
  patchDialogue(dialogueId, (d) => (
    d.participants.some((p) => p.kind === kind && p.refId === refId && p.label === l)
      ? d
      : { ...d, participants: [...d.participants, { id: id(), kind, label: l, refId, createdAt: now() }] }
  ), `Added ${kind} perspective`);
}

export function removePerspective(dialogueId: string, perspectiveId: string): void {
  patchDialogue(dialogueId, (d) => ({ ...d, participants: d.participants.filter((p) => p.id !== perspectiveId) }));
}

/** Add a dialogue turn (with provenance). The user authors; the engine only prompts. */
export function addDialogueTurn(dialogueId: string, fields: {
  kind: DialogueTurnKind;
  text: string;
  author?: DialogueTurnAuthor;
  perspectiveId?: string;
  citations?: string[];
}): void {
  const t = fields.text.trim();
  if (!t) return;
  patchDialogue(dialogueId, (d) => ({
    ...d,
    status: d.status === "open" ? "active" : d.status,
    turns: [...d.turns, { id: id(), kind: fields.kind, text: t, author: fields.author ?? "you", perspectiveId: fields.perspectiveId, citations: fields.citations ?? [], flags: [], createdAt: now() }],
  }), `Added ${fields.kind}`);
}

export function toggleDialogueTurnFlag(dialogueId: string, turnId: string, flag: DialogueTurnFlag): void {
  patchDialogue(dialogueId, (d) => ({
    ...d,
    turns: d.turns.map((t) => (t.id === turnId ? { ...t, flags: t.flags.includes(flag) ? t.flags.filter((f) => f !== flag) : [...t.flags, flag] } : t)),
  }));
}

export function removeDialogueTurn(dialogueId: string, turnId: string): void {
  patchDialogue(dialogueId, (d) => ({ ...d, turns: d.turns.filter((t) => t.id !== turnId) }));
}

export function setDialogueStatus(dialogueId: string, status: DialogueStatus): void {
  patchDialogue(dialogueId, (d) => ({ ...d, status }), `Marked ${status}`);
}

export function markDialogueReviewed(dialogueId: string): void {
  const d = state.dialogueSessions.find((x) => x.id === dialogueId);
  if (!d) return;
  patchDialogue(dialogueId, (dd) => ({ ...dd, fingerprint: makeFingerprint(state, dialogueDeps(dd)) }));
}

/** Bucket a dialogue's evidence (seeds + citations + perspectives) into a ProjectAssembly. */
function dialogueAssembly(d: DialogueSession): ProjectAssembly {
  const ids = new Set<string>([
    ...d.seedRefs,
    ...d.turns.flatMap((t) => t.citations),
    ...d.participants.map((p) => p.refId).filter((x): x is string => Boolean(x)),
  ]);
  const a = emptyAssembly();
  for (const rid of ids) {
    if (state.sources.some((s) => s.id === rid)) a.sourceIds.push(rid);
    else if (state.beliefs.some((b) => b.id === rid)) a.beliefIds.push(rid);
    else if (state.concepts.some((c) => c.id === rid)) a.conceptIds.push(rid);
    else if (state.megathreads.some((t) => t.id === rid)) a.threadIds.push(rid);
    else if (state.reasonings.some((r) => r.id === rid)) a.reasoningIds.push(rid);
    else if (state.frameworks.some((f) => f.id === rid)) a.frameworkIds.push(rid);
    else if (state.principles.some((p) => p.id === rid)) a.principleIds.push(rid);
    else if (state.formationSessions.some((f) => f.id === rid)) a.formationIds.push(rid);
    else if (state.decisions.some((dd) => dd.id === rid)) a.decisionIds.push(rid);
  }
  return a;
}

function recordOutcome(dialogueId: string, kind: string, recordId: string, label: string): void {
  patchDialogue(dialogueId, (d) => ({ ...d, outcomes: [...d.outcomes, { at: now(), kind, recordId, label }] }), `Created ${kind}`);
}

/** Outcome (Phase 7): spawn a Research Project seeded from this dialogue's evidence. */
export function dialogueToResearch(dialogueId: string): string | undefined {
  const d = state.dialogueSessions.find((x) => x.id === dialogueId);
  if (!d) return undefined;
  const rid = createResearchProject({ title: d.title, question: d.topic || d.title, purpose: d.purpose, assembly: dialogueAssembly(d) });
  recordOutcome(dialogueId, "research project", rid, d.title);
  return rid;
}

/** Outcome: spawn a Knowledge (authoring) Project seeded from this dialogue's evidence. */
export function dialogueToKnowledge(dialogueId: string): string | undefined {
  const d = state.dialogueSessions.find((x) => x.id === dialogueId);
  if (!d) return undefined;
  const kid = createKnowledgeProject({ title: d.title, kind: "essay", purpose: d.purpose, assembly: dialogueAssembly(d) });
  recordOutcome(dialogueId, "knowledge project", kid, d.title);
  return kid;
}

/** Outcome: spawn a Decision framed by the dialogue's topic. */
export function dialogueToDecision(dialogueId: string): string | undefined {
  const d = state.dialogueSessions.find((x) => x.id === dialogueId);
  if (!d) return undefined;
  const did = createDecision({ title: d.title, question: d.topic || d.title, seedRefs: [...new Set(d.turns.flatMap((t) => t.citations))] });
  recordOutcome(dialogueId, "decision", did, d.title);
  return did;
}

/** Outcome: model a concept / principle / framework from the dialogue. */
export function dialogueToConcept(dialogueId: string, name: string): string | undefined {
  if (!name.trim()) return undefined;
  const cid = createConcept({ name, source: "user" });
  recordOutcome(dialogueId, "concept", cid, name.trim());
  return cid;
}
export function dialogueToPrinciple(dialogueId: string, statement: string): string | undefined {
  if (!statement.trim()) return undefined;
  const pid = createPrinciple({ statement, source: "user" });
  recordOutcome(dialogueId, "principle", pid, statement.trim().slice(0, 60));
  return pid;
}
export function dialogueToFramework(dialogueId: string, name: string): string | undefined {
  if (!name.trim()) return undefined;
  const fid = createFramework({ name, kind: "framework", source: "user" });
  recordOutcome(dialogueId, "framework", fid, name.trim());
  return fid;
}

/** Outcome: send a belief (or Constitution) proposal to the Inbox — never auto-added. */
export function dialogueToBeliefProposal(dialogueId: string, text: string, constitution = false): void {
  if (!text.trim()) return;
  sendToInbox(text.trim(), [{ claim: text.trim() }], "mock");
  recordOutcome(dialogueId, constitution ? "constitution proposal" : "belief proposal", "", text.trim().slice(0, 60));
}

export function dialogueById(s: StoreState, dialogueId: string): DialogueSession | undefined {
  return s.dialogueSessions.find((d) => d.id === dialogueId);
}

// ---------- Dialectical synthesis & tension resolution (LIFEOS-023) ----------

export function tensionById(s: StoreState, tensionId: string): Tension | undefined {
  return s.tensions.find((t) => t.id === tensionId);
}
export function synthesisById(s: StoreState, synthesisId: string): Synthesis | undefined {
  return s.syntheses.find((x) => x.id === synthesisId);
}
export function tensionsOf(s: StoreState, dialogueId: string): Tension[] {
  return s.tensions.filter((t) => t.dialogueId === dialogueId);
}
export function synthesesOf(s: StoreState, dialogueId: string): Synthesis[] {
  return s.syntheses.filter((x) => x.dialogueId === dialogueId);
}

/**
 * Run deterministic tension detection over a dialogue and persist any NEW
 * tensions (deduped by signature against those already stored). Returns the
 * number added. Detection never resolves anything and never mutates a record.
 */
export function detectTensionsFor(dialogueId: string): number {
  const session = state.dialogueSessions.find((d) => d.id === dialogueId);
  if (!session) return 0;
  const existing = new Set(state.tensions.filter((t) => t.dialogueId === dialogueId).map((t) => t.signature));
  const at = now();
  const fresh: Tension[] = detectTensions(state, session)
    .filter((d) => !existing.has(d.signature))
    .map((d) => ({ ...d, id: id(), history: [{ at, note: "Detected" }], createdAt: at, updatedAt: at }));
  if (fresh.length === 0) return 0;
  setState({ ...state, tensions: [...fresh, ...state.tensions] });
  return fresh.length;
}

/** Author a tension by hand (for kinds the detectors don't cover, e.g. incompatible assumptions). */
export function addTension(dialogueId: string, fields: {
  kind: DialecticTensionKind;
  title: string;
  thesis: string;
  antithesis: string;
  thesisRefs?: string[];
  antithesisRefs?: string[];
  unresolvedQuestions?: string[];
}): string | undefined {
  if (!fields.thesis.trim() || !fields.antithesis.trim()) return undefined;
  const at = now();
  const thesisRefs = fields.thesisRefs ?? [];
  const antithesisRefs = fields.antithesisRefs ?? [];
  const t: Tension = {
    id: id(),
    dialogueId,
    kind: fields.kind,
    title: fields.title.trim() || "Tension",
    thesis: fields.thesis.trim(),
    antithesis: fields.antithesis.trim(),
    thesisRefs,
    antithesisRefs,
    evidence: [
      ...thesisRefs.map((refId): DialecticEvidenceLink => ({ id: `${refId}-t`, refId, label: refId, stance: "supports_thesis" })),
      ...antithesisRefs.map((refId): DialecticEvidenceLink => ({ id: `${refId}-a`, refId, label: refId, stance: "supports_antithesis" })),
    ],
    confidence: unknownConfidence(),
    unresolvedQuestions: fields.unresolvedQuestions ?? [],
    status: "open",
    origin: "user",
    detail: "Authored by you.",
    signature: `user:${id()}`,
    history: [{ at, note: "Added by you" }],
    createdAt: at,
    updatedAt: at,
  };
  setState({ ...state, tensions: [t, ...state.tensions] });
  return t.id;
}

function patchTension(tensionId: string, patch: (t: Tension) => Tension, note?: string): void {
  const at = now();
  setState({
    ...state,
    tensions: state.tensions.map((t) => {
      if (t.id !== tensionId) return t;
      const next = patch(t);
      return { ...next, updatedAt: at, history: note ? [...t.history, { at, note }] : next.history };
    }),
  });
}

export function setTensionStatus(tensionId: string, status: TensionStatus): void {
  patchTension(tensionId, (t) => ({ ...t, status }), `Marked ${status.replace(/_/g, " ")}`);
}
export function setTensionConfidence(tensionId: string, confidence: DialecticConfidence): void {
  patchTension(tensionId, (t) => ({ ...t, confidence }), "Confidence updated");
}
export function removeTension(tensionId: string): void {
  setState({
    ...state,
    tensions: state.tensions.filter((t) => t.id !== tensionId),
    // Detach syntheses from a removed tension; drop syntheses left with no tension.
    syntheses: state.syntheses
      .map((s) => ({ ...s, tensionIds: s.tensionIds.filter((id) => id !== tensionId) }))
      .filter((s) => s.tensionIds.length > 0),
  });
}

function newSynthesis(dialogueId: string, tensionIds: string[], fields: {
  statement: string;
  preservedInsights?: string[];
  discardedAssumptions?: string[];
  commonGround?: string[];
  remainingUncertainty?: string[];
  confidence?: DialecticConfidence;
  evidenceLinks?: DialecticEvidenceLink[];
  origin: "generated" | "user";
  supersedesId?: string;
}): Synthesis {
  const at = now();
  const confidence = fields.confidence ?? unknownConfidence();
  return {
    id: id(),
    dialogueId,
    tensionIds,
    statement: fields.statement.trim(),
    preservedInsights: fields.preservedInsights ?? [],
    discardedAssumptions: fields.discardedAssumptions ?? [],
    commonGround: fields.commonGround ?? [],
    remainingUncertainty: fields.remainingUncertainty ?? [],
    confidence,
    evidenceLinks: fields.evidenceLinks ?? [],
    status: "candidate",
    origin: fields.origin,
    supersedesId: fields.supersedesId,
    revisions: [{ at, statement: fields.statement.trim(), note: "Created", confidence }],
    outcomes: [],
    createdAt: at,
    updatedAt: at,
  };
}

/** Persist a generated candidate as a synthesis (status: candidate). Marks its tension under synthesis. */
export function addSynthesisFromCandidate(dialogueId: string, tensionId: string, candidate: SynthesisCandidate): string {
  const s = newSynthesis(dialogueId, [tensionId], { ...candidate, origin: "generated" });
  setState({
    ...state,
    syntheses: [s, ...state.syntheses],
    tensions: state.tensions.map((t) => (t.id === tensionId && t.status === "open" ? { ...t, status: "under_synthesis", updatedAt: now() } : t)),
  });
  return s.id;
}

/** Author your own synthesis across one or more tensions. */
export function addUserSynthesis(dialogueId: string, tensionIds: string[], fields: {
  statement: string;
  preservedInsights?: string[];
  discardedAssumptions?: string[];
  commonGround?: string[];
  remainingUncertainty?: string[];
  confidence?: DialecticConfidence;
}): string | undefined {
  if (!fields.statement.trim()) return undefined;
  const s = newSynthesis(dialogueId, tensionIds, { ...fields, origin: "user" });
  setState({ ...state, syntheses: [s, ...state.syntheses] });
  return s.id;
}

function patchSynthesis(synthesisId: string, patch: (s: Synthesis) => Synthesis): void {
  setState({
    ...state,
    syntheses: state.syntheses.map((s) => (s.id === synthesisId ? { ...patch(s), updatedAt: now() } : s)),
  });
}

/** Accept a synthesis: an explicit user act. Marks the linked tensions resolved. */
export function acceptSynthesis(synthesisId: string): void {
  const s = state.syntheses.find((x) => x.id === synthesisId);
  if (!s) return;
  const at = now();
  setState({
    ...state,
    syntheses: state.syntheses.map((x) => (x.id === synthesisId ? { ...x, status: "accepted", updatedAt: at } : x)),
    tensions: state.tensions.map((t) => (s.tensionIds.includes(t.id) ? { ...t, status: "resolved", updatedAt: at, history: [...t.history, { at, note: "Resolved by an accepted synthesis" }] } : t)),
  });
}

export function rejectSynthesis(synthesisId: string): void {
  patchSynthesis(synthesisId, (s) => ({ ...s, status: "rejected" }));
}

/** Revise a synthesis (append-only revision history). */
export function reviseSynthesis(synthesisId: string, fields: { statement: string; note?: string; confidence?: DialecticConfidence }): void {
  if (!fields.statement.trim()) return;
  const at = now();
  patchSynthesis(synthesisId, (s) => {
    const confidence = fields.confidence ?? s.confidence;
    return {
      ...s,
      statement: fields.statement.trim(),
      confidence,
      // Reviving a rejected/superseded synthesis returns it to candidate.
      status: s.status === "accepted" ? "accepted" : "candidate",
      revisions: [...s.revisions, { at, statement: fields.statement.trim(), note: fields.note, confidence }],
    };
  });
}

/** Continue the dialogue from a synthesis: append a reflection turn citing it (reuses the dialogue engine). */
export function continueDialogueFromSynthesis(synthesisId: string): void {
  const s = state.syntheses.find((x) => x.id === synthesisId);
  if (!s) return;
  addDialogueTurn(s.dialogueId, {
    kind: "reflection",
    text: `Continuing from a synthesis: ${s.statement}`,
    author: "you",
    citations: s.evidenceLinks.map((e) => e.refId),
  });
}

function recordSynthesisOutcome(synthesisId: string, kind: string, recordId: string, label: string): void {
  patchSynthesis(synthesisId, (s) => ({ ...s, outcomes: [...s.outcomes, { at: now(), kind, recordId, label }] }));
}

/** Integrate a synthesis into a belief proposal → Inbox (never auto-added). */
export function synthesisToBeliefProposal(synthesisId: string, constitution = false): void {
  const s = state.syntheses.find((x) => x.id === synthesisId);
  if (!s || !s.statement.trim()) return;
  sendToInbox(s.statement.trim(), [{ claim: s.statement.trim() }], "mock");
  recordSynthesisOutcome(synthesisId, constitution ? "constitution proposal" : "belief proposal", "", s.statement.trim().slice(0, 60));
}

/** Integrate a synthesis into the World Model as a concept or principle. */
export function synthesisToConcept(synthesisId: string, name: string): string | undefined {
  const s = state.syntheses.find((x) => x.id === synthesisId);
  if (!s || !name.trim()) return undefined;
  const cid = createConcept({ name, description: s.statement, source: "user" });
  recordSynthesisOutcome(synthesisId, "concept", cid, name.trim());
  return cid;
}
export function synthesisToPrinciple(synthesisId: string): string | undefined {
  const s = state.syntheses.find((x) => x.id === synthesisId);
  if (!s || !s.statement.trim()) return undefined;
  const pid = createPrinciple({ statement: s.statement, source: "user" });
  recordSynthesisOutcome(synthesisId, "principle", pid, s.statement.trim().slice(0, 60));
  return pid;
}

/** Integrate a synthesis into the Research Workspace, carrying its evidence as the assembly. */
export function synthesisToResearch(synthesisId: string): string | undefined {
  const s = state.syntheses.find((x) => x.id === synthesisId);
  if (!s) return undefined;
  const a = emptyAssembly();
  for (const rid of new Set(s.evidenceLinks.map((e) => e.refId))) {
    if (state.sources.some((x) => x.id === rid)) a.sourceIds.push(rid);
    else if (state.beliefs.some((x) => x.id === rid)) a.beliefIds.push(rid);
    else if (state.concepts.some((x) => x.id === rid)) a.conceptIds.push(rid);
    else if (state.megathreads.some((x) => x.id === rid)) a.threadIds.push(rid);
    else if (state.reasonings.some((x) => x.id === rid)) a.reasoningIds.push(rid);
    else if (state.frameworks.some((x) => x.id === rid)) a.frameworkIds.push(rid);
    else if (state.principles.some((x) => x.id === rid)) a.principleIds.push(rid);
    else if (state.formationSessions.some((x) => x.id === rid)) a.formationIds.push(rid);
    else if (state.decisions.some((x) => x.id === rid)) a.decisionIds.push(rid);
  }
  const rid = createResearchProject({ title: s.statement.slice(0, 60) || "Synthesis", question: s.statement, purpose: "Investigate a synthesis reached in dialogue.", assembly: a });
  recordSynthesisOutcome(synthesisId, "research project", rid, s.statement.slice(0, 60));
  return rid;
}

// ---------- Cognitive orchestration & active intelligence (LIFEOS-024) ----------

/**
 * Run every scanner over the current store and merge the resulting proposals
 * into `state.recommendations` (deduped by signature; existing lifecycle
 * preserved). Deterministic and read-only over knowledge — the orchestrator
 * generates opportunities, never content, and mutates no other record.
 */
export function refreshRecommendations(): number {
  const before = state.recommendations.length;
  const proposals = runScanners(state);
  const merged = mergeRecommendations(state.recommendations, proposals, now(), id);
  setState({ ...state, recommendations: merged });
  return merged.length - before;
}

function patchRecommendation(recId: string, patch: (r: Recommendation) => Recommendation): void {
  setState({ ...state, recommendations: state.recommendations.map((r) => (r.id === recId ? patch(r) : r)) });
}

export function acceptRecommendation(recId: string): void {
  patchRecommendation(recId, (r) => ({ ...r, accepted: true, snoozedUntil: undefined }));
}
export function dismissRecommendation(recId: string): void {
  patchRecommendation(recId, (r) => ({ ...r, dismissed: true, snoozedUntil: undefined }));
}
export function completeRecommendation(recId: string): void {
  patchRecommendation(recId, (r) => ({ ...r, completed: true, snoozedUntil: undefined }));
}
export function snoozeRecommendation(recId: string, days = 7): void {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  patchRecommendation(recId, (r) => ({ ...r, snoozedUntil: until }));
}
export function reopenRecommendation(recId: string): void {
  patchRecommendation(recId, (r) => ({ ...r, accepted: false, dismissed: false, completed: false, snoozedUntil: undefined }));
}

export function recommendationById(s: StoreState, recId: string): Recommendation | undefined {
  return s.recommendations.find((r) => r.id === recId);
}

// ---------- Generation 1 hardening (LIFEOS-025) ----------

/**
 * The ONLY integrity repair offered (safe + effectively reversible): remove
 * recommendations whose affected records no longer exist. Recommendations are
 * DERIVED opportunities — re-running the orchestrator scan recreates any whose
 * signal still exists. User knowledge is never touched. Returns removed count.
 */
export function repairStaleRecommendations(): number {
  const known = new Set<string>();
  const add = (arr: { id: string }[]) => { for (const r of arr) known.add(r.id); };
  add(state.captures); add(state.proposals); add(state.beliefs); add(state.sources);
  add(state.comparisons); add(state.inquiries); add(state.megathreads); add(state.reflections);
  add(state.practices); add(state.reviews); add(state.reasonings); add(state.decisions);
  add(state.formationSessions); add(state.concepts); add(state.conceptRelationships);
  add(state.principles); add(state.frameworks); add(state.knowledgeProjects);
  add(state.researchProjects); add(state.dialogueSessions); add(state.tensions); add(state.syntheses);
  const keep = state.recommendations.filter((r) => !r.affected.some((a) => a.id && !known.has(a.id)));
  const removed = state.recommendations.length - keep.length;
  if (removed > 0) setState({ ...state, recommendations: keep });
  return removed;
}

// ---------- Reading companion (LIFEOS-028) ----------

// Single-map document updater; stamps updatedAt once.
function patchDocument(docId: string, update: (d: ReadingDocument) => ReadingDocument): void {
  setState({
    ...state,
    documents: state.documents.map((d) => (d.id === docId ? { ...update(d), updatedAt: now() } : d)),
  });
}

/** Import a document from parsed input. Returns the new document id. */
export function createDocument(input: NewDocumentInput): string {
  const doc = assembleDocument(input, { id, now });
  setState({ ...state, documents: [doc, ...state.documents] });
  return doc.id;
}

/** Edit document metadata (title, authors, tags, rating, kind, status, notes, …). */
export function updateDocumentMeta(docId: string, patch: Partial<Pick<ReadingDocument, "title" | "subtitle" | "authors" | "publication" | "publicationDate" | "language" | "description" | "kind" | "status" | "rating" | "tags" | "notes">>): void {
  patchDocument(docId, (d) => {
    const next = { ...d, ...patch };
    // Keep progress.status and document.status in sync when status is set here.
    if (patch.status && patch.status !== d.status) next.progress = withStatus(d.progress, patch.status, now());
    return next;
  });
}

/** Delete a document and every citation that points into it. */
export function deleteDocument(docId: string): void {
  setState({ ...state, documents: state.documents.filter((d) => d.id !== docId), citations: state.citations.filter((c) => c.documentId !== docId) });
}

export function setDocumentNotes(docId: string, notes: string): void {
  patchDocument(docId, (d) => ({ ...d, notes }));
}
export function setSectionNote(docId: string, sectionId: string, note: string): void {
  patchDocument(docId, (d) => ({ ...d, sections: d.sections.map((s) => (s.id === sectionId ? { ...s, note } : s)) }));
}

/** Record that the reader opened at a location (updates progress + lastOpened). */
export function openDocumentAt(docId: string, sectionId?: string, passageId?: string): void {
  patchDocument(docId, (d) => ({ ...d, progress: withPosition(d.progress, sectionId, passageId, now()) }));
}

/** Mark a passage read/unread; recomputes percent and status. */
export function markPassageRead(docId: string, passageId: string, read: boolean): void {
  patchDocument(docId, (d) => {
    const total = d.sections.reduce((n, s) => n + s.passages.length, 0);
    const progress = withPassageRead(d.progress, passageId, read, total, now());
    return { ...d, progress, status: progress.status };
  });
}

/** Set the reading status explicitly. */
export function setDocumentStatus(docId: string, status: ReadingStatus): void {
  patchDocument(docId, (d) => ({ ...d, status, progress: withStatus(d.progress, status, now()) }));
}

// ---- Highlights ----
function mapPassage(d: ReadingDocument, passageId: string, fn: (p: Passage) => Passage): ReadingDocument {
  return { ...d, sections: d.sections.map((s) => ({ ...s, passages: s.passages.map((p) => (p.id === passageId ? fn(p) : p)) })) };
}

export function addHighlight(docId: string, passageId: string, start: number, end: number, color: Highlight["color"], note?: string): string | null {
  const doc = state.documents.find((d) => d.id === docId);
  const passage = doc?.sections.flatMap((s) => s.passages).find((p) => p.id === passageId);
  if (!doc || !passage) return null;
  const h = makeHighlight(passageId, passage.text, start, end, color, { id, now }, note);
  if (!h) return null;
  patchDocument(docId, (d) => mapPassage(d, passageId, (p) => ({ ...p, highlights: [...p.highlights, h] })));
  return h.id;
}
export function updateHighlight(docId: string, highlightId: string, patch: Partial<Pick<Highlight, "color" | "note">>): void {
  patchDocument(docId, (d) => ({ ...d, sections: d.sections.map((s) => ({ ...s, passages: s.passages.map((p) => ({ ...p, highlights: p.highlights.map((h) => (h.id === highlightId ? { ...h, ...patch, updatedAt: now() } : h)) })) })) }));
}
export function removeHighlight(docId: string, highlightId: string): void {
  patchDocument(docId, (d) => ({ ...d, sections: d.sections.map((s) => ({ ...s, passages: s.passages.map((p) => ({ ...p, highlights: p.highlights.filter((h) => h.id !== highlightId) })) })) }));
}

// ---- Annotations ----
export function addAnnotation(docId: string, passageId: string, text: string): string | null {
  const a = makeAnnotation(passageId, text, { id, now });
  if (!a) return null;
  patchDocument(docId, (d) => mapPassage(d, passageId, (p) => ({ ...p, annotations: [...p.annotations, a] })));
  return a.id;
}
export function updateAnnotation(docId: string, annotationId: string, text: string): void {
  patchDocument(docId, (d) => ({ ...d, sections: d.sections.map((s) => ({ ...s, passages: s.passages.map((p) => ({ ...p, annotations: p.annotations.map((a) => (a.id === annotationId ? { ...a, text, updatedAt: now() } : a)) })) })) }));
}
export function removeAnnotation(docId: string, annotationId: string): void {
  patchDocument(docId, (d) => ({ ...d, sections: d.sections.map((s) => ({ ...s, passages: s.passages.map((p) => ({ ...p, annotations: p.annotations.filter((a) => a.id !== annotationId) })) })) }));
}

/** Create an accepted belief directly from text (canonical: capture → proposal → belief). */
export function createBeliefFromText(text: string, opts?: { theme?: string }): string {
  const at = now();
  const captureId = id();
  const proposalId = id();
  const beliefId = id();
  const capture: Capture = { id: captureId, text: text.trim(), createdAt: at };
  const proposal: Proposal = { id: proposalId, captureId, claim: text.trim(), theme: opts?.theme, source: "mock", createdAt: at, resolved: true };
  const belief: Belief = {
    id: beliefId, captureId, proposalId, text: text.trim(), theme: opts?.theme, status: "accepted", createdAt: at, updatedAt: at,
    revisions: [{ text: text.trim(), at, reason: "accepted" }], judgments: [{ decision: "accepted", at }],
  };
  setState({ ...state, captures: [capture, ...state.captures], proposals: [proposal, ...state.proposals], beliefs: [belief, ...state.beliefs] });
  return beliefId;
}

export type ConversionTarget = "capture" | "belief" | "concept" | "question" | "research" | "synthesis";

/**
 * Convert a passage (optionally a specific highlight) into a knowledge record
 * using the EXISTING canonical creators, then attach a Citation back to the
 * source and link the record to the passage/highlight. Returns the record's
 * kind + id. Everything deterministic; no AI.
 */
export function convertPassage(
  docId: string,
  passageId: string,
  target: ConversionTarget,
  opts?: { text?: string; title?: string; highlightId?: string },
): { kind: string; id: string } | null {
  const doc = state.documents.find((d) => d.id === docId);
  const section = doc?.sections.find((s) => s.passages.some((p) => p.id === passageId));
  const passage = section?.passages.find((p) => p.id === passageId);
  if (!doc || !section || !passage) return null;
  const highlight = opts?.highlightId ? passage.highlights.find((h) => h.id === opts.highlightId) : undefined;
  const text = (opts?.text ?? highlight?.text ?? passage.text).trim();
  const title = (opts?.title ?? text).slice(0, 80);

  let recordKind: string;
  let recordId: string;
  switch (target) {
    case "capture": recordKind = "capture"; recordId = addCapture(text); break;
    case "belief": recordKind = "belief"; recordId = createBeliefFromText(text, { theme: passage.heading }); break;
    case "concept": recordKind = "concept"; recordId = createConcept({ name: title, description: text, source: "user" }); break;
    case "question": recordKind = "research_project"; recordId = createResearchProject({ title: `Question: ${title}`, question: text }); break;
    case "research": recordKind = "research_project"; recordId = createResearchProject({ title, question: text }); break;
    case "synthesis": recordKind = "dialogue"; recordId = createDialogue({ title: `Synthesis: ${title}`, topic: text, purpose: "Integrate this passage into a synthesis" }); break;
    default: return null;
  }

  // Attach citation + link the record to the passage (and highlight, if any).
  const citation = makeCitation(doc, { section, passage, highlight }, { kind: recordKind, id: recordId }, { id, now });
  const ref: RecordRefLite = { kind: recordKind, id: recordId };
  setState({
    ...state,
    citations: [citation, ...state.citations],
    documents: state.documents.map((d) => (d.id !== docId ? d : {
      ...d,
      updatedAt: now(),
      sections: d.sections.map((s) => ({
        ...s,
        passages: s.passages.map((p) => {
          if (p.id !== passageId) return p;
          return {
            ...p,
            linked: p.linked.some((l) => l.kind === ref.kind && l.id === ref.id) ? p.linked : [...p.linked, ref],
            highlights: highlight ? p.highlights.map((h) => (h.id === highlight.id ? { ...h, linked: [...h.linked, ref], updatedAt: now() } : h)) : p.highlights,
          };
        }),
      })),
    })),
  });
  return { kind: recordKind, id: recordId };
}

// ================= Workspaces, sessions & thinking modes (LIFEOS-030) =================
//
// Workspaces group EXISTING entities (references only, never copies); sessions
// are active thinking modes with a derived activity timeline. All deterministic:
// no AI, no analytics, no background work. Only one session is active at a time —
// starting a new session ends the current one first.

function bumpWorkspace(wsId: string, mutate: (w: Workspace) => Workspace): void {
  setState({
    ...state,
    workspaces: state.workspaces.map((w) => (w.id === wsId ? { ...mutate(w), updatedAt: now() } : w)),
  });
}

/** Create a first-class workspace. Returns the new id. */
export function createWorkspace(input: { name: string; description?: string; color?: string }): string {
  const ws: Workspace = {
    id: id(),
    name: input.name.trim() || "Untitled workspace",
    description: (input.description ?? "").trim(),
    color: input.color,
    goals: [],
    members: [],
    pinned: [],
    resume: {},
    archived: false,
    createdAt: now(),
    updatedAt: now(),
  };
  setState({ ...state, workspaces: [ws, ...state.workspaces] });
  setCurrentWorkspace(ws.id);
  return ws.id;
}

export function updateWorkspace(wsId: string, patch: { name?: string; description?: string; color?: string }): void {
  bumpWorkspace(wsId, (w) => ({
    ...w,
    name: patch.name !== undefined ? patch.name.trim() || w.name : w.name,
    description: patch.description !== undefined ? patch.description : w.description,
    color: patch.color !== undefined ? patch.color : w.color,
  }));
}

export function archiveWorkspace(wsId: string, archived = true): void {
  bumpWorkspace(wsId, (w) => ({ ...w, archived }));
}

/** Permanently delete a workspace and its sessions (never touches the grouped entities). */
export function deleteWorkspace(wsId: string): void {
  setState({
    ...state,
    workspaces: state.workspaces.filter((w) => w.id !== wsId),
    sessions: state.sessions.filter((s) => s.workspaceId !== wsId),
  });
  forgetWorkspace(wsId);
}

/** Add an existing entity to a workspace (a reference — the entity is not copied). */
export function addToWorkspace(wsId: string, kind: string, entityId: string): void {
  bumpWorkspace(wsId, (w) =>
    w.members.some((m) => m.kind === kind && m.id === entityId)
      ? w
      : { ...w, members: [...w.members, { kind, id: entityId }] },
  );
}

export function removeFromWorkspace(wsId: string, kind: string, entityId: string): void {
  bumpWorkspace(wsId, (w) => ({
    ...w,
    members: w.members.filter((m) => !(m.kind === kind && m.id === entityId)),
    pinned: w.pinned.filter((m) => !(m.kind === kind && m.id === entityId)),
  }));
}

/** Pin/unpin an entity within a workspace (must also be a member to pin). */
export function toggleWorkspacePin(wsId: string, kind: string, entityId: string): void {
  bumpWorkspace(wsId, (w) => {
    const pinned = w.pinned.some((m) => m.kind === kind && m.id === entityId);
    if (pinned) return { ...w, pinned: w.pinned.filter((m) => !(m.kind === kind && m.id === entityId)) };
    const members = w.members.some((m) => m.kind === kind && m.id === entityId)
      ? w.members
      : [...w.members, { kind, id: entityId }];
    return { ...w, members, pinned: [...w.pinned, { kind, id: entityId }] };
  });
}

export function addWorkspaceGoal(wsId: string, text: string): string {
  const goalId = id();
  bumpWorkspace(wsId, (w) => ({
    ...w,
    goals: [...w.goals, { id: goalId, text: text.trim(), done: false, createdAt: now() }],
  }));
  return goalId;
}

export function toggleWorkspaceGoal(wsId: string, goalId: string): void {
  bumpWorkspace(wsId, (w) => ({
    ...w,
    goals: w.goals.map((g) => (g.id === goalId ? { ...g, done: !g.done } : g)),
  }));
}

export function removeWorkspaceGoal(wsId: string, goalId: string): void {
  bumpWorkspace(wsId, (w) => ({ ...w, goals: w.goals.filter((g) => g.id !== goalId) }));
}

/** Persist a resume-memory patch on a workspace (Feature 6). */
export function setWorkspaceResume(wsId: string, patch: Partial<Workspace["resume"]>): void {
  bumpWorkspace(wsId, (w) => ({ ...w, resume: mergeResume(w.resume ?? {}, patch) }));
}

/**
 * Begin a thinking session in a workspace. Ends any currently-active session
 * first — only one session is ever active. Sets the current-workspace pointer.
 * Returns the new session id.
 */
export function startSession(wsId: string, type: SessionType, goal = ""): string {
  const sessionId = id();
  const stamp = now();
  const sessions = state.sessions.map((s) => (s.endedAt ? s : { ...s, endedAt: stamp }));
  const session: WorkspaceSession = {
    id: sessionId,
    workspaceId: wsId,
    type,
    goal: goal.trim(),
    notes: "",
    startedAt: stamp,
    activity: [],
  };
  setState({ ...state, sessions: [session, ...sessions] });
  setCurrentWorkspace(wsId);
  return sessionId;
}

/** End the given session (or the active one if omitted). */
export function endSession(sessionId?: string): void {
  const stamp = now();
  setState({
    ...state,
    sessions: state.sessions.map((s) => {
      const target = sessionId ? s.id === sessionId : !s.endedAt;
      return target && !s.endedAt ? { ...s, endedAt: stamp } : s;
    }),
  });
}

export function updateSessionNotes(sessionId: string, notes: string): void {
  setState({
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, notes } : s)),
  });
}

/** Insert a timestamped scratch line into a session's notes (Feature 8). */
export function appendSessionNote(sessionId: string, text: string): void {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const line = `\n\n**${time}** — ${text.trim()}`;
  setState({
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, notes: (s.notes + line).trimStart() } : s)),
  });
}

/**
 * Record an activity event into the ACTIVE session (Feature 5) and keep the
 * session's workspace resume memory current (Feature 6). No-ops when no session
 * is active. Deduped via `shouldRecord` so the timeline stays meaningful. This is
 * the single sink all `tracking.ts` helpers call.
 */
export function recordSessionActivity(candidate: {
  type: SessionActivityKind;
  entityKind?: string;
  entityId?: string;
  label: string;
  detail?: string;
}): void {
  const active = state.sessions.find((s) => !s.endedAt);
  if (!active) return;
  if (!shouldRecord(active, candidate)) return;
  const stamp = now();
  const event: SessionActivityEvent = { id: id(), at: stamp, ...candidate };
  const resumePatch = resumePatchFor(candidate, stamp);
  setState({
    ...state,
    sessions: state.sessions.map((s) => (s.id === active.id ? appendActivity(s, event) : s)),
    workspaces: state.workspaces.map((w) =>
      w.id === active.workspaceId
        ? { ...w, resume: mergeResume(w.resume ?? {}, resumePatch), updatedAt: stamp }
        : w,
    ),
  });
}

// ================= Goals, projects & execution (LIFEOS-031) =================
//
// Goals are the highest-level object; Projects belong to Goals; Milestones are
// embedded in Projects (manual completion only); Sessions optionally link to a
// Goal/Project. All deterministic — no AI, no auto-planning, no auto-progress.
// Progress is derived at view time (see lib/execution/progress.ts).

function bumpGoal(goalId: string, mutate: (g: Goal) => Goal): void {
  setState({ ...state, goals: state.goals.map((g) => (g.id === goalId ? { ...mutate(g), updatedAt: now() } : g)) });
}
function bumpProject(projectId: string, mutate: (p: Project) => Project): void {
  setState({ ...state, projects: state.projects.map((p) => (p.id === projectId ? { ...mutate(p), updatedAt: now() } : p)) });
}

export function createGoal(input: { title: string; description?: string; priority?: ExecutionPriority; targetDate?: string }): string {
  const goal: Goal = {
    id: id(),
    title: input.title.trim() || "Untitled goal",
    description: (input.description ?? "").trim(),
    status: "active",
    priority: input.priority ?? "medium",
    targetDate: input.targetDate,
    notes: "",
    tags: [],
    linkedWorkspaces: [],
    linkedKnowledge: [],
    createdAt: now(),
    updatedAt: now(),
  };
  setState({ ...state, goals: [goal, ...state.goals] });
  setCurrentGoal(goal.id);
  return goal.id;
}

export function updateGoal(goalId: string, patch: Partial<Pick<Goal, "title" | "description" | "status" | "priority" | "targetDate" | "notes" | "tags">>): void {
  bumpGoal(goalId, (g) => ({
    ...g,
    ...("title" in patch ? { title: (patch.title ?? "").trim() || g.title } : {}),
    ...("description" in patch ? { description: patch.description ?? g.description } : {}),
    ...("status" in patch ? { status: patch.status ?? g.status } : {}),
    ...("priority" in patch ? { priority: patch.priority ?? g.priority } : {}),
    ...("targetDate" in patch ? { targetDate: patch.targetDate } : {}),
    ...("notes" in patch ? { notes: patch.notes ?? g.notes } : {}),
    ...("tags" in patch ? { tags: patch.tags ?? g.tags } : {}),
  }));
}

/** Set (or clear, with undefined) a goal's manual progress override (0–100). */
export function setGoalProgress(goalId: string, value: number | undefined): void {
  bumpGoal(goalId, (g) => ({ ...g, manualProgress: value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value))) }));
}

export function deleteGoal(goalId: string): void {
  setState({
    ...state,
    goals: state.goals.filter((g) => g.id !== goalId),
    // Orphan (don't delete) the goal's projects — they remain valid work.
    projects: state.projects.map((p) => (p.goalId === goalId ? { ...p, goalId: undefined, updatedAt: now() } : p)),
  });
  forgetGoal(goalId);
}

export function linkGoalKnowledge(goalId: string, kind: string, entityId: string): void {
  bumpGoal(goalId, (g) => (g.linkedKnowledge.some((r) => r.kind === kind && r.id === entityId) ? g : { ...g, linkedKnowledge: [...g.linkedKnowledge, { kind, id: entityId }] }));
}
export function unlinkGoalKnowledge(goalId: string, kind: string, entityId: string): void {
  bumpGoal(goalId, (g) => ({ ...g, linkedKnowledge: g.linkedKnowledge.filter((r) => !(r.kind === kind && r.id === entityId)) }));
}
export function toggleGoalWorkspace(goalId: string, workspaceId: string): void {
  bumpGoal(goalId, (g) => {
    const has = g.linkedWorkspaces.some((r) => r.id === workspaceId);
    return { ...g, linkedWorkspaces: has ? g.linkedWorkspaces.filter((r) => r.id !== workspaceId) : [...g.linkedWorkspaces, { kind: "workspace", id: workspaceId }] };
  });
}

export function createProject(input: { title: string; description?: string; goalId?: string; workspaceId?: string; priority?: ExecutionPriority; targetDate?: string; startDate?: string }): string {
  const project: Project = {
    id: id(),
    title: input.title.trim() || "Untitled project",
    description: (input.description ?? "").trim(),
    status: "active",
    priority: input.priority ?? "medium",
    goalId: input.goalId,
    workspaceId: input.workspaceId,
    startDate: input.startDate,
    targetDate: input.targetDate,
    notes: "",
    milestones: [],
    relatedDocuments: [],
    relatedEntities: [],
    createdAt: now(),
    updatedAt: now(),
  };
  setState({ ...state, projects: [project, ...state.projects] });
  setCurrentProject(project.id);
  return project.id;
}

export function updateProject(projectId: string, patch: Partial<Pick<Project, "title" | "description" | "status" | "priority" | "goalId" | "workspaceId" | "startDate" | "targetDate" | "notes">>): void {
  bumpProject(projectId, (p) => ({
    ...p,
    ...("title" in patch ? { title: (patch.title ?? "").trim() || p.title } : {}),
    ...("description" in patch ? { description: patch.description ?? p.description } : {}),
    ...("status" in patch ? { status: patch.status ?? p.status } : {}),
    ...("priority" in patch ? { priority: patch.priority ?? p.priority } : {}),
    ...("goalId" in patch ? { goalId: patch.goalId } : {}),
    ...("workspaceId" in patch ? { workspaceId: patch.workspaceId } : {}),
    ...("startDate" in patch ? { startDate: patch.startDate } : {}),
    ...("targetDate" in patch ? { targetDate: patch.targetDate } : {}),
    ...("notes" in patch ? { notes: patch.notes ?? p.notes } : {}),
  }));
}

export function setProjectProgress(projectId: string, value: number | undefined): void {
  bumpProject(projectId, (p) => ({ ...p, manualProgress: value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value))) }));
}

export function deleteProject(projectId: string): void {
  setState({
    ...state,
    projects: state.projects.filter((p) => p.id !== projectId),
    // Detach sessions from the deleted project (they remain valid history).
    sessions: state.sessions.map((s) => (s.projectId === projectId ? { ...s, projectId: undefined } : s)),
  });
  forgetProject(projectId);
}

export function addProjectRelated(projectId: string, kind: string, entityId: string): void {
  bumpProject(projectId, (p) => {
    const bucket = kind === "document" ? "relatedDocuments" : "relatedEntities";
    const arr = p[bucket];
    if (arr.some((r) => r.kind === kind && r.id === entityId)) return p;
    return { ...p, [bucket]: [...arr, { kind, id: entityId }] };
  });
}
export function removeProjectRelated(projectId: string, kind: string, entityId: string): void {
  bumpProject(projectId, (p) => ({
    ...p,
    relatedEntities: p.relatedEntities.filter((r) => !(r.kind === kind && r.id === entityId)),
    relatedDocuments: p.relatedDocuments.filter((r) => !(r.kind === kind && r.id === entityId)),
  }));
}

export function addMilestone(projectId: string, title: string, targetDate?: string): string {
  const milestoneId = id();
  bumpProject(projectId, (p) => ({
    ...p,
    milestones: [...p.milestones, { id: milestoneId, title: title.trim() || "Untitled milestone", status: "open", targetDate, notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: now(), updatedAt: now() }],
  }));
  return milestoneId;
}

/** Manually toggle a milestone done/open (stamps or clears completedDate). */
export function toggleMilestone(projectId: string, milestoneId: string): void {
  bumpProject(projectId, (p) => ({ ...p, milestones: p.milestones.map((m) => (m.id === milestoneId ? toggleMilestoneDone(m, now()) : m)) }));
}

export function updateMilestone(projectId: string, milestoneId: string, patch: Partial<Pick<Milestone, "title" | "targetDate" | "notes">>): void {
  bumpProject(projectId, (p) => ({ ...p, milestones: p.milestones.map((m) => (m.id === milestoneId ? { ...m, ...patch, updatedAt: now() } : m)) }));
}

export function removeMilestone(projectId: string, milestoneId: string): void {
  bumpProject(projectId, (p) => ({ ...p, milestones: p.milestones.filter((m) => m.id !== milestoneId) }));
}

/** Link (or clear) the active/other session's goal + project (Feature 6). */
export function setSessionExecution(sessionId: string, links: { goalId?: string; projectId?: string }): void {
  setState({
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...("goalId" in links ? { goalId: links.goalId } : {}), ...("projectId" in links ? { projectId: links.projectId } : {}) } : s)),
  });
}

/**
 * Start a thinking session attributed to a project (Feature 6): reuses the
 * workspace-session lifecycle, in the project's workspace, linking goal+project.
 * Returns the session id, or "" when the project has no workspace to run in.
 */
export function startProjectSession(projectId: string, type: SessionType, goal = ""): string {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project?.workspaceId) return "";
  const sessionId = startSession(project.workspaceId, type, goal);
  setSessionExecution(sessionId, { goalId: project.goalId, projectId: project.id });
  return sessionId;
}
