/**
 * Staleness (LIFEOS-038, Feature 6).
 *
 * Exposes a record's maintenance timestamps — last reviewed, last edited, last
 * referenced, last cited, last opened — and phrases age NEUTRALLY. Age is a
 * fact, never a verdict: "Last reviewed 9 months ago", NEVER "Needs update".
 * Pure; no hidden score.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { type MaintenanceIndex, refKey } from "@/lib/maintenance/integrity";

export interface Staleness {
  lastReviewed?: string;
  lastEdited?: string;
  lastReferenced?: string;
  lastCited?: string;
  lastOpened?: string;
}

const maxIso = (...vals: (string | undefined)[]): string | undefined => {
  let best: string | undefined;
  for (const v of vals) if (v && (!best || v > best)) best = v;
  return best;
};

/** Resolve a record's own `updatedAt`/`createdAt` for `lastEdited`. */
function editedAt(state: StoreState, ref: RecordRefLite): string | undefined {
  const find = <T extends { id: string; updatedAt?: string; createdAt?: string }>(arr: T[] | undefined) => (arr ?? []).find((x) => x.id === ref.id);
  switch (ref.kind) {
    case "concept": case "theme": { const r = find(state.concepts); return r?.updatedAt ?? r?.createdAt; }
    case "belief": { const r = find(state.beliefs); return r?.updatedAt ?? r?.createdAt; }
    case "document": { const r = find(state.documents); return r?.updatedAt ?? r?.createdAt; }
    case "research_project": case "research": { const r = find(state.researchProjects); return r?.updatedAt ?? r?.createdAt; }
    case "project": { const r = find(state.projects); return r?.updatedAt ?? r?.createdAt; }
    case "goal": { const r = find(state.goals); return r?.updatedAt ?? r?.createdAt; }
    case "action": { const r = find(state.nextActions); return r?.updatedAt ?? r?.createdAt; }
    case "source": { const r = (state.sources ?? []).find((x) => x.id === ref.id); return r?.addedAt; }
    default: return undefined;
  }
}

/** The full staleness record for a reference. Deterministic. */
export function stalenessFor(state: StoreState, index: MaintenanceIndex, ref: RecordRefLite): Staleness {
  const key = refKey(ref);
  const lastReviewed = index.lastReviewed.get(key);
  const lastEdited = editedAt(state, ref);

  // Citations: owned by the record OR (for a document) pointing at it.
  const owned = index.citationsByRecord.get(key) ?? [];
  const incoming = ref.kind === "document" ? (index.citationsByDocument.get(ref.id) ?? []) : [];
  const lastCited = maxIso(...owned.map((c) => c.createdAt), ...incoming.map((c) => c.createdAt));

  let lastOpened: string | undefined;
  if (ref.kind === "document") lastOpened = (state.documents ?? []).find((d) => d.id === ref.id)?.progress?.lastOpenedAt;

  const lastReferenced = maxIso(lastCited, lastOpened);
  return { lastReviewed, lastEdited, lastReferenced, lastCited, lastOpened };
}

const MS = { day: 86400000, month: 2592000000, year: 31536000000 };

/** Neutral relative phrasing — a fact, never a verdict. */
export function ago(iso: string | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const d = Math.max(0, nowMs - t);
  if (d < MS.day) return "today";
  if (d < 2 * MS.day) return "yesterday";
  if (d < MS.month) return `${Math.round(d / MS.day)} days ago`;
  if (d < MS.year) { const m = Math.round(d / MS.month); return `${m} month${m === 1 ? "" : "s"} ago`; }
  const y = Math.floor(d / MS.year); const rm = Math.round((d % MS.year) / MS.month);
  return rm > 0 ? `${y}y ${rm}m ago` : `${y} year${y === 1 ? "" : "s"} ago`;
}

/** e.g. "Last reviewed 9 months ago." — neutral, no imperative. */
export function reviewedLabel(s: Staleness, nowMs: number = Date.now()): string {
  return `Last reviewed ${ago(s.lastReviewed, nowMs)}.`;
}

/** Whole-number age in days of the most recent touch, for deterministic sorting. */
export function ageDays(iso: string | undefined, nowMs: number = Date.now()): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.max(0, nowMs - t) / MS.day);
}
