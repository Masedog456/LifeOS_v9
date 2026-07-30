/**
 * Period comparison (LIFEOS-039, Feature 14).
 *
 * Compares two explicit periods with RAW value each, absolute difference, and
 * percentage difference ONLY when mathematically valid (previous value non-zero).
 * Language is strictly neutral — "12 sessions, previously 9." — and NEVER
 * improved / declined / better / worse / ahead / behind. Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { homeMetrics, type Metric } from "@/lib/insights/metrics";

export interface MetricComparison {
  key: string;
  label: string;
  unit: Metric["unit"];
  current: number;
  previous: number;
  /** current - previous (may be negative). */
  absDiff: number;
  /** Rounded percentage difference, or undefined when previous is 0 (undefined denominator). */
  pctDiff?: number;
}

export function comparePeriods(state: StoreState, index: ActivityEvent[], current: ResolvedRange, previous: ResolvedRange): MetricComparison[] {
  const a = homeMetrics(state, index, current);
  const b = homeMetrics(state, index, previous);
  const bByKey = new Map(b.map((m) => [m.key, m] as const));
  return a.map((m) => {
    const prev = bByKey.get(m.key)?.value ?? 0;
    const absDiff = m.value - prev;
    const pctDiff = prev === 0 ? undefined : Math.round((absDiff / prev) * 100);
    return { key: m.key, label: m.label, unit: m.unit, current: m.value, previous: prev, absDiff, pctDiff };
  });
}

/**
 * Neutral phrasing for a comparison. Never uses judgemental words. Examples:
 * "12, previously 9." / "3 fewer than before." / "same as before."
 */
export function comparisonPhrase(c: MetricComparison): string {
  if (c.absDiff === 0) return `${c.current}, same as before.`;
  const moreOrFewer = c.absDiff > 0 ? "more than" : "fewer than";
  return `${c.current}, ${Math.abs(c.absDiff)} ${moreOrFewer} before (was ${c.previous}).`;
}
