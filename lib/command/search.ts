/**
 * Unified global search (LIFEOS-027).
 *
 * A single deterministic index over all meaningful user-owned records
 * (captures, beliefs, concepts, themes, dialogues, research, syntheses,
 * tensions, decisions, questions, reflections, authoring, sources). The index
 * is built once per store snapshot (memoize with `useMemo` at the call site)
 * and queried per keystroke; querying allocates only the result arrays. Ranking
 * is documented in `ranking.ts`. No external API, no AI, no learned weights.
 */

import type { StoreState } from "@/types/mvp";
import type { SearchEntry, SearchGroup, SearchResult } from "@/lib/command/types";
import { buildSearchEntries, RECORD_LABELS, RECORD_ORDER } from "@/lib/command/records";
import { compareResults, normalizeQuery, scoreEntry } from "@/lib/command/ranking";

export { buildSearchEntries };

/** Build the index for a store snapshot. Cheap enough to memoize by state. */
export function buildIndex(state: StoreState): SearchEntry[] {
  return buildSearchEntries(state);
}

/**
 * Query the index. Returns a flat, ranked, de-duplicated result list.
 * `limit` caps the total (results are globally ranked first, then capped).
 */
export function searchFlat(index: SearchEntry[], rawQuery: string, limit = 50): SearchResult[] {
  const q = normalizeQuery(rawQuery);
  if (!q) return [];
  const hits: SearchResult[] = [];
  for (const entry of index) {
    const r = scoreEntry(entry, q);
    if (r) hits.push(r);
  }
  hits.sort(compareResults);
  return hits.slice(0, limit);
}

/** Query the index and group hits by record kind, groups ordered by RECORD_ORDER. */
export function searchGrouped(index: SearchEntry[], rawQuery: string, limitPerGroup = 6): SearchGroup[] {
  const flat = searchFlat(index, rawQuery, 500);
  const byKind = new Map<string, SearchResult[]>();
  for (const r of flat) {
    const arr = byKind.get(r.entry.kind);
    if (arr) { if (arr.length < limitPerGroup) arr.push(r); }
    else byKind.set(r.entry.kind, [r]);
  }
  const groups: SearchGroup[] = [];
  for (const kind of RECORD_ORDER) {
    const results = byKind.get(kind);
    if (results && results.length) groups.push({ kind, label: RECORD_LABELS[kind] ?? kind, results });
  }
  // Any kind not in RECORD_ORDER (defensive) appended in stable label order.
  for (const [kind, results] of byKind) {
    if (!RECORD_ORDER.includes(kind) && results.length) groups.push({ kind, label: RECORD_LABELS[kind] ?? kind, results });
  }
  return groups;
}
