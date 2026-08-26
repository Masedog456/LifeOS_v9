"use client";

/**
 * `/today/review` — the derived day closure (LIFEOS-073 §5, §17).
 *
 * Reached from Today's orientation card. Creates nothing by being visited: no
 * `DailyReview` is auto-started, nothing is pre-filled, and absence of a review
 * is never called incomplete. The journaling wizard lives on at `/daily`.
 */

import ReviewToday from "@/components/today/ReviewToday";

export default function ReviewTodayPage() {
  return <ReviewToday />;
}
