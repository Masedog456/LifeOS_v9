/**
 * Entity previews & graph neighbors (LIFEOS-029, Features 5 & 8).
 *
 * `entityPreview` powers hover cards (title, type, summary, relationship +
 * backlink counts, most-recent edit). `entityNeighbors` powers the miniature
 * relationship graph — the entity's IMMEDIATE neighbors only (one hop), reusing
 * the relationship engine (not the full graph page). Deterministic, memoized
 * upstream; no new storage, no AI.
 */

import { describeEntity, entityKindLabel, type EntityContext, type EntityRef } from "@/lib/entities/entity";
import { relatedEntities, relationshipCount } from "@/lib/entities/relationships";
import { backlinkCount } from "@/lib/entities/backlinks";
import { lastActivityAt } from "@/lib/entities/timeline";

export interface EntityPreview {
  ref: EntityRef;
  kindLabel: string;
  summary: string;
  tags: string[];
  status?: string;
  relationships: number;
  backlinks: number;
  updatedAt?: string;
  lastActivityAt?: string;
}

/** The data a hover card shows. */
export function entityPreview(ctx: EntityContext, kind: string, id: string): EntityPreview {
  const e = describeEntity(ctx, kind, id);
  return {
    ref: e.ref,
    kindLabel: entityKindLabel(kind),
    summary: e.summary,
    tags: e.tags,
    status: e.status,
    relationships: relationshipCount(ctx, kind, id),
    backlinks: backlinkCount(ctx, kind, id),
    updatedAt: e.updatedAt ?? e.createdAt,
    lastActivityAt: lastActivityAt(ctx, kind, id),
  };
}

export interface NeighborNode { ref: EntityRef; relation: string }
export interface EntityNeighborhood {
  center: EntityRef;
  neighbors: NeighborNode[];
}

/** Immediate neighbors for the mini relationship graph (one hop, capped). */
export function entityNeighbors(ctx: EntityContext, kind: string, id: string, limit = 12): EntityNeighborhood {
  const center = describeEntity(ctx, kind, id).ref;
  const neighbors = relatedEntities(ctx, kind, id).slice(0, limit).map((r) => ({ ref: r.ref, relation: r.relation }));
  return { center, neighbors };
}
