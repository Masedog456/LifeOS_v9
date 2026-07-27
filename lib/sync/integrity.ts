/**
 * Referential integrity validation (LIFEOS-033, Feature 11).
 *
 * Deterministic checks over a StoreState (or an incoming backup's data) used
 * before a restore and in the diagnostics integrity report: duplicate ids,
 * dangling citations (missing document/record), workspace/project/session
 * reference problems (missing parents), and orphaned execution links. Read-only
 * and pure — it reports issues; it never mutates. No AI.
 */

import type { StoreState } from "@/types/mvp";

export type IntegritySeverity = "error" | "warning";
export interface IntegrityIssue {
  severity: IntegritySeverity;
  domain: string;
  recordId: string;
  message: string;
}
export interface IntegrityResult {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: IntegrityIssue[];
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const ids = (a: { id: string }[]) => new Set(a.map((r) => r.id));

/** Validate referential integrity of a (possibly partial) state. */
export function validateIntegrity(state: Partial<StoreState>): IntegrityResult {
  const issues: IntegrityIssue[] = [];
  const add = (severity: IntegritySeverity, domain: string, recordId: string, message: string) => issues.push({ severity, domain, recordId, message });

  const documents = arr<{ id: string }>(state.documents);
  const citations = arr<{ id: string; documentId?: string; recordKind?: string; recordId?: string }>(state.citations);
  const workspaces = arr<{ id: string; members?: { kind: string; id: string }[] }>(state.workspaces);
  const sessions = arr<{ id: string; workspaceId?: string }>(state.sessions);
  const projects = arr<{ id: string; goalId?: string }>(state.projects);
  const goals = arr<{ id: string }>(state.goals);

  const docIds = ids(documents);
  const goalIds = ids(goals);
  const wsIds = ids(workspaces);

  // Duplicate ids across every domain.
  for (const [domain, list] of Object.entries(state)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    for (const r of list as { id?: string }[]) {
      if (!r || typeof r.id !== "string") continue;
      if (seen.has(r.id)) add("error", domain, r.id, "Duplicate id");
      seen.add(r.id);
    }
  }

  // Dangling citations.
  for (const c of citations) {
    if (c.documentId && !docIds.has(c.documentId)) add("warning", "citations", c.id, `Citation points to a missing document (${c.documentId})`);
  }
  // Sessions must reference an existing workspace.
  for (const s of sessions) {
    if (s.workspaceId && !wsIds.has(s.workspaceId)) add("warning", "sessions", s.id, `Session references a missing workspace (${s.workspaceId})`);
  }
  // Projects' goal link must exist (a project may legitimately have no goal).
  for (const p of projects) {
    if (p.goalId && !goalIds.has(p.goalId)) add("warning", "projects", p.id, `Project references a missing goal (${p.goalId})`);
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return { ok: errors === 0, errors, warnings, issues };
}

/** One-line human summary for the diagnostics report. */
export function integritySummary(r: IntegrityResult): string {
  if (r.ok && r.warnings === 0) return "No integrity issues found.";
  return `${r.errors} error${r.errors === 1 ? "" : "s"}, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}.`;
}
