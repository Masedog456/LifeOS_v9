/**
 * Search ranking (LIFEOS-027).
 *
 * Deterministic, explainable scoring — no hidden AI, no learned weights, no
 * external ranking service. The rules, in priority order (higher score wins):
 *
 *   1. exact title match            → 1000
 *   2. title prefix match           →  800
 *   3. title contains the query     →  600
 *   4. alias / concept-term match   →  400
 *   5. body / notes contains query  →  200
 *
 * Ties are broken by:
 *   a. more recent `updatedAt` (secondary signal — never overrides a stronger
 *      field match), then
 *   b. shorter title (a closer match is usually the more specific record), then
 *   c. id (a final, fully stable tiebreak so sorting is total and reproducible).
 *
 * Matching is case-insensitive, partial, and tolerant of minor punctuation
 * differences (both the query and the indexed fields are normalized the same
 * way before comparison).
 */

import type { SearchEntry, SearchResult } from "@/lib/command/types";

export const SCORE_TITLE_EXACT = 1000;
export const SCORE_TITLE_PREFIX = 800;
export const SCORE_TITLE_CONTAINS = 600;
export const SCORE_ALIAS = 400;
export const SCORE_BODY = 200;

/**
 * Normalize text for matching: lowercase, collapse whitespace, and strip
 * punctuation to spaces so "self-discipline", "self discipline", and
 * "selfdiscipline?" all compare equal on their word content. Deterministic.
 */
export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same normalization applied to a precomputed lowercased field. */
function normField(lower: string): string {
  return lower.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Score one entry against a normalized query. Returns null if it doesn't match. */
export function scoreEntry(entry: SearchEntry, q: string): SearchResult | null {
  if (!q) return null;
  const title = normField(entry.titleLower);
  if (title === q) return { entry, score: SCORE_TITLE_EXACT, matchField: "title-exact" };
  if (title.startsWith(q)) return { entry, score: SCORE_TITLE_PREFIX, matchField: "title-prefix" };
  if (title.includes(q)) return { entry, score: SCORE_TITLE_CONTAINS, matchField: "title" };
  for (const a of entry.aliasesLower) {
    if (normField(a).includes(q)) return { entry, score: SCORE_ALIAS, matchField: "alias" };
  }
  if (normField(entry.bodyLower).includes(q)) return { entry, score: SCORE_BODY, matchField: "body" };
  return null;
}

/** Total, stable comparator implementing the tiebreak chain above. */
export function compareResults(a: SearchResult, b: SearchResult): number {
  if (b.score !== a.score) return b.score - a.score;
  // Recency: more recent first (secondary only — scores already differ above).
  if (a.entry.updatedAt !== b.entry.updatedAt) return a.entry.updatedAt < b.entry.updatedAt ? 1 : -1;
  // Shorter title = usually the more specific match.
  if (a.entry.title.length !== b.entry.title.length) return a.entry.title.length - b.entry.title.length;
  // Fully stable final tiebreak.
  return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
}
