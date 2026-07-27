/**
 * Inspector store & navigation memory (LIFEOS-029, Features 6 & 9).
 *
 * A tiny module-level reactive store (like `mvpStore`) that holds which entity
 * the unified inspector is showing, the open tab, and which sections are
 * expanded — surfaced via `useSyncExternalStore`. Navigation memory (last-viewed
 * entity, tab, expanded sections, scroll) is persisted to `prefs` so the
 * workspace resumes across sessions. No new storage table; no AI.
 */

import { useSyncExternalStore } from "react";
import { readPrefs, writePrefs } from "@/lib/prefs";
import { trackInspect } from "@/lib/workspaces/tracking";

export type InspectorTab = "overview" | "relationships" | "backlinks" | "timeline" | "graph";
export const INSPECTOR_TABS: InspectorTab[] = ["overview", "relationships", "backlinks", "timeline", "graph"];

export interface InspectorTarget { kind: string; id: string }
export interface InspectorState {
  open: boolean;
  target: InspectorTarget | null;
  tab: InspectorTab;
  expanded: Record<string, boolean>;
}

let state: InspectorState = { open: false, target: null, tab: "overview", expanded: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(next: Partial<InspectorState>) { state = { ...state, ...next }; emit(); }

function persist() {
  writePrefs({ inspector: { last: state.target ?? undefined, tab: state.tab, expanded: state.expanded, scroll: readPrefs().inspector?.scroll } });
}

/** Open the inspector on an entity (records it as last-viewed). */
export function openInspector(kind: string, id: string): void {
  if (!kind || !id) return;
  const prev = readPrefs().inspector;
  // Restore the last tab/expanded only when re-opening the SAME entity.
  const same = prev?.last?.kind === kind && prev?.last?.id === id;
  set({ open: true, target: { kind, id }, tab: same && prev?.tab ? (prev.tab as InspectorTab) : "overview", expanded: same && prev?.expanded ? prev.expanded : state.expanded });
  persist();
  // First-run: record that the inspector has been used at least once (LIFEOS-032).
  if (!readPrefs().firstRun?.inspected) writePrefs({ firstRun: { ...readPrefs().firstRun, inspected: true } });
  // Record inspector usage into the active thinking session, if any (LIFEOS-030).
  trackInspect(kind, id);
}

export function closeInspector(): void { set({ open: false }); }

export function setInspectorTab(tab: InspectorTab): void { set({ tab }); persist(); }

export function toggleSection(key: string): void {
  set({ expanded: { ...state.expanded, [key]: !state.expanded[key] } });
  persist();
}
export function isSectionExpanded(key: string, fallback = true): boolean {
  return state.expanded[key] ?? fallback;
}

/** Persist the inspector scroll position (best-effort, throttled by caller). */
export function rememberScroll(scroll: number): void {
  const prev = readPrefs().inspector ?? {};
  writePrefs({ inspector: { ...prev, scroll } });
}
export function lastScroll(): number { return readPrefs().inspector?.scroll ?? 0; }

/** The last-viewed entity from a previous session, if any. */
export function lastViewedEntity(): InspectorTarget | undefined { return readPrefs().inspector?.last; }

// ---- React binding ----
function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
function snapshot(): InspectorState { return state; }
const SERVER: InspectorState = { open: false, target: null, tab: "overview", expanded: {} };
export function useInspector(): InspectorState {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}
