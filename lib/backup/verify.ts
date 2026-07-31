/**
 * Export verification (LIFEOS-040, Feature 13).
 *
 * Checks an archive for internal consistency WITHOUT importing it: it parses,
 * the manifest matches the included collections, record counts reconcile,
 * referenced ids are represented (or explicitly external/deleted), checksums
 * match, required metadata exists, and the archive version is supported. Returns
 * a human-readable report.
 */

import { safeJsonParse } from "@/lib/security/input-limits";
import { manifestMatches } from "@/lib/backup/manifest";
import { isArchiveVersionSupported, EXPORT_DOMAINS } from "@/lib/backup/versioning";
import type { AccountArchive } from "@/lib/backup/export";

export interface VerifyReport {
  ok: boolean;
  parsed: boolean;
  versionSupported: boolean;
  manifestOk: boolean;
  countsReconcile: boolean;
  metadataOk: boolean;
  totalRecords: number;
  problems: string[];
  notes: string[];
}

/** Verify from a raw archive string (never throws). */
export function verifyArchiveText(text: string): VerifyReport {
  const parsed = safeJsonParse(text);
  if (!parsed.ok) {
    return { ok: false, parsed: false, versionSupported: false, manifestOk: false, countsReconcile: false, metadataOk: false, totalRecords: 0, problems: [`archive did not parse: ${parsed.error}`], notes: [] };
  }
  return verifyArchive(parsed.value as AccountArchive);
}

/** Verify a parsed archive object. */
export function verifyArchive(archive: AccountArchive): VerifyReport {
  const problems: string[] = [];
  const notes: string[] = [];

  const metadataOk = Boolean(archive?.metadata && typeof archive.metadata.archiveVersion === "number" && archive.metadata.generatedAt);
  if (!metadataOk) problems.push("missing or malformed metadata");

  const versionSupported = metadataOk && isArchiveVersionSupported(archive.metadata.archiveVersion);
  if (metadataOk && !versionSupported) problems.push(`unsupported archive version ${archive.metadata.archiveVersion}`);

  const collections = archive?.collections ?? ({} as AccountArchive["collections"]);
  // Every known domain should be present as an array (may be empty).
  for (const d of EXPORT_DOMAINS) {
    if (!Array.isArray((collections as Record<string, unknown>)[d])) { problems.push(`collection ${d} missing or not an array`); }
  }

  const manifestInput: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(collections)) manifestInput[k] = Array.isArray(v) ? v : [];
  if (archive.tombstones) manifestInput.tombstones = archive.tombstones;
  if (archive.conflicts) manifestInput.conflicts = archive.conflicts;

  let manifestOk = false;
  if (archive?.manifest) {
    const m = manifestMatches(manifestInput, archive.manifest);
    manifestOk = m.ok;
    for (const mm of m.mismatches) problems.push(mm);
  } else {
    problems.push("missing manifest");
  }

  // Counts reconcile with metadata.recordCounts.
  let countsReconcile = true;
  if (metadataOk && archive.metadata.recordCounts) {
    for (const [k, n] of Object.entries(archive.metadata.recordCounts)) {
      const actual = Array.isArray((collections as Record<string, unknown>)[k]) ? ((collections as Record<string, unknown[]>)[k]).length : 0;
      if (actual !== n) { countsReconcile = false; problems.push(`metadata count mismatch: ${k} (${n} vs ${actual})`); }
    }
  }

  // Referential note: citations referencing documents not in the archive are
  // flagged as external/deleted, not errors (records may legitimately be gone).
  const docIds = new Set((collections.documents as { id?: string }[] | undefined ?? []).map((d) => d.id));
  const danglingCitations = (collections.citations as { documentId?: string }[] | undefined ?? []).filter((c) => c.documentId && !docIds.has(c.documentId)).length;
  if (danglingCitations) notes.push(`${danglingCitations} citation(s) reference a document not in this archive (external or deleted).`);

  const total = Object.values(manifestInput).reduce((n, a) => n + a.length, 0);
  const ok = problems.length === 0;
  return { ok, parsed: true, versionSupported, manifestOk, countsReconcile, metadataOk, totalRecords: total, problems, notes };
}

/** Format a verify report as human-readable text. */
export function formatVerifyReport(r: VerifyReport): string {
  const lines = [
    `Archive verification: ${r.ok ? "PASSED" : "FAILED"}`,
    `  parsed: ${r.parsed}`,
    `  version supported: ${r.versionSupported}`,
    `  manifest matches: ${r.manifestOk}`,
    `  counts reconcile: ${r.countsReconcile}`,
    `  metadata present: ${r.metadataOk}`,
    `  total records: ${r.totalRecords}`,
  ];
  if (r.problems.length) lines.push("  problems:", ...r.problems.map((p) => `    - ${p}`));
  if (r.notes.length) lines.push("  notes:", ...r.notes.map((n) => `    - ${n}`));
  return lines.join("\n");
}
