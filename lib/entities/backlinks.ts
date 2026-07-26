/**
 * Backlinks (LIFEOS-029, Feature 3).
 *
 * Deterministic "who links to me?" for any entity, grouped by the source entity
 * kind. Incoming graph edges (LIFEOS-021) + reverse domain links (dialogues,
 * tensions, decisions, reading citations) — every backlink is navigable to the
 * originating record. Memoized per graph. No new storage, no AI.
 */

import type { KnowledgeGraph } from "@/lib/graph";
import { RECORD_LABELS } from "@/lib/command/records";
import { entityRef, entityKindLabel, type EntityContext, type EntityRef } from "@/lib/entities/entity";

export interface BacklinkGroup { kind: string; label: string; items: EntityRef[] }

const cache = new WeakMap<KnowledgeGraph, Map<string, BacklinkGroup[]>>();

/** Grouped backlinks (incoming links) for an entity. */
export function entityBacklinks(ctx: EntityContext, kind: string, id: string): BacklinkGroup[] {
  let byId = cache.get(ctx.graph);
  if (!byId) { byId = new Map(); cache.set(ctx.graph, byId); }
  const memoKey = `${kind}:${id}`;
  const hit = byId.get(memoKey);
  if (hit) return hit;

  const byKind = new Map<string, Map<string, EntityRef>>();
  const push = (srcKind: string, srcId: string) => {
    if (srcId === id) return;
    const ref = entityRef(ctx, srcKind, srcId);
    if (!ref.exists) return;
    const m = byKind.get(srcKind) ?? new Map<string, EntityRef>();
    if (!m.has(srcId)) m.set(srcId, ref);
    byKind.set(srcKind, m);
  };

  // Incoming graph edges: `from` references `id`.
  for (const e of ctx.graph.byTo.get(id) ?? []) push(e.fromKind, e.from);

  // Reverse domain links the reference index doesn't include.
  const { state } = ctx;
  for (const d of state.dialogueSessions) if (d.seedRefs.includes(id)) push("dialogue", d.id);
  for (const t of state.tensions) if ([...t.thesisRefs, ...t.antithesisRefs, ...t.evidence.map((e) => e.refId)].includes(id)) push("tension", t.id);
  for (const s of state.syntheses) if (s.tensionIds.includes(id) || s.evidenceLinks.some((e) => e.refId === id)) push("synthesis", s.id);
  // Reading: a document/passage/highlight cites this knowledge record.
  for (const c of state.citations) if (c.recordId === id) push("document", c.documentId);
  // A passage/highlight linked TO this record (conversion provenance).
  for (const doc of state.documents) for (const sec of doc.sections) for (const p of sec.passages) {
    if (p.linked.some((l) => l.id === id)) push("passage", p.id);
  }

  const out: BacklinkGroup[] = [...byKind.entries()]
    .map(([k, m]) => ({ kind: k, label: RECORD_LABELS[k] ?? entityKindLabel(k), items: [...m.values()] }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));

  byId.set(memoKey, out);
  return out;
}

/** Total backlink count (hover cards / badges). */
export function backlinkCount(ctx: EntityContext, kind: string, id: string): number {
  return entityBacklinks(ctx, kind, id).reduce((n, g) => n + g.items.length, 0);
}
