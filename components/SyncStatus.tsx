"use client";

/**
 * The sync status affordance (LIFEOS-076 §1–§4).
 *
 * ## What the audit found
 *
 * The old indicator was a bare `<span>`. On a phone the calm states were
 * `display: none`, so a person could not tell whether their life was in the
 * cloud or only on that handset (C-6). The single recovery control was a 30×16
 * px Retry (E-1). The only explanation of a failure lived in a `title` tooltip
 * — unreachable by touch, unreliable for screen readers, and it printed a
 * DOMAIN NAME, "goals failed" (E-3). There was no `role`, no `aria-live` and no
 * `aria-label`, so a screen-reader user was never told sync had failed (E-4).
 * And "Local save failed", the one state where the newest change may not
 * survive a refresh, offered no action at all (E-2).
 *
 * ## The shape now
 *
 * One button, everywhere, that opens a small popover.
 *
 *  - ALARMING states (local save failed, failed, incomplete, retrying) keep
 *    their label visible at every width. LIFEOS-074 D-21 established that and
 *    nothing here weakens it.
 *  - CALM states collapse to a dot-only button on a phone — a 44×44 tap target
 *    with a 8px dot inside it — instead of vanishing. Wide screens keep the
 *    full label, so nothing is lost where there is room.
 *  - The popover carries the detail that used to hide in a tooltip: what the
 *    state means in consequences, when this device last confirmed a sync, and
 *    the action that applies.
 *
 * No provider, table or domain vocabulary reaches any of it (§5). "Some changes
 * are only on this device" is the whole truth a person needs; which internal
 * domain failed stays in System Health for whoever is debugging.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import {
  canRetryLocalSave, getHealth, hasUnsyncedChanges, retryLocalSave, retrySync, subscribeHealth,
} from "@/lib/persistence";
import { formatLastSync } from "@/lib/sync/last-sync";
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

/**
 * The words have to answer one question: "is this only on this device, or is it
 * safely in the cloud?"
 *
 * They used to answer it backwards — local-only read "Saved locally" and
 * confirmed remote durability read "Saved", so the weaker state carried the
 * longer, more reassuring phrase. LIFEOS-075 fixed that; 076 keeps every one of
 * these distinct rather than collapsing them into "Up to date".
 */
const LABEL: Record<PersistenceHealth["state"], string> = {
  local: "Saved locally",
  disabled: "Saved locally",
  syncing: "Syncing…",
  synced: "Synced",
  incomplete: "Sync incomplete",
  failed: "Sync failed",
  offline: "Offline — saved locally",
  retrying: "Retrying…",
};

/**
 * What each state MEANS, in consequences.
 *
 * This is the replacement for `title="goals failed"`. A person cannot act on a
 * table name; they can act on "some of your changes are only on this device".
 */
const MEANING: Record<PersistenceHealth["state"], string> = {
  local: "Your work is saved on this device. It isn’t in the cloud, so it won’t appear on your other devices.",
  disabled: "Your work is saved on this device. It isn’t in the cloud, so it won’t appear on your other devices.",
  syncing: "Saving your latest changes to the cloud.",
  synced: "Your work is saved on this device and in the cloud, so you can pick it up anywhere.",
  incomplete: "Some changes are only on this device. The rest reached the cloud.",
  failed: "Your changes are safe on this device, but they haven’t reached the cloud.",
  offline: "You’re offline. Your work is saved on this device and will sync when you reconnect.",
  retrying: "Trying again to save your changes to the cloud. Everything is safe on this device.",
};

const ALARMING: PersistenceHealth["state"][] = ["failed", "retrying", "incomplete"];

export default function SyncStatus() {
  const h = useHealth();
  const [open, setOpen] = useState(false);
  const [localRetry, setLocalRetry] = useState<"idle" | "failed">("idle");
  const wrapRef = useRef<HTMLDivElement>(null);

  // When a sync fails before anything has ever synced, that is not an alarming
  // "error" — nothing was lost and everything is safe locally (LIFEOS-042A).
  const neverSynced = !h.lastSyncAt;
  const softFail = !h.localError && h.state === "failed" && neverSynced;
  const label = h.localError ? "Local save failed" : softFail ? "Not yet synced" : LABEL[h.state];
  const meaning = h.localError
    ? "Your latest change is not saved on this device yet. Don’t reload the page — try saving again first."
    : softFail
      ? "Your work is saved on this device. It hasn’t reached the cloud yet."
      : MEANING[h.state];
  const dot = h.localError ? "bg-red-500" : softFail ? "bg-zinc-400" : DOT[h.state];
  const alarming = !!h.localError || ALARMING.includes(h.state);
  const lastSync = formatLastSync(h.lastSyncAt);
  const unsynced = hasUnsyncedChanges();

  // Close on Escape and on a click outside — standard popover manners, and the
  // reason the trigger and panel share a wrapper.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  const doLocalRetry = useCallback(() => {
    // Only leaves the alarming state if a durable write actually happened —
    // `retryLocalSave` returns the real result and clears `localError` itself.
    setLocalRetry(retryLocalSave() ? "idle" : "failed");
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-sync-status={h.localError ? "local-error" : h.state}
        data-sync-alarming={alarming ? "true" : "false"}
        aria-expanded={open}
        aria-haspopup="dialog"
        // The label carries the state for assistive tech, so the colour of the
        // dot is never the only thing that says what is happening (§2).
        aria-label={`Sync status: ${label}. ${meaning}`}
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1.5 rounded-full text-xs text-zinc-400",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
          // A 44×44 tap target on a phone (§2 / E-1), collapsing to the compact
          // inline chip once there is room for it.
          "min-h-[44px] min-w-[44px] justify-center px-2 sm:min-h-0 sm:min-w-0 sm:justify-start sm:px-0",
          h.localError ? "text-red-600 dark:text-red-400" : "",
        ].join(" ")}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        {/* Calm states hide the WORDS on a phone, never the control itself. */}
        <span className={alarming ? "inline" : "hidden sm:inline"}>{label}</span>
        {h.state === "retrying" && h.retryAttempt ? (
          <span className={`text-[10px] ${alarming ? "inline" : "hidden sm:inline"}`}>({h.retryAttempt}/5)</span>
        ) : null}
      </button>

      {/*
        One polite live region, outside the button, so a state change is
        announced once without the button's own label being re-read on every
        render (§2 / E-4).
      */}
      <span aria-live="polite" className="sr-only" data-sync-live>{label}</span>

      {open && (
        <div
          role="dialog"
          aria-label="Sync status"
          data-sync-panel
          /*
           * Measured at 390px, the first version rendered at left:-186 — the
           * panel hung off the side of the phone, so half the durability answer
           * was unreadable on exactly the device C-6 exists for. On small
           * screens it is pinned to the viewport with its own insets; from `sm`
           * upward it returns to anchoring under the trigger.
           */
          className="fixed inset-x-2 top-14 z-50 rounded-xl border border-black/10 bg-white p-3 text-left shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-72 dark:border-white/15 dark:bg-zinc-900"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span data-sync-panel-label>{label}</span>
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500" data-sync-panel-meaning>{meaning}</p>

          {/* Only shown when it is genuinely known — never derived from now(). */}
          {lastSync && !h.localError && (
            <p className="mt-2 text-[11px] text-zinc-400" data-sync-last>Last synced {lastSync}</p>
          )}
          {unsynced && !h.localError && h.state !== "incomplete" && (
            <p className="mt-1 text-[11px] text-zinc-400" data-sync-pending>Some changes haven’t reached the cloud yet.</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {h.localError && canRetryLocalSave() && (
              <button
                type="button"
                data-sync-retry-local
                onClick={doLocalRetry}
                className="min-h-[36px] rounded-full border border-current px-3 text-xs font-medium text-red-600 dark:text-red-400"
              >
                Try saving again
              </button>
            )}
            {!h.localError && (h.state === "failed" || h.state === "retrying" || h.state === "incomplete") && (
              <button
                type="button"
                data-sync-retry
                onClick={() => { void retrySync(); }}
                className="min-h-[36px] rounded-full border border-black/[.15] px-3 text-xs font-medium dark:border-white/20"
              >
                Try again
              </button>
            )}
          </div>

          {localRetry === "failed" && (
            <p className="mt-2 text-[11px] text-red-600 dark:text-red-400" data-sync-local-retry-failed>
              Still couldn’t save on this device. Close another tab or remove a large item, then try again. Don’t reload — that would lose this change.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
