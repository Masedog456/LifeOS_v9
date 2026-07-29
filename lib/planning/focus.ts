/**
 * Focus mode (LIFEOS-037, Features 5–7).
 *
 * A focused working mode centered on one selected target. Deterministic
 * factory + panel defaults; the store owns lifecycle (start/end, session
 * attach, interruptions). Only one focus session is active at a time. No
 * automatic fullscreen, no scoring.
 */

import type { FocusSession, FocusTargetKind, RecordRefLite, StoreState } from "@/types/mvp";

/** The optional panels a focus session can show (Feature 7). */
export const FOCUS_PANELS = [
  "current_action", "project_context", "milestone", "notes", "document", "captures", "timer", "session_activity", "related_knowledge",
] as const;
export type FocusPanel = (typeof FOCUS_PANELS)[number];

export const PANEL_LABEL: Record<FocusPanel, string> = {
  current_action: "Current action",
  project_context: "Project context",
  milestone: "Milestone",
  notes: "Notes",
  document: "Document",
  captures: "Captures",
  timer: "Timer",
  session_activity: "Session activity",
  related_knowledge: "Related knowledge",
};

/** Sensible default panel visibility per target kind (remembered per kind in prefs). */
export function defaultPanels(kind: FocusTargetKind): Record<string, boolean> {
  const on = (...p: FocusPanel[]) => Object.fromEntries(FOCUS_PANELS.map((x) => [x, p.includes(x)]));
  switch (kind) {
    case "action": return on("current_action", "project_context", "notes", "timer", "session_activity");
    case "milestone": return on("milestone", "project_context", "current_action", "timer");
    case "project": return on("project_context", "current_action", "milestone", "notes", "timer");
    case "document": return on("document", "notes", "captures", "timer");
    case "workspace": return on("session_activity", "notes", "current_action", "timer");
    case "entity": return on("related_knowledge", "notes", "captures", "timer");
    case "custom": return on("notes", "timer", "session_activity");
    default: return on("notes", "timer");
  }
}

function focusId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `fs_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export interface NewFocusInput {
  targetKind: FocusTargetKind;
  ref: RecordRefLite;
  title: string;
  sessionId?: string;
  panels?: Record<string, boolean>;
}

/** Build a new active focus session. */
export function makeFocusSession(input: NewFocusInput, at: string): FocusSession {
  return {
    id: focusId(),
    targetKind: input.targetKind,
    ref: input.ref,
    title: input.title.trim() || "Focus",
    sessionId: input.sessionId,
    startedAt: at,
    panels: input.panels ?? defaultPanels(input.targetKind),
    interruptions: [],
    history: [],
  };
}

/** The currently-active focus session (no `endedAt`), if any. */
export function activeFocus(state: StoreState): FocusSession | undefined {
  return (state.focusSessions ?? []).find((f) => !f.endedAt);
}

/** Elapsed milliseconds for a focus session (open sessions measure to `now`). */
export function focusElapsedMs(f: FocusSession, now: number = Date.now()): number {
  const start = new Date(f.startedAt).getTime();
  const end = f.endedAt ? new Date(f.endedAt).getTime() : now;
  return Math.max(0, end - start);
}
