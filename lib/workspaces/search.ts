/**
 * Workspace-scoped search (LIFEOS-030, Feature 9).
 *
 * REUSES the LIFEOS-027 search engine (index + ranking) — no second engine. It
 * simply restricts the shared index to the entries that belong to a workspace
 * (its members, a member document's own passages/highlights/notes/authors, and
 * the one-hop referenced frontier) before running the identical ranked query.
 * Pure and deterministic; no AI.
 */

import type { StoreState, Workspace } from "@/types/mvp";
import type { SearchEntry, SearchGroup, SearchResult } from "@/lib/command/types";
import { searchFlat, searchGrouped } from "@/lib/command/search";
import { makeEntityContext } from "@/lib/entities/entity";
import { workspaceReferenced } from "@/lib/workspaces/workspace";

/**
 * The set of index keys (`kind:id`) that count as "inside" a workspace: explicit
 * members; for each member document, its passages, highlights, annotations, and
 * authors; and the referenced-by-workspace frontier so adjacent context is
 * findable. Deterministic given the state + workspace.
 */
export function workspaceScopeKeys(state: StoreState, ws: Workspace): Set<string> {
  const keys = new Set<string>();
  const add = (kind: string, id: string) => keys.add(`${kind}:${id}`);
  for (const m of ws.members) {
    add(m.kind, m.id);
    if (m.kind === "document") {
      const doc = state.documents.find((d) => d.id === m.id);
      if (doc) {
        for (const a of doc.authors) add("author", a.toLowerCase().trim());
        for (const sec of doc.sections) for (const p of sec.passages) {
          add("passage", p.id);
          for (const h of p.highlights) add("highlight", h.id);
          for (const an of p.annotations) add("annotation", an.id);
        }
      }
    }
  }
  // Referenced frontier (one hop) — findable but clearly secondary.
  const ctx = makeEntityContext(state);
  for (const r of workspaceReferenced(ctx, ws, 40)) add(r.ref.kind, r.ref.id);
  return keys;
}

/** Restrict a prebuilt index to a workspace's scope. */
export function scopeIndex(index: SearchEntry[], keys: Set<string>): SearchEntry[] {
  return index.filter((e) => keys.has(`${e.kind}:${e.id}`));
}

/** Flat ranked search restricted to a workspace (reuses ranking verbatim). */
export function searchWorkspaceFlat(index: SearchEntry[], state: StoreState, ws: Workspace, query: string, limit = 50): SearchResult[] {
  return searchFlat(scopeIndex(index, workspaceScopeKeys(state, ws)), query, limit);
}

/** Grouped ranked search restricted to a workspace. */
export function searchWorkspaceGrouped(index: SearchEntry[], state: StoreState, ws: Workspace, query: string, limitPerGroup = 6): SearchGroup[] {
  return searchGrouped(scopeIndex(index, workspaceScopeKeys(state, ws)), query, limitPerGroup);
}
