/**
 * LocalPersistenceAdapter — localStorage backend.
 *
 * This is the offline / fallback mode and the default when Supabase is not
 * configured. It preserves the exact behavior LIFEOS-002/003 shipped with:
 * the whole state is a single JSON blob keyed per browser.
 */

import type {
  Belief,
  Capture,
  JudgmentEntry,
  KnowledgeSource,
  Proposal,
  RevisionEntry,
  StoreState,
} from "@/types/mvp";
import type { PersistenceAdapter, PersistenceHealth } from "@/lib/adapters/types";

const STORAGE_KEY = "lifeos.mvp.v1";

function read(): StoreState {
  const empty: StoreState = { captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [], megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [], formationSessions: [], concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [], researchProjects: [], dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [], sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [], planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [], savedInsightViews: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    return {
      captures: parsed.captures ?? [],
      proposals: parsed.proposals ?? [],
      beliefs: parsed.beliefs ?? [],
      sources: parsed.sources ?? [],
      feedback: parsed.feedback ?? [],
      comparisons: parsed.comparisons ?? [],
      inquiries: parsed.inquiries ?? [],
      megathreads: parsed.megathreads ?? [],
      reflections: parsed.reflections ?? [],
      practices: parsed.practices ?? [],
      reviews: parsed.reviews ?? [],
      reasonings: parsed.reasonings ?? [],
      embeddings: parsed.embeddings ?? [],
      decisions: parsed.decisions ?? [],
      formationSessions: parsed.formationSessions ?? [],
      concepts: parsed.concepts ?? [],
      conceptRelationships: parsed.conceptRelationships ?? [],
      principles: parsed.principles ?? [],
      frameworks: parsed.frameworks ?? [],
      knowledgeProjects: parsed.knowledgeProjects ?? [],
      researchProjects: parsed.researchProjects ?? [],
      dialogueSessions: parsed.dialogueSessions ?? [],
      tensions: parsed.tensions ?? [],
      syntheses: parsed.syntheses ?? [],
      recommendations: parsed.recommendations ?? [],
      documents: parsed.documents ?? [],
      citations: parsed.citations ?? [],
      workspaces: parsed.workspaces ?? [],
      sessions: parsed.sessions ?? [],
      goals: parsed.goals ?? [],
      projects: parsed.projects ?? [],
      dailyReviews: parsed.dailyReviews ?? [],
      nextActions: parsed.nextActions ?? [],
      actionDependencies: parsed.actionDependencies ?? [],
      actionTemplates: parsed.actionTemplates ?? [],
      planningAssignments: parsed.planningAssignments ?? [],
      focusSessions: parsed.focusSessions ?? [],
      maintenanceEvents: parsed.maintenanceEvents ?? [],
      duplicateCandidates: parsed.duplicateCandidates ?? [],
      savedInsightViews: parsed.savedInsightViews ?? [],
    };
  } catch {
    return empty;
  }
}

function write(state: StoreState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota/serialization errors in the prototype.
  }
}

export class LocalPersistenceAdapter implements PersistenceAdapter {
  readonly mode = "local" as const;

  async loadState(): Promise<Partial<StoreState> | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? read() : null;
  }

  async saveState(state: StoreState, _dirty?: Set<keyof StoreState>): Promise<void> {
    // localStorage is a single JSON blob keyed per browser, so a partial write
    // is not meaningful — always persist the whole state. `dirty` is accepted
    // for interface parity and ignored here.
    void _dirty;
    write(state);
  }

  async saveSource(source: KnowledgeSource): Promise<void> {
    const s = read();
    write({ ...s, sources: upsertById(s.sources, source) });
  }

  async saveCapture(capture: Capture): Promise<void> {
    const s = read();
    write({ ...s, captures: upsertById(s.captures, capture) });
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    const s = read();
    write({ ...s, proposals: upsertById(s.proposals, proposal) });
  }

  async saveBelief(belief: Belief): Promise<void> {
    const s = read();
    write({ ...s, beliefs: upsertById(s.beliefs, belief) });
  }

  async saveRevision(beliefId: string, seq: number, revision: RevisionEntry): Promise<void> {
    const s = read();
    write({
      ...s,
      beliefs: s.beliefs.map((b) =>
        b.id === beliefId ? { ...b, revisions: setAt(b.revisions, seq, revision) } : b,
      ),
    });
  }

  async saveJudgment(beliefId: string, seq: number, judgment: JudgmentEntry): Promise<void> {
    const s = read();
    write({
      ...s,
      beliefs: s.beliefs.map((b) =>
        b.id === beliefId ? { ...b, judgments: setAt(b.judgments, seq, judgment) } : b,
      ),
    });
  }

  async saveQuote(sourceId: string, quote: string): Promise<void> {
    const s = read();
    write({
      ...s,
      sources: s.sources.map((src) =>
        src.id === sourceId && !src.keyQuotes.includes(quote)
          ? { ...src, keyQuotes: [quote, ...src.keyQuotes] }
          : src,
      ),
    });
  }

  async deleteAll(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }

  health(): PersistenceHealth {
    return { mode: "local", state: "local" };
  }
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx < 0) return [item, ...list];
  const next = [...list];
  next[idx] = item;
  return next;
}

function setAt<T>(list: T[], seq: number, item: T): T[] {
  const next = [...list];
  next[seq] = item;
  return next;
}
