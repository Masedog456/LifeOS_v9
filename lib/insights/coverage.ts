/**
 * Data coverage (LIFEOS-039, Feature 25).
 *
 * Every insight view discloses what it can and cannot see, so partial data is
 * never presented as complete. Reports the first recorded activity instant
 * (history begins…), open sessions excluded from completed-duration totals, the
 * local-first synced-records caveat, and the retained-history caveat for deleted
 * records. Pure — plain facts, no interpretation.
 */

import type { StoreState } from "@/types/mvp";
import { earliestEvent, type ActivityEvent } from "@/lib/insights/activity";
import { formatDayKey, dayKeyFromIso } from "@/lib/reviews/dates";

export interface Coverage {
  firstEventAt?: string;
  openSessions: number;
  notes: string[];
}

/** Build the coverage disclosures for the current store snapshot + index. */
export function buildCoverage(state: StoreState, index: ActivityEvent[]): Coverage {
  const firstEventAt = earliestEvent(index);
  const openSessions = (state.sessions ?? []).filter((s) => !s.endedAt).length;
  const openFocus = (state.focusSessions ?? []).filter((f) => !f.endedAt).length;

  const notes: string[] = [];
  if (firstEventAt) {
    const key = dayKeyFromIso(firstEventAt);
    if (key) notes.push(`Activity history begins on ${formatDayKey(key, { month: "long", day: "numeric", year: "numeric" })}.`);
  } else {
    notes.push("No recorded activity yet.");
  }
  if (openSessions > 0) notes.push(`${openSessions} session${openSessions === 1 ? " remains" : "s remain"} open and ${openSessions === 1 ? "is" : "are"} excluded from completed-duration totals.`);
  if (openFocus > 0) notes.push(`${openFocus} focus session${openFocus === 1 ? "" : "s"} left open — counted, but excluded from completed-duration totals.`);
  notes.push("This view includes locally available synced records.");
  notes.push("Deleted records may appear only through retained history events.");
  return { firstEventAt, openSessions, notes };
}
