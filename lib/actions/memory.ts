/**
 * Action-queue navigation memory (LIFEOS-036, Feature 21).
 *
 * Persists ONLY appropriate UI preferences — selected view, sort, filters,
 * active action, scroll, split-pane width, and collapsed groups — in
 * `prefs.actions`, so the queue restores safely after reload. No record content
 * is stored here.
 */

import { readPrefs, writePrefs, type Prefs } from "@/lib/prefs";
import type { ActionView } from "@/lib/actions/status";
import type { ActionSort, ActionFilter } from "@/lib/actions/queue";

export interface ActionMemory {
  view: ActionView;
  sort: ActionSort;
  filter: ActionFilter;
  activeActionId?: string;
  scroll: number;
  paneWidth: number;
  collapsed: Record<string, boolean>;
}

const DEFAULTS: ActionMemory = { view: "next", sort: "manual", filter: {}, scroll: 0, paneWidth: 380, collapsed: {} };

export function readActionMemory(): ActionMemory {
  const m = readPrefs().actions;
  if (!m) return { ...DEFAULTS, filter: {}, collapsed: {} };
  return {
    view: (m.view as ActionView) ?? DEFAULTS.view,
    sort: (m.sort as ActionSort) ?? DEFAULTS.sort,
    filter: (m.filter as ActionFilter) ?? {},
    activeActionId: m.activeActionId,
    scroll: typeof m.scroll === "number" ? m.scroll : 0,
    paneWidth: typeof m.paneWidth === "number" ? m.paneWidth : DEFAULTS.paneWidth,
    collapsed: m.collapsed ?? {},
  };
}

export function writeActionMemory(patch: Partial<ActionMemory>): void {
  const current = readActionMemory();
  const next = { ...current, ...patch };
  writePrefs({ actions: {
    view: next.view, sort: next.sort, filter: next.filter as Record<string, unknown>,
    activeActionId: next.activeActionId, scroll: next.scroll, paneWidth: next.paneWidth, collapsed: next.collapsed,
  } as Prefs["actions"] });
}
