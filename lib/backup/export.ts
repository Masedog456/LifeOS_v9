/**
 * Complete account export (LIFEOS-040, Feature 12).
 *
 * Produces a deterministic, documented JSON archive of everything the user owns:
 * every StoreState collection, safe preferences, and (optionally) tombstones +
 * conflict records for fidelity — plus a manifest with per-collection checksums.
 * The archive contains NO secrets, tokens, or auth material. Given a fixed clock
 * the same state always yields the same bytes. A streaming NDJSON variant avoids
 * holding several copies of a large archive in memory.
 */

import type { StoreState } from "@/types/mvp";
import type { Prefs } from "@/lib/prefs";
import { EXPORT_ARCHIVE_VERSION, EXPORT_DOMAINS, type ExportDomain } from "@/lib/backup/versioning";
import { buildManifest, type ExportManifest } from "@/lib/backup/manifest";
import { CURRENT_STATE_VERSION } from "@/lib/migrations/state-version";
import { EXPECTED_MIGRATION_VERSION } from "@/lib/security/schema-compatibility";

export interface ExportMetadata {
  archiveVersion: number;
  appVersion: string;
  stateSchemaVersion: number;
  migrationVersion: number;
  generatedAt: string;
  timezone: string;
  /** Number of pending local mutations disclosed at export time. */
  pendingMutations: number;
  recordCounts: Record<string, number>;
}

export interface AccountArchive {
  metadata: ExportMetadata;
  collections: Record<ExportDomain, unknown[]>;
  prefs: Partial<Prefs>;
  tombstones?: unknown[];
  conflicts?: unknown[];
  manifest: ExportManifest;
}

export interface ExportOptions {
  appVersion?: string;
  now?: string;
  timezone?: string;
  pendingMutations?: number;
  tombstones?: unknown[];
  conflicts?: unknown[];
  /** Preferences to include (already reduced to safe fields by the caller). */
  prefs?: Partial<Prefs>;
}

/** Preferences that are safe to export (UI memory only, never secrets). */
export function safeExportPrefs(prefs: Prefs): Partial<Prefs> {
  const { onboarding, recent, pinned, workspace, execution, insights } = prefs as Prefs & { insights?: unknown };
  return { onboarding, recent, pinned, workspace, execution, ...(insights ? { insights } : {}) } as Partial<Prefs>;
}

/** Extract the ordered collection map from a StoreState. */
export function collectionsFromState(state: StoreState): Record<ExportDomain, unknown[]> {
  const out = {} as Record<ExportDomain, unknown[]>;
  for (const d of EXPORT_DOMAINS) {
    const arr = (state as unknown as Record<string, unknown>)[d];
    out[d] = Array.isArray(arr) ? arr : [];
  }
  return out;
}

/** Build the full account archive (in-memory). */
export function buildAccountArchive(state: StoreState, opts: ExportOptions = {}): AccountArchive {
  const collections = collectionsFromState(state);
  const recordCounts: Record<string, number> = {};
  for (const d of EXPORT_DOMAINS) recordCounts[d] = collections[d].length;

  const manifestInput: Record<string, unknown[]> = { ...collections };
  if (opts.tombstones) manifestInput.tombstones = opts.tombstones;
  if (opts.conflicts) manifestInput.conflicts = opts.conflicts;

  const metadata: ExportMetadata = {
    archiveVersion: EXPORT_ARCHIVE_VERSION,
    appVersion: opts.appVersion ?? "0.0.0",
    stateSchemaVersion: CURRENT_STATE_VERSION,
    migrationVersion: EXPECTED_MIGRATION_VERSION,
    generatedAt: opts.now ?? new Date().toISOString(),
    timezone: opts.timezone ?? "UTC",
    pendingMutations: opts.pendingMutations ?? 0,
    recordCounts,
  };

  return {
    metadata,
    collections,
    prefs: opts.prefs ?? {},
    tombstones: opts.tombstones,
    conflicts: opts.conflicts,
    manifest: buildManifest(manifestInput),
  };
}

/** Serialize the archive as pretty, stable JSON. */
export function serializeArchive(archive: AccountArchive): string {
  return JSON.stringify(archive, null, 2);
}

/** A suggested filename, e.g. `lifeos-export-2026-07-31.json`. */
export function archiveFilename(archive: AccountArchive): string {
  const date = (archive.metadata.generatedAt || "").slice(0, 10) || "export";
  return `lifeos-export-${date}.json`;
}

/**
 * Streaming export: yields the archive as NDJSON lines (metadata, then one line
 * per collection, then manifest) so a large archive never sits in memory as a
 * single giant string plus its JSON.stringify copy. Callers pipe each line to a
 * writable stream / Blob part.
 */
export function* streamArchiveLines(state: StoreState, opts: ExportOptions = {}): Generator<string> {
  const archive = buildAccountArchive(state, opts);
  yield JSON.stringify({ kind: "metadata", metadata: archive.metadata }) + "\n";
  for (const d of EXPORT_DOMAINS) {
    yield JSON.stringify({ kind: "collection", name: d, records: archive.collections[d] }) + "\n";
  }
  if (archive.tombstones) yield JSON.stringify({ kind: "tombstones", records: archive.tombstones }) + "\n";
  if (archive.conflicts) yield JSON.stringify({ kind: "conflicts", records: archive.conflicts }) + "\n";
  yield JSON.stringify({ kind: "manifest", manifest: archive.manifest, prefs: archive.prefs }) + "\n";
}

/** Build CSV text for a tabular collection (flat scalar columns only). */
export function collectionToCsv(records: Record<string, unknown>[]): string {
  if (!records.length) return "";
  const cols = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) { if (isScalar(r[k])) cols.add(k); }
  const header = [...cols];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of records) lines.push(header.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}

function isScalar(v: unknown): boolean {
  return v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Assert an archive carries no secret/token fields (used by the self-test). */
export function assertNoSecrets(archive: AccountArchive): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const text = JSON.stringify(archive);
  if (/"(access_token|refresh_token|service_role|apikey|api_key|password|secret)"\s*:/i.test(text)) problems.push("secret-like key present in archive");
  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(text)) problems.push("JWT-like token present in archive");
  return { ok: problems.length === 0, problems };
}
