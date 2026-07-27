/**
 * Goal & project dashboards (LIFEOS-031, Features 4 & 5).
 *
 * One deterministic projection each: a Goal dashboard (overall progress,
 * projects, milestones, recent sessions/reading/captures/decisions, a graph
 * frontier, timeline) and a Project dashboard (overview, workspace, recent
 * sessions/entities/documents, milestones, reading, activity timeline, notes).
 * Pure over the store + the LIFEOS-029 entity API + the LIFEOS-030 session
 * helpers. No AI, no analytics.
 */

import type { Goal, Project, ReadingDocument, RecordRefLite, StoreState } from "@/types/mvp";
import { describeEntity, entityRef, type EntityContext, type Entity, type EntityRef } from "@/lib/entities/entity";
import { entityNeighbors } from "@/lib/entities/preview";
import { groupSessionsByRecency, totalDuration, type SessionGroups } from "@/lib/workspaces/sessions";
import { recentEntitiesFromActivity } from "@/lib/workspaces/activity";
import { findWorkspace, workspaceRef } from "@/lib/workspaces/workspace";
import { goalProgress, goalMilestoneCounts, goalProjectCounts, projectProgress, milestoneCounts, type MilestoneCounts } from "@/lib/execution/progress";
import { goalProjects } from "@/lib/execution/goals";
import { projectRelated } from "@/lib/execution/projects";
import { sortedMilestones } from "@/lib/execution/milestones";
import { goalSessions, projectSessions, contribution, type Contribution } from "@/lib/execution/tracking";

export interface ProjectProgressItem { ref: EntityRef; progress: number; status: string; milestones: MilestoneCounts }
export interface ReadingItem { ref: EntityRef; percent: number; status: string }

/** Resolve a mixed reference list to existing entities of one kind, newest-first. */
function collectKind(ctx: EntityContext, refs: RecordRefLite[], kind: string, limit: number): Entity[] {
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const r of refs) {
    if (r.kind !== kind) continue;
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = describeEntity(ctx, r.kind, r.id);
    if (e.ref.exists) out.push(e);
  }
  out.sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  return out.slice(0, limit);
}

/** Resolve a mixed reference list to existing entities of ANY kind, newest-first. */
function collectAny(ctx: EntityContext, refs: RecordRefLite[], limit: number): Entity[] {
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const r of refs) {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = describeEntity(ctx, r.kind, r.id);
    if (e.ref.exists) out.push(e);
  }
  out.sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  return out.slice(0, limit);
}

// ------------------------------------------------------------------ Goal ----

export interface GoalDashboard {
  goal: Goal;
  progress: number;
  overview: {
    projectCounts: { total: number; completed: number };
    milestones: MilestoneCounts;
    sessionCount: number;
    totalMs: number;
    contribution: Contribution;
  };
  projects: ProjectProgressItem[];
  nextMilestones: { ref: EntityRef; project: EntityRef; targetDate?: string }[];
  recentReading: ReadingItem[];
  recentCaptures: Entity[];
  recentDecisions: Entity[];
  knowledge: Entity[];
  neighbors: EntityRef[];
  sessions: SessionGroups;
}

export function goalDashboard(ctx: EntityContext, goal: Goal, nowMs = Date.now()): GoalDashboard {
  const state: StoreState = ctx.state;
  const projects = goalProjects(state, goal.id);
  const sessions = goalSessions(state, goal.id);

  // Aggregate reference pools from linked knowledge + the goal's projects.
  const knowledgeRefs = goal.linkedKnowledge;
  const relatedRefs: RecordRefLite[] = [
    ...goal.linkedKnowledge,
    ...projects.flatMap((p) => [...p.relatedEntities, ...p.relatedDocuments]),
  ];
  const sessionRefs = sessions.flatMap((s) => recentEntitiesFromActivity(s.activity, 20));

  const nextMilestones = projects.flatMap((p) => {
    const next = sortedMilestones(p).filter((m) => m.status === "open").slice(0, 2);
    return next.map((m) => ({ ref: { kind: "milestone", id: m.id, title: m.title, href: `/project/${p.id}`, exists: true } as EntityRef, project: entityRef(ctx, "project", p.id), targetDate: m.targetDate }));
  }).slice(0, 8);

  // Graph frontier: one-hop neighbors of the goal's linked knowledge.
  const memberKeys = new Set(knowledgeRefs.map((r) => `${r.kind}:${r.id}`));
  const seen = new Set<string>();
  const neighbors: EntityRef[] = [];
  for (const r of knowledgeRefs) {
    for (const n of entityNeighbors(ctx, r.kind, r.id, 6).neighbors) {
      const key = `${n.ref.kind}:${n.ref.id}`;
      if (memberKeys.has(key) || seen.has(key) || !n.ref.exists) continue;
      seen.add(key);
      neighbors.push(n.ref);
      if (neighbors.length >= 12) break;
    }
    if (neighbors.length >= 12) break;
  }

  return {
    goal,
    progress: goalProgress(goal, state.projects ?? []),
    overview: {
      projectCounts: goalProjectCounts(goal, state.projects ?? []),
      milestones: goalMilestoneCounts(goal, state.projects ?? []),
      sessionCount: sessions.length,
      totalMs: totalDuration(sessions, nowMs),
      contribution: contribution(sessions),
    },
    projects: projects.map((p) => ({ ref: entityRef(ctx, "project", p.id), progress: projectProgress(p), status: p.status, milestones: milestoneCounts(p) })),
    nextMilestones,
    recentReading: readingItems(ctx, [...relatedRefs, ...sessionRefs]),
    recentCaptures: collectKind(ctx, [...sessionRefs, ...relatedRefs], "capture", 6),
    recentDecisions: collectKind(ctx, [...relatedRefs, ...sessionRefs], "decision", 6),
    knowledge: collectAny(ctx, knowledgeRefs, 8),
    neighbors,
    sessions: groupSessionsByRecency(sessions, nowMs),
  };
}

// --------------------------------------------------------------- Project ----

export interface ProjectDashboard {
  project: Project;
  progress: number;
  milestones: MilestoneCounts;
  workspace?: EntityRef;
  goal?: EntityRef;
  overview: { status: string; startDate?: string; targetDate?: string; sessionCount: number; totalMs: number; contribution: Contribution };
  sessions: SessionGroups;
  recentEntities: EntityRef[];
  recentDocuments: Entity[];
  reading: ReadingItem[];
}

export function projectDashboard(ctx: EntityContext, project: Project, nowMs = Date.now()): ProjectDashboard {
  const state: StoreState = ctx.state;
  const sessions = projectSessions(state, project.id);
  const related = projectRelated(ctx, project);

  return {
    project,
    progress: projectProgress(project),
    milestones: milestoneCounts(project),
    workspace: project.workspaceId ? resolveWorkspace(ctx, project.workspaceId) : undefined,
    goal: project.goalId ? entityRef(ctx, "goal", project.goalId) : undefined,
    overview: {
      status: project.status,
      startDate: project.startDate,
      targetDate: project.targetDate,
      sessionCount: sessions.length,
      totalMs: totalDuration(sessions, nowMs),
      contribution: contribution(sessions),
    },
    sessions: groupSessionsByRecency(sessions, nowMs),
    recentEntities: related,
    recentDocuments: collectKind(ctx, project.relatedDocuments, "document", 8),
    reading: readingItems(ctx, project.relatedDocuments),
  };
}

// ---------------------------------------------------------------- helpers ----

function resolveWorkspace(ctx: EntityContext, workspaceId: string): EntityRef | undefined {
  const ws = findWorkspace(ctx.state, workspaceId);
  return ws ? workspaceRef(ws) : undefined;
}

function readingItems(ctx: EntityContext, refs: RecordRefLite[]): ReadingItem[] {
  const seen = new Set<string>();
  const out: ReadingItem[] = [];
  for (const r of refs) {
    if (r.kind !== "document" || seen.has(r.id)) continue;
    seen.add(r.id);
    const doc: ReadingDocument | undefined = ctx.state.documents.find((d) => d.id === r.id);
    if (!doc) continue;
    out.push({ ref: entityRef(ctx, "document", doc.id), percent: doc.progress.percent ?? 0, status: doc.progress.status });
  }
  return out.slice(0, 8);
}
