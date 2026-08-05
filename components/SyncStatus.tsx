"use client";

import { useSyncExternalStore } from "react";
import { getHealth, retrySync, subscribeHealth } from "@/lib/persistence";
import type { PersistenceHealth } from "@/lib/adapters/types";

const SERVER_SNAPSHOT: PersistenceHealth = { mode: "local", state: "disabled" };

function useHealth(): PersistenceHealth {
  return useSyncExternalStore(subscribeHealth, getHealth, () => SERVER_SNAPSHOT);
}

const DOT: Record<PersistenceHealth["state"], string> = {
  local: "bg-zinc-400",
  disabled: "bg-zinc-400",
  syncing: "bg-amber-500",
  synced: "bg-emerald-500",
  failed: "bg-red-500",
  offline: "bg-sky-500",
  retrying: "bg-amber-500",
};

const LABEL: Record<PersistenceHealth["state"], string> = {
  local: "Saved locally",
  disabled: "Saved locally",
  syncing: "Saving…",
  synced: "Saved",
  failed: "Sync error",
  offline: "Offline — saved locally",
  retrying: "Retrying…",
};

export default function SyncStatus() {
  const h = useHealth();
  // When a sync fails before anything has ever synced, that's not an alarming
  // "error" — nothing was lost and everything is safe locally. Say "Not yet
  // synced" instead (LIFEOS-042A). A failure AFTER a prior successful sync still
  // shows as a real error. The tooltip keeps the underlying detail either way.
  const neverSynced = !h.lastSyncAt;
  const softFail = !h.localError && h.state === "failed" && neverSynced;
  const label = h.localError ? "Local save failed" : softFail ? "Not yet synced" : LABEL[h.state];
  const dot = h.localError ? "bg-red-500" : softFail ? "bg-zinc-400" : DOT[h.state];
  return (
    <span className="flex items-center gap-1.5 text-xs text-zinc-400" title={h.localError ?? h.error ?? undefined}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
      {h.state === "retrying" && h.retryAttempt ? <span className="text-[10px]">({h.retryAttempt}/5)</span> : null}
      {(h.state === "failed" || h.state === "retrying") && (
        <button
          type="button"
          onClick={() => void retrySync()}
          className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Retry
        </button>
      )}
    </span>
  );
}
