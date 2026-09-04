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
/** LIFEOS-085. Every query word found in the title, in any order. */
export const SCORE_TITLE_TOKENS = 500;
export const SCORE_ALIAS = 400;
export const SCORE_BODY = 200;
/** LIFEOS-085. Every query word found in the body, in any order. */
export const SCORE_BODY_TOKENS = 100;

/**
 * Words carried by ordinary questions that name no record (LIFEOS-085).
 *
 * A closed list, deliberately tiny. It exists because token matching requires
 * EVERY word to be found, and "rules about anger" would otherwise fail on
 * `about` — a word no title contains and none should have to.
 *
 * It is not a stemmer, a synonym table or a language model. Adding a word here
 * makes a query looser, so the bar is: the word carries no record identity in
 * any domain Conqify stores.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "my", "our", "his", "her", "their", "its", "your",
  "about", "for", "of", "on", "in", "at", "to", "from", "with", "by",
  "and", "or", "is", "are", "was", "were", "be", "been", "am",
  "i", "im", "me", "we", "it", "that", "this", "these", "those",
  "any", "some", "all", "thing", "things", "stuff", "show", "find",
]);

/**
 * The query as words, stopwords removed, one-character words dropped.
 *
 * Returns an empty array when nothing survives — a query of only stopwords
 * ("the", "any of it") must fall back to substring matching rather than match
 * every record in the store.
 */
export function queryTokens(q: string): string[] {
  return q.split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * True when every token is a PREFIX of some word in the field.
 *
 * Prefix rather than equality is what lets "grad school" find "Graduate
 * school" — the audit's headline failure — and it is bounded in the direction
 * that matters: a query word must be an opening of a real word, never the
 * other way round, so "school" does not match "sch".
 */
function tokensMatch(field: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const words = field.split(" ").map(stem);
  for (const t of tokens) {
    const st = stem(t);
    if (!words.some((w) => w.startsWith(st))) return false;
  }
  return true;
}

/**
 * The one morphological rule English actually needs here: a trailing plural s.
 *
 * NOT a stemmer and NOT fuzzy matching (§30). Without it "completed
 * applications" cannot find an action called "Submit UH application", because
 * prefix matching is one-directional and the query word is the LONGER one.
 * Guarded on length and on "ss" so "less", "class" and "is" are untouched.
 */
function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

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

/**
 * Score one entry against a normalized query. Returns null if it doesn't match.
 *
 * Every substring tier is checked before any token tier, which is what keeps
 * LIFEOS-085 §7's rule true: a looser match can never bury an exact title hit,
 * because the loosest phrase match (`body`, 200) still outscores the strongest
 * token match on a title (500) only when… it does not — and that is the point.
 * The ordering is title-exact 1000 > title-prefix 800 > title-contains 600 >
 * title-tokens 500 > alias 400 > body-contains 200 > body-tokens 100, so a
 * whole-phrase hit always beats the same field's scattered-word hit.
 */
export function scoreEntry(entry: SearchEntry, q: string): SearchResult | null {
  if (!q) return null;
  const title = normField(entry.titleLower);
  if (title === q) return { entry, score: SCORE_TITLE_EXACT, matchField: "title-exact" };
  if (title.startsWith(q)) return { entry, score: SCORE_TITLE_PREFIX, matchField: "title-prefix" };
  if (title.includes(q)) return { entry, score: SCORE_TITLE_CONTAINS, matchField: "title" };

  // LIFEOS-085. The audit's root cause: matching was contiguous-substring only,
  // so "grad school" could not find the goal called "Graduate school" and every
  // multi-word question found nothing at all.
  const tokens = queryTokens(q);
  if (tokensMatch(title, tokens)) return { entry, score: SCORE_TITLE_TOKENS, matchField: "title-tokens" };

  for (const a of entry.aliasesLower) {
    if (normField(a).includes(q)) return { entry, score: SCORE_ALIAS, matchField: "alias" };
  }
  const body = normField(entry.bodyLower);
  if (body.includes(q)) return { entry, score: SCORE_BODY, matchField: "body" };
  if (tokensMatch(body, tokens)) return { entry, score: SCORE_BODY_TOKENS, matchField: "body-tokens" };
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
