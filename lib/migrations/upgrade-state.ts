/**
 * Ordered, idempotent StoreState upgrades (LIFEOS-033, Feature 9).
 *
 * Brings any historical persisted blob up to `CURRENT_STATE_VERSION`: applies
 * ordered upgraders (add domains introduced in later sprints), then NORMALIZES —
 * every canonical domain becomes an array (malformed → []), unknown/deprecated
 * top-level keys are dropped, and the explicit version marker is stamped.
 * Deterministic and idempotent: upgrading an already-current blob is a no-op
 * beyond normalization. No component owns migration logic — only this module.
 */

import type { StoreState } from "@/types/mvp";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { CURRENT_STATE_VERSION, detectStateVersion } from "@/lib/migrations/state-version";

type Blob = Record<string, unknown>;
const ensureArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface Upgrader { to: number; fn: (s: Blob) => Blob }

/** Ordered upgraders. Each is idempotent and only fills what its version added. */
const UPGRADERS: Upgrader[] = [
  {
    to: 1,
    fn: (s) => ({
      ...s,
      // LIFEOS-030/031 domains that older blobs won't have.
      workspaces: ensureArr(s.workspaces),
      sessions: ensureArr(s.sessions),
      goals: ensureArr(s.goals),
      projects: ensureArr(s.projects),
    }),
  },
];

export interface UpgradeResult {
  state: Partial<StoreState>;
  fromVersion: number;
  toVersion: number;
  changed: boolean;
  droppedKeys: string[];
}

/**
 * Upgrade + normalize a raw persisted blob. Returns a partial StoreState with
 * every canonical domain present as an array, plus metadata for diagnostics.
 */
export function upgradeState(raw: unknown): UpgradeResult {
  const from = detectStateVersion(raw);
  let blob: Blob = raw && typeof raw === "object" ? { ...(raw as Blob) } : {};
  for (const u of UPGRADERS) if (from < u.to) blob = u.fn(blob);

  // Normalize: coerce every canonical domain to an array; record dropped keys.
  const allowed = new Set<string>([...(STORE_DOMAINS as string[]), "__stateVersion"]);
  const droppedKeys = Object.keys(blob).filter((k) => !allowed.has(k));
  const state: Record<string, unknown> = {};
  for (const d of STORE_DOMAINS) state[d as string] = ensureArr(blob[d as string]);

  return {
    state: state as Partial<StoreState>,
    fromVersion: from,
    toVersion: CURRENT_STATE_VERSION,
    changed: from < CURRENT_STATE_VERSION || droppedKeys.length > 0,
    droppedKeys,
  };
}

/** Stamp the current version marker onto a blob (for what we persist next). */
export function stampVersion<T extends object>(state: T): T & { __stateVersion: number } {
  return { ...state, __stateVersion: CURRENT_STATE_VERSION };
}
