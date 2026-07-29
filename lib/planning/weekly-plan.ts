/**
 * Weekly planning view (LIFEOS-037, Feature 4).
 *
 * A deterministic projection — NOT a seven-day calendar grid. Nothing is
 * assigned to clock times or weekdays. It surfaces: items the user assigned to
 * This Week, unfinished Today items, currently-active milestones, projects
 * touched this week, waiting follow-ups, deferred returns, selected open loops,
 * and completed actions for context. Pure over `StoreState`.
 */

import type { StoreState, NextAction, PlanningAssignment } from "@/types/mvp";
import { todayKey, weekStartKey, weekDays, isoOnLocalDay, type DayKey } from "@/lib/reviews/dates";
import { assignmentsIn } from "@/lib/planning/horizon";
import { dueFollowUps } from "@/lib/actions/waiting";
import { returningToday } from "@/lib/actions/defer";

export interface WeeklyPlanView {
  weekStart: DayKey;
  thisWeek: PlanningAssignment[];
  unfinishedToday: PlanningAssignment[];
  activeMilestones: { projectId: string; milestoneId: string; title: string }[];
  projectsTouched: { id: string; title: string }[];
  waitingFollowUps: NextAction[];
  deferredReturns: NextAction[];
  completedThisWeek: NextAction[];
}

export function weeklyPlan(state: StoreState, today: DayKey = todayKey()): WeeklyPlanView {
  const weekStart = weekStartKey(today);
  const days = new Set(weekDays(weekStart));
  const inWeek = (iso?: string) => !!iso && [...days].some((d) => isoOnLocalDay(iso, d));

  const assignments = state.planningAssignments ?? [];
  const actions = state.nextActions ?? [];

  const activeMilestones: WeeklyPlanView["activeMilestones"] = [];
  const projectsTouched: WeeklyPlanView["projectsTouched"] = [];
  for (const p of state.projects ?? []) {
    if (p.status === "active") {
      for (const m of p.milestones ?? []) if (m.status !== "done") activeMilestones.push({ projectId: p.id, milestoneId: m.id, title: m.title });
    }
    // "Touched this week": updated this week, or a milestone completed this week.
    if (inWeek(p.updatedAt) || (p.milestones ?? []).some((m) => inWeek(m.completedDate))) projectsTouched.push({ id: p.id, title: p.title });
  }

  return {
    weekStart,
    thisWeek: assignmentsIn(assignments, "this_week"),
    unfinishedToday: assignmentsIn(assignments, "today"),
    activeMilestones,
    projectsTouched,
    waitingFollowUps: dueFollowUps(actions, today),
    deferredReturns: returningToday(actions, today),
    completedThisWeek: actions.filter((a) => a.completedAt && inWeek(a.completedAt)),
  };
}
