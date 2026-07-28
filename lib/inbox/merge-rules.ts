/**
 * Sync-conflict rules for capture processing fields (LIFEOS-035).
 *
 * Deterministic three-way merge for the processing metadata a capture carries.
 * The overriding rule: never silently discard lineage or processing history, and
 * never silently concatenate capture text. Links, tags, history and lineage
 * UNION safely; status-vs-content and divergent status/rewrites ESCALATE as
 * conflicts for the shared resolution UI (LIFEOS-033). Pure.
 *
 * Encoded cases (from the sprint spec):
 *  - local rewrite + remote tag add        → auto-merge (non-overlapping)
 *  - local archive + remote conversion     → conflict (status vs content)
 *  - local defer + remote mark processed   → conflict (divergent status)
 *  - both add different links               → union
 *  - split on one device + rewrite on other → conflict (status/lineage vs edit)
 *  - originals archived remotely + edited locally → conflict
 */

import type { Capture, CaptureProcessingEvent, RecordRefLite } from "@/types/mvp";

/** Statuses that hide/terminate a capture — editing one while it moves here conflicts. */
const TERMINAL = new Set(["archived", "discarded", "processed", "deferred"]);

const uniqRefs = (...lists: (RecordRefLite[] | undefined)[]): RecordRefLite[] => {
  const out: RecordRefLite[] = [];
  const seen = new Set<string>();
  for (const list of lists) for (const r of list ?? []) {
    const k = `${r.kind}:${r.id}`;
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
};
const uniqIds = (...lists: (string[] | undefined)[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) for (const id of list ?? []) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
};
const uniqHistory = (...lists: (CaptureProcessingEvent[] | undefined)[]): CaptureProcessingEvent[] => {
  const out: CaptureProcessingEvent[] = [];
  const seen = new Set<string>();
  for (const list of lists) for (const e of list ?? []) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
};

const changed = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

export interface CaptureMergeResult { merged: Capture; conflicts: string[]; autoMerged: string[] }

/**
 * Three-way merge of a capture's processing fields. `text` is never merged (it
 * is immutable). Returns the merged capture plus the list of conflicting fields
 * (empty when everything auto-merged).
 */
export function mergeCaptureProcessing(base: Capture, local: Capture, remote: Capture): CaptureMergeResult {
  const conflicts: string[] = [];
  const autoMerged: string[] = [];
  const merged: Capture = { ...local };

  // Links, tags, lineage, history: union — never discarded.
  merged.linkedWorkspaceIds = uniqIds(base.linkedWorkspaceIds, local.linkedWorkspaceIds, remote.linkedWorkspaceIds);
  merged.linkedGoalIds = uniqIds(base.linkedGoalIds, local.linkedGoalIds, remote.linkedGoalIds);
  merged.linkedProjectIds = uniqIds(base.linkedProjectIds, local.linkedProjectIds, remote.linkedProjectIds);
  merged.linkedEntityRefs = uniqRefs(base.linkedEntityRefs, local.linkedEntityRefs, remote.linkedEntityRefs);
  merged.tags = uniqIds(base.tags, local.tags, remote.tags);
  merged.mergedFromIds = uniqIds(base.mergedFromIds, local.mergedFromIds, remote.mergedFromIds);
  merged.splitFromId = local.splitFromId ?? remote.splitFromId ?? base.splitFromId;
  merged.history = uniqHistory(base.history, local.history, remote.history);
  for (const f of ["links", "tags", "history", "lineage"]) autoMerged.push(f);

  // Status changes.
  const localStatus = local.processingStatus ?? "inbox";
  const remoteStatus = remote.processingStatus ?? "inbox";
  const baseStatus = base.processingStatus ?? "inbox";
  const localStatusChanged = localStatus !== baseStatus;
  const remoteStatusChanged = remoteStatus !== baseStatus;

  // Content changes (rewrite / notes / new conversion targets).
  const localRewrote = changed(base.workingText, local.workingText);
  const remoteRewrote = changed(base.workingText, remote.workingText);
  const localNotes = changed(base.processingNotes, local.processingNotes);
  const remoteNotes = changed(base.processingNotes, remote.processingNotes);
  const localAddedContent = localRewrote || localNotes || changed(base.linkedEntityRefs, local.linkedEntityRefs);
  const remoteAddedContent = remoteRewrote || remoteNotes || changed(base.linkedEntityRefs, remote.linkedEntityRefs);

  // Divergent status → conflict.
  if (localStatusChanged && remoteStatusChanged && localStatus !== remoteStatus) {
    conflicts.push("processingStatus");
    merged.processingStatus = localStatus; // keep local; UI resolves
  } else if (localStatusChanged && TERMINAL.has(localStatus) && remoteAddedContent) {
    // e.g. local archive + remote conversion/rewrite.
    conflicts.push("status-vs-content");
    merged.processingStatus = localStatus;
  } else if (remoteStatusChanged && TERMINAL.has(remoteStatus) && localAddedContent) {
    // e.g. originals archived remotely + locally edited.
    conflicts.push("status-vs-content");
    merged.processingStatus = remoteStatus;
  } else {
    merged.processingStatus = localStatusChanged ? localStatus : remoteStatus;
    if (localStatusChanged || remoteStatusChanged) autoMerged.push("processingStatus");
  }
  // Carry the timestamps/defer of whichever side owns the resulting status.
  const owner = merged.processingStatus === remoteStatus && remoteStatusChanged && !localStatusChanged ? remote : local;
  merged.deferredUntil = owner.deferredUntil;
  merged.processedAt = owner.processedAt ?? local.processedAt ?? remote.processedAt;
  merged.archivedAt = owner.archivedAt ?? local.archivedAt ?? remote.archivedAt;
  merged.discardedAt = owner.discardedAt ?? local.discardedAt ?? remote.discardedAt;

  // Rewrite (workingText): both changed differently → conflict.
  if (localRewrote && remoteRewrote && changed(local.workingText, remote.workingText)) {
    conflicts.push("workingText");
    merged.workingText = local.workingText; // keep local; never concatenate
  } else {
    merged.workingText = localRewrote ? local.workingText : (remoteRewrote ? remote.workingText : base.workingText);
    if (localRewrote || remoteRewrote) autoMerged.push("workingText");
  }

  // Notes: both changed differently → conflict; else take the changed side.
  if (localNotes && remoteNotes && changed(local.processingNotes, remote.processingNotes)) {
    conflicts.push("processingNotes");
    merged.processingNotes = local.processingNotes;
  } else {
    merged.processingNotes = localNotes ? local.processingNotes : (remoteNotes ? remote.processingNotes : base.processingNotes);
  }

  return { merged, conflicts, autoMerged };
}
