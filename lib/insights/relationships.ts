/**
 * Per-record activity (LIFEOS-039, Feature 21).
 *
 * The compact Activity section for the inspector: created, last edited, last
 * opened, last reviewed, last session, sessions + focus duration in the selected
 * range, linked activity count, and recent history. Reuses the shared activity
 * index and entity resolution. Pure.
 */

import type { RecordRefLite } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsForRecord } from "@/lib/insights/activity";
import { inRange, type ResolvedRange } from "@/lib/insights/range";

export interface RecordActivity {
  created?: string;
  lastEdited?: string;
  lastOpened?: string;
  lastReviewed?: string;
  lastSession?: string;
  sessionsInRange: number;
  focusMs: number;
  linkedActivityCount: number;
  /** Most-recent-first recent events (bounded). */
  recentHistory: ActivityEvent[];
}

const lastOf = (events: ActivityEvent[], types: string[]): string | undefined => {
  let best: string | undefined;
  for (const e of events) if (types.includes(e.type) && (!best || e.at > best)) best = e.at;
  return best;
};

export function recordActivity(index: ActivityEvent[], ref: RecordRefLite, range: ResolvedRange): RecordActivity {
  const all = eventsForRecord(index, ref.kind, ref.id);
  const ranged = all.filter((e) => inRange(e.at, range));
  return {
    created: lastOf(all, ["action_created", "belief_created", "entity_created", "research_created", "capture_created"]) ?? (all[0]?.at),
    lastEdited: all.length ? all[all.length - 1].at : undefined,
    lastOpened: lastOf(all, ["document_opened", "entity_opened"]),
    lastReviewed: lastOf(all, ["belief_reviewed", "maintenance_reviewed", "review_completed"]),
    lastSession: lastOf(all, ["session_started", "focus_started"]),
    sessionsInRange: ranged.filter((e) => e.type === "session_started" || e.type === "focus_started").length,
    focusMs: ranged.filter((e) => e.type === "focus_ended").reduce((n, e) => n + (e.durationMs ?? 0), 0),
    linkedActivityCount: ranged.length,
    recentHistory: [...all].reverse().slice(0, 8),
  };
}
