/**
 * Persistence adapter contract (LIFEOS-004).
 *
 * The UI and store never touch localStorage or Supabase directly — they go
 * through an adapter. Two implementations exist: LocalPersistenceAdapter
 * (localStorage, offline/fallback) and SupabasePersistenceAdapter (durable,
 * per-user, RLS-protected). Swapping backends is choosing an adapter.
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

export type SyncState =
  | "local"
  | "syncing"
  | "synced"
  /** Some domains pushed, others did not (LIFEOS-074 D-22). NEVER "synced". */
  | "incomplete"
  | "failed"
  | "disabled"
  | "offline"
  | "retrying";

/**
 * What one isolated push run actually achieved, per domain (LIFEOS-074 D-22).
 *
 * `saveState` used to be a single sequential await chain across all 46 domains,
 * so the first failure aborted every domain after it — a push was a PREFIX, and
 * a persistent failure in an early domain starved every later one indefinitely.
 * The isolated run attempts every dirty domain and reports each outcome, so the
 * caller can advance the sync baseline for exactly the domains that succeeded
 * and leave the rest dirty.
 */
export interface DomainPushReport {
  /** Domains whose push completed. Safe to mark clean. */
  succeeded: string[];
  /** Domains that failed, with the message, in attempt order. Stay dirty. */
  failed: { domain: string; error: string }[];
  /** Domains that were dirty and attempted (succeeded ∪ failed). */
  attempted: string[];
}

export interface PersistenceHealth {
  mode: "local" | "supabase";
  state: SyncState;
  error?: string;
  /** Local (localStorage) write failure — quota/serialization (LIFEOS-025). */
  localError?: string;
  /** Current automatic-retry attempt (LIFEOS-025), when state is "retrying". */
  retryAttempt?: number;
  /** ISO timestamp of the last successful remote sync, or null if none yet
   * (LIFEOS-042A). Lets the UI say "Not yet synced" instead of alarming with a
   * "Sync error" when a first attempt fails before anything has ever synced. */
  lastSyncAt?: string | null;
  /** Domains the last push could not write (LIFEOS-074 D-22). Present when the
   *  state is "incomplete"/"retrying"; runtime-only, never persisted. */
  failedDomains?: string[];
}

export interface PersistenceAdapter {
  readonly mode: "local" | "supabase";

  /** Load the full state for the current user (or null if none). */
  loadState(): Promise<Partial<StoreState> | null>;
  /**
   * Persist state (idempotent upserts for remote). When `dirty` is provided
   * (LIFEOS-021 incremental sync), only those domains are pushed; when omitted,
   * the whole state is persisted (full sync — backward compatible). `base` is the
   * last successfully-synced state, used by normalized domains (LIFEOS-028
   * reading library) to compute row-level upserts/deletes so a single edit does
   * not rewrite every document. Adapters that don't need it ignore it.
   */
  saveState(state: StoreState, dirty?: Set<keyof StoreState>, base?: StoreState | null): Promise<void>;

  // Granular saves — append-only where the ontology requires it.
  saveSource(source: KnowledgeSource): Promise<void>;
  saveCapture(capture: Capture): Promise<void>;
  saveProposal(proposal: Proposal): Promise<void>;
  saveBelief(belief: Belief): Promise<void>;
  saveRevision(beliefId: string, seq: number, revision: RevisionEntry): Promise<void>;
  saveJudgment(beliefId: string, seq: number, judgment: JudgmentEntry): Promise<void>;
  saveQuote(sourceId: string, quote: string): Promise<void>;

  /** Delete all of the current user's data. */
  deleteAll(): Promise<void>;

  health(): PersistenceHealth;
}
