/**
 * Merge workspace (LIFEOS-038, Feature 8).
 *
 * Deterministic merge PREVIEW for entities, beliefs, documents, research topics,
 * aliases, and relationships. A merge folds "loser" records into a chosen
 * primary while PRESERVING history, citations, and backlinks and keeping the
 * primary's id. It NEVER destroys evidence and NEVER deletes automatically — the
 * preview is read-only; only an explicit, confirmed store action applies it, and
 * even then losers are archived (reversible), not erased. Pure.
 */

import type { StoreState, RecordRefLite, Citation } from "@/types/mvp";
import { type MaintenanceIndex, refKey } from "@/lib/maintenance/integrity";

export const MERGEABLE_KINDS = new Set(["concept", "theme", "belief", "document", "research_project", "research", "relationship"]);

export interface MergePreview {
  primary: RecordRefLite;
  losers: RecordRefLite[];
  /** Citations currently owned by losers that would be re-pointed to the primary. */
  movedCitations: Citation[];
  /** Records that reference a loser and would be re-pointed to the primary. */
  affectedBacklinks: RecordRefLite[];
  /** Total maintenance-history events that would be carried onto the primary. */
  preservedHistoryCount: number;
  /** True — a merge never deletes; losers are archived, evidence preserved. */
  evidencePreserved: true;
  warnings: string[];
}

/** Records that reference a target (documents by citation, concepts by relatedX). */
function backlinksTo(state: StoreState, ref: RecordRefLite): RecordRefLite[] {
  const out: RecordRefLite[] = [];
  const key = refKey(ref);
  for (const c of state.concepts ?? []) {
    const hit =
      (ref.kind === "belief" && (c.relatedBeliefs ?? []).includes(ref.id)) ||
      (ref.kind === "concept" && ((c.relatedConcepts ?? []).includes(ref.id) || (c.parentConcepts ?? []).includes(ref.id) || (c.childConcepts ?? []).includes(ref.id) || (c.opposingConcepts ?? []).includes(ref.id))) ||
      (ref.kind === "source" && (c.relatedSources ?? []).includes(ref.id));
    if (hit) out.push({ kind: "concept", id: c.id });
  }
  if (ref.kind === "concept") for (const r of state.conceptRelationships ?? []) if (r.fromConceptId === ref.id || r.toConceptId === ref.id) out.push({ kind: "relationship", id: r.id });
  if (ref.kind === "document") for (const c of state.citations ?? []) if (c.documentId === ref.id) out.push({ kind: c.recordKind, id: c.recordId });
  // Dedup.
  const seen = new Set<string>([key]);
  return out.filter((r) => { const k = refKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Build a deterministic merge preview. `primary` is kept; `losers` fold into it.
 * Nothing is applied — this only describes what a confirmed merge would preserve.
 */
export function mergePreview(state: StoreState, index: MaintenanceIndex, primary: RecordRefLite, losers: RecordRefLite[]): MergePreview {
  const warnings: string[] = [];
  const cleanLosers = losers.filter((l) => refKey(l) !== refKey(primary));

  if (!MERGEABLE_KINDS.has(primary.kind)) warnings.push(`${primary.kind} is not a mergeable kind`);
  for (const l of cleanLosers) if (l.kind !== primary.kind) warnings.push(`${l.kind} differs from the primary kind (${primary.kind})`);
  if (!index.has(primary)) warnings.push("the primary record no longer exists");

  const movedCitations: Citation[] = [];
  for (const l of cleanLosers) movedCitations.push(...(index.citationsByRecord.get(refKey(l)) ?? []));

  const affectedBacklinks: RecordRefLite[] = [];
  const seen = new Set<string>();
  for (const l of cleanLosers) for (const b of backlinksTo(state, l)) { const k = refKey(b); if (!seen.has(k)) { seen.add(k); affectedBacklinks.push(b); } }

  // History that would carry onto the primary: each loser's maintenance events.
  let preservedHistoryCount = 0;
  for (const e of state.maintenanceEvents ?? []) if (cleanLosers.some((l) => refKey(l) === refKey(e.ref))) preservedHistoryCount++;

  return { primary, losers: cleanLosers, movedCitations, affectedBacklinks, preservedHistoryCount, evidencePreserved: true, warnings };
}

/** Can these references be merged at all (same mergeable kind, ≥2 records)? */
export function canMerge(primary: RecordRefLite, losers: RecordRefLite[]): boolean {
  if (!MERGEABLE_KINDS.has(primary.kind)) return false;
  const distinct = losers.filter((l) => refKey(l) !== refKey(primary));
  return distinct.length >= 1 && distinct.every((l) => l.kind === primary.kind);
}
