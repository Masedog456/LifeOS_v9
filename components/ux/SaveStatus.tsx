"use client";

/**
 * Standardized save/sync status label (LIFEOS-032, Feature 6).
 *
 * A single, honest status chip driven by the persistence health. It never shows
 * "Saved" before remote persistence has actually succeeded when remote sync is
 * enabled — local-only writes read "Saved locally". Complements the existing
 * `SyncStatus` with an explicit, labelled state for forms. Reads live health.
 */

import { useSyncExternalStore } from "react";
import { getHealth, subscribeHealth } from "@/lib/persistence";
import type { PersistenceHealth } from "@/lib/adapters/types";

const SERVER: PersistenceHealth = { mode: "local", state: "disabled" };

function useHealth(): PersistenceHealth {
  return useSyncExternalStore(subscribeHealth, getHealth, () => SERVER);
}

/** Map health → a user-facing {label, tone}. Exported for reuse/testing. */
export function describeSaveState(h: PersistenceHealth): { label: string; tone: "ok" | "pending" | "error" | "muted" } {
  if (h.localError) return { label: "Local save failed", tone: "error" };
  if (h.mode === "local" || h.state === "disabled") return { label: "Saved locally", tone: "muted" };
  switch (h.state) {
    case "synced": return { label: "Saved", tone: "ok" };
    case "syncing": return { label: "Saving…", tone: "pending" };
    case "retrying": return { label: "Retrying…", tone: "pending" };
    case "offline": return { label: "Saved locally · offline", tone: "muted" };
    case "failed": return { label: "Sync failed", tone: "error" };
    default: return { label: "Saved locally", tone: "muted" };
  }
}

const TONE: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  pending: "text-blue-600 dark:text-blue-400",
  error: "text-rose-600 dark:text-rose-400",
  muted: "text-zinc-400",
};

export default function SaveStatus() {
  const h = useHealth();
  const { label, tone } = describeSaveState(h);
  return <span role="status" className={`text-[11px] ${TONE[tone]}`}>{label}</span>;
}
