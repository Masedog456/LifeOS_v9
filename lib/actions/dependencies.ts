/**
 * Action dependencies (LIFEOS-036, Feature 10).
 *
 * Explicit, manually-created edges: `blockedId` is blocked by `blockerId`.
 * Requirements:
 *  - manual creation only (no scheduler, no inference)
 *  - reject direct AND indirect cycles at the application layer
 *  - completing a blocker makes the blocked action eligible but never starts it
 *  - a missing endpoint (dangling dependency) degrades gracefully, never crashes
 *
 * Pure over `ActionDependency[]` + `NextAction[]`; builds indexed adjacency maps
 * so cycle checks and unblock queries are cheap even with thousands of edges.
 */

import type { NextAction, ActionDependency } from "@/types/mvp";

function depId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ad_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** blocker -> Set<blocked> adjacency (who a node blocks). */
export function buildBlocksMap(deps: ActionDependency[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const d of deps) {
    if (!m.has(d.blockerId)) m.set(d.blockerId, new Set());
    m.get(d.blockerId)!.add(d.blockedId);
  }
  return m;
}

/** blocked -> Set<blocker> adjacency (what a node is blocked by). */
export function buildBlockedByMap(deps: ActionDependency[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const d of deps) {
    if (!m.has(d.blockedId)) m.set(d.blockedId, new Set());
    m.get(d.blockedId)!.add(d.blockerId);
  }
  return m;
}

/**
 * Would adding blocker→blocked create a cycle? True if `blocker` is already
 * reachable FROM `blocked` following blocks-edges (i.e. blocked can already
 * reach blocker), or the edge is a self-loop. Iterative DFS over the existing
 * blocks-map; safe against pre-existing cycles in the data.
 */
export function wouldCreateCycle(deps: ActionDependency[], blockerId: string, blockedId: string): boolean {
  if (blockerId === blockedId) return true;
  const blocks = buildBlocksMap(deps);
  // Reachable from `blocked` via blocks-edges — if that set contains `blocker`,
  // then blocker already (transitively) waits on blocked; adding blocker→blocked closes a loop.
  const seen = new Set<string>();
  const stack = [blockedId];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === blockerId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    const next = blocks.get(node);
    if (next) for (const n of next) if (!seen.has(n)) stack.push(n);
  }
  return false;
}

/** True when the edge already exists (idempotent add guard). */
export function dependencyExists(deps: ActionDependency[], blockerId: string, blockedId: string): boolean {
  return deps.some((d) => d.blockerId === blockerId && d.blockedId === blockedId);
}

export type AddDependencyResult =
  | { ok: true; dependency: ActionDependency }
  | { ok: false; reason: "self" | "cycle" | "duplicate" };

/**
 * Validate + build a new dependency. Rejects self-loops, duplicates, and any
 * edge that would create a direct or indirect cycle. Does not mutate.
 */
export function planDependency(deps: ActionDependency[], blockerId: string, blockedId: string, at: string): AddDependencyResult {
  if (blockerId === blockedId) return { ok: false, reason: "self" };
  if (dependencyExists(deps, blockerId, blockedId)) return { ok: false, reason: "duplicate" };
  if (wouldCreateCycle(deps, blockerId, blockedId)) return { ok: false, reason: "cycle" };
  return { ok: true, dependency: { id: depId(), blockerId, blockedId, createdAt: at } };
}

/**
 * Is `action` blocked right now? An action is blocked when at least one of its
 * blockers exists AND is not completed/cancelled. A dangling blocker id (no such
 * action) is treated as NOT blocking, so a deleted blocker never freezes work.
 */
export function isBlocked(action: NextAction, blockedByMap: Map<string, Set<string>>, byId: Map<string, NextAction>): boolean {
  const blockers = blockedByMap.get(action.id);
  if (!blockers || blockers.size === 0) return false;
  for (const blockerId of blockers) {
    const blocker = byId.get(blockerId);
    if (!blocker) continue; // dangling → does not block (orphan-safe)
    if (blocker.status !== "completed" && blocker.status !== "cancelled") return true;
  }
  return false;
}

/** The (existing) actions that block `actionId`. Dangling ids are skipped. */
export function blockersOf(actionId: string, blockedByMap: Map<string, Set<string>>, byId: Map<string, NextAction>): NextAction[] {
  const ids = blockedByMap.get(actionId);
  if (!ids) return [];
  const out: NextAction[] = [];
  for (const id of ids) { const a = byId.get(id); if (a) out.push(a); }
  return out;
}

/** The (existing) actions that `actionId` blocks. Dangling ids are skipped. */
export function blockedBy(actionId: string, blocksMap: Map<string, Set<string>>, byId: Map<string, NextAction>): NextAction[] {
  const ids = blocksMap.get(actionId);
  if (!ids) return [];
  const out: NextAction[] = [];
  for (const id of ids) { const a = byId.get(id); if (a) out.push(a); }
  return out;
}

/**
 * Impact summary for deleting/cancelling `actionId`: the actions it currently
 * blocks (which would become eligible) and its dependency edges. Used to require
 * an impact confirmation (Feature 10) before a destructive change.
 */
export function dependencyImpact(actionId: string, deps: ActionDependency[], byId: Map<string, NextAction>): {
  unblocks: NextAction[];
  removedEdges: number;
} {
  const blocksMap = buildBlocksMap(deps);
  const unblocks = blockedBy(actionId, blocksMap, byId);
  const removedEdges = deps.filter((d) => d.blockerId === actionId || d.blockedId === actionId).length;
  return { unblocks, removedEdges };
}

/** Remove all edges touching an action (used when it is deleted). */
export function pruneDependencies(deps: ActionDependency[], actionId: string): ActionDependency[] {
  return deps.filter((d) => d.blockerId !== actionId && d.blockedId !== actionId);
}
