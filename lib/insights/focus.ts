/**
 * Focus activity (LIFEOS-039, Feature 11).
 *
 * Focus sessions, total + median recorded duration, targets used, interruptions,
 * sessions ended normally vs left open, and actions/documents active during
 * focus. No distraction score, no deep-work score, no comparison to other users.
 * Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import { inRange, type ResolvedRange } from "@/lib/insights/range";

export interface FocusActivity {
  sessions: number;
  totalMs: number;
  medianMs: number;
  targetsUsed: number;
  interruptions: number;
  endedNormally: number;
  leftOpen: number;
  actionsCompletedDuringFocus: number;
  documentsOpenedDuringFocus: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function focusActivity(state: StoreState, index: ActivityEvent[], range: ResolvedRange): FocusActivity {
  // Focus sessions STARTED in range.
  const started = (state.focusSessions ?? []).filter((f) => inRange(f.startedAt, range));
  const durations = started.filter((f) => f.endedAt).map((f) => Math.max(0, Date.parse(f.endedAt!) - Date.parse(f.startedAt)));
  const targets = new Set(started.map((f) => `${f.ref.kind}:${f.ref.id}`));
  const interruptions = started.reduce((n, f) => n + (f.interruptions ?? []).length, 0);

  // Actions completed / documents opened while a focus session was active in range.
  const ev = eventsInRange(index, range);
  const focusIntervals = started.map((f) => ({ start: Date.parse(f.startedAt), end: f.endedAt ? Date.parse(f.endedAt) : Date.now() }));
  const during = (iso: string) => { const t = Date.parse(iso); return focusIntervals.some((iv) => t >= iv.start && t <= iv.end); };
  const actionsCompletedDuringFocus = ev.filter((e) => e.type === "action_completed" && during(e.at)).length;
  const documentsOpenedDuringFocus = ev.filter((e) => e.type === "document_opened" && during(e.at)).length;

  return {
    sessions: started.length,
    totalMs: durations.reduce((a, b) => a + b, 0),
    medianMs: median(durations),
    targetsUsed: targets.size,
    interruptions,
    endedNormally: started.filter((f) => f.endedAt).length,
    leftOpen: started.filter((f) => !f.endedAt).length,
    actionsCompletedDuringFocus,
    documentsOpenedDuringFocus,
  };
}
