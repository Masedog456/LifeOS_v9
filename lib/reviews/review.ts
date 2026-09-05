/**
 * Daily review model & derivations (LIFEOS-034, Features 1, 3, 9, 10).
 *
 * Pure helpers over `DailyReview` records: lookup by local date, status labels,
 * hrefs/refs for the entity API, counts, recency grouping for the history page,
 * and the deterministic "start tomorrow" action set. No AI, no scoring.
 */

import type { DailyReview, ReviewStatus, StoreState } from "@/types/mvp";
import type { EntityRef } from "@/lib/entities/entity";
import { recencyBucket, formatDayKey, type DayKey } from "@/lib/reviews/dates";

export const REVIEW_KIND = "daily_review";

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  reopened: "Reopened",
};

/** The seven guided steps (non-forced; the user may skip / jump freely). */
/**
 * The wizard's seven steps, retired with it (LIFEOS-092 §23, §26).
 *
 * Kept as an empty list rather than deleted outright because the type is
 * exported and the emptiness is the claim: there is no stepped daily review any
 * more, and a future reader should not find seven step labels for a surface
 * that has no steps.
 */
export const REVIEW_STEPS = [] as const;
export type ReviewStepKey = string;

export function reviewHref(date: DayKey): string {
  return `/daily/${date}`;
}

export function reviewRef(review: DailyReview): EntityRef {
  return { kind: REVIEW_KIND, id: review.id, title: `Review · ${formatDayKey(review.date, { month: "short", day: "numeric" })}`, href: reviewHref(review.date), exists: true };
}

/** The canonical review for a local date, if any. */
export function findReviewByDate(state: StoreState, date: DayKey): DailyReview | undefined {
  return (state.dailyReviews ?? []).find((r) => r.date === date);
}

export function findReviewById(state: StoreState, id: string): DailyReview | undefined {
  return (state.dailyReviews ?? []).find((r) => r.id === id);
}

/** All reviews, most recent local date first. */
export function listReviews(state: StoreState): DailyReview[] {
  return [...(state.dailyReviews ?? [])].sort((a, b) => b.date.localeCompare(a.date));
}

/** The most recent COMPLETED review (for "tomorrow focus" surfacing). */
export function latestCompletedReview(state: StoreState): DailyReview | undefined {
  return listReviews(state).find((r) => r.status === "completed");
}

export interface ReviewCounts { wins: number; lessons: number; friction: number; openLoops: number; focus: number }
export function reviewCounts(r: DailyReview): ReviewCounts {
  return { wins: r.wins.length, lessons: r.lessons.length, friction: r.friction.length, openLoops: r.openLoops.length, focus: r.tomorrowFocus.length };
}

/** Is the review effectively empty (nothing captured yet)? */
export function isReviewEmpty(r: DailyReview): boolean {
  const c = reviewCounts(r);
  return !r.summary.trim() && !r.notes.trim() && c.wins + c.lessons + c.friction + c.openLoops + c.focus === 0;
}

export interface ReviewGroup { bucket: "Today" | "Yesterday" | "This Week" | "Earlier"; reviews: DailyReview[] }

/** Group reviews for the history page (Today / Yesterday / This Week / Earlier). */
export function groupReviewsByRecency(state: StoreState, today: DayKey): ReviewGroup[] {
  const order: ReviewGroup["bucket"][] = ["Today", "Yesterday", "This Week", "Earlier"];
  const buckets: Record<string, DailyReview[]> = { Today: [], Yesterday: [], "This Week": [], Earlier: [] };
  for (const r of listReviews(state)) buckets[recencyBucket(r.date, today)].push(r);
  return order.map((bucket) => ({ bucket, reviews: buckets[bucket] })).filter((g) => g.reviews.length > 0);
}

/*
 * `StartTomorrowAction` / `startTomorrowActions` were removed in LIFEOS-092
 * along with the wizard that produced the focus lists they read. Nothing else
 * ever called them, and LIFEOS-091's Tomorrow section answers the same question
 * from recorded evidence instead of from a hand-typed list.
 */
