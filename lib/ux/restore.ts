/**
 * Deterministic restore validation & preview (LIFEOS-032, Feature 8).
 *
 * Validates an uploaded backup, previews exactly what a restore would change
 * (merge vs. overwrite), and applies it purely. Never silently overwrites: the
 * caller must confirm, and a malformed file is rejected with clear errors so the
 * original data (and the original file) are preserved. No network, no AI.
 */

import type { StoreState } from "@/types/mvp";
import { BACKUP_SCHEMA_VERSION, STORE_DOMAINS, backupCounts, type LifeOSBackup } from "@/lib/ux/backup";

export interface RestoreValidation {
  ok: boolean;
  version: number | null;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
  /** Domains present in the file that this app version doesn't know about. */
  incompatibleFields: string[];
  backup?: LifeOSBackup;
}

/** Parse + validate a raw uploaded string/object. Deterministic; never throws. */
export function validateBackup(raw: unknown): RestoreValidation {
  const empty: RestoreValidation = { ok: false, version: null, errors: [], warnings: [], counts: {}, incompatibleFields: [] };
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); }
    catch { return { ...empty, errors: ["The file is not valid JSON."] }; }
  }
  if (!obj || typeof obj !== "object") return { ...empty, errors: ["The backup is empty or malformed."] };
  const b = obj as Partial<LifeOSBackup>;
  const errors: string[] = [];
  const warnings: string[] = [];

  const version = typeof b.schemaVersion === "number" ? b.schemaVersion : null;
  if (version === null) errors.push("Missing schemaVersion — this doesn’t look like a LifeOS backup.");
  else if (version > BACKUP_SCHEMA_VERSION) warnings.push(`Backup schema v${version} is newer than this app (v${BACKUP_SCHEMA_VERSION}); unknown fields will be ignored.`);

  if (!b.data || typeof b.data !== "object") {
    errors.push("Missing data — no records to restore.");
    return { ...empty, version, errors, warnings };
  }

  const data = b.data as unknown as Record<string, unknown>;
  // Every known domain must be an array if present.
  for (const d of STORE_DOMAINS) {
    if (d in data && !Array.isArray(data[d])) errors.push(`Domain “${d}” is malformed (expected a list).`);
  }
  const knownKeys = new Set<string>(STORE_DOMAINS as string[]);
  const incompatibleFields = Object.keys(data).filter((k) => !knownKeys.has(k));
  if (incompatibleFields.length) warnings.push(`${incompatibleFields.length} unrecognized domain(s) will be ignored: ${incompatibleFields.join(", ")}.`);

  const counts = backupCounts(data as Partial<StoreState>);
  const ok = errors.length === 0;
  return { ok, version, errors, warnings, counts, incompatibleFields, backup: ok ? (b as LifeOSBackup) : undefined };
}

export type RestoreMode = "overwrite" | "merge";

export interface DomainPreview { domain: string; current: number; incoming: number; resulting: number }
export interface RestorePreview {
  mode: RestoreMode;
  domains: DomainPreview[];
  totalResulting: number;
  warnings: string[];
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Preview the per-domain effect of a restore without mutating anything. */
export function previewRestore(current: StoreState, backup: LifeOSBackup, mode: RestoreMode): RestorePreview {
  const data = backup.data as unknown as Record<string, unknown>;
  const domains: DomainPreview[] = STORE_DOMAINS.map((d) => {
    const cur = arr<{ id?: string }>(current[d]);
    const inc = arr<{ id?: string }>(data[d]);
    let resulting: number;
    if (mode === "overwrite") resulting = inc.length;
    else {
      const ids = new Set(cur.map((r) => r?.id));
      resulting = cur.length + inc.filter((r) => !ids.has(r?.id)).length;
    }
    return { domain: d, current: cur.length, incoming: inc.length, resulting };
  });
  const warnings: string[] = [];
  if (mode === "overwrite") warnings.push("Overwrite replaces ALL current records with the backup’s. Export first if unsure.");
  return { mode, domains, totalResulting: domains.reduce((n, d) => n + d.resulting, 0), warnings };
}

/**
 * Apply a restore purely, returning a new StoreState. Overwrite replaces each
 * domain with the backup's; merge unions by `id` with INCOMING winning on
 * conflict (so a re-import updates existing records). Unknown domains ignored.
 */
export function applyRestore(current: StoreState, backup: LifeOSBackup, mode: RestoreMode): StoreState {
  const next: StoreState = { ...current };
  const data = backup.data as unknown as Record<string, unknown>;
  for (const d of STORE_DOMAINS) {
    const inc = arr<{ id?: string }>(data[d]);
    if (mode === "overwrite") {
      (next as unknown as Record<string, unknown>)[d] = inc;
    } else {
      const cur = arr<{ id?: string }>(current[d]);
      const incIds = new Set(inc.map((r) => r?.id));
      const kept = cur.filter((r) => !incIds.has(r?.id));
      (next as unknown as Record<string, unknown>)[d] = [...inc, ...kept];
    }
  }
  return next;
}
