/**
 * Capture → canonical record conversion (LIFEOS-035, Feature 5).
 *
 * A PURE planner: it describes the deterministic conversion targets and builds a
 * conversion PREVIEW (target type, copied fields, source-capture link, context,
 * what remains on the original). The store performs the actual creation by
 * reusing the existing canonical creators — this module never creates records
 * and never decides which conversion to do. No AI, no automatic conversion.
 */

import type { Capture, StoreState } from "@/types/mvp";
import { effectiveText } from "@/lib/inbox/capture-status";

export type ConversionTargetKey =
  | "belief" | "concept" | "decision" | "research" | "dialogue"
  | "reflection" | "principle" | "framework" | "practice"
  | "project_note" | "workspace_note";

export interface ConversionTarget {
  key: ConversionTargetKey;
  label: string;
  /** The entity kind the created record resolves to (for links/inspector). */
  entityKind: string;
  /** When set, the user must pick a target project/workspace first. */
  needsContext?: "project" | "workspace";
  description: string;
}

export const CONVERSION_TARGETS: ConversionTarget[] = [
  { key: "belief", label: "Belief", entityKind: "belief", description: "A first-person belief in your constitution." },
  { key: "concept", label: "Concept", entityKind: "concept", description: "A named concept in your world model." },
  { key: "decision", label: "Decision", entityKind: "decision", description: "A decision to explore." },
  { key: "research", label: "Research", entityKind: "research_project", description: "A research question to investigate." },
  { key: "dialogue", label: "Dialogue seed", entityKind: "dialogue", description: "A Socratic dialogue to open." },
  { key: "reflection", label: "Reflection", entityKind: "reflection", description: "A reflection prompt." },
  { key: "principle", label: "Principle", entityKind: "principle", description: "A guiding principle." },
  { key: "framework", label: "Framework", entityKind: "framework", description: "A mental framework." },
  { key: "practice", label: "Practice", entityKind: "practice", description: "A recurring practice." },
  { key: "project_note", label: "Project note", entityKind: "project", needsContext: "project", description: "Append as a note on a project." },
  { key: "workspace_note", label: "Workspace note", entityKind: "workspace", needsContext: "workspace", description: "Append as a note on a workspace." },
];

export function findTarget(key: ConversionTargetKey): ConversionTarget | undefined {
  return CONVERSION_TARGETS.find((t) => t.key === key);
}

/** A short title derived from a capture's (working) text — first line / snippet. */
export function titleFromText(text: string, n = 70): string {
  const firstLine = (text ?? "").split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  const base = firstLine || (text ?? "").trim();
  return base.length > n ? base.slice(0, n - 1).trimEnd() + "…" : base;
}

export interface ConversionField { label: string; value: string }
export interface ConversionPreview {
  targetKey: ConversionTargetKey;
  targetLabel: string;
  entityKind: string;
  needsContext?: "project" | "workspace";
  /** The fields that will be copied onto the new record. */
  copiedFields: ConversionField[];
  /** The source capture that will be linked from the new record. */
  sourceCaptureId: string;
  /** Workspace/project context that will be carried, if any. */
  context: { workspaceId?: string; projectId?: string; goalId?: string };
  /** Human description of what stays on the original capture. */
  remainsOnOriginal: string;
}

/**
 * Build a deterministic conversion preview. `contextId` names the target
 * project/workspace for note conversions. Never mutates.
 */
export function previewConversion(state: StoreState, capture: Capture, targetKey: ConversionTargetKey, contextId?: string): ConversionPreview | null {
  const target = findTarget(targetKey);
  if (!target) return null;
  const text = effectiveText(capture).trim();
  const title = titleFromText(text);
  const fields: ConversionField[] = [];

  switch (targetKey) {
    case "belief": fields.push({ label: "Statement", value: text }); break;
    case "concept": fields.push({ label: "Name", value: title }, { label: "Definition", value: text }); break;
    case "decision": fields.push({ label: "Title", value: title }, { label: "Question", value: text }); break;
    case "research": fields.push({ label: "Title", value: title }, { label: "Question", value: text }); break;
    case "dialogue": fields.push({ label: "Title", value: title }, { label: "Topic", value: text }); break;
    case "reflection": fields.push({ label: "Prompt", value: text }); break;
    case "principle": fields.push({ label: "Statement", value: text }); break;
    case "framework": fields.push({ label: "Name", value: title }, { label: "Description", value: text }); break;
    case "practice": fields.push({ label: "Practice", value: text }); break;
    case "project_note": case "workspace_note": fields.push({ label: "Note", value: text }); break;
  }

  const context: ConversionPreview["context"] = {};
  if (target.needsContext === "project" && contextId) context.projectId = contextId;
  if (target.needsContext === "workspace" && contextId) context.workspaceId = contextId;
  // Carry the capture's inherited context where it doesn't conflict.
  if (!context.projectId && capture.sourceContext?.projectId) context.projectId = capture.sourceContext.projectId;
  if (!context.workspaceId && capture.sourceContext?.workspaceId) context.workspaceId = capture.sourceContext.workspaceId;
  if (capture.sourceContext?.goalId) context.goalId = capture.sourceContext.goalId;

  return {
    targetKey, targetLabel: target.label, entityKind: target.entityKind, needsContext: target.needsContext,
    copiedFields: fields, sourceCaptureId: capture.id, context,
    remainsOnOriginal: "The original capture text is preserved and stays in your inbox unless you archive or mark it processed. The new record links back to this capture.",
  };
}
