/**
 * Confirmation model (LIFEOS-041, Feature 26).
 *
 * Four proportional levels of confirmation, reusing the deletion-semantics
 * registry from LIFEOS-040 so the copy matches the actual behavior. Ordinary
 * reversible actions get an Undo (no dialog); consequential ones get a light
 * dialog; destructive ones a clear dialog with the destructive action NOT
 * pre-focused; permanent account-level ones require typed confirmation.
 */

import { deletionSemantic, type DeletionBehavior } from "@/lib/privacy/deletion";

export type ConfirmLevel = 1 | 2 | 3 | 4;

export interface ConfirmSpec {
  level: ConfirmLevel;
  /** Whether a modal dialog is shown (level ≥ 2). */
  dialog: boolean;
  /** Whether an Undo affordance is offered instead of/after (level 1–2, reversible). */
  undo: boolean;
  /** Whether a typed phrase is required (level 4). */
  requiresTypedPhrase: boolean;
  /** Whether the destructive button may be the pre-focused default (never for ≥3). */
  destructivePreFocus: boolean;
  confirmLabel: string;
  title: string;
  body: string;
}

/** Map a deletion behavior to a confirmation level. */
export function levelForBehavior(behavior: DeletionBehavior): ConfirmLevel {
  switch (behavior) {
    case "reversible-discard": return 2;
    case "archive": return 2;
    case "soft-delete": return 3;
    case "tombstone": return 3;
    case "permanent": return 4;
    default: return 3;
  }
}

/** Build the confirmation spec for an entity's delete/discard/archive action. */
export function confirmForEntity(entityKey: string): ConfirmSpec {
  const sem = deletionSemantic(entityKey);
  const behavior = sem?.behavior ?? "permanent";
  const level = levelForBehavior(behavior);
  return {
    level,
    dialog: level >= 2,
    undo: level <= 2 && (sem?.reversible ?? false),
    requiresTypedPhrase: level === 4,
    destructivePreFocus: level < 3,
    confirmLabel: sem?.actionLabel ?? "Confirm",
    title: `${sem?.actionLabel ?? "Confirm"}?`,
    body: sem?.explanation ?? "This action changes your data.",
  };
}

/** A generic (non-entity) confirmation by explicit level. */
export function confirmForLevel(level: ConfirmLevel, opts: { title: string; body: string; confirmLabel: string; reversible?: boolean }): ConfirmSpec {
  return {
    level,
    dialog: level >= 2,
    undo: level <= 2 && !!opts.reversible,
    requiresTypedPhrase: level === 4,
    destructivePreFocus: level < 3,
    confirmLabel: opts.confirmLabel,
    title: opts.title,
    body: opts.body,
  };
}

/** Enter/Escape behavior for a confirmation dialog, by level. */
export function dialogKeys(level: ConfirmLevel): { enterConfirms: boolean; escapeCancels: boolean } {
  // For destructive/permanent levels Enter must NOT confirm (avoid accidental
  // destruction); Escape always cancels.
  return { enterConfirms: level < 3, escapeCancels: true };
}
