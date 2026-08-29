/**
 * Import preview & dry-run (LIFEOS-040, Feature 14).
 *
 * BEFORE any mutation, an import is previewed: version validated, record counts
 * shown, duplicate ids detected against current state, and a conflict preview
 * produced for merge vs replace. A dry run computes exactly what WOULD change
 * without touching the store. Archive HTML/URLs are never trusted; auth secrets
 * are never imported (there are none in the archive by construction).
 */

import type { StoreState } from "@/types/mvp";
import { verifyArchive, type VerifyReport } from "@/lib/backup/verify";
import { EXPORT_DOMAINS, isArchiveVersionSupported, type ExportDomain } from "@/lib/backup/versioning";
import type { AccountArchive } from "@/lib/backup/export";

export type ImportMode = "merge" | "replace";

export interface DomainPlan {
  domain: string;
  incoming: number;
  existing: number;
  newIds: number;
  duplicateIds: number;
  /** merge: added + updated; replace: replaced whole collection. */
  added: number;
  updated: number;
  removed: number;
}

export interface ImportPreview {
  verify: VerifyReport;
  importable: boolean;
  mode: ImportMode;
  plans: DomainPlan[];
  totalIncoming: number;
  totalDuplicates: number;
  /** True if any existing record would be overwritten (needs explicit confirm). */
  destructive: boolean;
  warnings: string[];
}

function idsOf(arr: unknown[]): Set<string> {
  const s = new Set<string>();
  for (const r of arr) { const id = (r as { id?: string }).id; if (id) s.add(id); }
  return s;
}

/**
 * Compute a preview/dry-run. Pure: does not mutate `current`. `mode` decides
 * whether existing records are merged (upsert by id) or the collection is
 * replaced wholesale.
 */
export function previewImport(current: StoreState, archive: AccountArchive, mode: ImportMode = "merge"): ImportPreview {
  const verify = verifyArchive(archive);
  const warnings: string[] = [];
  /**
   * A CORRUPT archive is not importable (LIFEOS-074).
   *
   * `verifyArchive` computes a per-collection checksum and correctly catches a
   * tampered field, a removed record and a collection that is no longer an
   * array — and this gate read none of it. Importability was decided by
   * metadata and version alone, so an archive whose contents had been altered
   * still reported `importable: true` and `restore()` let it through. A backup
   * format that carries a checksum and then ignores it on the one path where
   * the user is trusting the file is not offering integrity, only the look of
   * it.
   *
   * Deliberately narrow: an archive with NO manifest at all still imports, as
   * it always did. Older exports predate the manifest, and refusing them would
   * strand real data to punish a format change. What is refused is an archive
   * that CARRIES a manifest and does not match it — corruption, not age.
   */
  const manifestPresent = Boolean(archive?.manifest);
  const manifestBroken = manifestPresent && !verify.manifestOk;
  const importable = verify.parsed && verify.metadataOk
    && isArchiveVersionSupported(archive?.metadata?.archiveVersion ?? -1)
    && !manifestBroken;
  if (!importable) warnings.push("Archive is not importable (see verification problems).");
  if (manifestBroken) warnings.push("Archive contents do not match its manifest — the file has been altered or truncated.");
  else if (!manifestPresent) warnings.push("Archive has no manifest; contents could not be checksum-verified.");

  const plans: DomainPlan[] = [];
  let totalIncoming = 0;
  let totalDuplicates = 0;
  let destructive = false;

  for (const d of EXPORT_DOMAINS as readonly ExportDomain[]) {
    const incoming = Array.isArray(archive?.collections?.[d]) ? archive.collections[d] : [];
    const existing = ((current as unknown as Record<string, unknown[]>)[d]) ?? [];
    const existingIds = idsOf(existing);
    const incomingIds = idsOf(incoming);
    let newIds = 0, dup = 0;
    for (const id of incomingIds) { if (existingIds.has(id)) dup++; else newIds++; }
    totalIncoming += incoming.length;
    totalDuplicates += dup;

    let added = 0, updated = 0, removed = 0;
    if (mode === "merge") { added = newIds; updated = dup; }
    else { added = incoming.length; updated = 0; removed = existing.length; if (existing.length) destructive = true; }
    if (mode === "merge" && dup > 0) destructive = true; // updates overwrite fields

    plans.push({ domain: d, incoming: incoming.length, existing: existing.length, newIds, duplicateIds: dup, added, updated, removed });
  }

  return { verify, importable, mode, plans, totalIncoming, totalDuplicates, destructive, warnings };
}

/**
 * Apply an import to produce a NEW StoreState (dry-runnable — call and discard
 * to preview the exact result). Never mutates the input. Ownership rewriting is
 * the caller's concern (adapter stamps user_id server-side).
 */
export function applyImport(current: StoreState, archive: AccountArchive, mode: ImportMode = "merge"): StoreState {
  const next = { ...current } as unknown as Record<string, unknown[]>;
  for (const d of EXPORT_DOMAINS) {
    const incoming = Array.isArray(archive?.collections?.[d]) ? archive.collections[d] : [];
    if (mode === "replace") { next[d] = [...incoming]; continue; }
    const existing = (next[d] ?? []) as { id?: string }[];
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const r of incoming as { id?: string }[]) if (r.id) byId.set(r.id, r);
    next[d] = [...byId.values()];
  }
  return next as unknown as StoreState;
}

/** True when applying this import would overwrite or remove existing data. */
export function requiresExplicitConfirmation(preview: ImportPreview): boolean {
  return preview.destructive;
}
