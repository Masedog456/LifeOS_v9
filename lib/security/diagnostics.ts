/**
 * Diagnostics Center projection (LIFEOS-040, Feature 11).
 *
 * Composes a single SANITIZED snapshot for the user-visible Diagnostics page:
 * versions, sync state, pending mutations, conflicts, storage, connectivity,
 * auth category, and recent redacted errors. It NEVER carries record contents,
 * tokens, or raw payloads. The snapshot doubles as the "copy/download sanitized
 * diagnostic report" payload — every field here is safe to share.
 */

import { maskEmail, redactMessage, type DiagnosticEvent } from "@/lib/security/redaction";
import type { CompatResult } from "@/lib/security/schema-compatibility";
import type { AuthCategory } from "@/lib/security/auth-boundaries";

export interface DiagnosticsInputs {
  appVersion: string;
  buildId: string;
  stateSchemaVersion: number;
  migrationVersion: number;
  compat?: CompatResult;
  /** LIFEOS-077: deployed contract, as read from the database. Developer-only. */
  schemaContract?: {
    state: string;
    clientContract: number;
    serverContract: number | null;
    minClientContract: number | null;
    capabilities: Record<string, number> | null;
    gatedDomains: string[];
  } | null;
  authCategory: AuthCategory;
  authEmail?: string | null;
  adapter: "local" | "supabase";
  remoteReachable: boolean | null;
  lastSyncAt: string | null;
  pendingMutations: number;
  dirtyDomains: string[];
  unresolvedConflicts: number;
  storageStatus: string;
  storageUsedBytes?: number;
  serviceWorker?: string;
  lastExportAt?: string | null;
  recentErrors?: { at: string; code: string; message: string }[];
  now?: string;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  app: { version: string; buildId: string; stateSchemaVersion: number; migrationVersion: number };
  compatibility: { mode: string; canWrite: boolean; canSync: boolean } | null;
  /**
   * LIFEOS-077 §29 — developer diagnostics only. This is the one place backend
   * nouns are allowed; ordinary product surfaces speak in consequences.
   */
  schemaContract: {
    state: string;
    clientContract: number;
    serverContract: number | null;
    minClientContract: number | null;
    capabilities: Record<string, number> | null;
    gatedDomains: string[];
  } | null;
  auth: { category: AuthCategory; emailMasked: string | null };
  sync: { adapter: "local" | "supabase"; remoteReachable: boolean | null; lastSyncAt: string | null; pendingMutations: number; dirtyDomains: string[]; unresolvedConflicts: number };
  storage: { status: string; usedBytes: number | null; serviceWorker: string | null };
  lastExportAt: string | null;
  recentErrors: { at: string; code: string; message: string }[];
}

/** Build the sanitized snapshot. Every string is redacted; no content leaks. */
export function buildDiagnostics(inputs: DiagnosticsInputs): DiagnosticsSnapshot {
  return {
    generatedAt: inputs.now ?? new Date().toISOString(),
    app: {
      version: inputs.appVersion,
      buildId: inputs.buildId,
      stateSchemaVersion: inputs.stateSchemaVersion,
      migrationVersion: inputs.migrationVersion,
    },
    compatibility: inputs.compat ? { mode: inputs.compat.mode, canWrite: inputs.compat.canWrite, canSync: inputs.compat.canSync } : null,
    schemaContract: inputs.schemaContract ?? null,
    auth: { category: inputs.authCategory, emailMasked: maskEmail(inputs.authEmail) },
    sync: {
      adapter: inputs.adapter,
      remoteReachable: inputs.remoteReachable,
      lastSyncAt: inputs.lastSyncAt,
      pendingMutations: inputs.pendingMutations,
      dirtyDomains: [...inputs.dirtyDomains].sort(),
      unresolvedConflicts: inputs.unresolvedConflicts,
    },
    storage: { status: inputs.storageStatus, usedBytes: inputs.storageUsedBytes ?? null, serviceWorker: inputs.serviceWorker ?? null },
    lastExportAt: inputs.lastExportAt ?? null,
    recentErrors: (inputs.recentErrors ?? []).slice(0, 20).map((e) => ({ at: e.at, code: redactMessage(e.code, 40), message: redactMessage(e.message) })),
  };
}

/** Serialize the snapshot as a downloadable, sanitized report. */
export function serializeDiagnostics(snap: DiagnosticsSnapshot): string {
  return JSON.stringify(snap, null, 2);
}

/** Assert a snapshot carries nothing sensitive (used by the self-test). */
export function assertSanitized(snap: DiagnosticsSnapshot): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const text = JSON.stringify(snap);
  if (/eyJ[A-Za-z0-9_-]{10,}/.test(text)) problems.push("possible token in diagnostics");
  if (/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text) && !/•/.test(snap.auth.emailMasked ?? "")) problems.push("unmasked email in diagnostics");
  if (/\bpassword\b|\bsecret\b/i.test(text)) problems.push("secret-like field in diagnostics");
  return { ok: problems.length === 0, problems };
}

/** Convert an in-memory diagnostic event stream to display rows (already clean). */
export function diagnosticEventRows(events: DiagnosticEvent[]): DiagnosticEvent[] {
  return events.slice(-50);
}
