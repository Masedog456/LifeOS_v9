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
} from "@/types/mvp";
import type { PersistenceAdapter, PersistenceHealth, SyncState } from "@/lib/adapters/types";
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

  /** Row-level upsert/delete for workspaces (LIFEOS-030). */
  private async syncWorkspaces(current: Workspace[], base: Workspace[]): Promise<void> {
    const d = diffById<WorkspaceRow>(current.map(workspaceToRow), base.map(workspaceToRow));
    if (d.upsert.length) await this.throwing(this.client.from("workspaces").upsert(d.upsert));
    // Deleting a workspace cascades its sessions in the DB; the client also
    // removes the session rows below, so an explicit delete here is enough.
    if (d.deleteIds.length) await this.throwing(this.client.from("workspaces").delete().in("id", d.deleteIds));
  }

  /** Row-level upsert/delete for sessions (LIFEOS-030). */
  private async syncSessions(current: WorkspaceSession[], base: WorkspaceSession[]): Promise<void> {
    const d = diffById<SessionRow>(current.map(sessionToRow), base.map(sessionToRow));
    if (d.upsert.length) await this.throwing(this.client.from("workspace_sessions").upsert(d.upsert));
    if (d.deleteIds.length) await this.throwing(this.client.from("workspace_sessions").delete().in("id", d.deleteIds));
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
  return { id: c.id, text: c.text, source_id: c.sourceId ?? null, created_at: c.createdAt };
}
function rowToCapture(r: any): Capture {
  return { id: r.id, text: r.text, sourceId: r.source_id ?? undefined, createdAt: r.created_at };
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
  activity: unknown; started_at: string; ended_at: string | null;
}
function sessionToRow(s: WorkspaceSession): SessionRow {
  return {
    id: s.id,
    workspace_id: s.workspaceId,
    type: s.type,
    goal: s.goal,
    notes: s.notes,
    activity: s.activity,
    started_at: s.startedAt,
    ended_at: s.endedAt ?? null,
  };
}
function rowToSession(r: any): WorkspaceSession {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: (r.type ?? "thinking") as WorkspaceSession["type"],
    goal: r.goal ?? "",
    notes: r.notes ?? "",
    activity: Array.isArray(r.activity) ? r.activity : [],
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
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
