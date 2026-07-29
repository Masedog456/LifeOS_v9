/**
 * Planning preferences (LIFEOS-037, Feature 20).
 *
 * Persists ONLY appropriate UI preferences in `prefs.planning` — default board
 * filters, collapsed groups, column widths, mobile view, per-focus-kind visible
 * panels, capacity soft limits, selected view, and sort mode. No ephemeral
 * dialog/hover state.
 */

import { readPrefs, writePrefs, type Prefs } from "@/lib/prefs";
import type { BoardFilter } from "@/lib/planning/board";
import type { CapacityCategory } from "@/lib/planning/capacity";
import type { FocusTargetKind } from "@/types/mvp";

export interface PlanningMemory {
  view: string;
  sort: string;
  filter: BoardFilter;
  collapsed: Record<string, boolean>;
  columnWidths: Record<string, number>;
  mobileView: boolean;
  focusPanels: Record<string, Record<string, boolean>>;
  capacityLimits: Partial<Record<CapacityCategory, number>>;
}

const DEFAULTS: PlanningMemory = { view: "board", sort: "manual", filter: {}, collapsed: {}, columnWidths: {}, mobileView: false, focusPanels: {}, capacityLimits: {} };

export function readPlanningMemory(): PlanningMemory {
  const m = readPrefs().planning;
  if (!m) return { ...DEFAULTS, filter: {}, collapsed: {}, columnWidths: {}, focusPanels: {}, capacityLimits: {} };
  return {
    view: m.view ?? DEFAULTS.view,
    sort: m.sort ?? DEFAULTS.sort,
    filter: (m.filter as BoardFilter) ?? {},
    collapsed: m.collapsed ?? {},
    columnWidths: m.columnWidths ?? {},
    mobileView: !!m.mobileView,
    focusPanels: m.focusPanels ?? {},
    capacityLimits: (m.capacityLimits as Partial<Record<CapacityCategory, number>>) ?? {},
  };
}

export function writePlanningMemory(patch: Partial<PlanningMemory>): void {
  const cur = readPlanningMemory();
  const next = { ...cur, ...patch };
  writePrefs({ planning: {
    view: next.view, sort: next.sort, filter: next.filter as Record<string, unknown>,
    collapsed: next.collapsed, columnWidths: next.columnWidths, mobileView: next.mobileView,
    focusPanels: next.focusPanels, capacityLimits: next.capacityLimits as Record<string, number>,
  } as Prefs["planning"] });
}

/** The remembered visible panels for a focus target kind, if any. */
export function rememberedPanels(kind: FocusTargetKind): Record<string, boolean> | undefined {
  return readPlanningMemory().focusPanels[kind];
}

/** Persist a focus session's panel visibility for its target kind. */
export function rememberPanels(kind: FocusTargetKind, panels: Record<string, boolean>): void {
  const mem = readPlanningMemory();
  writePlanningMemory({ focusPanels: { ...mem.focusPanels, [kind]: panels } });
}
