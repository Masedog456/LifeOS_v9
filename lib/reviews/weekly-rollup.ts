/**
 * Weekly rollup projection (LIFEOS-034, Feature 11).
 *
 * A deterministic weekly summary computed from completed daily reviews plus the
 * existing activity — a PROJECTION, never a persisted domain. No scoring, no
 * productivity rating, no automatic recommendations. Reuses `buildDaySummary`
 * per day and aggregates.
 */

import type { DailyReview, FrictionArea, StoreState } from "@/types/mvp";
import { buildDaySummary } from "@/lib/reviews/day-summary";
import { findReviewByDate } from "@/lib/reviews/review";
import { isoOnLocalDay, isoOnDayAtOffset, weekDays, formatDayKey, type DayKey } from "@/lib/reviews/dates";

export interface WeeklyRollup {
  weekStart: DayKey;
  days: DayKey[];
  completedReviews: DayKey[];
  missedReviewDays: DayKey[];
  sessionCount: number;
  totalSessionMs: number;
  timeByWorkspace: { workspaceId: string; name: string; ms: number }[];
  goalsTouched: string[];
  projectsTouched: string[];
  milestonesCompleted: number;
  readingActivity: number;
  captures: number;
  decisions: number;
  repeatedFriction: { area: FrictionArea; count: number }[];
  unresolvedOpenLoops: { id: string; text: string; date: DayKey }[];
}

export interface WeeklyRollupOptions { offsetMinutes?: number; today?: DayKey }

export function buildWeeklyRollup(state: StoreState, weekStart: DayKey, opts: WeeklyRollupOptions = {}): WeeklyRollup {
  const days = weekDays(weekStart);
  const today = opts.today;
  const onDay = (iso: string | undefined, key: DayKey) =>
    opts.offsetMinutes === undefined ? isoOnLocalDay(iso, key) : isoOnDayAtOffset(iso, key, opts.offsetMinutes);

  const completedReviews: DayKey[] = [];
  const missedReviewDays: DayKey[] = [];
  const goalsTouched = new Set<string>();
  const projectsTouched = new Set<string>();
  let sessionCount = 0, totalSessionMs = 0, milestonesCompleted = 0, readingActivity = 0, captures = 0, decisions = 0;

  for (const key of days) {
    const review = findReviewByDate(state, key);
    if (review?.status === "completed") completedReviews.push(key);
    else if (!today || key <= today) missedReviewDays.push(key); // only past/today days count as "missed"

    const s = buildDaySummary(state, key, { offsetMinutes: opts.offsetMinutes });
    sessionCount += s.sessionCount;
    totalSessionMs += s.totalSessionMs;
    for (const g of s.groups) {
      if (g.key === "goals_touched") g.items.forEach((it) => goalsTouched.add(it.id));
      if (g.key === "projects_advanced") g.items.forEach((it) => projectsTouched.add(it.id));
      if (g.key === "milestones_completed") milestonesCompleted += g.count;
      if (g.key === "highlights_created" || g.key === "annotations_created" || g.key === "documents_read") readingActivity += g.count;
      if (g.key === "captures_created") captures += g.count;
      if (g.key === "decisions") decisions += g.count;
    }
  }

  // Time by workspace (sessions started within the week window).
  const wsTime = new Map<string, number>();
  for (const s of state.sessions ?? []) {
    if (!days.some((k) => onDay(s.startedAt, k))) continue;
    const start = Date.parse(s.startedAt);
    const end = s.endedAt ? Date.parse(s.endedAt) : Date.now();
    if (Number.isNaN(start) || end <= start || !s.workspaceId) continue;
    wsTime.set(s.workspaceId, (wsTime.get(s.workspaceId) ?? 0) + (end - start));
  }
  const timeByWorkspace = [...wsTime.entries()]
    .map(([workspaceId, ms]) => ({ workspaceId, name: (state.workspaces ?? []).find((w) => w.id === workspaceId)?.name ?? "Workspace", ms }))
    .sort((a, b) => b.ms - a.ms);

  // Repeated friction areas + unresolved open loops, aggregated across the week's reviews.
  const frictionByArea = new Map<FrictionArea, number>();
  const unresolvedOpenLoops: { id: string; text: string; date: DayKey }[] = [];
  const weekReviews: DailyReview[] = days.map((k) => findReviewByDate(state, k)).filter((r): r is DailyReview => !!r);
  for (const r of weekReviews) {
    for (const f of r.friction) if (!f.resolved) frictionByArea.set(f.area, (frictionByArea.get(f.area) ?? 0) + 1);
    for (const l of r.openLoops) unresolvedOpenLoops.push({ id: l.id, text: l.text, date: r.date });
  }
  const repeatedFriction = [...frictionByArea.entries()]
    .map(([area, count]) => ({ area, count }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count);

  return {
    weekStart, days, completedReviews, missedReviewDays,
    sessionCount, totalSessionMs, timeByWorkspace,
    goalsTouched: [...goalsTouched], projectsTouched: [...projectsTouched],
    milestonesCompleted, readingActivity, captures, decisions,
    repeatedFriction, unresolvedOpenLoops,
  };
}

/** A short human label for the rollup's week (e.g. "Jul 21 – Jul 27"). */
export function weekLabel(rollup: WeeklyRollup): string {
  return `${formatDayKey(rollup.days[0], { month: "short", day: "numeric" })} – ${formatDayKey(rollup.days[6], { month: "short", day: "numeric" })}`;
}
