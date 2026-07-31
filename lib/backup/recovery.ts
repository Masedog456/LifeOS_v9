/**
 * Recovery Center projection (LIFEOS-040, Feature 18).
 *
 * A single read-only projection of everything the user can recover: recently
 * discarded captures, archived records, tombstoned records where restoration is
 * supported, failed imports, interrupted exports, sync conflicts, orphan-safe
 * records, incomplete migrations, and corrupted local preferences. Every
 * candidate carries a PREVIEW of impact; nothing here auto-repairs an ambiguous
 * state — the user chooses.
 */

import type { StoreState } from "@/types/mvp";

export type RecoveryKind =
  | "discarded-capture"
  | "archived-record"
  | "tombstone"
  | "failed-import"
  | "interrupted-export"
  | "sync-conflict"
  | "orphan-record"
  | "incomplete-migration"
  | "corrupt-preferences";

export interface RecoveryCandidate {
  kind: RecoveryKind;
  id: string;
  label: string;
  /** Non-technical description of what recovering this would do. */
  impact: string;
  /** Whether recovery is reversible/safe to attempt. */
  restorable: boolean;
}

export interface RecoveryInputs {
  state: StoreState;
  unresolvedConflicts?: { id: string; domain: string }[];
  failedImports?: { id: string; at: string }[];
  interruptedExports?: { id: string; at: string }[];
  corruptPrefsKey?: string | null;
  incompleteMigration?: { from: number; to: number } | null;
}

export interface RecoveryProjection {
  candidates: RecoveryCandidate[];
  countsByKind: Record<string, number>;
}

/** Build the recovery projection. Pure and deterministic. */
export function buildRecovery(inputs: RecoveryInputs): RecoveryProjection {
  const { state } = inputs;
  const out: RecoveryCandidate[] = [];

  // Discarded captures (status === 'discarded' but retained).
  for (const c of (state.captures ?? []) as { id: string; text?: string; processingStatus?: string }[]) {
    if (c.processingStatus === "discarded") {
      out.push({ kind: "discarded-capture", id: c.id, label: (c.text ?? "").slice(0, 60) || "Discarded capture", impact: "Restores this capture to your inbox.", restorable: true });
    }
  }

  // Archived records across the domains that carry a status field.
  const archivedFrom = (arr: unknown[] | undefined, kindLabel: string) => {
    for (const r of (arr ?? []) as { id: string; title?: string; status?: string }[]) {
      if (r.status === "archived") out.push({ kind: "archived-record", id: r.id, label: r.title ?? `${kindLabel} ${r.id.slice(0, 6)}`, impact: `Un-archives this ${kindLabel}. Nothing is deleted.`, restorable: true });
    }
  };
  archivedFrom(state.projects, "project");
  archivedFrom(state.documents, "document");
  archivedFrom(state.researchProjects, "research project");

  // Sync conflicts.
  for (const c of inputs.unresolvedConflicts ?? []) {
    out.push({ kind: "sync-conflict", id: c.id, label: `Conflict in ${c.domain}`, impact: "Opens the conflict so you can choose which version to keep. No data is lost.", restorable: true });
  }

  // Failed imports / interrupted exports.
  for (const f of inputs.failedImports ?? []) out.push({ kind: "failed-import", id: f.id, label: `Failed import (${f.at.slice(0, 10)})`, impact: "Retries the import preview from the saved archive.", restorable: true });
  for (const e of inputs.interruptedExports ?? []) out.push({ kind: "interrupted-export", id: e.id, label: `Interrupted export (${e.at.slice(0, 10)})`, impact: "Restarts the export. Nothing was written to your data.", restorable: true });

  // Corrupt preferences (safe to reset).
  if (inputs.corruptPrefsKey) out.push({ kind: "corrupt-preferences", id: inputs.corruptPrefsKey, label: "Corrupted preferences", impact: "Resets UI preferences to defaults. Your records are untouched.", restorable: true });

  // Incomplete migration.
  if (inputs.incompleteMigration) {
    const m = inputs.incompleteMigration;
    out.push({ kind: "incomplete-migration", id: `mig-${m.from}-${m.to}`, label: `Incomplete upgrade v${m.from}→v${m.to}`, impact: "Re-runs the local data upgrade. Your data is preserved.", restorable: true });
  }

  const countsByKind: Record<string, number> = {};
  for (const c of out) countsByKind[c.kind] = (countsByKind[c.kind] ?? 0) + 1;
  return { candidates: out, countsByKind };
}
