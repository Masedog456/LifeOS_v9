/**
 * Merge captures (LIFEOS-035, Feature 7).
 *
 * An EXPLICIT user operation: manually select captures, choose their order and a
 * separator, and preview the resulting capture. Originals are preserved by
 * default (optional archive-originals). No automatic deduplication, and this is
 * NEVER used by sync conflict handling — the sync layer must never silently
 * concatenate captures. Pure planner; the store performs the creation.
 */

import type { Capture } from "@/types/mvp";
import { effectiveText } from "@/lib/inbox/capture-status";

export const MERGE_SEPARATORS: { key: string; label: string; value: string }[] = [
  { key: "blank", label: "Blank line", value: "\n\n" },
  { key: "newline", label: "New line", value: "\n" },
  { key: "space", label: "Space", value: " " },
  { key: "bullet", label: "Bullet list", value: "\n• " },
  { key: "rule", label: "Divider", value: "\n\n---\n\n" },
];

export interface MergePlan {
  valid: boolean;
  text: string;
  orderedIds: string[];
  errors: string[];
}

/**
 * Build the merged text from captures in the given id order with a separator.
 * Missing/unknown ids are dropped (and reported). Deterministic.
 */
export function planMerge(captures: Capture[], orderedIds: string[], separator = "\n\n"): MergePlan {
  const byId = new Map(captures.map((c) => [c.id, c]));
  const errors: string[] = [];
  const present = orderedIds.filter((id) => byId.has(id));
  if (present.length < 2) errors.push("A merge needs at least two captures.");
  const parts = present.map((id) => effectiveText(byId.get(id)!).trim()).filter(Boolean);
  const bulletLead = separator.startsWith("\n• ") ? "• " : "";
  const text = bulletLead + parts.join(separator);
  return { valid: errors.length === 0 && parts.length >= 2, text, orderedIds: present, errors };
}
