/**
 * Review activity (LIFEOS-039, Feature 10).
 *
 * Daily-review history over the range — completed reviews, open loops surfaced,
 * tomorrow-focus selections, friction entries, maintenance decisions,
 * interruptions logged, items carried forward. A missing date is the ABSENCE of
 * a record, nothing more. NEVER a streak, never shame, never failure language.
 * Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import { inRange, type ResolvedRange } from "@/lib/insights/range";

export interface ReviewActivity {
  completedReviews: { id: string; date: string }[];
  /** Days in the range with a review record (for a plain calendar, not a streak). */
  reviewedDays: string[];
  openLoops: number;
  tomorrowFocus: number;
  friction: number;
  maintenanceDecisions: number;
  interruptions: number;
  carriedForward: number;
}

export function reviewActivity(state: StoreState, index: ActivityEvent[], range: ResolvedRange): ReviewActivity {
  const reviews = (state.dailyReviews ?? []).filter((r) => inRange(r.createdAt || `${r.date}T12:00:00.000Z`, range));
  const ev = eventsInRange(index, range);

  let openLoops = 0, tomorrowFocus = 0, friction = 0, carriedForward = 0;
  for (const r of reviews) {
    openLoops += (r.openLoops ?? []).length;
    tomorrowFocus += (r.tomorrowFocus ?? []).length;
    friction += (r.friction ?? []).length;
    // "Carried forward" = tomorrow-focus items the user explicitly marked carried.
    carriedForward += (r.tomorrowFocus ?? []).filter((f) => (f as { carried?: boolean }).carried).length;
  }

  return {
    completedReviews: reviews.map((r) => ({ id: r.id, date: r.date })).sort((a, b) => b.date.localeCompare(a.date)),
    reviewedDays: [...new Set(reviews.map((r) => r.date))].sort(),
    openLoops,
    tomorrowFocus,
    friction,
    maintenanceDecisions: ev.filter((e) => e.type.startsWith("maintenance_")).length,
    interruptions: ev.filter((e) => e.type === "interruption_logged").length,
    carriedForward,
  };
}
