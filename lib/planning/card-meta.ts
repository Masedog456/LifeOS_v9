/**
 * Card-metadata resolver (LIFEOS-037). Resolves a planned record reference into
 * display + filter metadata for the board, reusing the entity API for the title/
 * href and pulling filterable context (workspace/goal/project/tags) from the
 * underlying record. Pure over `StoreState` + an `EntityContext`.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { entityRef, type EntityContext } from "@/lib/entities/entity";
import type { CardMeta } from "@/lib/planning/board";

export function resolveCardMeta(state: StoreState, ctx: EntityContext, ref: RecordRefLite): CardMeta {
  const r = entityRef(ctx, ref.kind, ref.id);
  const base: CardMeta = { title: r.title, kind: ref.kind, href: r.href, exists: r.exists };
  switch (ref.kind) {
    case "action": {
      const a = (state.nextActions ?? []).find((x) => x.id === ref.id);
      if (a) return { ...base, workspaceId: a.workspaceId, goalId: a.goalId, projectId: a.projectId, context: a.context, tags: a.tags, exists: true };
      return { ...base, exists: false };
    }
    case "project": {
      const p = (state.projects ?? []).find((x) => x.id === ref.id);
      if (p) return { ...base, workspaceId: p.workspaceId, goalId: p.goalId, projectId: p.id, exists: true };
      return { ...base, exists: false };
    }
    case "milestone": {
      for (const p of state.projects ?? []) { const m = p.milestones.find((x) => x.id === ref.id); if (m) return { ...base, workspaceId: p.workspaceId, goalId: p.goalId, projectId: p.id, exists: true }; }
      return { ...base, exists: false };
    }
    case "document": {
      const d = (state.documents ?? []).find((x) => x.id === ref.id);
      if (d) return { ...base, tags: d.tags, exists: true };
      return { ...base, exists: false };
    }
    case "capture": {
      const c = (state.captures ?? []).find((x) => x.id === ref.id);
      if (c) return { ...base, tags: c.tags, exists: true };
      return { ...base, exists: false };
    }
    default:
      return base;
  }
}
