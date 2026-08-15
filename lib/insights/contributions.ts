/**
 * Contribution map (LIFEOS-039, Feature 16).
 *
 * A BOUNDED relationship view of how activity flowed through the hierarchy in
 * the selected range — session→action, action→milestone, milestone→project,
 * project→goal, capture→action, document→citation, citation→belief,
 * focus→target. It reports edge COUNTS (and a bounded sample of edges); it never
 * renders the entire graph and never infers causation. Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { inRange } from "@/lib/insights/range";

export interface ContributionEdge {
  from: string; // e.g. "action"
  to: string;   // e.g. "milestone"
  label: string;
  count: number;
}

export function contributionMap(state: StoreState, index: ActivityEvent[], range: ResolvedRange): ContributionEdge[] {
  const ev = eventsInRange(index, range);
  const touchedActions = new Set(ev.filter((e) => e.recordKind === "action").map((e) => e.recordId));
  const touchedProjects = new Set(ev.map((e) => e.projectId).filter(Boolean) as string[]);

  const actions = (state.nextActions ?? []).filter((a) => touchedActions.has(a.id));
  const projects = state.projects ?? [];
  const milestoneToProject = new Map<string, string>();
  for (const p of projects) for (const m of p.milestones ?? []) milestoneToProject.set(m.id, p.id);

  // action → milestone (touched actions that carry a milestone)
  const actionMilestone = actions.filter((a) => a.milestoneId).length;
  // milestone → project (distinct milestones of touched actions)
  const milestoneProject = new Set(actions.map((a) => a.milestoneId).filter(Boolean) as string[]).size;
  // project → goal (touched projects that advance a goal)
  const projectGoal = projects.filter((p) => touchedProjects.has(p.id) && p.goalId).length;
  // capture → action: actions created in range that genuinely came FROM a
  // capture, counted off the `sourceCaptureId` the action actually carries.
  //
  // This previously counted `capture_converted` — an event type nothing emits —
  // OR'd with every `capture_processed` event, so marking a capture processed
  // asserted a capture→action edge even when no `NextAction` was ever created
  // (LIFEOS-050B, D-2). The real edge is written by `createActionFromCapture`,
  // and this is the only field that proves it.
  const captureAction = (state.nextActions ?? [])
    .filter((a) => a.sourceCaptureId && inRange(a.createdAt, range)).length;
  // session → action (actions completed while attributed to a project/session context)
  const sessionAction = ev.filter((e) => e.type === "action_completed").length;
  // document → citation (citations added in range that name a document)
  const documentCitation = ev.filter((e) => e.type === "citation_added").length;
  // citation → belief (citations added to beliefs in range)
  const citationBelief = ev.filter((e) => e.type === "citation_added" && e.recordKind === "belief").length;
  // focus → target
  const focusTarget = ev.filter((e) => e.type === "focus_started").length;

  const edges: ContributionEdge[] = [
    { from: "session", to: "action", label: "Session → action", count: sessionAction },
    { from: "action", to: "milestone", label: "Action → milestone", count: actionMilestone },
    { from: "milestone", to: "project", label: "Milestone → project", count: milestoneProject },
    { from: "project", to: "goal", label: "Project → goal", count: projectGoal },
    { from: "capture", to: "action", label: "Capture → action", count: captureAction },
    { from: "document", to: "citation", label: "Document → citation", count: documentCitation },
    { from: "citation", to: "belief", label: "Citation → belief", count: citationBelief },
    { from: "focus", to: "target", label: "Focus → target", count: focusTarget },
  ];
  return edges.filter((e) => e.count > 0);
}
