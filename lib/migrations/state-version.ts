/**
 * Persisted-state schema versioning (LIFEOS-033, Feature 9).
 *
 * A single source of truth for the local StoreState / backup schema version and
 * how to detect the version of an arbitrary (possibly historical) blob. Upgrade
 * logic lives in `upgrade-state.ts` / `upgrade-backup.ts` — never scattered
 * across components. Deterministic and dependency-free.
 */

export const CURRENT_STATE_VERSION = 1;

/** The domains that make each historical version detectable by shape. */
export function detectStateVersion(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const r = raw as Record<string, unknown>;
  if (typeof r.__stateVersion === "number") return r.__stateVersion as number;
  // Heuristic fallback for blobs written before an explicit version marker:
  // execution (goals/projects, LIFEOS-031) marks v1; earlier blobs are v0.
  if ("goals" in r || "projects" in r) return 1;
  return 0;
}
