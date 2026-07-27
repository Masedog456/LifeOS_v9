"use client";

/**
 * Sync Reliability Center (LIFEOS-032, Feature 7).
 *
 * A System-facing view of the live, SANITIZED sync state: adapter, auth,
 * local/remote status, last successful sync, dirty domains, retry state, pending
 * local changes, and recent (sanitized) errors. Actions: Retry sync, Copy
 * diagnostics. No secrets, tokens, or document contents are ever shown. No
 * analytics.
 */

import { useSyncExternalStore, useState } from "react";
import { getHealth, subscribeHealth, retrySync } from "@/lib/persistence";
import { subscribeAuth, getAuth } from "@/lib/authStore";
import { syncDiagnostics, diagnosticsText } from "@/lib/ux/diagnostics";
import { toast } from "@/lib/ux/feedback";
import { loadJournal, journalDepth, oldestPending, clearCompleted, saveJournal } from "@/lib/sync/journal";
import { getSyncStatus } from "@/lib/sync/status-store";
import { lastRecoveryEvent } from "@/lib/sync/recovery";
import { CURRENT_STATE_VERSION } from "@/lib/migrations/state-version";

function useTick(): number {
  return useSyncExternalStore(
    (cb) => { const a = subscribeHealth(cb); const b = subscribeAuth(cb); return () => { a(); b(); }; },
    () => getHealth().state + getAuth().email,
    () => "server",
  ) as unknown as number;
}

export default function SyncDiagnostics() {
  useTick();
  const [copied, setCopied] = useState(false);
  const d = syncDiagnostics();

  const journal = typeof window !== "undefined" ? loadJournal() : [];
  const status = getSyncStatus();
  const recEvent = typeof window !== "undefined" ? lastRecoveryEvent() : null;
  const oldest = oldestPending(journal);
  const rows: { label: string; value: string }[] = [
    { label: "Adapter", value: d.adapter },
    { label: "Authenticated", value: d.authenticated ? `yes${d.authEmailMasked ? ` (${d.authEmailMasked})` : ""}` : "no" },
    { label: "Local save", value: d.localStatus === "ok" ? "ok" : `error — ${d.localError}` },
    { label: "Remote sync", value: d.remoteError ? `${d.remoteStatus} — ${d.remoteError}` : d.remoteStatus },
    { label: "Last successful sync", value: d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString() : "never" },
    { label: "Dirty domains", value: d.dirtyDomains.length ? d.dirtyDomains.join(", ") : "none" },
    { label: "Pending local changes", value: d.pendingLocalChanges ? "yes" : "no" },
    { label: "Retrying", value: d.retrying ? `yes (attempt ${d.retryAttempt ?? "?"})` : "no" },
    // LIFEOS-033 additions.
    { label: "Unresolved conflicts", value: String(status.conflicts.filter((c) => c.needsResolution).length) },
    { label: "Journal depth", value: String(journalDepth(journal)) },
    { label: "Oldest pending op", value: oldest ? `${oldest.domain}/${oldest.type} @ ${new Date(oldest.createdAt).toLocaleTimeString()}` : "none" },
    { label: "Skipped malformed records", value: recEvent ? String(recEvent.totalSkipped) : "0" },
    { label: "Recovery mode", value: status.recoveryMode ? "yes" : "no" },
    { label: "Local schema version", value: `v${CURRENT_STATE_VERSION}` },
  ];

  const copy = async () => {
    try { await navigator.clipboard.writeText(diagnosticsText(d)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast({ kind: "error", message: "Couldn’t copy diagnostics" }); }
  };

  return (
    <section aria-label="Sync diagnostics" className="rounded-xl border border-black/10 p-4 dark:border-white/12">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Sync reliability</h2>
        <div className="flex gap-2">
          {d.adapter === "supabase" && (
            <button type="button" onClick={() => { retrySync(); toast({ kind: "syncing", message: "Retrying sync…", dedupeKey: "sync-retry" }); }}
              className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Retry sync</button>
          )}
          <button type="button" onClick={copy} className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">{copied ? "Copied ✓" : "Copy diagnostics"}</button>
          <button type="button" onClick={() => { saveJournal(clearCompleted(loadJournal())); toast({ kind: "info", message: "Cleared completed journal entries" }); }} className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Clear journal</button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="contents"><dt className="text-zinc-400">{r.label}</dt><dd className="truncate text-zinc-700 dark:text-zinc-200" title={r.value}>{r.value}</dd></div>
        ))}
      </dl>
      {d.recentErrors.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Recent errors (sanitized)</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-rose-600 dark:text-rose-400">
            {d.recentErrors.slice(0, 4).map((e, i) => <li key={i} className="truncate" title={e.message}>{new Date(e.at).toLocaleTimeString()} — {e.message}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[10px] text-zinc-400">Diagnostics never include secrets, tokens, or document contents.</p>
    </section>
  );
}
