/**
 * Insights preference memory (LIFEOS-039, Feature 27).
 *
 * Persists the last selected range, grouping, dormancy threshold, and
 * definitions-drawer state in `prefs.insights` (LIFEOS-025), mirrored to
 * `user_prefs` across devices. UI memory only — saved views are durable records.
 */

import { useSyncExternalStore } from "react";
import { readPrefs, writePrefs, type Prefs } from "@/lib/prefs";
import type { RangeKind } from "@/lib/insights/range";

export type InsightsPrefs = NonNullable<Prefs["insights"]>;
export interface RangeSelection { kind: RangeKind; customStart?: string; customEnd?: string }

export function readInsightsPrefs(): InsightsPrefs {
  return readPrefs().insights ?? {};
}

export function writeInsightsPrefs(patch: Partial<InsightsPrefs>): void {
  writePrefs({ insights: { ...readInsightsPrefs(), ...patch } });
}

/** The remembered range selection (defaults to last_7_days). */
export function rememberedRange(): RangeSelection {
  const p = readInsightsPrefs();
  return { kind: (p.rangeKind as RangeKind) || "last_7_days", customStart: p.customStart, customEnd: p.customEnd };
}

export function rememberRange(kind: RangeKind, customStart?: string, customEnd?: string): void {
  writeInsightsPrefs({ rangeKind: kind, customStart, customEnd });
  rangeSel = { kind, customStart, customEnd };
  rangeListeners.forEach((l) => l());
}

// ---- Reactive range selection (hydration-safe external store) ----
// SSR + the first client render use SERVER_RANGE so markup matches; after
// hydration useSyncExternalStore adopts the persisted selection without a
// setState-in-effect. rememberRange() notifies subscribers on every change.
const SERVER_RANGE: RangeSelection = { kind: "last_7_days" };
let rangeSel: RangeSelection | null = null;
const rangeListeners = new Set<() => void>();

function subscribeRange(l: () => void): () => void {
  rangeListeners.add(l);
  return () => rangeListeners.delete(l);
}
function rangeSnapshot(): RangeSelection {
  // Cache so getSnapshot returns a referentially-stable value between changes.
  if (rangeSel === null) rangeSel = rememberedRange();
  return rangeSel;
}

/** Subscribe a component to the persisted range selection (defaults on the server). */
export function useRememberedRange(): RangeSelection {
  return useSyncExternalStore(subscribeRange, rangeSnapshot, () => SERVER_RANGE);
}

/** Remembered dormancy inactivity threshold in days (default 90). */
export function rememberedDormancyDays(): number {
  const d = readInsightsPrefs().dormancyDays;
  return typeof d === "number" && d > 0 ? d : 90;
}

export function rememberDormancyDays(days: number): void {
  writeInsightsPrefs({ dormancyDays: days });
}
