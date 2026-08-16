/**
 * Topics (LIFEOS-052).
 *
 * ## Why there is no Topic entity, and no workspace discriminator
 *
 * The sprint brief asked whether Topics / Learning Areas need a new primitive, a
 * `Workspace.kind` discriminator, or neither — and to prefer naming and UX if
 * naming and UX are enough.
 *
 * They are enough. `Workspace` is already documented in `types/mvp.ts` as a
 * durable, user-owned grouping of existing entities "around a project or life
 * area — 'Philosophy Thesis', 'Pool Business', 'Peace Corps'". It already holds
 * typed references to any record, already has a name and description, already
 * syncs, exports, restores, and deletes, and is already indexed by the command
 * palette. A Topic is that, used for Spanish instead of a thesis.
 *
 * A `kind: "project" | "area"` field was considered and rejected for this
 * sprint, because it would have to earn three costs and currently earns none:
 *
 *   1. **A schema + migration + sync change** on a table that already works.
 *   2. **A distinction the user must understand.** The brief is explicit: do not
 *      expose a complicated difference between Workspace, Topic and Life Area if
 *      users do not need to understand it. A discriminator makes that difference
 *      real and therefore explainable — the taxonomy bureaucracy the audit warned
 *      against.
 *   3. **A migration decision for existing workspaces.** Every current workspace
 *      would need a kind, and guessing it manufactures structure from old data
 *      (brief §16).
 *
 * Nothing here forecloses it. If beta users demonstrably need Topics and
 * Projects to behave differently, adding a discriminator later is additive and
 * the notes written in the meantime keep working unchanged, because a note
 * points at a workspace id either way.
 *
 * Pure module: no creation, no mutation.
 */

import type { StoreState, Workspace } from "@/types/mvp";

/**
 * The user-facing word. Notes call a workspace a "Topic"; Workspaces call it a
 * workspace. One record, two contexts — the same way a person calls the same
 * folder "my recipes" in one breath and "that folder" in another.
 */
export const TOPIC_LABEL = "Topic";

/** Workspaces available to file a note under, in a stable display order. */
export function availableTopics(state: StoreState): Workspace[] {
  return (state.workspaces ?? [])
    .filter((w) => !w.archived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Resolve a topic's display name, degrading gracefully if it has been deleted. */
export function topicName(state: StoreState, workspaceId: string | undefined): string | undefined {
  if (!workspaceId) return undefined;
  return (state.workspaces ?? []).find((w) => w.id === workspaceId)?.name;
}

/**
 * Does this note's topic still exist? A workspace can be deleted while notes
 * still point at it; the note must survive that (it simply becomes untopiced in
 * the UI rather than disappearing or crashing a projection).
 */
export function topicExists(state: StoreState, workspaceId: string | undefined): boolean {
  if (!workspaceId) return false;
  return (state.workspaces ?? []).some((w) => w.id === workspaceId);
}
