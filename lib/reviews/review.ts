/**
 * Daily review model & derivations (LIFEOS-034, Features 1, 3, 9, 10).
 *
 * Pure helpers over `DailyReview` records: lookup by local date, status labels,
 * hrefs/refs for the entity API, counts, recency grouping for the history page,
 * and the deterministic "start tomorrow" action set. No AI, no scoring.
 */

import type { DailyReview, RecordRefLite, ReviewStatus, StoreState } from "@/types/mvp";
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
export const REVIEW_STEPS = [
  { key: "summary", label: "Today at a glance" },
  { key: "wins", label: "Wins" },
  { key: "lessons", label: "Lessons" },
  { key: "friction", label: "Friction" },
  { key: "openLoops", label: "Open loops" },
  { key: "tomorrow", label: "Tomorrow’s focus" },
  { key: "complete", label: "Confirm & complete" },
] as const;
export type ReviewStepKey = (typeof REVIEW_STEPS)[number]["key"];

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

export interface StartTomorrowAction { key: string; label: string; href?: string; ref?: RecordRefLite; kind: "resume_project" | "open_workspace" | "open_document" | "inspect" | "start_session" }

/**
 * Deterministic "start tomorrow" actions derived from a completed review's focus
 * list — each REUSES an existing system (project/workspace/document/inspector/
 * session). No new navigation or session logic is introduced here; the UI wires
 * these to the existing store actions.
 */
export function startTomorrowActions(review: DailyReview): StartTomorrowAction[] {
  const out: StartTomorrowAction[] = [];
  const ordered = [...review.tomorrowFocus].sort((a, b) => a.order - b.order);
  for (const f of ordered) {
    if (!f.ref) continue;
    switch (f.ref.kind) {
      case "project": out.push({ key: `resume:${f.ref.id}`, label: `Resume: ${f.text}`, href: `/project/${f.ref.id}`, ref: f.ref, kind: "resume_project" }); break;
      case "workspace": out.push({ key: `ws:${f.ref.id}`, label: `Open workspace: ${f.text}`, href: `/workspace/${f.ref.id}`, ref: f.ref, kind: "open_workspace" }); break;
      case "document": out.push({ key: `doc:${f.ref.id}`, label: `Open document: ${f.text}`, href: `/document/${f.ref.id}`, ref: f.ref, kind: "open_document" }); break;
      case "goal": out.push({ key: `goal:${f.ref.id}`, label: `Open goal: ${f.text}`, href: `/goal/${f.ref.id}`, ref: f.ref, kind: "inspect" }); break;
      default: out.push({ key: `inspect:${f.ref.kind}:${f.ref.id}`, label: `Inspect: ${f.text}`, ref: f.ref, kind: "inspect" }); break;
    }
  }
  return out;
}
