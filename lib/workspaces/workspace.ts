/**
 * Workspace model & membership (LIFEOS-030, Features 1 & 10).
 *
 * A Workspace is a first-class, durable grouping of EXISTING entities around a
 * project or life area. It never copies the entities it groups — `members` and
 * `pinned` hold typed references (kind + id) only, resolved live against the
 * store so renames and deletions are handled for free. Everything here is a pure,
 * deterministic derivation over `StoreState` (+ the LIFEOS-021 graph and the
 * LIFEOS-029 unified entity API): no store mutation, no AI, no background work.
 */

import type { RecordRefLite, StoreState, Workspace } from "@/types/mvp";
import { describeEntity, entityRef, type EntityContext, type EntityRef } from "@/lib/entities/entity";
import { entityNeighbors } from "@/lib/entities/preview";

export const WORKSPACE_KIND = "workspace";

/** The route for a workspace's dashboard. */
export function workspaceHref(id: string): string {
  return `/workspace/${id}`;
}

/** A normalized reference to a workspace (for search, inspector, links). */
export function workspaceRef(ws: Workspace): EntityRef {
  return { kind: WORKSPACE_KIND, id: ws.id, title: ws.name || "Untitled workspace", href: workspaceHref(ws.id), exists: true };
}

/** All non-archived workspaces, most-recently-updated first (stable). */
export function activeWorkspaces(state: StoreState): Workspace[] {
  return [...(state.workspaces ?? [])]
    .filter((w) => !w.archived)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.name.localeCompare(b.name));
}

export function findWorkspace(state: StoreState, id: string | undefined): Workspace | undefined {
  if (!id) return undefined;
  return (state.workspaces ?? []).find((w) => w.id === id);
}

const refKey = (r: RecordRefLite): string => `${r.kind}:${r.id}`;

export function isMember(ws: Workspace, kind: string, id: string): boolean {
  return ws.members.some((m) => m.kind === kind && m.id === id);
}

export function isPinnedInWorkspace(ws: Workspace, kind: string, id: string): boolean {
  return ws.pinned.some((m) => m.kind === kind && m.id === id);
}

/** Which workspaces an entity belongs to (Feature 10 — "Belongs to workspace(s)"). */
export function entityWorkspaces(state: StoreState, kind: string, id: string): Workspace[] {
  return (state.workspaces ?? []).filter((w) => !w.archived && isMember(w, kind, id));
}

/**
 * Resolve a workspace's members to live entity references, dropping any that no
 * longer exist (a deleted belief silently leaves the workspace). Deduped by
 * kind+id, membership order preserved.
 */
export function workspaceEntities(ctx: EntityContext, ws: Workspace): EntityRef[] {
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  for (const m of ws.members) {
    const key = refKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = entityRef(ctx, m.kind, m.id);
    if (ref.exists) out.push(ref);
  }
  return out;
}

/** Pinned entities resolved to live references (existing only, order preserved). */
export function workspacePinned(ctx: EntityContext, ws: Workspace): EntityRef[] {
  const out: EntityRef[] = [];
  for (const p of ws.pinned) {
    const ref = entityRef(ctx, p.kind, p.id);
    if (ref.exists) out.push(ref);
  }
  return out;
}

export interface WorkspaceReference { ref: EntityRef; via: EntityRef; relation: string }

/**
 * Entities REFERENCED BY a workspace but not themselves members (Feature 10 —
 * "Referenced by workspace"): the one-hop graph neighbors of the members. Pure
 * derivation over the LIFEOS-029 neighbor engine; capped and deduped. Members
 * (and non-existent nodes) are excluded so this only ever surfaces the frontier.
 */
export function workspaceReferenced(ctx: EntityContext, ws: Workspace, limit = 24): WorkspaceReference[] {
  const memberKeys = new Set(ws.members.map(refKey));
  const seen = new Set<string>();
  const out: WorkspaceReference[] = [];
  for (const m of ws.members) {
    const via = entityRef(ctx, m.kind, m.id);
    if (!via.exists) continue;
    const hood = entityNeighbors(ctx, m.kind, m.id, 8);
    for (const n of hood.neighbors) {
      const key = `${n.ref.kind}:${n.ref.id}`;
      if (memberKeys.has(key) || seen.has(key) || !n.ref.exists) continue;
      seen.add(key);
      out.push({ ref: n.ref, via, relation: n.relation });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** A short deterministic summary line for a workspace card. */
export function workspaceSummary(ctx: EntityContext, ws: Workspace): string {
  if (ws.description.trim()) return ws.description.trim();
  const n = workspaceEntities(ctx, ws).length;
  const g = ws.goals.filter((x) => !x.done).length;
  const bits: string[] = [];
  bits.push(n === 1 ? "1 entity" : `${n} entities`);
  if (g) bits.push(g === 1 ? "1 open goal" : `${g} open goals`);
  return bits.join(" · ");
}

/** Human count of members grouped by kind label (for dashboard overview). */
export function memberBreakdown(ctx: EntityContext, ws: Workspace): { kind: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const ref of workspaceEntities(ctx, ws)) {
    counts.set(ref.kind, (counts.get(ref.kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
}

/** Describe a workspace as a full Entity-like summary (used by the inspector). */
export function describeWorkspace(ctx: EntityContext, ws: Workspace) {
  return {
    ref: workspaceRef(ws),
    summary: workspaceSummary(ctx, ws),
    memberCount: ws.members.length,
    goalCount: ws.goals.length,
    entities: workspaceEntities(ctx, ws),
    describe: (kind: string, id: string) => describeEntity(ctx, kind, id),
  };
}
