/**
 * Export manifest & checksums (LIFEOS-040, Feature 12/13).
 *
 * A deterministic, dependency-free content hash (FNV-1a 32-bit, hex) over the
 * canonical JSON of each collection, plus per-collection counts. The manifest
 * lets a verifier confirm an archive is internally consistent WITHOUT importing
 * it: counts reconcile, checksums match, required metadata exists. No crypto
 * library — this is integrity/consistency, not tamper-proofing, and that
 * limitation is documented.
 */

export interface ManifestEntry {
  collection: string;
  count: number;
  checksum: string; // fnv1a hex of canonical JSON
}

export interface ExportManifest {
  entries: ManifestEntry[];
  totalRecords: number;
  overallChecksum: string;
}

/** FNV-1a 32-bit hash of a string → 8-char hex. Deterministic, fast, no deps. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Canonical JSON: object keys sorted recursively so the same data always
 * hashes to the same value regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Build a manifest over a map of collection → records[]. */
export function buildManifest(collections: Record<string, unknown[]>): ExportManifest {
  const entries: ManifestEntry[] = [];
  let total = 0;
  for (const name of Object.keys(collections).sort()) {
    const arr = collections[name] ?? [];
    const count = arr.length;
    total += count;
    entries.push({ collection: name, count, checksum: fnv1a(canonicalJson(arr)) });
  }
  const overallChecksum = fnv1a(entries.map((e) => `${e.collection}:${e.count}:${e.checksum}`).join("|"));
  return { entries, totalRecords: total, overallChecksum };
}

/** Recompute a manifest from collections and compare to a claimed manifest. */
export function manifestMatches(collections: Record<string, unknown[]>, claimed: ExportManifest): { ok: boolean; mismatches: string[] } {
  const rebuilt = buildManifest(collections);
  const mismatches: string[] = [];
  if (rebuilt.overallChecksum !== claimed.overallChecksum) mismatches.push("overall checksum");
  const claimedByName = new Map(claimed.entries.map((e) => [e.collection, e]));
  for (const e of rebuilt.entries) {
    const c = claimedByName.get(e.collection);
    if (!c) { mismatches.push(`missing manifest entry: ${e.collection}`); continue; }
    if (c.count !== e.count) mismatches.push(`count mismatch: ${e.collection} (${c.count} vs ${e.count})`);
    if (c.checksum !== e.checksum) mismatches.push(`checksum mismatch: ${e.collection}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}
