/**
 * Deterministic backup export (LIFEOS-032, Feature 8).
 *
 * Serializes ALL user-owned LifeOS data to a versioned JSON envelope so a user
 * can export and later restore their own data — no cloud provider, no network.
 * The envelope carries a schema version, export timestamp, optional app version,
 * every canonical `StoreState` domain, and the safe, useful preferences. Pure and
 * deterministic: the same state always produces the same bytes (given a fixed
 * clock). No secrets are ever included (prefs hold none).
 */

import type { StoreState } from "@/types/mvp";
import type { Prefs } from "@/lib/prefs";

export const BACKUP_SCHEMA_VERSION = 1;

/** Every canonical StoreState domain, in a stable order (backup + counts + merge). */
export const STORE_DOMAINS: (keyof StoreState)[] = [
  "captures", "proposals", "beliefs", "sources", "feedback", "comparisons", "inquiries",
  "megathreads", "reflections", "practices", "reviews", "reasonings", "embeddings", "decisions",
  "formationSessions", "concepts", "conceptRelationships", "principles", "frameworks",
  "knowledgeProjects", "researchProjects", "dialogueSessions", "tensions", "syntheses",
  "recommendations", "documents", "citations", "workspaces", "sessions", "goals", "projects",
];

export interface LifeOSBackup {
  schemaVersion: number;
  exportedAt: string;
  appVersion?: string;
  prefs?: Partial<Prefs>;
  data: StoreState;
}

/** Preferences that are safe and useful to restore (all local UI memory). */
export function safePrefs(prefs: Prefs): Partial<Prefs> {
  return {
    onboarding: prefs.onboarding,
    recent: prefs.recent,
    pinned: prefs.pinned,
    workspace: prefs.workspace,
    execution: prefs.execution,
    // inspector scroll/expanded is transient; onboardingStep is not restored.
  };
}

/** Build the backup envelope from a store snapshot + prefs. */
export function exportBackup(state: StoreState, prefs: Prefs, opts: { appVersion?: string; now?: string } = {}): LifeOSBackup {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: opts.now ?? new Date().toISOString(),
    appVersion: opts.appVersion,
    prefs: safePrefs(prefs),
    data: state,
  };
}

/** Stable, pretty JSON for download. */
export function serializeBackup(backup: LifeOSBackup): string {
  return JSON.stringify(backup, null, 2);
}

/** Per-domain record counts (for the export summary + restore preview). */
export function backupCounts(data: Partial<StoreState>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of STORE_DOMAINS) {
    const arr = data[d];
    out[d] = Array.isArray(arr) ? arr.length : 0;
  }
  return out;
}

/** Total records across all domains. */
export function totalRecords(counts: Record<string, number>): number {
  return Object.values(counts).reduce((n, c) => n + c, 0);
}

/** A suggested filename, e.g. `lifeos-backup-2026-07-27.json`. */
export function backupFilename(backup: LifeOSBackup): string {
  const date = (backup.exportedAt || "").slice(0, 10) || "export";
  return `lifeos-backup-${date}.json`;
}
