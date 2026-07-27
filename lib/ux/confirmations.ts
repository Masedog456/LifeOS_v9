/**
 * Destructive-action impact summaries (LIFEOS-032, Feature 3).
 *
 * Deterministic builder that describes exactly what a delete/archive/abandon/
 * reset will affect: the record's name and type, the child records that go with
 * it, whether linked EXTERNAL records survive, whether the action can be undone,
 * and a severity ("high" requires stronger confirmation). Pure over `StoreState`
 * + the LIFEOS-029 entity API — the shared `ConfirmDialog` renders it. No generic
 * browser confirms; no AI.
 */

import type { StoreState } from "@/types/mvp";
import { describeEntity, entityKindLabel, makeEntityContext } from "@/lib/entities/entity";
import { backlinkCount } from "@/lib/entities/backlinks";
import { citationsForRecord } from "@/lib/library/citations";

export type ConfirmSeverity = "normal" | "high";
export interface ImpactChild { label: string; count: number }
export interface ConfirmImpact {
  name: string;
  typeLabel: string;
  children: ImpactChild[];
  /** How external/linked records are affected (they survive). */
  linkedNote?: string;
  undoable: boolean;
  severity: ConfirmSeverity;
  /** The verb for the action button ("Delete", "Reset", …). */
  verb: string;
}

const child = (label: string, count: number): ImpactChild[] => (count > 0 ? [{ label, count }] : []);

/**
 * Build the impact summary for deleting/resetting a record. `verb` defaults to
 * "Delete". Severity is "high" for documents, workspaces, projects-with-
 * milestones, and any record that has citations or backlinks (per the spec).
 */
export function buildImpact(state: StoreState, kind: string, id: string, verb = "Delete"): ConfirmImpact {
  // "reset" is state-independent — handle it before building a graph so callers
  // that don't hold a full state snapshot can request it safely.
  if (kind === "reset") {
    return {
      name: "All local LifeOS data", typeLabel: "Everything", verb: "Reset",
      children: [], undoable: false, severity: "high",
      linkedNote: "This clears every capture, belief, document, workspace, goal, and project on this device (and remotely when signed in). Export a backup first.",
    };
  }
  const ctx = makeEntityContext(state);
  const name = describeEntity(ctx, kind, id).ref.title;
  const typeLabel = entityKindLabel(kind);
  const backs = backlinkCount(ctx, kind, id);
  const cites = citationsForRecord(state, kind, id).length;
  let children: ImpactChild[] = [];
  let linkedNote: string | undefined;
  let severity: ConfirmSeverity = "normal";

  switch (kind) {
    case "document": {
      const d = state.documents.find((x) => x.id === id);
      if (d) {
        const passages = d.sections.reduce((n, s) => n + s.passages.length, 0);
        const highlights = d.sections.reduce((n, s) => n + s.passages.reduce((m, p) => m + p.highlights.length, 0), 0);
        const annotations = d.sections.reduce((n, s) => n + s.passages.reduce((m, p) => m + p.annotations.length, 0), 0);
        children = [...child("section", d.sections.length), ...child("passage", passages), ...child("highlight", highlights), ...child("note", annotations)];
      }
      linkedNote = "Beliefs, concepts, and other records you created from this document are kept — only their citation home is removed.";
      severity = "high";
      break;
    }
    case "workspace": {
      const sessions = (state.sessions ?? []).filter((s) => s.workspaceId === id).length;
      children = child("session", sessions);
      linkedNote = "The entities grouped in this workspace are kept — a workspace holds references, never copies.";
      severity = "high";
      break;
    }
    case "project": {
      const p = (state.projects ?? []).find((x) => x.id === id);
      const sessions = (state.sessions ?? []).filter((s) => s.projectId === id).length;
      const milestones = p?.milestones.length ?? 0;
      children = [...child("milestone", milestones)];
      linkedNote = "The goal, documents, and entities related to this project are kept; its sessions are detached, not deleted.";
      severity = milestones > 0 ? "high" : "normal";
      if (sessions > 0) children.push({ label: "linked session", count: sessions });
      break;
    }
    case "goal": {
      const projects = (state.projects ?? []).filter((x) => x.goalId === id).length;
      children = child("project", projects);
      linkedNote = "Its projects are kept and simply unlinked from this goal — nothing else is deleted.";
      severity = projects > 0 ? "high" : "normal";
      break;
    }
    default:
      break;
  }

  // Any record with citations or backlinks is high-impact regardless of kind.
  if (cites > 0 || backs > 0) {
    severity = "high";
    if (!linkedNote) linkedNote = "Records that reference this are kept — only the reference target is removed.";
  }
  children.push(...child("citation", cites), ...child("backlink", backs));

  return { name, typeLabel, children, linkedNote, undoable: false, severity, verb };
}

/** One-line plain-text summary of an impact (for tests / copy). */
export function impactSummary(impact: ConfirmImpact): string {
  const bits = impact.children.map((c) => `${c.count} ${c.label}${c.count === 1 ? "" : "s"}`);
  return `${impact.verb} ${impact.typeLabel} “${impact.name}”${bits.length ? ` — affects ${bits.join(", ")}` : ""}`;
}
