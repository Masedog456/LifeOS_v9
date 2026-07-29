/**
 * Commitment review (LIFEOS-037, Feature 10).
 *
 * A deterministic grouping of everything the user is currently committed to, so
 * they can examine and adjust it. Pure — VIEWING mutates nothing; every change
 * (horizon / defer / cancel / archive / remove-from-planning) is an explicit
 * action taken from the view. Each group carries navigable record references.
 */

import type { StoreState, RecordRefLite, NextAction } from "@/types/mvp";
import { assignmentsIn } from "@/lib/planning/horizon";

export interface CommitmentGroup {
  key: string;
  label: string;
  refs: RecordRefLite[];
}

export function commitmentGroups(state: StoreState): CommitmentGroup[] {
  const actions = state.nextActions ?? [];
  const assignments = state.planningAssignments ?? [];
  const openReading = (state.documents ?? []).filter((d) => d.status === "reading" || d.status === "paused");
  const activeMs: RecordRefLite[] = [];
  for (const p of state.projects ?? []) if (p.status === "active") for (const m of p.milestones ?? []) if (m.status !== "done") activeMs.push({ kind: "milestone", id: m.id });

  const openLoopRefs = assignments.filter((a) => a.ref.kind === "open_loop").map((a) => a.ref);

  const groups: CommitmentGroup[] = [
    { key: "goals", label: "Active goals", refs: (state.goals ?? []).filter((g) => g.status === "active").map((g) => ({ kind: "goal", id: g.id })) },
    { key: "projects", label: "Active projects", refs: (state.projects ?? []).filter((p) => p.status === "active").map((p) => ({ kind: "project", id: p.id })) },
    { key: "milestones", label: "Active milestones", refs: activeMs },
    { key: "open_actions", label: "Open actions", refs: actions.filter((a: NextAction) => a.status === "open" || a.status === "in_progress").map((a) => ({ kind: "action", id: a.id })) },
    { key: "waiting", label: "Waiting actions", refs: actions.filter((a) => a.status === "waiting").map((a) => ({ kind: "action", id: a.id })) },
    { key: "today", label: "Today selections", refs: assignmentsIn(assignments, "today").map((a) => a.ref) },
    { key: "this_week", label: "This Week selections", refs: assignmentsIn(assignments, "this_week").map((a) => a.ref) },
    { key: "reading", label: "Unfinished reading", refs: openReading.map((d) => ({ kind: "document", id: d.id })) },
    { key: "open_loops", label: "Selected open loops", refs: openLoopRefs },
  ];
  return groups.filter((g) => g.refs.length > 0);
}

/** Total distinct commitments (deduped by ref) — a neutral headline count. */
export function commitmentCount(groups: CommitmentGroup[]): number {
  const seen = new Set<string>();
  for (const g of groups) for (const r of g.refs) seen.add(`${r.kind}:${r.id}`);
  return seen.size;
}
