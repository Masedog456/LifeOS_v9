/**
 * SupabasePersistenceAdapter — durable, per-user, RLS-protected backend.
 *
 * Maps the flat StoreState to/from the relational schema in
 * supabase/migrations/0001_initial_schema.sql. Append-only tables
 * (belief_revisions, user_judgments, saved_quotes) are written with
 * insert-or-ignore so history is never rewritten and existing rows are
 * never updated (which RLS forbids anyway).
 *
 * Note: user_id is set by the database default (auth.uid()), so rows are
 * never tagged client-side. This adapter requires an authenticated session
 * (the persistence facade signs the user in before using it).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConstitutionElement, ConstitutionRevision,
  LifeEvent, RecurrenceCompletion,
  Belief,
  Capture,
  Comparison,
  Concept,
  ConceptRelationship,
  Decision,
  EmbeddingRecord,
  FormationSession,
  Framework,
  Inquiry,
  DialogueSession,
  Tension,
  Synthesis,
  Recommendation,
  KnowledgeProject,
  Principle,
  ResearchProject,
  Megathread,
  PracticeCandidate,
  ReasoningQuery,
  Reflection,
  ReviewSession,
  JudgmentEntry,
  KnowledgeChunk,
  KnowledgeSource,
  Proposal,
  RevisionEntry,
  SourceType,
  StoreState,
  Citation,
  ReadingDocument,
  Workspace,
  WorkspaceSession,
  Goal,
  Project,
  DailyReview,
  NextAction,
  ActionDependency,
  ActionTemplate,
  PlanningAssignment,
  FocusSession,
  MaintenanceEvent,
  DuplicateCandidate,
  SavedInsightView,
  Note,
  Protocol,
} from "@/types/mvp";
import type { PersistenceAdapter, PersistenceHealth, SyncState } from "@/lib/adapters/types";
import { readRule } from "@/lib/time/recurrence";
import {
  allDocumentRows, citationToRow, diffById, documentToImportPayload, newDocumentIds, rowsToDocuments,
  type AnnotationRow, type CitationRow, type DocumentRow, type HighlightRow, type PassageRow, type SectionRow,
} from "@/lib/library/rows";

/* eslint-disable @typescript-eslint/no-explicit-any */

export class SupabasePersistenceAdapter implements PersistenceAdapter {
  readonly mode = "supabase" as const;
  private client: SupabaseClient;
  private lastState: SyncState = "syncing";
  private lastError?: string;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  private async uid(): Promise<string | null> {
    const { data } = await this.client.auth.getUser();
    return data.user?.id ?? null;
  }

  async loadState(): Promise<Partial<StoreState> | null> {
    const [sources, captures, proposals, beliefs, revisions, judgments, quotes, feedback, comparisons, inquiries, megathreads, reflections, practices, reviews, reasonings, embeddings, decisions, formationSessions, concepts, conceptRelationships, principles, frameworks, knowledgeProjects, researchProjects, dialogueSessions, tensions, syntheses, recommendations] =
      await Promise.all([
        this.client.from("sources").select("*"),
        this.client.from("captures").select("*"),
        this.client.from("proposals").select("*"),
        this.client.from("beliefs").select("*"),
        this.client.from("belief_revisions").select("*").order("seq", { ascending: true }),
        this.client.from("user_judgments").select("*").order("seq", { ascending: true }),
        this.client.from("saved_quotes").select("*").order("created_at", { ascending: true }),
        this.client.from("retrieval_feedback").select("*"),
        this.client.from("comparisons").select("*").order("created_at", { ascending: false }),
        this.client.from("inquiries").select("*").order("created_at", { ascending: false }),
        this.client.from("megathreads").select("*").order("created_at", { ascending: false }),
        this.client.from("reflections").select("*").order("created_at", { ascending: false }),
        this.client.from("practices").select("*").order("created_at", { ascending: false }),
        this.client.from("review_sessions").select("*").order("started_at", { ascending: false }),
        this.client.from("reasonings").select("*").order("created_at", { ascending: false }),
        this.client.from("embeddings").select("*"),
        this.client.from("decisions").select("*").order("created_at", { ascending: false }),
        this.client.from("formation_sessions").select("*").order("created_at", { ascending: false }),
        this.client.from("concepts").select("*").order("created_at", { ascending: false }),
        this.client.from("concept_relationships").select("*").order("created_at", { ascending: false }),
        this.client.from("principles").select("*").order("created_at", { ascending: false }),
        this.client.from("frameworks").select("*").order("created_at", { ascending: false }),
        this.client.from("knowledge_projects").select("*").order("created_at", { ascending: false }),
        this.client.from("research_projects").select("*").order("created_at", { ascending: false }),
        this.client.from("dialogue_sessions").select("*").order("created_at", { ascending: false }),
        this.client.from("tensions").select("*").order("created_at", { ascending: false }),
        this.client.from("syntheses").select("*").order("created_at", { ascending: false }),
        this.client.from("recommendations").select("*").order("created_at", { ascending: false }),
      ]);

    const firstError =
      sources.error ||
      captures.error ||
      proposals.error ||
      beliefs.error ||
      revisions.error ||
      judgments.error ||
      quotes.error ||
      feedback.error ||
      comparisons.error ||
      inquiries.error ||
      megathreads.error ||
      reflections.error ||
      practices.error ||
      reviews.error ||
      reasonings.error ||
      embeddings.error ||
      decisions.error ||
      formationSessions.error ||
      concepts.error ||
      conceptRelationships.error ||
      principles.error ||
      frameworks.error ||
      knowledgeProjects.error ||
      researchProjects.error ||
      dialogueSessions.error ||
      tensions.error ||
      syntheses.error ||
      recommendations.error;
    if (firstError) throw new Error(firstError.message);

    const quotesBySource = groupBy((quotes.data ?? []) as any[], "source_id");
    const revsByBelief = groupBy((revisions.data ?? []) as any[], "belief_id");
    const judsByBelief = groupBy((judgments.data ?? []) as any[], "belief_id");

    // Reading library (LIFEOS-028): fetched separately and resiliently — if the
    // 0021 tables are missing on an older deployment, hydration degrades to an
    // empty reading library rather than failing the whole load.
    const reading = await this.loadReading();
    // Workspaces & sessions (LIFEOS-030): resilient to the 0022 tables being
    // absent on an older deployment — degrades to empty rather than failing load.
    const workspaces = await this.loadWorkspaces();
    // Goals & projects (LIFEOS-031): resilient to the 0023 tables being absent.
    const execution = await this.loadExecution();
    // Daily reviews (LIFEOS-034): resilient to the 0025 table being absent.
    const dailyReviews = await this.loadDailyReviews();
    const actions = await this.loadActions();
    const planning = await this.loadPlanning();
    // Knowledge maintenance (LIFEOS-038): resilient to the 0029 tables being absent.
    const maintenance = await this.loadMaintenance();
    // Insights saved views (LIFEOS-039): resilient to the 0030 table being absent.
    const savedInsightViews = await this.loadInsightViews();
    const notes = await this.loadNotes();
    const protocols = await this.loadProtocols();
    const events = await this.loadEvents();
    const recurrenceCompletions = await this.loadRecurrenceCompletions();
    const constitutionElements = await this.loadConstitutionElements();
    const constitutionRevisions = await this.loadConstitutionRevisions();

    return {
      sources: (sources.data ?? []).map((r: any) =>
        rowToSource(r, (quotesBySource[r.id] ?? []).map((q) => q.text as string)),
      ),
      captures: (captures.data ?? []).map(rowToCapture),
      proposals: (proposals.data ?? []).map(rowToProposal),
      beliefs: (beliefs.data ?? []).map((r: any) =>
        rowToBelief(r, revsByBelief[r.id] ?? [], judsByBelief[r.id] ?? []),
      ),
      feedback: (feedback.data ?? []).map((r: any) => ({
        recordId: r.record_id,
        verdict: r.verdict,
        at: r.at,
        snoozeUntil: r.snooze_until ?? undefined,
      })),
      comparisons: (comparisons.data ?? []).map(rowToComparison),
      inquiries: (inquiries.data ?? []).map(rowToInquiry),
      megathreads: (megathreads.data ?? []).map(rowToMegathread),
      reflections: (reflections.data ?? []).map(rowToReflection),
      practices: (practices.data ?? []).map(rowToPractice),
      reviews: (reviews.data ?? []).map(rowToReview),
      reasonings: (reasonings.data ?? []).map(rowToReasoning),
      embeddings: (embeddings.data ?? []).map(rowToEmbedding),
      decisions: (decisions.data ?? []).map(rowToDecision),
      formationSessions: (formationSessions.data ?? []).map(rowToFormationSession),
      concepts: (concepts.data ?? []).map(rowToConcept),
      conceptRelationships: (conceptRelationships.data ?? []).map(rowToRelationship),
      principles: (principles.data ?? []).map(rowToPrinciple),
      frameworks: (frameworks.data ?? []).map(rowToFramework),
      knowledgeProjects: (knowledgeProjects.data ?? []).map(rowToProject),
      researchProjects: (researchProjects.data ?? []).map(rowToResearch),
      dialogueSessions: (dialogueSessions.data ?? []).map(rowToDialogue),
      tensions: (tensions.data ?? []).map(rowToTension),
      syntheses: (syntheses.data ?? []).map(rowToSynthesis),
      recommendations: (recommendations.data ?? []).map(rowToRecommendation),
      documents: reading.documents,
      citations: reading.citations,
      workspaces: workspaces.workspaces,
      sessions: workspaces.sessions,
      goals: execution.goals,
      projects: execution.projects,
      dailyReviews,
      nextActions: actions.nextActions,
      actionDependencies: actions.actionDependencies,
      actionTemplates: actions.actionTemplates,
      planningAssignments: planning.planningAssignments,
      focusSessions: planning.focusSessions,
      maintenanceEvents: maintenance.maintenanceEvents,
      duplicateCandidates: maintenance.duplicateCandidates,
      savedInsightViews,
      notes,
      protocols,
      events,
      recurrenceCompletions,
      constitutionElements,
      constitutionRevisions,
    };
  }

  async saveState(state: StoreState, dirty?: Set<keyof StoreState>, base?: StoreState | null): Promise<void> {
    // Incremental sync (LIFEOS-021): with a `dirty` set, push only changed
    // domains; without one, push everything (full/backward-compatible sync).
    const w = (k: keyof StoreState) => !dirty || dirty.has(k);
    if (w("sources") && state.sources.length) {
      await this.throwing(this.client.from("sources").upsert(state.sources.map(sourceToRow)));
      // Extracted + user-saved quotes live in saved_quotes (append-only).
      const quoteRows = state.sources.flatMap((s) =>
        s.keyQuotes.map((text) => ({ source_id: s.id, text })),
      );
      if (quoteRows.length) await this.insertIgnore("saved_quotes", quoteRows, "source_id,text");
    }
    if (w("captures") && state.captures.length)
      await this.throwing(this.client.from("captures").upsert(state.captures.map(captureToRow)));
    if (w("proposals") && state.proposals.length)
      await this.throwing(this.client.from("proposals").upsert(state.proposals.map(proposalToRow)));
    if (w("beliefs") && state.beliefs.length) {
      await this.throwing(this.client.from("beliefs").upsert(state.beliefs.map(beliefToRow)));
      const revRows = state.beliefs.flatMap((b) =>
        b.revisions.map((r, seq) => ({ belief_id: b.id, seq, text: r.text, reason: r.reason, at: r.at })),
      );
      const judRows = state.beliefs.flatMap((b) =>
        b.judgments.map((j, seq) => ({ belief_id: b.id, seq, decision: j.decision, note: j.note ?? null, at: j.at })),
      );
      if (revRows.length) await this.insertIgnore("belief_revisions", revRows, "belief_id,seq");
      if (judRows.length) await this.insertIgnore("user_judgments", judRows, "belief_id,seq");
    }
    if (w("feedback") && state.feedback?.length) {
      const rows = state.feedback.map((f) => ({
        record_id: f.recordId,
        verdict: f.verdict,
        at: f.at,
        snooze_until: f.snoozeUntil ?? null,
      }));
      await this.insertIgnore("retrieval_feedback", rows, "user_id,record_id,at");
    }
    if (w("comparisons") && state.comparisons.length) {
      await this.throwing(this.client.from("comparisons").upsert(state.comparisons.map(comparisonToRow)));
    }
    if (w("inquiries") && state.inquiries.length) {
      await this.throwing(this.client.from("inquiries").upsert(state.inquiries.map(inquiryToRow)));
    }
    if (w("megathreads") && state.megathreads.length) {
      await this.throwing(this.client.from("megathreads").upsert(state.megathreads.map(megathreadToRow)));
    }
    if (w("reflections") && state.reflections.length) {
      await this.throwing(this.client.from("reflections").upsert(state.reflections.map(reflectionToRow)));
    }
    if (w("practices") && state.practices.length) {
      await this.throwing(this.client.from("practices").upsert(state.practices.map(practiceToRow)));
    }
    if (w("reviews") && state.reviews.length) {
      await this.throwing(this.client.from("review_sessions").upsert(state.reviews.map(reviewToRow)));
    }
    if (w("reasonings") && state.reasonings.length) {
      await this.throwing(this.client.from("reasonings").upsert(state.reasonings.map(reasoningToRow)));
    }
    if (w("embeddings") && state.embeddings.length) {
      await this.throwing(this.client.from("embeddings").upsert(state.embeddings.map(embeddingToRow), { onConflict: "user_id,record_id" }));
    }
    if (w("decisions") && state.decisions.length) {
      await this.throwing(this.client.from("decisions").upsert(state.decisions.map(decisionToRow)));
    }
    if (w("formationSessions") && state.formationSessions.length) {
      await this.throwing(this.client.from("formation_sessions").upsert(state.formationSessions.map(formationSessionToRow)));
    }
    if (w("concepts") && state.concepts.length) {
      await this.throwing(this.client.from("concepts").upsert(state.concepts.map(conceptToRow)));
    }
    if (w("conceptRelationships") && state.conceptRelationships.length) {
      await this.throwing(this.client.from("concept_relationships").upsert(state.conceptRelationships.map(relationshipToRow)));
    }
    if (w("principles") && state.principles.length) {
      await this.throwing(this.client.from("principles").upsert(state.principles.map(principleToRow)));
    }
    if (w("frameworks") && state.frameworks.length) {
      await this.throwing(this.client.from("frameworks").upsert(state.frameworks.map(frameworkToRow)));
    }
    if (w("knowledgeProjects") && state.knowledgeProjects.length) {
      await this.throwing(this.client.from("knowledge_projects").upsert(state.knowledgeProjects.map(projectToRow)));
    }
    if (w("researchProjects") && state.researchProjects.length) {
      await this.throwing(this.client.from("research_projects").upsert(state.researchProjects.map(researchToRow)));
    }
    if (w("dialogueSessions") && state.dialogueSessions.length) {
      await this.throwing(this.client.from("dialogue_sessions").upsert(state.dialogueSessions.map(dialogueToRow)));
    }
    if (w("tensions") && state.tensions.length) {
      await this.throwing(this.client.from("tensions").upsert(state.tensions.map(tensionToRow)));
    }
    if (w("syntheses") && state.syntheses.length) {
      await this.throwing(this.client.from("syntheses").upsert(state.syntheses.map(synthesisToRow)));
    }
    if (w("recommendations") && state.recommendations.length) {
      await this.throwing(this.client.from("recommendations").upsert(state.recommendations.map(recommendationToRow)));
    }
    // ---- Reading library (LIFEOS-028): normalized, row-level incremental sync ----
    if (w("documents")) await this.syncReadingDocuments(state.documents, base?.documents ?? []);
    if (w("citations")) await this.syncCitations(state.citations, base?.citations ?? []);
    // ---- Workspaces & sessions (LIFEOS-030): row-level upsert/delete ----
    if (w("workspaces")) await this.syncWorkspaces(state.workspaces ?? [], base?.workspaces ?? []);
    if (w("sessions")) await this.syncSessions(state.sessions ?? [], base?.sessions ?? []);
    // ---- Goals & projects (LIFEOS-031): row-level upsert/delete ----
    if (w("goals")) await this.syncGoals(state.goals ?? [], base?.goals ?? []);
    if (w("projects")) await this.syncProjects(state.projects ?? [], base?.projects ?? []);
    // ---- Daily reviews (LIFEOS-034): row-level upsert/delete ----
    if (w("dailyReviews")) await this.syncDailyReviews(state.dailyReviews ?? [], base?.dailyReviews ?? []);
    // ---- Next actions (LIFEOS-036): row-level upsert/delete ----
    if (w("nextActions")) await this.syncNextActions(state.nextActions ?? [], base?.nextActions ?? []);
    if (w("actionDependencies")) await this.syncActionDependencies(state.actionDependencies ?? [], base?.actionDependencies ?? []);
    if (w("actionTemplates")) await this.syncActionTemplates(state.actionTemplates ?? [], base?.actionTemplates ?? []);
    // ---- Planning & focus (LIFEOS-037): row-level upsert/delete ----
    if (w("planningAssignments")) await this.syncPlanningAssignments(state.planningAssignments ?? [], base?.planningAssignments ?? []);
    if (w("focusSessions")) await this.syncFocusSessions(state.focusSessions ?? [], base?.focusSessions ?? []);
    if (w("maintenanceEvents")) await this.syncMaintenanceEvents(state.maintenanceEvents ?? [], base?.maintenanceEvents ?? []);
    if (w("duplicateCandidates")) await this.syncDuplicateCandidates(state.duplicateCandidates ?? [], base?.duplicateCandidates ?? []);
    if (w("savedInsightViews")) await this.syncInsightViews(state.savedInsightViews ?? [], base?.savedInsightViews ?? []);
    if (w("notes")) await this.syncNotes(state.notes ?? [], base?.notes ?? []);
    if (w("protocols")) await this.syncProtocols(state.protocols ?? [], base?.protocols ?? []);
    if (w("events")) await this.syncEvents(state.events ?? [], base?.events ?? []);
    if (w("recurrenceCompletions")) await this.syncRecurrenceCompletions(state.recurrenceCompletions ?? [], base?.recurrenceCompletions ?? []);
    if (w("constitutionElements")) await this.syncConstitutionElements(state.constitutionElements ?? [], base?.constitutionElements ?? []);
    if (w("constitutionRevisions")) await this.syncConstitutionRevisions(state.constitutionRevisions ?? [], base?.constitutionRevisions ?? []);
    this.lastState = "synced";
    this.lastError = undefined;
  }

  /**
   * Sync the reading document hierarchy with ROW-LEVEL granularity: brand-new
   * documents import atomically via the RPC (so a partial import can never look
   * complete); existing documents push only their changed rows and delete only
   * removed ones; removed documents delete their row (DB cascades owned
   * children). Editing one annotation therefore touches one row, not the library.
   */
  private async syncReadingDocuments(current: ReadingDocument[], base: ReadingDocument[]): Promise<void> {
    const isNew = newDocumentIds(current, base);
    // 1. Atomic import for brand-new documents (transactional RPC).
    for (const doc of current) {
      if (isNew.has(doc.id)) {
        await this.throwing(this.client.rpc("import_reading_document", { payload: documentToImportPayload(doc) }));
      }
    }
    // 2. Incremental upsert/delete for the rest (existing, possibly edited).
    const existingCurrent = current.filter((d) => !isNew.has(d.id));
    const cur = allDocumentRows(existingCurrent);
    const prev = allDocumentRows(base.filter((d) => current.some((c) => c.id === d.id) && !isNew.has(d.id)));

    const dDoc = diffById<DocumentRow>(cur.documents, prev.documents);
    const dSec = diffById<SectionRow>(cur.sections, prev.sections);
    const dPas = diffById<PassageRow>(cur.passages, prev.passages);
    const dHl = diffById<HighlightRow>(cur.highlights, prev.highlights);
    const dAn = diffById<AnnotationRow>(cur.annotations, prev.annotations);

    // Upserts parent → child (FK-safe).
    if (dDoc.upsert.length) await this.throwing(this.client.from("reading_documents").upsert(dDoc.upsert));
    if (dSec.upsert.length) await this.throwing(this.client.from("document_sections").upsert(dSec.upsert));
    if (dPas.upsert.length) await this.throwing(this.client.from("document_passages").upsert(dPas.upsert));
    if (dHl.upsert.length) await this.throwing(this.client.from("document_highlights").upsert(dHl.upsert));
    if (dAn.upsert.length) await this.throwing(this.client.from("document_annotations").upsert(dAn.upsert));

    // Deletes child → parent (also covers whole-document deletion; cascade is a backstop).
    const removedDocIds = base.filter((d) => !current.some((c) => c.id === d.id)).map((d) => d.id);
    if (dAn.deleteIds.length) await this.throwing(this.client.from("document_annotations").delete().in("id", dAn.deleteIds));
    if (dHl.deleteIds.length) await this.throwing(this.client.from("document_highlights").delete().in("id", dHl.deleteIds));
    if (dPas.deleteIds.length) await this.throwing(this.client.from("document_passages").delete().in("id", dPas.deleteIds));
    if (dSec.deleteIds.length) await this.throwing(this.client.from("document_sections").delete().in("id", dSec.deleteIds));
    if (removedDocIds.length) await this.throwing(this.client.from("reading_documents").delete().in("id", removedDocIds));
  }

  private async syncCitations(current: Citation[], base: Citation[]): Promise<void> {
    const cur = current.map(citationToRow);
    const prev = base.map(citationToRow);
    const d = diffById<CitationRow>(cur, prev);
    if (d.upsert.length) await this.throwing(this.client.from("document_citations").upsert(d.upsert));
    if (d.deleteIds.length) await this.throwing(this.client.from("document_citations").delete().in("id", d.deleteIds));
  }

  /**
   * Record tombstones for deleted independently-synced records (LIFEOS-033) so a
   * stale device can't resurrect them. Best-effort + guarded: a missing 0024
   * table is a no-op, never a sync failure. Stores only {domain, record_id}.
   */
  private async writeTombstones(domain: string, deleteIds: string[]): Promise<void> {
    if (!deleteIds.length) return;
    try {
      const rows = deleteIds.map((id) => ({ domain, record_id: id, deleted_at: new Date().toISOString() }));
      await this.client.from("sync_tombstones").upsert(rows, { onConflict: "user_id,domain,record_id" });
    } catch { /* 0024 table may not exist yet — tombstones are additive */ }
  }

  /** Row-level upsert/delete for workspaces (LIFEOS-030). */
  private async syncWorkspaces(current: Workspace[], base: Workspace[]): Promise<void> {
    const d = diffById<WorkspaceRow>(current.map(workspaceToRow), base.map(workspaceToRow));
    if (d.upsert.length) await this.throwing(this.client.from("workspaces").upsert(d.upsert));
    // Deleting a workspace cascades its sessions in the DB; the client also
    // removes the session rows below, so an explicit delete here is enough.
    if (d.deleteIds.length) { await this.throwing(this.client.from("workspaces").delete().in("id", d.deleteIds)); await this.writeTombstones("workspaces", d.deleteIds); }
  }

  /** Row-level upsert/delete for sessions (LIFEOS-030). */
  private async syncSessions(current: WorkspaceSession[], base: WorkspaceSession[]): Promise<void> {
    const d = diffById<SessionRow>(current.map(sessionToRow), base.map(sessionToRow));
    if (d.upsert.length) await this.throwing(this.client.from("workspace_sessions").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("workspace_sessions").delete().in("id", d.deleteIds)); await this.writeTombstones("sessions", d.deleteIds); }
  }

  /** Row-level upsert/delete for goals (LIFEOS-031). */
  private async syncGoals(current: Goal[], base: Goal[]): Promise<void> {
    const d = diffById<GoalRow>(current.map(goalToRow), base.map(goalToRow));
    if (d.upsert.length) await this.throwing(this.client.from("goals").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("goals").delete().in("id", d.deleteIds)); await this.writeTombstones("goals", d.deleteIds); }
  }

  /** Row-level upsert/delete for projects (milestones embedded, LIFEOS-031). */
  private async syncProjects(current: Project[], base: Project[]): Promise<void> {
    const d = diffById<ExecProjectRow>(current.map(execProjectToRow), base.map(execProjectToRow));
    if (d.upsert.length) await this.throwing(this.client.from("projects").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("projects").delete().in("id", d.deleteIds)); await this.writeTombstones("projects", d.deleteIds); }
  }

  /** Load goals + projects, resilient to the 0023 tables being absent. */
  private async loadExecution(): Promise<{ goals: Goal[]; projects: Project[] }> {
    try {
      const [goals, projects] = await Promise.all([
        this.client.from("goals").select("*").order("updated_at", { ascending: false }),
        this.client.from("projects").select("*").order("updated_at", { ascending: false }),
      ]);
      if (goals.error || projects.error) return { goals: [], projects: [] };
      return {
        goals: (goals.data ?? []).map(rowToGoal),
        projects: (projects.data ?? []).map(rowToExecProject),
      };
    } catch {
      return { goals: [], projects: [] };
    }
  }

  /** Row-level upsert/delete for daily reviews (LIFEOS-034). */
  private async syncDailyReviews(current: DailyReview[], base: DailyReview[]): Promise<void> {
    const d = diffById<DailyReviewRow>(current.map(dailyReviewToRow), base.map(dailyReviewToRow));
    if (d.upsert.length) await this.throwing(this.client.from("daily_reviews").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("daily_reviews").delete().in("id", d.deleteIds)); await this.writeTombstones("dailyReviews", d.deleteIds); }
  }

  /** Row-level upsert/delete for next actions (LIFEOS-036). */
  private async syncNextActions(current: NextAction[], base: NextAction[]): Promise<void> {
    const d = diffById<NextActionRow>(current.map(actionToRow), base.map(actionToRow));
    if (d.upsert.length) await this.throwing(this.client.from("next_actions").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("next_actions").delete().in("id", d.deleteIds)); await this.writeTombstones("nextActions", d.deleteIds); }
  }

  /** Row-level upsert/delete for action dependencies (LIFEOS-036). */
  private async syncActionDependencies(current: ActionDependency[], base: ActionDependency[]): Promise<void> {
    const d = diffById<ActionDependencyRow>(current.map(dependencyToRow), base.map(dependencyToRow));
    if (d.upsert.length) await this.throwing(this.client.from("action_dependencies").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("action_dependencies").delete().in("id", d.deleteIds)); await this.writeTombstones("actionDependencies", d.deleteIds); }
  }

  /** Row-level upsert/delete for action templates (LIFEOS-036). */
  private async syncActionTemplates(current: ActionTemplate[], base: ActionTemplate[]): Promise<void> {
    const d = diffById<ActionTemplateRow>(current.map(templateToRow), base.map(templateToRow));
    if (d.upsert.length) await this.throwing(this.client.from("action_templates").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("action_templates").delete().in("id", d.deleteIds)); await this.writeTombstones("actionTemplates", d.deleteIds); }
  }

  /** Row-level upsert/delete for planning assignments (LIFEOS-037). */
  private async syncPlanningAssignments(current: PlanningAssignment[], base: PlanningAssignment[]): Promise<void> {
    const d = diffById<PlanningAssignmentRow>(current.map(planningToRow), base.map(planningToRow));
    if (d.upsert.length) await this.throwing(this.client.from("planning_assignments").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("planning_assignments").delete().in("id", d.deleteIds)); await this.writeTombstones("planningAssignments", d.deleteIds); }
  }

  /** Row-level upsert/delete for focus sessions (LIFEOS-037). */
  private async syncFocusSessions(current: FocusSession[], base: FocusSession[]): Promise<void> {
    const d = diffById<FocusSessionRow>(current.map(focusToRow), base.map(focusToRow));
    if (d.upsert.length) await this.throwing(this.client.from("focus_sessions").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("focus_sessions").delete().in("id", d.deleteIds)); await this.writeTombstones("focusSessions", d.deleteIds); }
  }

  /** Row-level upsert/delete for maintenance events (LIFEOS-038, append-only). */
  private async syncMaintenanceEvents(current: MaintenanceEvent[], base: MaintenanceEvent[]): Promise<void> {
    const d = diffById<MaintenanceEventRow>(current.map(maintenanceEventToRow), base.map(maintenanceEventToRow));
    if (d.upsert.length) await this.throwing(this.client.from("maintenance_events").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("maintenance_events").delete().in("id", d.deleteIds)); await this.writeTombstones("maintenanceEvents", d.deleteIds); }
  }

  /** Row-level upsert/delete for duplicate-candidate decisions (LIFEOS-038). */
  private async syncDuplicateCandidates(current: DuplicateCandidate[], base: DuplicateCandidate[]): Promise<void> {
    const d = diffById<DuplicateCandidateRow>(current.map(duplicateToRow), base.map(duplicateToRow));
    if (d.upsert.length) await this.throwing(this.client.from("duplicate_candidates").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("duplicate_candidates").delete().in("id", d.deleteIds)); await this.writeTombstones("duplicateCandidates", d.deleteIds); }
  }

  /** Row-level upsert/delete for saved insight views (LIFEOS-039). */
  private async syncInsightViews(current: SavedInsightView[], base: SavedInsightView[]): Promise<void> {
    const d = diffById<SavedInsightViewRow>(current.map(insightViewToRow), base.map(insightViewToRow));
    if (d.upsert.length) await this.throwing(this.client.from("saved_insight_views").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("saved_insight_views").delete().in("id", d.deleteIds)); await this.writeTombstones("savedInsightViews", d.deleteIds); }
  }

  /** Row-level upsert/delete for protocols (LIFEOS-054). */
  private async syncProtocols(current: Protocol[], base: Protocol[]): Promise<void> {
    const d = diffById<ProtocolRow>(current.map(protocolToRow), base.map(protocolToRow));
    if (d.upsert.length) await this.throwing(this.client.from("protocols").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("protocols").delete().in("id", d.deleteIds)); await this.writeTombstones("protocols", d.deleteIds); }
  }

  /** Load protocols, resilient to the 0037 table being absent. */
  private async loadProtocols(): Promise<Protocol[]> {
    try {
      const res = await this.client.from("protocols").select("*").order("updated_at", { ascending: false });
      if (res.error) return [];
      return (res.data ?? []).map(rowToProtocol);
    } catch { return []; }
  }

  /** Row-level upsert/delete for events (LIFEOS-061). */
  private async syncEvents(current: LifeEvent[], base: LifeEvent[]): Promise<void> {
    const d = diffById<EventRow>(current.map(eventToRow), base.map(eventToRow));
    if (d.upsert.length) await this.throwing(this.client.from("events").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("events").delete().in("id", d.deleteIds)); await this.writeTombstones("events", d.deleteIds); }
  }

  /** Load events, resilient to the 0040 table being absent. */
  private async loadEvents(): Promise<LifeEvent[]> {
    try {
      const res = await this.client.from("events").select("*").order("date", { ascending: true });
      if (res.error) return [];
      return (res.data ?? []).map(rowToEvent);
    } catch { return []; }
  }

  /**
   * Row-level upsert/delete for recurrence completions (LIFEOS-061).
   *
   * `(action_id, occurrence_date)` is unique in the database, so a duplicate
   * upsert from a racing device is rejected by the constraint rather than
   * creating a second record of the same Sunday.
   */
  private async syncRecurrenceCompletions(current: RecurrenceCompletion[], base: RecurrenceCompletion[]): Promise<void> {
    const d = diffById<RecurrenceCompletionRow>(current.map(completionToRow), base.map(completionToRow));
    if (d.upsert.length) await this.throwing(this.client.from("recurrence_completions").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("recurrence_completions").delete().in("id", d.deleteIds)); await this.writeTombstones("recurrenceCompletions", d.deleteIds); }
  }

  /** Load completion history, resilient to the 0040 table being absent. */
  private async loadRecurrenceCompletions(): Promise<RecurrenceCompletion[]> {
    try {
      const res = await this.client.from("recurrence_completions").select("*").order("occurrence_date", { ascending: false });
      if (res.error) return [];
      return (res.data ?? []).map(rowToCompletion);
    } catch { return []; }
  }

  /**
   * Row-level upsert/delete for constitution elements (LIFEOS-056).
   *
   * Deleting an element cascades its revisions IN THE DATABASE (0038), so the
   * local revision rows are dropped by the store at the same time and the two
   * stay consistent. The tombstone carries only `{domain, recordId, deletedAt}`
   * — never the statement text.
   */
  private async syncConstitutionElements(current: ConstitutionElement[], base: ConstitutionElement[]): Promise<void> {
    const d = diffById<ConstitutionElementRow>(current.map(constitutionElementToRow), base.map(constitutionElementToRow));
    if (d.upsert.length) await this.throwing(this.client.from("constitution_elements").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("constitution_elements").delete().in("id", d.deleteIds)); await this.writeTombstones("constitutionElements", d.deleteIds); }
  }

  /** Row-level upsert/delete for constitution revisions (LIFEOS-056). */
  private async syncConstitutionRevisions(current: ConstitutionRevision[], base: ConstitutionRevision[]): Promise<void> {
    const d = diffById<ConstitutionRevisionRow>(current.map(constitutionRevisionToRow), base.map(constitutionRevisionToRow));
    if (d.upsert.length) await this.throwing(this.client.from("constitution_revisions").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("constitution_revisions").delete().in("id", d.deleteIds)); await this.writeTombstones("constitutionRevisions", d.deleteIds); }
  }

  /** Load constitution elements, resilient to the 0038 table being absent. */
  private async loadConstitutionElements(): Promise<ConstitutionElement[]> {
    try {
      const res = await this.client.from("constitution_elements").select("*").order("updated_at", { ascending: false });
      if (res.error) return [];
      return (res.data ?? []).map(rowToConstitutionElement);
    } catch { return []; }
  }

  /** Load constitution revisions, resilient to the 0038 table being absent. */
  private async loadConstitutionRevisions(): Promise<ConstitutionRevision[]> {
    try {
      const res = await this.client.from("constitution_revisions").select("*").order("at", { ascending: true });
      if (res.error) return [];
      return (res.data ?? []).map(rowToConstitutionRevision);
    } catch { return []; }
  }

  /** Row-level upsert/delete for notes (LIFEOS-052). */
  private async syncNotes(current: Note[], base: Note[]): Promise<void> {
    const d = diffById<NoteRow>(current.map(noteToRow), base.map(noteToRow));
    if (d.upsert.length) await this.throwing(this.client.from("notes").upsert(d.upsert));
    if (d.deleteIds.length) { await this.throwing(this.client.from("notes").delete().in("id", d.deleteIds)); await this.writeTombstones("notes", d.deleteIds); }
  }

  /** Load notes, resilient to the 0035 table being absent. */
  private async loadNotes(): Promise<Note[]> {
    try {
      const res = await this.client.from("notes").select("*").order("updated_at", { ascending: false });
      if (res.error) return [];
      return (res.data ?? []).map(rowToNote);
    } catch { return []; }
  }

  /** Load saved insight views, resilient to the 0030 table being absent. */
  private async loadInsightViews(): Promise<SavedInsightView[]> {
    try {
      const res = await this.client.from("saved_insight_views").select("*").order("updated_at", { ascending: false });
      if (res.error) return [];
      return (res.data ?? []).map(rowToInsightView);
    } catch {
      return [];
    }
  }

  /** Load maintenance events + duplicate decisions, resilient to the 0029 tables being absent. */
  private async loadMaintenance(): Promise<{ maintenanceEvents: MaintenanceEvent[]; duplicateCandidates: DuplicateCandidate[] }> {
    try {
      const [events, dups] = await Promise.all([
        this.client.from("maintenance_events").select("*").order("at", { ascending: true }),
        this.client.from("duplicate_candidates").select("*").order("updated_at", { ascending: false }),
      ]);
      if (events.error || dups.error) return { maintenanceEvents: [], duplicateCandidates: [] };
      return {
        maintenanceEvents: (events.data ?? []).map(rowToMaintenanceEvent),
        duplicateCandidates: (dups.data ?? []).map(rowToDuplicate),
      };
    } catch {
      return { maintenanceEvents: [], duplicateCandidates: [] };
    }
  }

  /** Load daily reviews, resilient to the 0025 table being absent. */
  private async loadDailyReviews(): Promise<DailyReview[]> {
    try {
      const res = await this.client.from("daily_reviews").select("*").order("date", { ascending: false });
      if (res.error) return [];
      return (res.data ?? []).map(rowToDailyReview);
    } catch {
      return [];
    }
  }

  /** Load next actions + dependencies + templates, resilient to the 0027 tables being absent. */
  private async loadActions(): Promise<{ nextActions: NextAction[]; actionDependencies: ActionDependency[]; actionTemplates: ActionTemplate[] }> {
    try {
      const [actions, deps, templates] = await Promise.all([
        this.client.from("next_actions").select("*").order("updated_at", { ascending: false }),
        this.client.from("action_dependencies").select("*"),
        this.client.from("action_templates").select("*").order("updated_at", { ascending: false }),
      ]);
      if (actions.error || deps.error || templates.error) return { nextActions: [], actionDependencies: [], actionTemplates: [] };
      return {
        nextActions: (actions.data ?? []).map(rowToAction),
        actionDependencies: (deps.data ?? []).map(rowToDependency),
        actionTemplates: (templates.data ?? []).map(rowToTemplate),
      };
    } catch {
      return { nextActions: [], actionDependencies: [], actionTemplates: [] };
    }
  }

  /** Load planning assignments + focus sessions, resilient to the 0028 tables being absent. */
  private async loadPlanning(): Promise<{ planningAssignments: PlanningAssignment[]; focusSessions: FocusSession[] }> {
    try {
      const [assignments, focus] = await Promise.all([
        this.client.from("planning_assignments").select("*").order("updated_at", { ascending: false }),
        this.client.from("focus_sessions").select("*").order("started_at", { ascending: false }),
      ]);
      if (assignments.error || focus.error) return { planningAssignments: [], focusSessions: [] };
      return {
        planningAssignments: (assignments.data ?? []).map(rowToPlanning),
        focusSessions: (focus.data ?? []).map(rowToFocus),
      };
    } catch {
      return { planningAssignments: [], focusSessions: [] };
    }
  }

  /** Load workspaces + sessions, resilient to the 0022 tables being absent. */
  private async loadWorkspaces(): Promise<{ workspaces: Workspace[]; sessions: WorkspaceSession[] }> {
    try {
      const [workspaces, sessions] = await Promise.all([
        this.client.from("workspaces").select("*").order("updated_at", { ascending: false }),
        this.client.from("workspace_sessions").select("*").order("started_at", { ascending: false }),
      ]);
      if (workspaces.error || sessions.error) return { workspaces: [], sessions: [] };
      return {
        workspaces: (workspaces.data ?? []).map(rowToWorkspace),
        sessions: (sessions.data ?? []).map(rowToSession),
      };
    } catch {
      return { workspaces: [], sessions: [] };
    }
  }

  async saveSource(source: KnowledgeSource): Promise<void> {
    await this.throwing(this.client.from("sources").upsert(sourceToRow(source)));
    if (source.keyQuotes.length) {
      await this.insertIgnore(
        "saved_quotes",
        source.keyQuotes.map((text) => ({ source_id: source.id, text })),
        "source_id,text",
      );
    }
  }

  async saveCapture(capture: Capture): Promise<void> {
    await this.throwing(this.client.from("captures").upsert(captureToRow(capture)));
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    await this.throwing(this.client.from("proposals").upsert(proposalToRow(proposal)));
  }

  async saveBelief(belief: Belief): Promise<void> {
    await this.throwing(this.client.from("beliefs").upsert(beliefToRow(belief)));
    await this.insertIgnore(
      "belief_revisions",
      belief.revisions.map((r, seq) => ({ belief_id: belief.id, seq, text: r.text, reason: r.reason, at: r.at })),
      "belief_id,seq",
    );
    await this.insertIgnore(
      "user_judgments",
      belief.judgments.map((j, seq) => ({ belief_id: belief.id, seq, decision: j.decision, note: j.note ?? null, at: j.at })),
      "belief_id,seq",
    );
  }

  async saveRevision(beliefId: string, seq: number, revision: RevisionEntry): Promise<void> {
    await this.insertIgnore(
      "belief_revisions",
      [{ belief_id: beliefId, seq, text: revision.text, reason: revision.reason, at: revision.at }],
      "belief_id,seq",
    );
  }

  async saveJudgment(beliefId: string, seq: number, judgment: JudgmentEntry): Promise<void> {
    await this.insertIgnore(
      "user_judgments",
      [{ belief_id: beliefId, seq, decision: judgment.decision, note: judgment.note ?? null, at: judgment.at }],
      "belief_id,seq",
    );
  }

  async saveQuote(sourceId: string, quote: string): Promise<void> {
    await this.insertIgnore("saved_quotes", [{ source_id: sourceId, text: quote }], "source_id,text");
  }

  /** Load the reading hierarchy + citations, resilient to missing tables. */
  private async loadReading(): Promise<{ documents: ReadingDocument[]; citations: Citation[] }> {
    try {
      const [docs, secs, pass, hls, anns, cites] = await Promise.all([
        this.client.from("reading_documents").select("*"),
        this.client.from("document_sections").select("*"),
        this.client.from("document_passages").select("*"),
        this.client.from("document_highlights").select("*"),
        this.client.from("document_annotations").select("*"),
        this.client.from("document_citations").select("*"),
      ]);
      // A missing table / permission error → treat reading as empty (graceful).
      if (docs.error || secs.error || pass.error || hls.error || anns.error || cites.error) {
        return { documents: [], citations: [] };
      }
      const documents = rowsToDocuments(
        (docs.data ?? []) as DocumentRow[], (secs.data ?? []) as SectionRow[], (pass.data ?? []) as PassageRow[],
        (hls.data ?? []) as HighlightRow[], (anns.data ?? []) as AnnotationRow[],
      );
      const citations: Citation[] = ((cites.data ?? []) as CitationRow[]).map((r) => ({
        id: r.id, recordKind: r.record_kind, recordId: r.record_id, documentId: r.document_id,
        documentTitle: documents.find((d) => d.id === r.document_id)?.title ?? "",
        author: documents.find((d) => d.id === r.document_id)?.authors[0],
        sectionId: r.section_id ?? undefined, passageId: r.passage_id ?? undefined, highlightId: r.highlight_id ?? undefined,
        page: r.page ?? undefined, location: r.location ?? undefined, createdAt: r.created_at,
      }));
      return { documents, citations };
    } catch {
      return { documents: [], citations: [] };
    }
  }

  async deleteAll(): Promise<void> {
    const uid = await this.uid();
    if (!uid) return;
    // Reading library: deleting the documents cascades sections/passages/
    // highlights/annotations/citations. Guarded so a missing 0021 table is a
    // no-op rather than an error.
    try { await this.client.from("reading_documents").delete().eq("user_id", uid); } catch { /* table may not exist yet */ }
    // Workspaces & sessions (LIFEOS-030): deleting a workspace cascades its
    // sessions; guarded so a missing 0022 table is a no-op rather than an error.
    try { await this.client.from("workspace_sessions").delete().eq("user_id", uid); } catch { /* table may not exist yet */ }
    try { await this.client.from("workspaces").delete().eq("user_id", uid); } catch { /* table may not exist yet */ }
    // Goals & projects (LIFEOS-031): delete projects first (goal_id FK), guarded.
    try { await this.client.from("projects").delete().eq("user_id", uid); } catch { /* table may not exist yet */ }
    try { await this.client.from("goals").delete().eq("user_id", uid); } catch { /* table may not exist yet */ }
    // Daily reviews (LIFEOS-034), guarded.
    try { await this.client.from("daily_reviews").delete().eq("user_id", uid); } catch { /* table may not exist yet */ }
    try { await this.client.from("sync_tombstones").delete().eq("domain", "dailyReviews"); } catch { /* table may not exist yet */ }
    try { await this.client.from("sync_tombstones").delete().eq("user_id", uid); } catch { /* 0024 table may not exist yet */ }
    // Delete beliefs first (cascades revisions/judgments), then the rest.
    // saved_quotes cascade from sources.
    await this.throwing(this.client.from("recommendations").delete().eq("user_id", uid));
    await this.throwing(this.client.from("syntheses").delete().eq("user_id", uid));
    await this.throwing(this.client.from("tensions").delete().eq("user_id", uid));
    await this.throwing(this.client.from("dialogue_sessions").delete().eq("user_id", uid));
    await this.throwing(this.client.from("research_projects").delete().eq("user_id", uid));
    await this.throwing(this.client.from("knowledge_projects").delete().eq("user_id", uid));
    await this.throwing(this.client.from("concept_relationships").delete().eq("user_id", uid));
    await this.throwing(this.client.from("frameworks").delete().eq("user_id", uid));
    await this.throwing(this.client.from("principles").delete().eq("user_id", uid));
    await this.throwing(this.client.from("concepts").delete().eq("user_id", uid));
    await this.throwing(this.client.from("formation_sessions").delete().eq("user_id", uid));
    await this.throwing(this.client.from("decisions").delete().eq("user_id", uid));
    await this.throwing(this.client.from("embeddings").delete().eq("user_id", uid));
    await this.throwing(this.client.from("reasonings").delete().eq("user_id", uid));
    await this.throwing(this.client.from("review_sessions").delete().eq("user_id", uid));
    await this.throwing(this.client.from("practices").delete().eq("user_id", uid));
    await this.throwing(this.client.from("reflections").delete().eq("user_id", uid));
    await this.throwing(this.client.from("megathreads").delete().eq("user_id", uid));
    await this.throwing(this.client.from("inquiries").delete().eq("user_id", uid));
    await this.throwing(this.client.from("comparisons").delete().eq("user_id", uid));
    await this.throwing(this.client.from("beliefs").delete().eq("user_id", uid));
    await this.throwing(this.client.from("proposals").delete().eq("user_id", uid));
    await this.throwing(this.client.from("captures").delete().eq("user_id", uid));
    await this.throwing(this.client.from("sources").delete().eq("user_id", uid));
  }

  health(): PersistenceHealth {
    return { mode: "supabase", state: this.lastState, error: this.lastError };
  }

  private async throwing(query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
    const { error } = await query;
    if (error) {
      this.lastState = "failed";
      this.lastError = error.message;
      throw new Error(error.message);
    }
  }

  private async insertIgnore(table: string, rows: any[], onConflict: string): Promise<void> {
    if (!rows.length) return;
    await this.throwing(
      this.client.from(table).upsert(rows, { onConflict, ignoreDuplicates: true }),
    );
  }
}

// ---------- row mappers ----------

function sourceToRow(s: KnowledgeSource) {
  return {
    id: s.id,
    type: s.type,
    input: s.input,
    title: s.title,
    author: s.author ?? null,
    origin: s.origin ?? null,
    status: s.status,
    processing_state: s.processingState,
    processing_error: s.processingError ?? null,
    original_text: s.originalText,
    chunks: s.chunks,
    summary: s.summary ?? null,
    key_concepts: s.keyConcepts,
    candidate_beliefs: s.candidateBeliefs,
    derived_source: s.derivedSource ?? null,
    chunk_results: s.chunkResults ?? [],
    analysis: s.analysis ?? null,
    stages: s.stages ?? null,
    pdf_meta: s.pdfMeta ?? null,
    page_map: s.pageMap ?? null,
    extraction_status: s.extractionStatus ?? null,
    added_at: s.addedAt,
  };
}

function rowToSource(r: any, keyQuotes: string[]): KnowledgeSource {
  return {
    id: r.id,
    type: r.type as SourceType,
    input: r.input,
    title: r.title,
    author: r.author ?? undefined,
    origin: r.origin ?? undefined,
    addedAt: r.added_at,
    status: r.status,
    processingState: r.processing_state,
    processingError: r.processing_error ?? undefined,
    originalText: r.original_text ?? "",
    chunks: (r.chunks ?? []) as KnowledgeChunk[],
    summary: r.summary ?? undefined,
    keyQuotes,
    keyConcepts: (r.key_concepts ?? []) as string[],
    candidateBeliefs: (r.candidate_beliefs ?? []) as string[],
    derivedSource: r.derived_source ?? undefined,
    chunkResults: (r.chunk_results ?? []) as KnowledgeSource["chunkResults"],
    analysis: (r.analysis ?? undefined) as KnowledgeSource["analysis"],
    stages: (r.stages ?? undefined) as KnowledgeSource["stages"],
    pdfMeta: (r.pdf_meta ?? undefined) as KnowledgeSource["pdfMeta"],
    pageMap: (r.page_map ?? undefined) as KnowledgeSource["pageMap"],
    extractionStatus: (r.extraction_status ?? undefined) as KnowledgeSource["extractionStatus"],
  };
}

function captureToRow(c: Capture) {
  return {
    id: c.id, text: c.text, source_id: c.sourceId ?? null, created_at: c.createdAt,
    // Processing metadata (LIFEOS-035). `text` is never changed here.
    processing_status: c.processingStatus ?? "inbox",
    processed_at: c.processedAt ?? null, processed_by_action: c.processedByAction ?? null,
    processed_in_session: c.processedInSession ?? null, deferred_until: c.deferredUntil ?? null,
    archived_at: c.archivedAt ?? null, discarded_at: c.discardedAt ?? null,
    source_context: c.sourceContext ?? {},
    linked_workspace_ids: c.linkedWorkspaceIds ?? [], linked_goal_ids: c.linkedGoalIds ?? [],
    linked_project_ids: c.linkedProjectIds ?? [], linked_entity_refs: c.linkedEntityRefs ?? [],
    processing_notes: c.processingNotes ?? "", tags: c.tags ?? [], working_text: c.workingText ?? null,
    split_from_id: c.splitFromId ?? null, merged_from_ids: c.mergedFromIds ?? [], processing_history: c.history ?? [],
  };
}
function rowToCapture(r: any): Capture {
  return {
    id: r.id, text: r.text, sourceId: r.source_id ?? undefined, createdAt: r.created_at,
    processingStatus: r.processing_status ?? "inbox",
    processedAt: r.processed_at ?? undefined, processedByAction: r.processed_by_action ?? undefined,
    processedInSession: r.processed_in_session ?? undefined, deferredUntil: r.deferred_until ?? undefined,
    archivedAt: r.archived_at ?? undefined, discardedAt: r.discarded_at ?? undefined,
    sourceContext: r.source_context && typeof r.source_context === "object" ? r.source_context : undefined,
    linkedWorkspaceIds: Array.isArray(r.linked_workspace_ids) ? r.linked_workspace_ids : [],
    linkedGoalIds: Array.isArray(r.linked_goal_ids) ? r.linked_goal_ids : [],
    linkedProjectIds: Array.isArray(r.linked_project_ids) ? r.linked_project_ids : [],
    linkedEntityRefs: Array.isArray(r.linked_entity_refs) ? r.linked_entity_refs : [],
    processingNotes: r.processing_notes ?? "", tags: Array.isArray(r.tags) ? r.tags : [],
    workingText: r.working_text ?? undefined, splitFromId: r.split_from_id ?? undefined,
    mergedFromIds: Array.isArray(r.merged_from_ids) ? r.merged_from_ids : [],
    history: Array.isArray(r.processing_history) ? r.processing_history : [],
  };
}

function proposalToRow(p: Proposal) {
  return {
    id: p.id,
    capture_id: p.captureId,
    claim: p.claim,
    theme: p.theme ?? null,
    span_start: p.spanStart ?? null,
    span_end: p.spanEnd ?? null,
    source: p.source,
    resolved: p.resolved,
    created_at: p.createdAt,
  };
}
function rowToProposal(r: any): Proposal {
  return {
    id: r.id,
    captureId: r.capture_id,
    claim: r.claim,
    theme: r.theme ?? undefined,
    spanStart: r.span_start ?? undefined,
    spanEnd: r.span_end ?? undefined,
    source: r.source,
    createdAt: r.created_at,
    resolved: r.resolved,
  };
}

function beliefToRow(b: Belief) {
  return {
    id: b.id,
    capture_id: b.captureId,
    proposal_id: b.proposalId,
    text: b.text,
    theme: b.theme ?? null,
    status: b.status,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}
function rowToBelief(r: any, revs: any[], juds: any[]): Belief {
  return {
    id: r.id,
    captureId: r.capture_id,
    proposalId: r.proposal_id,
    text: r.text,
    theme: r.theme ?? undefined,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revisions: [...revs]
      .sort((a, b) => a.seq - b.seq)
      .map((x) => ({ text: x.text, at: x.at, reason: x.reason } as RevisionEntry)),
    judgments: [...juds]
      .sort((a, b) => a.seq - b.seq)
      .map((x) => ({ decision: x.decision, at: x.at, note: x.note ?? undefined } as JudgmentEntry)),
  };
}

function comparisonToRow(c: Comparison) {
  return {
    id: c.id,
    title: c.title,
    question: c.question,
    inputs: c.inputs,
    source_ids: c.sourceIds,
    belief_ids: c.beliefIds,
    evidence: c.evidence,
    result: c.result,
    ai_model: c.aiModel,
    source: c.source,
    coverage: c.coverage,
    partial: c.partial,
    verified: c.verified,
    judgments: c.judgments,
    created_at: c.createdAt,
  };
}

function rowToComparison(r: any): Comparison {
  return {
    id: r.id,
    title: r.title,
    question: r.question,
    inputs: (r.inputs ?? []) as Comparison["inputs"],
    sourceIds: (r.source_ids ?? []) as string[],
    beliefIds: (r.belief_ids ?? []) as string[],
    evidence: (r.evidence ?? []) as Comparison["evidence"],
    result: r.result as Comparison["result"],
    aiModel: r.ai_model ?? "mock",
    source: r.source ?? "mock",
    coverage: r.coverage ?? null,
    partial: Boolean(r.partial),
    verified: Boolean(r.verified),
    createdAt: r.created_at,
    judgments: (r.judgments ?? []) as Comparison["judgments"],
  };
}

function inquiryToRow(i: Inquiry) {
  return {
    id: i.id,
    question: i.question,
    inputs: i.inputs,
    source_ids: i.sourceIds,
    belief_ids: i.beliefIds,
    comparison_ids: i.comparisonIds,
    evidence: i.evidence,
    result: i.result,
    history: i.history,
    ai_model: i.aiModel,
    source: i.source,
    coverage: i.coverage,
    partial: i.partial,
    verified: i.verified,
    status: i.status,
    provisional_conclusion: i.provisionalConclusion ?? null,
    judgments: i.judgments,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
  };
}

function rowToInquiry(r: any): Inquiry {
  return {
    id: r.id,
    question: r.question,
    inputs: (r.inputs ?? []) as Inquiry["inputs"],
    sourceIds: (r.source_ids ?? []) as string[],
    beliefIds: (r.belief_ids ?? []) as string[],
    comparisonIds: (r.comparison_ids ?? []) as string[],
    evidence: (r.evidence ?? []) as Inquiry["evidence"],
    result: r.result as Inquiry["result"],
    history: (r.history ?? []) as Inquiry["history"],
    aiModel: r.ai_model ?? "mock",
    source: r.source ?? "mock",
    coverage: r.coverage ?? null,
    partial: Boolean(r.partial),
    verified: Boolean(r.verified),
    status: (r.status ?? "open") as Inquiry["status"],
    provisionalConclusion: r.provisional_conclusion ?? undefined,
    judgments: (r.judgments ?? []) as Inquiry["judgments"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function megathreadToRow(t: Megathread) {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    seed_type: t.seedType,
    seed_id: t.seedId ?? null,
    seed_label: t.seedLabel ?? null,
    members: t.members,
    pinned: t.pinned,
    excluded: t.excluded,
    synthesis: t.synthesis ?? null,
    synthesis_source: t.synthesisSource ?? null,
    synthesis_evidence: t.synthesisEvidence ?? null,
    unresolved_questions: t.unresolvedQuestions,
    notes: t.notes ?? null,
    judgments: t.judgments,
    revisions: t.revisions,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

function rowToMegathread(r: any): Megathread {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    status: (r.status ?? "active") as Megathread["status"],
    seedType: (r.seed_type ?? "manual") as Megathread["seedType"],
    seedId: r.seed_id ?? undefined,
    seedLabel: r.seed_label ?? undefined,
    members: (r.members ?? []) as Megathread["members"],
    pinned: (r.pinned ?? []) as string[],
    excluded: (r.excluded ?? []) as string[],
    synthesis: (r.synthesis ?? undefined) as Megathread["synthesis"],
    synthesisSource: (r.synthesis_source ?? undefined) as Megathread["synthesisSource"],
    synthesisEvidence: (r.synthesis_evidence ?? undefined) as Megathread["synthesisEvidence"],
    unresolvedQuestions: (r.unresolved_questions ?? []) as Megathread["unresolvedQuestions"],
    notes: r.notes ?? undefined,
    judgments: (r.judgments ?? []) as Megathread["judgments"],
    revisions: (r.revisions ?? []) as Megathread["revisions"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function reflectionToRow(r: Reflection) {
  return {
    id: r.id,
    prompt: r.prompt,
    response: r.response,
    belief_ids: r.beliefIds ?? [],
    thread_ids: r.threadIds ?? [],
    source_ids: r.sourceIds ?? [],
    context: r.context ?? null,
    annotations: r.annotations,
    created_at: r.createdAt,
  };
}
function rowToReflection(r: any): Reflection {
  return {
    id: r.id,
    prompt: r.prompt ?? "",
    response: r.response ?? "",
    createdAt: r.created_at,
    beliefIds: (r.belief_ids ?? undefined) as string[] | undefined,
    threadIds: (r.thread_ids ?? undefined) as string[] | undefined,
    sourceIds: (r.source_ids ?? undefined) as string[] | undefined,
    context: r.context ?? undefined,
    annotations: (r.annotations ?? []) as Reflection["annotations"],
  };
}

function practiceToRow(p: PracticeCandidate) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    rationale: p.rationale,
    derived_from: p.derivedFrom,
    cadence: p.cadence ?? null,
    status: p.status,
    user_wording: p.userWording ?? null,
    source: p.source,
    history: p.history,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}
function rowToPractice(r: any): PracticeCandidate {
  return {
    id: r.id,
    title: r.title ?? "",
    description: r.description ?? "",
    rationale: r.rationale ?? "",
    derivedFrom: (r.derived_from ?? {}) as PracticeCandidate["derivedFrom"],
    cadence: (r.cadence ?? undefined) as PracticeCandidate["cadence"],
    status: (r.status ?? "proposed") as PracticeCandidate["status"],
    userWording: r.user_wording ?? undefined,
    source: (r.source ?? "mock") as PracticeCandidate["source"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    history: (r.history ?? []) as PracticeCandidate["history"],
  };
}

function reviewToRow(r: ReviewSession) {
  return {
    id: r.id,
    type: r.type,
    surfaced: r.surfaced,
    prompts: r.prompts ?? null,
    reflection_ids: r.reflectionIds,
    judgments: r.judgments,
    accepted_practice_ids: r.acceptedPracticeIds,
    unresolved_questions: r.unresolvedQuestions,
    synthesis: r.synthesis ?? null,
    synthesis_source: r.synthesisSource ?? null,
    alignment: r.alignment ?? null,
    alignment_source: r.alignmentSource ?? null,
    started_at: r.startedAt,
    completed_at: r.completedAt ?? null,
  };
}
function rowToReview(r: any): ReviewSession {
  return {
    id: r.id,
    type: (r.type ?? "daily") as ReviewSession["type"],
    surfaced: (r.surfaced ?? []) as ReviewSession["surfaced"],
    prompts: (r.prompts ?? undefined) as string[] | undefined,
    reflectionIds: (r.reflection_ids ?? []) as string[],
    judgments: (r.judgments ?? []) as ReviewSession["judgments"],
    acceptedPracticeIds: (r.accepted_practice_ids ?? []) as string[],
    unresolvedQuestions: (r.unresolved_questions ?? []) as string[],
    synthesis: (r.synthesis ?? undefined) as ReviewSession["synthesis"],
    synthesisSource: (r.synthesis_source ?? undefined) as ReviewSession["synthesisSource"],
    alignment: (r.alignment ?? undefined) as ReviewSession["alignment"],
    alignmentSource: (r.alignment_source ?? undefined) as ReviewSession["alignmentSource"],
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
  };
}

function reasoningToRow(q: ReasoningQuery) {
  return {
    id: q.id,
    question: q.question,
    mode: q.mode,
    scope: q.scope,
    evidence: q.evidence,
    result: q.result,
    history: q.history,
    ai_model: q.aiModel,
    source: q.source,
    coverage: q.coverage,
    partial: q.partial,
    verified: q.verified,
    status: q.status,
    provisional_conclusion: q.provisionalConclusion ?? null,
    judgments: q.judgments,
    created_at: q.createdAt,
    updated_at: q.updatedAt,
  };
}
function rowToReasoning(r: any): ReasoningQuery {
  return {
    id: r.id,
    question: r.question ?? "",
    mode: r.mode,
    scope: (r.scope ?? { kind: "all" }) as ReasoningQuery["scope"],
    evidence: (r.evidence ?? []) as ReasoningQuery["evidence"],
    result: r.result as ReasoningQuery["result"],
    history: (r.history ?? []) as ReasoningQuery["history"],
    aiModel: r.ai_model ?? "mock",
    source: r.source ?? "mock",
    coverage: r.coverage ?? null,
    partial: Boolean(r.partial),
    verified: Boolean(r.verified),
    status: (r.status ?? "open") as ReasoningQuery["status"],
    provisionalConclusion: r.provisional_conclusion ?? undefined,
    judgments: (r.judgments ?? []) as ReasoningQuery["judgments"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function embeddingToRow(e: EmbeddingRecord) {
  return {
    record_id: e.recordId,
    type: e.type,
    source_id: e.sourceId ?? null,
    content_hash: e.contentHash,
    provider: e.provider,
    model: e.model,
    dimensions: e.dimensions,
    // pgvector accepts the array literal string form `[a,b,c]`.
    embedding: `[${e.vector.join(",")}]`,
    generated_at: e.generatedAt,
  };
}
function rowToEmbedding(r: any): EmbeddingRecord {
  let vector: number[] = [];
  const raw = r.embedding;
  if (Array.isArray(raw)) vector = raw as number[];
  else if (typeof raw === "string") {
    try { vector = JSON.parse(raw) as number[]; } catch { vector = []; }
  }
  return {
    recordId: r.record_id,
    type: r.type,
    sourceId: r.source_id ?? undefined,
    contentHash: r.content_hash,
    provider: r.provider ?? "local",
    model: r.model ?? "lexical-v1",
    dimensions: r.dimensions ?? vector.length,
    generatedAt: r.generated_at,
    vector,
  };
}

function decisionToRow(d: Decision) {
  return {
    id: d.id,
    title: d.title,
    question: d.question,
    status: d.status,
    options: d.options,
    criteria: d.criteria,
    ratings: d.ratings,
    constraints: d.constraints,
    assumptions: d.assumptions,
    seed_refs: d.seedRefs,
    evidence: d.evidence,
    analysis: d.analysis ?? null,
    analysis_source: d.analysisSource ?? null,
    history: d.history,
    provisional_choice: d.provisionalChoice ?? null,
    final_choice: d.finalChoice ?? null,
    rationale: d.rationale ?? null,
    user_confidence: d.userConfidence ?? null,
    judgments: d.judgments,
    revisions: d.revisions,
    outcome_reviews: d.outcomeReviews,
    fingerprint: d.fingerprint ?? null,
    sensitive: d.sensitive ?? null,
    ai_model: d.aiModel,
    source: d.source,
    coverage: d.coverage,
    partial: d.partial,
    verified: d.verified,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}
function rowToDecision(r: any): Decision {
  return {
    id: r.id,
    title: r.title ?? "",
    question: r.question ?? "",
    status: (r.status ?? "exploring") as Decision["status"],
    options: (r.options ?? []) as Decision["options"],
    criteria: (r.criteria ?? []) as Decision["criteria"],
    ratings: (r.ratings ?? {}) as Decision["ratings"],
    constraints: (r.constraints ?? []) as string[],
    assumptions: (r.assumptions ?? []) as string[],
    seedRefs: (r.seed_refs ?? []) as string[],
    evidence: (r.evidence ?? []) as Decision["evidence"],
    analysis: (r.analysis ?? undefined) as Decision["analysis"],
    analysisSource: (r.analysis_source ?? undefined) as Decision["analysisSource"],
    history: (r.history ?? []) as Decision["history"],
    provisionalChoice: r.provisional_choice ?? undefined,
    finalChoice: r.final_choice ?? undefined,
    rationale: r.rationale ?? undefined,
    userConfidence: (r.user_confidence ?? undefined) as Decision["userConfidence"],
    judgments: (r.judgments ?? []) as Decision["judgments"],
    revisions: (r.revisions ?? []) as Decision["revisions"],
    outcomeReviews: (r.outcome_reviews ?? []) as Decision["outcomeReviews"],
    fingerprint: (r.fingerprint ?? undefined) as Decision["fingerprint"],
    sensitive: r.sensitive ?? undefined,
    aiModel: r.ai_model ?? "mock",
    source: (r.source ?? "mock") as Decision["source"],
    coverage: r.coverage ?? null,
    partial: Boolean(r.partial),
    verified: Boolean(r.verified),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function formationSessionToRow(f: FormationSession) {
  return {
    id: f.id,
    title: f.title,
    type: f.type,
    custom_type: f.customType ?? null,
    prompt: f.prompt,
    suggested_prompts: f.suggestedPrompts,
    reflection: f.reflection,
    linked_decisions: f.linkedDecisions,
    linked_beliefs: f.linkedBeliefs,
    linked_practices: f.linkedPractices,
    linked_threads: f.linkedThreads,
    linked_inquiries: f.linkedInquiries,
    linked_sources: f.linkedSources,
    linked_reflections: f.linkedReflections,
    seed_refs: f.seedRefs,
    lessons: f.lessons,
    unresolved_questions: f.unresolvedQuestions,
    emotional_observations: f.emotionalObservations,
    revised_assumptions: f.revisedAssumptions,
    belief_candidates: f.beliefCandidates,
    follow_up_reflections: f.followUpReflections,
    evidence: f.evidence,
    synthesis: f.synthesis ?? null,
    synthesis_source: f.synthesisSource ?? null,
    history: f.history,
    fingerprint: f.fingerprint ?? null,
    judgments: f.judgments,
    status: f.status,
    sensitive: f.sensitive ?? null,
    ai_model: f.aiModel,
    source: f.source,
    coverage: f.coverage,
    partial: f.partial,
    verified: f.verified,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}
function rowToFormationSession(r: any): FormationSession {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    title: r.title ?? "",
    type: (r.type ?? "open") as FormationSession["type"],
    customType: r.custom_type ?? undefined,
    prompt: r.prompt ?? "",
    suggestedPrompts: (r.suggested_prompts ?? []) as string[],
    reflection: r.reflection ?? "",
    linkedDecisions: (r.linked_decisions ?? []) as string[],
    linkedBeliefs: (r.linked_beliefs ?? []) as string[],
    linkedPractices: (r.linked_practices ?? []) as string[],
    linkedThreads: (r.linked_threads ?? []) as string[],
    linkedInquiries: (r.linked_inquiries ?? []) as string[],
    linkedSources: (r.linked_sources ?? []) as string[],
    linkedReflections: (r.linked_reflections ?? []) as string[],
    seedRefs: (r.seed_refs ?? []) as string[],
    lessons: (r.lessons ?? []) as string[],
    unresolvedQuestions: (r.unresolved_questions ?? []) as string[],
    emotionalObservations: (r.emotional_observations ?? []) as string[],
    revisedAssumptions: (r.revised_assumptions ?? []) as string[],
    beliefCandidates: (r.belief_candidates ?? []) as string[],
    followUpReflections: (r.follow_up_reflections ?? []) as string[],
    evidence: (r.evidence ?? []) as FormationSession["evidence"],
    synthesis: (r.synthesis ?? undefined) as FormationSession["synthesis"],
    synthesisSource: (r.synthesis_source ?? undefined) as FormationSession["synthesisSource"],
    history: (r.history ?? []) as FormationSession["history"],
    fingerprint: (r.fingerprint ?? undefined) as FormationSession["fingerprint"],
    judgments: (r.judgments ?? []) as FormationSession["judgments"],
    status: (r.status ?? "draft") as FormationSession["status"],
    sensitive: r.sensitive ?? undefined,
    aiModel: r.ai_model ?? "mock",
    source: (r.source ?? "mock") as FormationSession["source"],
    coverage: r.coverage ?? null,
    partial: Boolean(r.partial),
    verified: Boolean(r.verified),
  };
}

function conceptToRow(c: Concept) {
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    definition: c.definition,
    description: c.description,
    related_beliefs: c.relatedBeliefs,
    related_threads: c.relatedThreads,
    related_sources: c.relatedSources,
    related_practices: c.relatedPractices,
    parent_concepts: c.parentConcepts,
    child_concepts: c.childConcepts,
    related_concepts: c.relatedConcepts,
    opposing_concepts: c.opposingConcepts,
    principle_ids: c.principleIds,
    questions: c.questions,
    history: c.history,
    status: c.status,
    fingerprint: c.fingerprint ?? null,
    source: c.source,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}
function rowToConcept(r: any): Concept {
  return {
    id: r.id,
    name: r.name ?? "",
    aliases: (r.aliases ?? []) as string[],
    definition: r.definition ?? "",
    description: r.description ?? "",
    relatedBeliefs: (r.related_beliefs ?? []) as string[],
    relatedThreads: (r.related_threads ?? []) as string[],
    relatedSources: (r.related_sources ?? []) as string[],
    relatedPractices: (r.related_practices ?? []) as string[],
    parentConcepts: (r.parent_concepts ?? []) as string[],
    childConcepts: (r.child_concepts ?? []) as string[],
    relatedConcepts: (r.related_concepts ?? []) as string[],
    opposingConcepts: (r.opposing_concepts ?? []) as string[],
    principleIds: (r.principle_ids ?? []) as string[],
    questions: (r.questions ?? []) as string[],
    history: (r.history ?? []) as Concept["history"],
    status: (r.status ?? "active") as Concept["status"],
    fingerprint: (r.fingerprint ?? undefined) as Concept["fingerprint"],
    source: (r.source ?? "user") as Concept["source"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function relationshipToRow(r: ConceptRelationship) {
  return {
    id: r.id,
    from_concept_id: r.fromConceptId,
    to_concept_id: r.toConceptId,
    type: r.type,
    reason: r.reason,
    citations: r.citations,
    confidence: r.confidence,
    source: r.source,
    approved: r.approved,
    history: r.history,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}
function rowToRelationship(r: any): ConceptRelationship {
  return {
    id: r.id,
    fromConceptId: r.from_concept_id,
    toConceptId: r.to_concept_id,
    type: r.type,
    reason: r.reason ?? "",
    citations: (r.citations ?? []) as string[],
    confidence: (r.confidence ?? "medium") as ConceptRelationship["confidence"],
    source: (r.source ?? "user") as ConceptRelationship["source"],
    approved: Boolean(r.approved),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    history: (r.history ?? []) as ConceptRelationship["history"],
  };
}

function principleToRow(p: Principle) {
  return {
    id: p.id,
    statement: p.statement,
    description: p.description ?? null,
    concept_ids: p.conceptIds,
    belief_ids: p.beliefIds,
    citations: p.citations,
    status: p.status,
    history: p.history,
    source: p.source,
    fingerprint: p.fingerprint ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}
function rowToPrinciple(r: any): Principle {
  return {
    id: r.id,
    statement: r.statement ?? "",
    description: r.description ?? undefined,
    conceptIds: (r.concept_ids ?? []) as string[],
    beliefIds: (r.belief_ids ?? []) as string[],
    citations: (r.citations ?? []) as string[],
    status: (r.status ?? "active") as Principle["status"],
    history: (r.history ?? []) as Principle["history"],
    source: (r.source ?? "user") as Principle["source"],
    fingerprint: (r.fingerprint ?? undefined) as Principle["fingerprint"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function frameworkToRow(f: Framework) {
  return {
    id: f.id,
    name: f.name,
    kind: f.kind,
    description: f.description,
    concept_ids: f.conceptIds,
    principle_ids: f.principleIds,
    status: f.status,
    history: f.history,
    source: f.source,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}
function rowToFramework(r: any): Framework {
  return {
    id: r.id,
    name: r.name ?? "",
    kind: (r.kind ?? "framework") as Framework["kind"],
    description: r.description ?? "",
    conceptIds: (r.concept_ids ?? []) as string[],
    principleIds: (r.principle_ids ?? []) as string[],
    status: (r.status ?? "active") as Framework["status"],
    history: (r.history ?? []) as Framework["history"],
    source: (r.source ?? "user") as Framework["source"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function projectToRow(p: KnowledgeProject) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    purpose: p.purpose,
    audience: p.audience,
    kind: p.kind,
    status: p.status,
    assembly: p.assembly,
    outline_options: p.outlineOptions,
    chosen_outline_id: p.chosenOutlineId ?? null,
    sections: p.sections,
    history: p.history,
    fingerprint: p.fingerprint ?? null,
    ai_model: p.aiModel,
    source: p.source,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}
function rowToProject(r: any): KnowledgeProject {
  return {
    id: r.id,
    title: r.title ?? "",
    description: r.description ?? "",
    purpose: r.purpose ?? "",
    audience: r.audience ?? "",
    kind: (r.kind ?? "essay") as KnowledgeProject["kind"],
    status: (r.status ?? "planning") as KnowledgeProject["status"],
    assembly: (r.assembly ?? {}) as KnowledgeProject["assembly"],
    outlineOptions: (r.outline_options ?? []) as KnowledgeProject["outlineOptions"],
    chosenOutlineId: r.chosen_outline_id ?? undefined,
    sections: (r.sections ?? []) as KnowledgeProject["sections"],
    history: (r.history ?? []) as KnowledgeProject["history"],
    fingerprint: (r.fingerprint ?? undefined) as KnowledgeProject["fingerprint"],
    aiModel: r.ai_model ?? "mock",
    source: (r.source ?? "mock") as KnowledgeProject["source"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function researchToRow(p: ResearchProject) {
  return {
    id: p.id,
    title: p.title,
    question: p.question,
    description: p.description,
    purpose: p.purpose,
    scope: p.scope,
    status: p.status,
    questions: p.questions,
    assembly: p.assembly,
    notes: p.notes,
    hypotheses: p.hypotheses,
    argument_nodes: p.argumentNodes,
    argument_edges: p.argumentEdges,
    history: p.history,
    fingerprint: p.fingerprint ?? null,
    seeded_project_id: p.seededProjectId ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}
function rowToResearch(r: any): ResearchProject {
  return {
    id: r.id,
    title: r.title ?? "",
    question: r.question ?? "",
    description: r.description ?? "",
    purpose: r.purpose ?? "",
    scope: r.scope ?? "",
    status: (r.status ?? "open") as ResearchProject["status"],
    questions: (r.questions ?? { subquestions: [], unknowns: [], assumptions: [], definitions: [], successCriteria: [], openProblems: [] }) as ResearchProject["questions"],
    assembly: (r.assembly ?? {}) as ResearchProject["assembly"],
    notes: (r.notes ?? []) as ResearchProject["notes"],
    hypotheses: (r.hypotheses ?? []) as ResearchProject["hypotheses"],
    argumentNodes: (r.argument_nodes ?? []) as ResearchProject["argumentNodes"],
    argumentEdges: (r.argument_edges ?? []) as ResearchProject["argumentEdges"],
    history: (r.history ?? []) as ResearchProject["history"],
    fingerprint: (r.fingerprint ?? undefined) as ResearchProject["fingerprint"],
    seededProjectId: r.seeded_project_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function dialogueToRow(d: DialogueSession) {
  return {
    id: d.id,
    title: d.title,
    topic: d.topic,
    purpose: d.purpose,
    status: d.status,
    participants: d.participants,
    seed_refs: d.seedRefs,
    turns: d.turns,
    outcomes: d.outcomes,
    history: d.history,
    fingerprint: d.fingerprint ?? null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}
function rowToDialogue(r: any): DialogueSession {
  return {
    id: r.id,
    title: r.title ?? "",
    topic: r.topic ?? "",
    purpose: r.purpose ?? "",
    status: (r.status ?? "open") as DialogueSession["status"],
    participants: (r.participants ?? []) as DialogueSession["participants"],
    seedRefs: (r.seed_refs ?? []) as string[],
    turns: (r.turns ?? []) as DialogueSession["turns"],
    outcomes: (r.outcomes ?? []) as DialogueSession["outcomes"],
    history: (r.history ?? []) as DialogueSession["history"],
    fingerprint: (r.fingerprint ?? undefined) as DialogueSession["fingerprint"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function tensionToRow(t: Tension) {
  return {
    id: t.id,
    dialogue_id: t.dialogueId,
    kind: t.kind,
    title: t.title,
    thesis: t.thesis,
    antithesis: t.antithesis,
    thesis_refs: t.thesisRefs,
    antithesis_refs: t.antithesisRefs,
    evidence: t.evidence,
    confidence: t.confidence,
    unresolved_questions: t.unresolvedQuestions,
    status: t.status,
    origin: t.origin,
    detail: t.detail ?? null,
    signature: t.signature,
    history: t.history,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}
function rowToTension(r: any): Tension {
  return {
    id: r.id,
    dialogueId: r.dialogue_id,
    kind: r.kind as Tension["kind"],
    title: r.title ?? "",
    thesis: r.thesis ?? "",
    antithesis: r.antithesis ?? "",
    thesisRefs: (r.thesis_refs ?? []) as string[],
    antithesisRefs: (r.antithesis_refs ?? []) as string[],
    evidence: (r.evidence ?? []) as Tension["evidence"],
    confidence: (r.confidence ?? {}) as Tension["confidence"],
    unresolvedQuestions: (r.unresolved_questions ?? []) as string[],
    status: (r.status ?? "open") as Tension["status"],
    origin: (r.origin ?? "detected") as Tension["origin"],
    detail: r.detail ?? undefined,
    signature: r.signature ?? "",
    history: (r.history ?? []) as Tension["history"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function synthesisToRow(s: Synthesis) {
  return {
    id: s.id,
    dialogue_id: s.dialogueId,
    tension_ids: s.tensionIds,
    statement: s.statement,
    preserved_insights: s.preservedInsights,
    discarded_assumptions: s.discardedAssumptions,
    common_ground: s.commonGround,
    remaining_uncertainty: s.remainingUncertainty,
    confidence: s.confidence,
    evidence_links: s.evidenceLinks,
    status: s.status,
    origin: s.origin,
    supersedes_id: s.supersedesId ?? null,
    revisions: s.revisions,
    outcomes: s.outcomes,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}
function rowToSynthesis(r: any): Synthesis {
  return {
    id: r.id,
    dialogueId: r.dialogue_id,
    tensionIds: (r.tension_ids ?? []) as string[],
    statement: r.statement ?? "",
    preservedInsights: (r.preserved_insights ?? []) as string[],
    discardedAssumptions: (r.discarded_assumptions ?? []) as string[],
    commonGround: (r.common_ground ?? []) as string[],
    remainingUncertainty: (r.remaining_uncertainty ?? []) as string[],
    confidence: (r.confidence ?? {}) as Synthesis["confidence"],
    evidenceLinks: (r.evidence_links ?? []) as Synthesis["evidenceLinks"],
    status: (r.status ?? "candidate") as Synthesis["status"],
    origin: (r.origin ?? "generated") as Synthesis["origin"],
    supersedesId: r.supersedes_id ?? undefined,
    revisions: (r.revisions ?? []) as Synthesis["revisions"],
    outcomes: (r.outcomes ?? []) as Synthesis["outcomes"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function recommendationToRow(r: Recommendation) {
  return {
    id: r.id,
    type: r.type,
    priority: r.priority,
    confidence: r.confidence,
    rationale: r.rationale,
    subsystem: r.subsystem,
    suggested_action: r.suggestedAction,
    action_href: r.actionHref ?? null,
    affected: r.affected,
    signature: r.signature,
    created_at: r.createdAt,
    dismissed: r.dismissed,
    accepted: r.accepted,
    completed: r.completed,
    snoozed_until: r.snoozedUntil ?? null,
  };
}
function rowToRecommendation(r: any): Recommendation {
  return {
    id: r.id,
    type: r.type as Recommendation["type"],
    priority: (r.priority ?? "low") as Recommendation["priority"],
    confidence: (r.confidence ?? "unknown") as Recommendation["confidence"],
    rationale: r.rationale ?? "",
    subsystem: r.subsystem as Recommendation["subsystem"],
    suggestedAction: r.suggested_action ?? "",
    actionHref: r.action_href ?? undefined,
    affected: (r.affected ?? []) as Recommendation["affected"],
    signature: r.signature ?? "",
    createdAt: r.created_at,
    dismissed: Boolean(r.dismissed),
    accepted: Boolean(r.accepted),
    completed: Boolean(r.completed),
    snoozedUntil: r.snoozed_until ?? undefined,
  };
}

// ---------------------- Workspaces & sessions (LIFEOS-030) ----------------------

interface WorkspaceRow {
  id: string; name: string; description: string; color: string | null;
  goals: unknown; members: unknown; pinned: unknown; resume: unknown;
  archived: boolean; created_at: string; updated_at: string;
}
function workspaceToRow(w: Workspace): WorkspaceRow {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    color: w.color ?? null,
    goals: w.goals,
    members: w.members,
    pinned: w.pinned,
    resume: w.resume,
    archived: w.archived,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}
function rowToWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name ?? "Untitled workspace",
    description: r.description ?? "",
    color: r.color ?? undefined,
    goals: Array.isArray(r.goals) ? r.goals : [],
    members: Array.isArray(r.members) ? r.members : [],
    pinned: Array.isArray(r.pinned) ? r.pinned : [],
    resume: r.resume && typeof r.resume === "object" ? r.resume : {},
    archived: Boolean(r.archived),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface SessionRow {
  id: string; workspace_id: string; type: string; goal: string; notes: string;
  // Soft references (0044). `goal` is the session's stated intent as free text;
  // `goal_id` is a pointer to a Goal record — different things, easily confused,
  // and both persisted.
  goal_id: string | null; project_id: string | null; current_action_id: string | null;
  activity: unknown; started_at: string; ended_at: string | null;
}
export function sessionToRow(s: WorkspaceSession): SessionRow {
  return {
    id: s.id,
    workspace_id: s.workspaceId,
    type: s.type,
    goal: s.goal,
    goal_id: s.goalId ?? null,
    project_id: s.projectId ?? null,
    current_action_id: s.currentActionId ?? null,
    notes: s.notes,
    activity: s.activity,
    started_at: s.startedAt,
    ended_at: s.endedAt ?? null,
  };
}
export function rowToSession(r: any): WorkspaceSession {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: (r.type ?? "thinking") as WorkspaceSession["type"],
    goal: r.goal ?? "",
    goalId: r.goal_id ?? undefined,
    projectId: r.project_id ?? undefined,
    // A pointer to an action that no longer exists degrades gracefully rather
    // than being repaired here: the store clears it at mutation time (action
    // completed or deleted), and every reader treats an unresolvable pointer as
    // no current action. Resurrecting the target would be inventing a record.
    currentActionId: r.current_action_id ?? undefined,
    notes: r.notes ?? "",
    activity: Array.isArray(r.activity) ? r.activity : [],
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
  };
}

// ---------------------------- Goals & projects (LIFEOS-031) ----------------------------

interface GoalRow {
  id: string; title: string; description: string; status: string; priority: string;
  target_date: string | null; notes: string; tags: unknown; manual_progress: number | null;
  linked_workspaces: unknown; linked_knowledge: unknown; created_at: string; updated_at: string;
}
function goalToRow(g: Goal): GoalRow {
  return {
    id: g.id, title: g.title, description: g.description, status: g.status, priority: g.priority,
    target_date: g.targetDate ?? null, notes: g.notes, tags: g.tags,
    manual_progress: g.manualProgress ?? null, linked_workspaces: g.linkedWorkspaces,
    linked_knowledge: g.linkedKnowledge, created_at: g.createdAt, updated_at: g.updatedAt,
  };
}
function rowToGoal(r: any): Goal {
  return {
    id: r.id, title: r.title ?? "Untitled goal", description: r.description ?? "",
    status: (r.status ?? "active") as Goal["status"], priority: (r.priority ?? "medium") as Goal["priority"],
    targetDate: r.target_date ?? undefined, notes: r.notes ?? "", tags: Array.isArray(r.tags) ? r.tags : [],
    manualProgress: r.manual_progress ?? undefined,
    linkedWorkspaces: Array.isArray(r.linked_workspaces) ? r.linked_workspaces : [],
    linkedKnowledge: Array.isArray(r.linked_knowledge) ? r.linked_knowledge : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface ExecProjectRow {
  id: string; title: string; description: string; status: string; priority: string;
  goal_id: string | null; workspace_id: string | null; start_date: string | null; target_date: string | null;
  notes: string; milestones: unknown; manual_progress: number | null;
  related_documents: unknown; related_entities: unknown; created_at: string; updated_at: string;
}
function execProjectToRow(p: Project): ExecProjectRow {
  return {
    id: p.id, title: p.title, description: p.description, status: p.status, priority: p.priority,
    goal_id: p.goalId ?? null, workspace_id: p.workspaceId ?? null,
    start_date: p.startDate ?? null, target_date: p.targetDate ?? null, notes: p.notes,
    milestones: p.milestones, manual_progress: p.manualProgress ?? null,
    related_documents: p.relatedDocuments, related_entities: p.relatedEntities,
    created_at: p.createdAt, updated_at: p.updatedAt,
  };
}
function rowToExecProject(r: any): Project {
  return {
    id: r.id, title: r.title ?? "Untitled project", description: r.description ?? "",
    status: (r.status ?? "active") as Project["status"], priority: (r.priority ?? "medium") as Project["priority"],
    goalId: r.goal_id ?? undefined, workspaceId: r.workspace_id ?? undefined,
    startDate: r.start_date ?? undefined, targetDate: r.target_date ?? undefined, notes: r.notes ?? "",
    milestones: Array.isArray(r.milestones) ? r.milestones : [], manualProgress: r.manual_progress ?? undefined,
    relatedDocuments: Array.isArray(r.related_documents) ? r.related_documents : [],
    relatedEntities: Array.isArray(r.related_entities) ? r.related_entities : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ---------------------------- Daily reviews (LIFEOS-034) ----------------------------

interface DailyReviewRow {
  id: string; user_id?: string; date: string; status: string;
  started_at: string | null; completed_at: string | null;
  summary: string; notes: string;
  wins: unknown; lessons: unknown; friction: unknown; open_loops: unknown; tomorrow_focus: unknown;
  linked_goals: unknown; linked_projects: unknown; linked_workspaces: unknown; linked_entities: unknown;
  tz_offset_minutes: number | null; created_at: string; updated_at: string;
}
function dailyReviewToRow(r: DailyReview): DailyReviewRow {
  return {
    id: r.id, date: r.date, status: r.status,
    started_at: r.startedAt ?? null, completed_at: r.completedAt ?? null,
    summary: r.summary, notes: r.notes,
    wins: r.wins, lessons: r.lessons, friction: r.friction, open_loops: r.openLoops, tomorrow_focus: r.tomorrowFocus,
    linked_goals: r.linkedGoals, linked_projects: r.linkedProjects, linked_workspaces: r.linkedWorkspaces, linked_entities: r.linkedEntities,
    tz_offset_minutes: r.tzOffsetMinutes ?? null, created_at: r.createdAt, updated_at: r.updatedAt,
  };
}
function rowToDailyReview(r: any): DailyReview {
  return {
    id: r.id, date: r.date, status: (r.status ?? "not_started") as DailyReview["status"],
    startedAt: r.started_at ?? undefined, completedAt: r.completed_at ?? undefined,
    summary: r.summary ?? "", notes: r.notes ?? "",
    wins: Array.isArray(r.wins) ? r.wins : [], lessons: Array.isArray(r.lessons) ? r.lessons : [],
    friction: Array.isArray(r.friction) ? r.friction : [], openLoops: Array.isArray(r.open_loops) ? r.open_loops : [],
    tomorrowFocus: Array.isArray(r.tomorrow_focus) ? r.tomorrow_focus : [],
    linkedGoals: Array.isArray(r.linked_goals) ? r.linked_goals : [],
    linkedProjects: Array.isArray(r.linked_projects) ? r.linked_projects : [],
    linkedWorkspaces: Array.isArray(r.linked_workspaces) ? r.linked_workspaces : [],
    linkedEntities: Array.isArray(r.linked_entities) ? r.linked_entities : [],
    tzOffsetMinutes: r.tz_offset_minutes ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ---------------------------- Next actions (LIFEOS-036) ----------------------------
//
// `due_time` and `recurrence` were added to the table and to `NextAction` by
// LIFEOS-061 (migration 0040) and never wired through here. The LIFEOS-074
// audit found the consequence: an action the user made recurring — "take the
// medication every day at 8" — pushed to Supabase WITHOUT its rule or its time,
// and came back on the next device as a plain, undated, non-recurring task. The
// completions kept syncing, so the reloaded state also held occurrence rows for
// an action that no longer recurred.
//
// Both columns are carried here now. Every other value keeps the `?? null`
// shape the rest of this mapper uses, so absent stays absent rather than
// becoming a JSON `null` the reader would have to special-case.
interface NextActionRow {
  id: string; user_id?: string; title: string; description: string; status: string;
  completed_at: string | null; cancelled_at: string | null; due_date: string | null; deferred_until: string | null;
  due_time: string | null; recurrence: unknown | null;
  waiting_on: string | null; waiting_since: string | null; follow_up_date: string | null; notes: string;
  workspace_id: string | null; goal_id: string | null; project_id: string | null; milestone_id: string | null;
  source_capture_id: string | null; source_review_id: string | null;
  linked_entity_refs: unknown; tags: unknown; estimated_size: string; energy: string; context: string | null;
  order: number; pinned: boolean; history: unknown; created_at: string; updated_at: string;
}
/**
 * Exported for the round-trip suite (LIFEOS-074 §5).
 *
 * These two functions were the site of a P1 that shipped precisely because
 * nothing could reach them: a mapper with no test is a contract with no reader.
 */
export function actionToRow(a: NextAction): NextActionRow {
  return {
    id: a.id, title: a.title, description: a.description, status: a.status,
    completed_at: a.completedAt ?? null, cancelled_at: a.cancelledAt ?? null, due_date: a.dueDate ?? null, deferred_until: a.deferredUntil ?? null,
    due_time: a.dueTime ?? null, recurrence: a.recurrence ?? null,
    waiting_on: a.waitingOn ?? null, waiting_since: a.waitingSince ?? null, follow_up_date: a.followUpDate ?? null, notes: a.notes,
    workspace_id: a.workspaceId ?? null, goal_id: a.goalId ?? null, project_id: a.projectId ?? null, milestone_id: a.milestoneId ?? null,
    source_capture_id: a.sourceCaptureId ?? null, source_review_id: a.sourceReviewId ?? null,
    linked_entity_refs: a.linkedEntityRefs, tags: a.tags, estimated_size: a.estimatedSize, energy: a.energy, context: a.context ?? null,
    order: a.order, pinned: !!a.pinned, history: a.history, created_at: a.createdAt, updated_at: a.updatedAt,
  };
}
export function rowToAction(r: any): NextAction {
  return {
    id: r.id, title: r.title ?? "", description: r.description ?? "", status: (r.status ?? "open") as NextAction["status"],
    completedAt: r.completed_at ?? undefined, cancelledAt: r.cancelled_at ?? undefined, dueDate: r.due_date ?? undefined, deferredUntil: r.deferred_until ?? undefined,
    dueTime: r.due_time ?? undefined,
    // Validated on the way in, not trusted. A malformed rule stored by an older
    // client (or hand-edited) would otherwise reach every recurrence consumer;
    // `readRule` is the same gate `setActionRecurrence` uses, so a rule that
    // cannot be read becomes absent rather than a rule that cannot be honoured.
    recurrence: readRule(r.recurrence) ? (r.recurrence as NextAction["recurrence"]) : undefined,
    waitingOn: r.waiting_on ?? undefined, waitingSince: r.waiting_since ?? undefined, followUpDate: r.follow_up_date ?? undefined, notes: r.notes ?? "",
    workspaceId: r.workspace_id ?? undefined, goalId: r.goal_id ?? undefined, projectId: r.project_id ?? undefined, milestoneId: r.milestone_id ?? undefined,
    sourceCaptureId: r.source_capture_id ?? undefined, sourceReviewId: r.source_review_id ?? undefined,
    linkedEntityRefs: Array.isArray(r.linked_entity_refs) ? r.linked_entity_refs : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    estimatedSize: (r.estimated_size ?? "unspecified") as NextAction["estimatedSize"],
    energy: (r.energy ?? "unspecified") as NextAction["energy"],
    context: r.context ?? undefined,
    order: typeof r.order === "number" ? r.order : 0, pinned: !!r.pinned,
    history: Array.isArray(r.history) ? r.history : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
interface ActionDependencyRow { id: string; user_id?: string; blocker_id: string; blocked_id: string; created_at: string }
function dependencyToRow(d: ActionDependency): ActionDependencyRow {
  return { id: d.id, blocker_id: d.blockerId, blocked_id: d.blockedId, created_at: d.createdAt };
}
function rowToDependency(r: any): ActionDependency {
  return { id: r.id, blockerId: r.blocker_id, blockedId: r.blocked_id, createdAt: r.created_at };
}
interface ActionTemplateRow {
  id: string; user_id?: string; title: string; description: string; context: string | null;
  energy: string; estimated_size: string; tags: unknown; default_workspace_id: string | null;
  default_project_id: string | null; suggested_recurrence: string | null; created_at: string; updated_at: string;
}
function templateToRow(t: ActionTemplate): ActionTemplateRow {
  return {
    id: t.id, title: t.title, description: t.description, context: t.context ?? null,
    energy: t.energy, estimated_size: t.estimatedSize, tags: t.tags,
    default_workspace_id: t.defaultWorkspaceId ?? null, default_project_id: t.defaultProjectId ?? null,
    suggested_recurrence: t.suggestedRecurrence ?? null, created_at: t.createdAt, updated_at: t.updatedAt,
  };
}
function rowToTemplate(r: any): ActionTemplate {
  return {
    id: r.id, title: r.title ?? "", description: r.description ?? "", context: r.context ?? undefined,
    energy: (r.energy ?? "unspecified") as ActionTemplate["energy"],
    estimatedSize: (r.estimated_size ?? "unspecified") as ActionTemplate["estimatedSize"],
    tags: Array.isArray(r.tags) ? r.tags : [],
    defaultWorkspaceId: r.default_workspace_id ?? undefined, defaultProjectId: r.default_project_id ?? undefined,
    suggestedRecurrence: r.suggested_recurrence ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ---------------------------- Planning & focus (LIFEOS-037) ----------------------------
interface PlanningAssignmentRow {
  id: string; user_id?: string; ref_kind: string; ref_id: string; horizon: string;
  order: number; history: unknown; created_at: string; updated_at: string;
}
function planningToRow(a: PlanningAssignment): PlanningAssignmentRow {
  return { id: a.id, ref_kind: a.ref.kind, ref_id: a.ref.id, horizon: a.horizon, order: a.order, history: a.history, created_at: a.createdAt, updated_at: a.updatedAt };
}
function rowToPlanning(r: any): PlanningAssignment {
  return {
    id: r.id, ref: { kind: r.ref_kind, id: r.ref_id }, horizon: (r.horizon ?? "unscheduled") as PlanningAssignment["horizon"],
    order: typeof r.order === "number" ? r.order : 0, history: Array.isArray(r.history) ? r.history : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
interface FocusSessionRow {
  id: string; user_id?: string; target_kind: string; ref_kind: string; ref_id: string; title: string;
  session_id: string | null; started_at: string; ended_at: string | null;
  panels: unknown; interruptions: unknown; history: unknown; created_at: string; updated_at: string;
}
function focusToRow(f: FocusSession): FocusSessionRow {
  return {
    id: f.id, target_kind: f.targetKind, ref_kind: f.ref.kind, ref_id: f.ref.id, title: f.title,
    session_id: f.sessionId ?? null, started_at: f.startedAt, ended_at: f.endedAt ?? null,
    panels: f.panels, interruptions: f.interruptions, history: f.history, created_at: f.startedAt, updated_at: f.endedAt ?? f.startedAt,
  };
}
function rowToFocus(r: any): FocusSession {
  return {
    id: r.id, targetKind: (r.target_kind ?? "custom") as FocusSession["targetKind"], ref: { kind: r.ref_kind, id: r.ref_id },
    title: r.title ?? "", sessionId: r.session_id ?? undefined, startedAt: r.started_at, endedAt: r.ended_at ?? undefined,
    panels: (r.panels && typeof r.panels === "object") ? r.panels : {},
    interruptions: Array.isArray(r.interruptions) ? r.interruptions : [],
    history: Array.isArray(r.history) ? r.history : [],
  };
}

interface MaintenanceEventRow {
  id: string; user_id?: string; kind: string; ref_kind: string; ref_id: string;
  related_kind: string | null; related_id: string | null; detail: string | null; at: string;
}
function maintenanceEventToRow(e: MaintenanceEvent): MaintenanceEventRow {
  return { id: e.id, kind: e.kind, ref_kind: e.ref.kind, ref_id: e.ref.id, related_kind: e.relatedRef?.kind ?? null, related_id: e.relatedRef?.id ?? null, detail: e.detail ?? null, at: e.at };
}
function rowToMaintenanceEvent(r: any): MaintenanceEvent {
  const e: MaintenanceEvent = { id: r.id, at: r.at, kind: r.kind, ref: { kind: r.ref_kind, id: r.ref_id } };
  if (r.related_kind && r.related_id) e.relatedRef = { kind: r.related_kind, id: r.related_id };
  if (r.detail) e.detail = r.detail;
  return e;
}
interface DuplicateCandidateRow {
  id: string; user_id?: string; reason: string; kind: string; members: unknown; dup_key: string;
  status: string; history: unknown; created_at: string; updated_at: string;
}
function duplicateToRow(d: DuplicateCandidate): DuplicateCandidateRow {
  return { id: d.id, reason: d.reason, kind: d.kind, members: d.members, dup_key: d.key, status: d.status, history: d.history, created_at: d.createdAt, updated_at: d.updatedAt };
}
function rowToDuplicate(r: any): DuplicateCandidate {
  return {
    id: r.id, reason: r.reason, kind: r.kind, members: Array.isArray(r.members) ? r.members : [],
    key: r.dup_key ?? "", status: (r.status ?? "open") as DuplicateCandidate["status"],
    history: Array.isArray(r.history) ? r.history : [], createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
interface SavedInsightViewRow {
  id: string; user_id?: string; name: string; insight: string; range_kind: string;
  custom_start: string | null; custom_end: string | null; grouping: string | null;
  filters: unknown; created_at: string; updated_at: string;
}
function insightViewToRow(v: SavedInsightView): SavedInsightViewRow {
  return { id: v.id, name: v.name, insight: v.insight, range_kind: v.rangeKind, custom_start: v.customStart ?? null, custom_end: v.customEnd ?? null, grouping: v.grouping ?? null, filters: v.filters ?? {}, created_at: v.createdAt, updated_at: v.updatedAt };
}
function rowToInsightView(r: any): SavedInsightView {
  return {
    id: r.id, name: r.name ?? "", insight: r.insight ?? "home", rangeKind: (r.range_kind ?? "last_7_days") as SavedInsightView["rangeKind"],
    customStart: r.custom_start ?? undefined, customEnd: r.custom_end ?? undefined, grouping: r.grouping ?? undefined,
    filters: (r.filters && typeof r.filters === "object") ? r.filters : {}, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface ProtocolRow {
  id: string; user_id?: string; trigger_text: string; response_text: string;
  reason: string | null; status: string; source_capture_id: string | null;
  from_ai_text: boolean; created_at: string; updated_at: string;
}
function protocolToRow(p: Protocol): ProtocolRow {
  return {
    id: p.id, trigger_text: p.trigger, response_text: p.response, reason: p.reason ?? null,
    status: p.status, source_capture_id: p.sourceCaptureId ?? null,
    from_ai_text: !!p.fromAiText, created_at: p.createdAt, updated_at: p.updatedAt,
  };
}
function rowToProtocol(r: any): Protocol {
  return {
    id: r.id, trigger: r.trigger_text ?? "", response: r.response_text ?? "",
    reason: r.reason ?? undefined, status: (r.status ?? "active") as Protocol["status"],
    sourceCaptureId: r.source_capture_id ?? undefined,
    fromAiText: r.from_ai_text ? true : undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ---------------------------------------------- time foundation (061) ----

interface EventRow {
  id: string; user_id?: string; title: string; date: string;
  start_time: string | null; end_time: string | null; all_day: boolean;
  notes: string; recurrence: unknown | null; linked_entity_refs: unknown;
  source_capture_id: string | null; from_ai_text: boolean;
  // LIFEOS-067. External calendar identity, all-or-nothing (0041).
  external_provider: string | null;
  external_calendar_id: string | null;
  external_event_id: string | null;
  external_updated_at: string | null;
  created_at: string; updated_at: string;
}

function eventToRow(e: LifeEvent): EventRow {
  // Identity is written as a UNIT. Sending a partial one would violate the 0041
  // CHECK — correctly — and, worse, a row that slipped through would defeat the
  // unique index, because Postgres treats NULLs as distinct.
  const linked = !!(e.externalProvider && e.externalCalendarId && e.externalEventId);
  return {
    id: e.id, title: e.title, date: e.date,
    start_time: e.startTime ?? null, end_time: e.endTime ?? null,
    all_day: !!e.allDay, notes: e.notes ?? "",
    recurrence: e.recurrence ?? null,
    linked_entity_refs: e.linkedEntityRefs ?? [],
    source_capture_id: e.sourceCaptureId ?? null,
    from_ai_text: !!e.fromAiText,
    external_provider: linked ? e.externalProvider! : null,
    external_calendar_id: linked ? e.externalCalendarId! : null,
    external_event_id: linked ? e.externalEventId! : null,
    external_updated_at: linked ? (e.externalUpdatedAt ?? null) : null,
    created_at: e.createdAt, updated_at: e.updatedAt,
  };
}

/**
 * A remote row becomes an event.
 *
 * `recurrence` arrives as untrusted JSONB — hand-edited, written by an older
 * client, or corrupted. `readRule` returns null for anything malformed, so a bad
 * rule loses its SCHEDULE and keeps its EVENT rather than taking down the load
 * path (§9 of the continuation brief). It is never repaired: a guessed rule
 * would replace the user's data with ours and then look like theirs.
 */
function rowToEvent(r: any): LifeEvent {
  return {
    id: r.id, title: r.title ?? "", date: r.date,
    startTime: r.start_time ?? undefined, endTime: r.end_time ?? undefined,
    allDay: r.all_day ? true : undefined, notes: r.notes ?? "",
    recurrence: readRule(r.recurrence) ?? undefined,
    linkedEntityRefs: Array.isArray(r.linked_entity_refs) ? r.linked_entity_refs : [],
    sourceCaptureId: r.source_capture_id ?? undefined,
    fromAiText: r.from_ai_text ? true : undefined,
    // Read as a UNIT for the same reason it is written as one: a half identity
    // is not a partially-linked event, it is a row nothing can reconcile. An
    // older client that predates 0041 returns undefined for all four, which is
    // the correct "not linked" state.
    ...(r.external_provider && r.external_calendar_id && r.external_event_id ? {
      externalProvider: r.external_provider as string,
      externalCalendarId: r.external_calendar_id as string,
      externalEventId: r.external_event_id as string,
      externalUpdatedAt: r.external_updated_at ?? undefined,
    } : {}),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface RecurrenceCompletionRow {
  id: string; user_id?: string; action_id: string; occurrence_date: string; completed_at: string;
}
function completionToRow(c: RecurrenceCompletion): RecurrenceCompletionRow {
  return { id: c.id, action_id: c.actionId, occurrence_date: c.occurrenceDate, completed_at: c.completedAt };
}
function rowToCompletion(r: any): RecurrenceCompletion {
  return { id: r.id, actionId: r.action_id, occurrenceDate: r.occurrence_date, completedAt: r.completed_at };
}

interface NoteRow {
  id: string; user_id?: string; title: string | null; body: string;
  workspace_id: string | null; source_capture_id: string | null;
  linked_refs: unknown; tags: string[]; from_ai_text: boolean; archived: boolean;
  created_at: string; updated_at: string;
}
function noteToRow(n: Note): NoteRow {
  return {
    id: n.id, title: n.title ?? null, body: n.body ?? "",
    workspace_id: n.workspaceId ?? null, source_capture_id: n.sourceCaptureId ?? null,
    linked_refs: n.linkedEntityRefs ?? [], tags: n.tags ?? [],
    // Provenance is a stored fact, not a display flag: it must round-trip.
    from_ai_text: !!n.fromAiText, archived: !!n.archived,
    created_at: n.createdAt, updated_at: n.updatedAt,
  };
}
function rowToNote(r: any): Note {
  return {
    id: r.id, title: r.title ?? undefined, body: r.body ?? "",
    workspaceId: r.workspace_id ?? undefined, sourceCaptureId: r.source_capture_id ?? undefined,
    linkedEntityRefs: Array.isArray(r.linked_refs) ? r.linked_refs : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    fromAiText: r.from_ai_text ? true : undefined,
    archived: r.archived ? true : undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface ConstitutionElementRow {
  id: string; user_id?: string; kind: string; statement: string; note: string | null;
  status: string; adopted_at: string | null; retired_at: string | null;
  supersedes_id: string | null; workspace_id: string | null;
  linked_refs: unknown; source_capture_id: string | null;
  from_ai_text: boolean; exclude_from_ai: boolean;
  created_at: string; updated_at: string;
}
function constitutionElementToRow(e: ConstitutionElement): ConstitutionElementRow {
  return {
    id: e.id, kind: e.kind, statement: e.statement ?? "", note: e.note ?? null,
    status: e.status, adopted_at: e.adoptedAt ?? null, retired_at: e.retiredAt ?? null,
    supersedes_id: e.supersedesId ?? null, workspace_id: e.workspaceId ?? null,
    linked_refs: e.linkedRefs ?? [], source_capture_id: e.sourceCaptureId ?? null,
    // Both are stored FACTS, not display flags — they must round-trip exactly.
    from_ai_text: !!e.fromAiText, exclude_from_ai: !!e.excludeFromAi,
    created_at: e.createdAt, updated_at: e.updatedAt,
  };
}
function rowToConstitutionElement(r: any): ConstitutionElement {
  return {
    id: r.id, kind: (r.kind ?? "value") as ConstitutionElement["kind"],
    statement: r.statement ?? "", note: r.note ?? undefined,
    status: (r.status ?? "draft") as ConstitutionElement["status"],
    adoptedAt: r.adopted_at ?? undefined, retiredAt: r.retired_at ?? undefined,
    supersedesId: r.supersedes_id ?? undefined, workspaceId: r.workspace_id ?? undefined,
    linkedRefs: Array.isArray(r.linked_refs) ? r.linked_refs : [],
    sourceCaptureId: r.source_capture_id ?? undefined,
    fromAiText: r.from_ai_text ? true : undefined,
    excludeFromAi: r.exclude_from_ai ? true : undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface ConstitutionRevisionRow {
  id: string; user_id?: string; element_id: string; change_kind: string;
  /** The successor a `revised` transition produced (LIFEOS-056D). */
  successor_id: string | null;
  previous_statement: string | null; new_statement: string | null;
  reason: string | null; evidence_refs: unknown; at: string;
}
function constitutionRevisionToRow(r: ConstitutionRevision): ConstitutionRevisionRow {
  return {
    id: r.id, element_id: r.elementId, change_kind: r.changeKind,
    successor_id: r.successorId ?? null,
    previous_statement: r.previousStatement ?? null, new_statement: r.newStatement ?? null,
    reason: r.reason ?? null, evidence_refs: r.evidenceRefs ?? [], at: r.at,
  };
}
function rowToConstitutionRevision(r: any): ConstitutionRevision {
  return {
    id: r.id, elementId: r.element_id, changeKind: (r.change_kind ?? "edited") as ConstitutionRevision["changeKind"],
    // Absent on pre-056D rows and on every non-supersession event — undefined is
    // the correct, lossless representation of "this produced no successor".
    successorId: r.successor_id ?? undefined,
    previousStatement: r.previous_statement ?? undefined, newStatement: r.new_statement ?? undefined,
    reason: r.reason ?? undefined,
    evidenceRefs: Array.isArray(r.evidence_refs) ? r.evidence_refs : [],
    at: r.at,
  };
}

function groupBy<T extends Record<string, any>>(rows: T[], key: string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) {
    const k = row[key] as string;
    (out[k] ??= []).push(row);
  }
  return out;
}
