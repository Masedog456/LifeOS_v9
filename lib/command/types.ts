/**
 * Command Center types (LIFEOS-027).
 *
 * Shared shapes for the universal command palette, global search, recent
 * history, and pinning. Everything here is deterministic and local — no LLM, no
 * embeddings, no external service. A "command" is anything the palette can list
 * and activate: a navigation target, a record-creation flow, a search result, a
 * continuation of unfinished work, a recently-viewed record, a pinned record,
 * or a plain action (quick capture, shortcut help).
 */

/** The behaviour a command triggers when activated. */
export type CommandKind =
  | "navigate" // go to a route
  | "create" // open a canonical creation flow
  | "action" // run a named client action (quick capture, shortcut help, …)
  | "record" // open an existing record (search / recent / pinned)
  | "continue"; // resume unfinished work (reuses LIFEOS-026 projections)

/** A single palette entry. */
export interface CommandItem {
  /** Stable id — used for dedupe and for React keys. */
  id: string;
  title: string;
  subtitle?: string;
  /** Display bucket, e.g. "Navigate", "Create", "Continue", "Recent", "Pinned". */
  group: string;
  kind: CommandKind;
  /** Extra terms to match on (aliases, synonyms) beyond the title. */
  keywords?: string[];
  /** Route to navigate to (navigate / create / record / continue). */
  href?: string;
  /** Named client action (resolved by the palette): "quick-capture", "shortcut-help", … */
  action?: string;
  /** For record/continue commands: the underlying record. */
  recordKind?: string;
  recordId?: string;
  /** A short text glyph shown at the leading edge (never color-only). */
  icon?: string;
  /** A keyboard hint shown at the trailing edge, e.g. "⌘K". */
  shortcut?: string;
}

/** One entry in the normalized search index. */
export interface SearchEntry {
  kind: string;
  id: string;
  title: string;
  /** Lowercased title, precomputed for fast, allocation-free matching. */
  titleLower: string;
  /** Lowercased alias/alternate terms (concept aliases, themes). */
  aliasesLower: string[];
  /** Lowercased body/notes text, precomputed. */
  bodyLower: string;
  /** A short human snippet for the result row. */
  snippet: string;
  status?: string;
  updatedAt: string;
  href: string;
}

/** A scored, explainable search hit. */
export interface SearchResult {
  entry: SearchEntry;
  score: number;
  /** Which field produced the best match (shown to the user). */
  matchField: "title" | "title-prefix" | "title-exact" | "alias" | "body";
}

/** Search hits grouped by record kind, groups ordered by best hit. */
export interface SearchGroup {
  kind: string;
  label: string;
  results: SearchResult[];
}

/** A recently-viewed record (persisted in prefs; reconciled against the store). */
export interface RecentItem {
  kind: string;
  id: string;
  title: string;
  at: string; // ISO of last open
}

/** A pinned/favorite record (persisted in prefs; reconciled against the store). */
export interface PinnedItem {
  kind: string;
  id: string;
  title: string;
  at: string; // ISO of when pinned (deterministic ordering)
}
