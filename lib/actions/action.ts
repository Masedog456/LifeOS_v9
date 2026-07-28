/**
 * Next action core (LIFEOS-036, Features 1 & 2).
 *
 * The canonical action factory and context-inheritance helpers. Every field is
 * user-provided or user-confirmed — this module pre-fills known context (from a
 * milestone, capture, session, …) but never invents titles, estimates, energy,
 * or priority. There is one creator; every entry point routes through it.
 */

import type {
  NextAction, ActionSize, ActionEnergy, RecordRefLite, StoreState,
} from "@/types/mvp";
import { makeEvent } from "@/lib/actions/history";

/** The user-supplied shape for creating an action. Only `title` is required. */
export interface NewActionInput {
  title: string;
  description?: string;
  notes?: string;
  workspaceId?: string;
  goalId?: string;
  projectId?: string;
  milestoneId?: string;
  sourceCaptureId?: string;
  sourceReviewId?: string;
  linkedEntityRefs?: RecordRefLite[];
  tags?: string[];
  estimatedSize?: ActionSize;
  energy?: ActionEnergy;
  context?: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `na_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Build a new open action from user input. `order` places it after all existing
 * actions unless the caller supplies one. History starts with a `created` event.
 * Nothing is auto-classified.
 */
export function makeAction(input: NewActionInput, opts: { order: number; at: string } ): NextAction {
  const at = opts.at;
  const a: NextAction = {
    id: newId(),
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    status: "open",
    createdAt: at,
    updatedAt: at,
    notes: (input.notes ?? "").trim(),
    workspaceId: input.workspaceId,
    goalId: input.goalId,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    sourceCaptureId: input.sourceCaptureId,
    sourceReviewId: input.sourceReviewId,
    linkedEntityRefs: input.linkedEntityRefs ?? [],
    tags: input.tags ?? [],
    estimatedSize: input.estimatedSize ?? "unspecified",
    energy: input.energy ?? "unspecified",
    context: input.context?.trim() || undefined,
    order: opts.order,
    history: [makeEvent({ action: "created", at })],
  };
  return a;
}

/**
 * Pre-fill context from a milestone: milestone → project → goal → workspace.
 * Read-only; the user confirms every field in the creator. Resolves the parent
 * project (and its goal/workspace) from the store.
 */
export function inheritFromMilestone(state: StoreState, projectId: string, milestoneId: string): Partial<NewActionInput> {
  const project = (state.projects ?? []).find((p) => p.id === projectId);
  if (!project) return { milestoneId };
  return {
    milestoneId,
    projectId: project.id,
    goalId: project.goalId,
    workspaceId: project.workspaceId,
  };
}

/** Pre-fill context from a project (→ goal, workspace). */
export function inheritFromProject(state: StoreState, projectId: string): Partial<NewActionInput> {
  const project = (state.projects ?? []).find((p) => p.id === projectId);
  if (!project) return {};
  return { projectId: project.id, goalId: project.goalId, workspaceId: project.workspaceId };
}

/**
 * Pre-fill from a processed capture (Feature 15): source id, inherited context,
 * links, and the capture's working/original text as an editable title
 * suggestion. The capture is never mutated here.
 */
export function inheritFromCapture(state: StoreState, captureId: string): Partial<NewActionInput> {
  const capture = (state.captures ?? []).find((c) => c.id === captureId);
  if (!capture) return { sourceCaptureId: captureId };
  const text = (capture.workingText ?? capture.text ?? "").trim();
  const firstLine = text.split(/\n/)[0]?.slice(0, 120) ?? "";
  const links: RecordRefLite[] = [
    ...(capture.linkedWorkspaceIds ?? []).map((id) => ({ kind: "workspace", id })),
    ...(capture.linkedGoalIds ?? []).map((id) => ({ kind: "goal", id })),
    ...(capture.linkedProjectIds ?? []).map((id) => ({ kind: "project", id })),
    ...(capture.linkedEntityRefs ?? []),
  ];
  return {
    sourceCaptureId: captureId,
    title: firstLine,
    description: text !== firstLine ? text : "",
    workspaceId: capture.sourceContext?.workspaceId ?? capture.linkedWorkspaceIds?.[0],
    goalId: capture.linkedGoalIds?.[0],
    projectId: capture.linkedProjectIds?.[0],
    linkedEntityRefs: links,
    tags: capture.tags ?? [],
  };
}

/** Pre-fill from the active session's workspace/goal/project context. */
export function inheritFromSession(state: StoreState, sessionId: string): Partial<NewActionInput> {
  const session = (state.sessions ?? []).find((s) => s.id === sessionId);
  if (!session) return {};
  return { workspaceId: session.workspaceId };
}

/** The effective title to show in a list (trimmed, never empty-rendered). */
export function actionTitle(a: NextAction): string {
  return a.title.trim() || "(untitled action)";
}
