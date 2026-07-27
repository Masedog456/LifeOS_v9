/**
 * Capture processing relationships & lineage (LIFEOS-035, Feature 17).
 *
 * Deterministic two-way links: records created from a capture, captures split
 * from / merged into it, and entities linked during processing. Plus the reverse
 * ("which captures reference this record"). References only — never copies.
 */

import type { Capture, RecordRefLite, StoreState } from "@/types/mvp";
import { captureLinks, conversionTargets } from "@/lib/inbox/capture-status";

export interface CaptureLineage {
  /** The capture this one was split from (if any). */
  splitFrom?: Capture;
  /** Captures split FROM this capture. */
  splitChildren: Capture[];
  /** Captures merged INTO this capture. */
  mergedFrom: Capture[];
  /** A capture this one was merged into (if any). */
  mergedInto?: Capture;
  /** Records created from this capture (conversions). */
  conversions: RecordRefLite[];
  /** Direct (non-conversion) links. */
  links: RecordRefLite[];
}

export function captureLineage(state: StoreState, capture: Capture): CaptureLineage {
  const all = state.captures ?? [];
  return {
    splitFrom: capture.splitFromId ? all.find((c) => c.id === capture.splitFromId) : undefined,
    splitChildren: all.filter((c) => c.splitFromId === capture.id),
    mergedFrom: all.filter((c) => (capture.mergedFromIds ?? []).includes(c.id)),
    mergedInto: all.find((c) => (c.mergedFromIds ?? []).includes(capture.id)),
    conversions: conversionTargets(capture),
    links: captureLinks(capture),
  };
}

/** Captures that link to (or were converted into) a given record. */
export function capturesReferencing(state: StoreState, kind: string, id: string): Capture[] {
  return (state.captures ?? []).filter((c) => {
    if (kind === "workspace" && (c.linkedWorkspaceIds ?? []).includes(id)) return true;
    if (kind === "goal" && (c.linkedGoalIds ?? []).includes(id)) return true;
    if (kind === "project" && (c.linkedProjectIds ?? []).includes(id)) return true;
    if ((c.linkedEntityRefs ?? []).some((r) => r.kind === kind && r.id === id)) return true;
    if (conversionTargets(c).some((r) => r.kind === kind && r.id === id)) return true;
    return false;
  });
}
