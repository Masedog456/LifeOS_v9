/**
 * First-run checklist projection (LIFEOS-032, Feature 14).
 *
 * A lightweight, dismissible checklist that guides the user through the real
 * application actions — no forced tour, no fake sample data. Each step's "done"
 * is DERIVED from actual state (you created a capture, a workspace, a session, a
 * goal, a project, imported a document) or from two prefs flags for actions that
 * leave no domain trace (opened the command center, inspected a relationship).
 * Pure — the component reads it and renders links to the real pages.
 */

import type { StoreState } from "@/types/mvp";
import type { Prefs } from "@/lib/prefs";

export interface FirstRunStep {
  id: string;
  label: string;
  href: string;
  done: boolean;
  hint: string;
}

export function firstRunSteps(state: StoreState, prefs: Prefs): FirstRunStep[] {
  const fr = prefs.firstRun ?? {};
  return [
    { id: "capture", label: "Create a capture", href: "/", done: (state.captures?.length ?? 0) > 0, hint: "Jot a raw thought — everything starts here." },
    { id: "workspace", label: "Create or open a workspace", href: "/workspaces?new=1", done: (state.workspaces?.length ?? 0) > 0, hint: "Group work around a project or life area." },
    { id: "session", label: "Start a thinking session", href: "/workspaces", done: (state.sessions?.length ?? 0) > 0, hint: "Focus your work and let it be tracked." },
    { id: "goal", label: "Create a goal", href: "/goals?new=1", done: (state.goals?.length ?? 0) > 0, hint: "Name what you're trying to accomplish." },
    { id: "project", label: "Create a project", href: "/projects?new=1", done: (state.projects?.length ?? 0) > 0, hint: "Turn a goal into concrete work." },
    { id: "document", label: "Import a short document", href: "/reading?new=1", done: (state.documents?.length ?? 0) > 0, hint: "Paste text — it becomes a readable, citable document." },
    { id: "inspect", label: "Inspect a relationship", href: "/world", done: Boolean(fr.inspected), hint: "Click any entity to open the inspector and follow its links." },
    { id: "command", label: "Open the command center", href: "/today", done: Boolean(fr.commandOpened), hint: "Press ⌘K / Ctrl K to navigate, create, or search anything." },
  ];
}

export function firstRunProgress(steps: FirstRunStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}

/** Whether to show the first-run checklist at all (not dismissed, not complete). */
export function shouldShowFirstRun(state: StoreState, prefs: Prefs): boolean {
  if (prefs.firstRun?.dismissed) return false;
  return !firstRunProgress(firstRunSteps(state, prefs)).complete;
}
