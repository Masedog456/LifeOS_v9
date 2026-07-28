/**
 * Action templates (LIFEOS-036, Feature 11).
 *
 * Templates are reusable action shapes — NOT recurring actions. There is no
 * background recurrence generation: the user explicitly instantiates each
 * instance. `suggestedRecurrence` is a plain human description, never a schedule
 * the system acts on.
 */

import type { ActionTemplate, ActionEnergy, ActionSize } from "@/types/mvp";
import type { NewActionInput } from "@/lib/actions/action";

export interface NewTemplateInput {
  title: string;
  description?: string;
  context?: string;
  energy?: ActionEnergy;
  estimatedSize?: ActionSize;
  tags?: string[];
  defaultWorkspaceId?: string;
  defaultProjectId?: string;
  suggestedRecurrence?: string;
}

function templateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `at_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function makeTemplate(input: NewTemplateInput, at: string): ActionTemplate {
  return {
    id: templateId(),
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    context: input.context?.trim() || undefined,
    energy: input.energy ?? "unspecified",
    estimatedSize: input.estimatedSize ?? "unspecified",
    tags: input.tags ?? [],
    defaultWorkspaceId: input.defaultWorkspaceId,
    defaultProjectId: input.defaultProjectId,
    suggestedRecurrence: input.suggestedRecurrence?.trim() || undefined,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Build the action-creation input a template pre-fills. The user still confirms
 * every field before an action is created (Feature 11) — this only carries the
 * template's defaults forward; the recurrence hint is intentionally NOT copied.
 */
export function instantiateTemplate(t: ActionTemplate): NewActionInput {
  return {
    title: t.title,
    description: t.description,
    context: t.context,
    energy: t.energy,
    estimatedSize: t.estimatedSize,
    tags: [...t.tags],
    workspaceId: t.defaultWorkspaceId,
    projectId: t.defaultProjectId,
  };
}
