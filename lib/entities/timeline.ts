/**
 * Entity timeline (LIFEOS-029, Feature 4).
 *
 * A thin formatting layer over `entityActivity` — the ordered events plus a
 * relative-time label — so the inspector renders a consistent history without
 * duplicating date logic. Deterministic; `now` is injectable for tests.
 */

import type { EntityContext } from "@/lib/entities/entity";
import { entityActivity, type ActivityEvent } from "@/lib/entities/activity";

export type { ActivityEvent } from "@/lib/entities/activity";

export interface TimelineEntry extends ActivityEvent { relative: string }

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((now - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function entityTimeline(ctx: EntityContext, kind: string, id: string, now = Date.now()): TimelineEntry[] {
  return entityActivity(ctx, kind, id).map((e) => ({ ...e, relative: relativeTime(e.at, now) }));
}

/** The most recent activity moment for an entity (hover cards / freshness). */
export function lastActivityAt(ctx: EntityContext, kind: string, id: string): string | undefined {
  return entityActivity(ctx, kind, id)[0]?.at;
}
