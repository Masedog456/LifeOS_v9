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
  incomplete: "bg-amber-600",
  failed: "bg-red-500",
  offline: "bg-sky-500",
  retrying: "bg-amber-500",
};

const LABEL: Record<PersistenceHealth["state"], string> = {
  local: "Saved locally",
  disabled: "Saved locally",
  syncing: "Saving…",
  synced: "Saved",
  // Some domains reached the server and some did not (LIFEOS-074 D-22). It is
  // deliberately NOT "Saved": claiming remote durability for the whole state
  // when only part of it landed is the false success this state exists to stop.
  incomplete: "Sync incomplete",
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
  /**
   * A calm state may hide on a phone. A BROKEN one may not (LIFEOS-074 §3).
   *
   * `Nav` used to wrap this in `hidden sm:block`, which is right for "Saved
   * locally" — it is reassurance, and reassurance can wait for a wider screen.
   * But the same rule hid "Local save failed". Injecting a localStorage quota
   * error at 390px produced a "Completed" toast, an action that looked done,
   * and this element rendering the contradiction at 0x0 with `display: none`:
   * the one signal that the write was lost was invisible on the device the app
   * is mostly used on, and the mutation vanished on the next reload. Measured
   * at 1280px the same element is 106x16 and reads correctly, which is why the
   * gap survived — every check had been run wide.
   *
   * So the breakpoint now depends on whether there is anything wrong.
   */
  const alarming = !!h.localError || h.state === "failed" || h.state === "retrying" || h.state === "incomplete";
  return (
    <span
      data-sync-status={h.localError ? "local-error" : h.state}
      className={`${alarming ? "flex" : "hidden sm:flex"} items-center gap-1.5 text-xs ${h.localError ? "text-red-600 dark:text-red-400" : "text-zinc-400"}`}
      title={h.localError ?? h.error ?? undefined}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
      {h.state === "retrying" && h.retryAttempt ? <span className="text-[10px]">({h.retryAttempt}/5)</span> : null}
      {(h.state === "failed" || h.state === "retrying" || h.state === "incomplete") && (
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
