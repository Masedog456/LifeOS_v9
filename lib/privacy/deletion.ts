/**
 * Deletion semantics registry + account deletion workflow (LIFEOS-040, Features 16/17).
 *
 * A SINGLE source of truth for what "delete", "archive", and "discard" actually
 * do for each entity type, so confirmation dialogs and docs never lie. Then the
 * account-deletion state machine: explain → offer export → confirm → (re-auth) →
 * run → report. Nothing here promises instant, irreversible erasure the
 * infrastructure cannot guarantee; retention is disclosed honestly.
 */

export type DeletionBehavior = "soft-delete" | "archive" | "reversible-discard" | "tombstone" | "permanent";

export interface DeletionSemantic {
  entity: string;
  behavior: DeletionBehavior;
  /** The exact word the UI uses for the action. */
  actionLabel: string;
  /** Honest one-liner shown in the confirmation dialog. */
  explanation: string;
  reversible: boolean;
}

/** Registry: every entity type's deletion behavior + honest copy. */
export const DELETION_SEMANTICS: readonly DeletionSemantic[] = [
  { entity: "capture", behavior: "reversible-discard", actionLabel: "Discard", explanation: "Moves this capture out of your inbox. You can restore it from the Recovery Center.", reversible: true },
  { entity: "project", behavior: "archive", actionLabel: "Archive", explanation: "Archives this project. It stays in your data and can be un-archived anytime. Archive does not delete.", reversible: true },
  { entity: "document", behavior: "archive", actionLabel: "Archive", explanation: "Archives this document and keeps its highlights and citations. Nothing is deleted.", reversible: true },
  { entity: "action", behavior: "soft-delete", actionLabel: "Delete", explanation: "Removes this action from your lists. Its history is retained and it syncs as a deletion.", reversible: false },
  { entity: "belief", behavior: "tombstone", actionLabel: "Delete", explanation: "Deletes this belief and records a tombstone so the deletion syncs across devices.", reversible: false },
  { entity: "merge-loser", behavior: "archive", actionLabel: "Merge", explanation: "The merged-away record is archived (reversible), never destroyed, so a merge can be undone.", reversible: true },
  { entity: "saved-insight-view", behavior: "tombstone", actionLabel: "Delete", explanation: "Deletes this saved view. It stores no data of its own — only your display choices.", reversible: false },
  { entity: "account", behavior: "permanent", actionLabel: "Delete permanently", explanation: "Permanently deletes your account and content. This cannot be undone. Some records may persist briefly in backups per the retention policy.", reversible: false },
];

export function deletionSemantic(entity: string): DeletionSemantic | undefined {
  return DELETION_SEMANTICS.find((d) => d.entity === entity);
}

/** The confirmation copy an entity's delete dialog must show. */
export function confirmationCopy(entity: string): { title: string; body: string; confirmLabel: string; reversible: boolean } {
  const s = deletionSemantic(entity) ?? { entity, behavior: "permanent" as DeletionBehavior, actionLabel: "Delete", explanation: "This action removes the item.", reversible: false };
  return { title: `${s.actionLabel}?`, body: s.explanation, confirmLabel: s.actionLabel, reversible: s.reversible };
}

/** Validate that no "archive" action is mislabeled as a destructive delete. */
export function validateSemantics(reg: readonly DeletionSemantic[] = DELETION_SEMANTICS): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const s of reg) {
    if (s.behavior === "archive" && /delete/i.test(s.actionLabel)) problems.push(`${s.entity}: archive labeled as "${s.actionLabel}"`);
    if (s.behavior === "permanent" && s.reversible) problems.push(`${s.entity}: permanent marked reversible`);
    if (s.behavior === "reversible-discard" && !s.reversible) problems.push(`${s.entity}: discard marked non-reversible`);
    if (s.behavior === "permanent" && !/permanent|cannot be undone/i.test(s.explanation)) problems.push(`${s.entity}: permanent delete must state irreversibility`);
  }
  return { ok: problems.length === 0, problems };
}

// ---- Account deletion state machine (Feature 16) ----

export type DeletionStage = "explain" | "offer-export" | "confirm" | "reauth" | "running" | "done" | "failed";

export interface DeletionState {
  stage: DeletionStage;
  exportOffered: boolean;
  exportDone: boolean;
  confirmedPhrase: boolean;
  reauthenticated: boolean;
  /** A freeze that blocks new mutations once deletion starts. */
  frozen: boolean;
  error?: string;
}

export const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export function initialDeletionState(): DeletionState {
  return { stage: "explain", exportOffered: false, exportDone: false, confirmedPhrase: false, reauthenticated: false, frozen: false };
}

/** Advance the machine given an event. Pure; returns the next state. */
export function nextDeletionStage(state: DeletionState, event: { type: string; supportsReauth?: boolean; phrase?: string }): DeletionState {
  switch (event.type) {
    case "start": return { ...state, stage: "offer-export", exportOffered: true };
    case "export-done": return { ...state, exportDone: true };
    case "skip-export": return { ...state, stage: "confirm" };
    case "export-then-continue": return { ...state, stage: "confirm", exportDone: true };
    case "confirm-phrase": {
      const ok = event.phrase === CONFIRM_PHRASE;
      if (!ok) return { ...state, confirmedPhrase: false, error: "Type the exact phrase to confirm." };
      return { ...state, confirmedPhrase: true, error: undefined, stage: event.supportsReauth ? "reauth" : "running", frozen: true };
    }
    case "reauth-ok": return { ...state, reauthenticated: true, stage: "running" };
    case "complete": return { ...state, stage: "done" };
    case "fail": return { ...state, stage: "failed", error: "Deletion did not fully complete. Some data may need a retry." };
    case "cancel": return initialDeletionState();
    default: return state;
  }
}

/** Whether it is safe to actually run deletion (all gates passed). */
export function mayRunDeletion(state: DeletionState): boolean {
  return state.stage === "running" && state.confirmedPhrase && state.frozen;
}
