"use client";

/**
 * Diagnostics Center (LIFEOS-040, Feature 11).
 *
 * User-visible, SANITIZED diagnostics: versions, sync state, pending mutations,
 * conflicts, storage, connectivity, auth category. Copy/download a sanitized
 * report. No record contents, tokens, or raw payloads ever appear here.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/authStore";
import { getHealth, getSyncDiagnostics, getLastSyncAt } from "@/lib/persistence";
import { getSyncStatus } from "@/lib/sync/status-store";
import { buildDiagnostics, serializeDiagnostics } from "@/lib/security/diagnostics";
import { evaluateCompatibility } from "@/lib/security/schema-compatibility";
import { probeStorage } from "@/lib/security/storage-resilience";
import { categorize } from "@/lib/security/auth-boundaries";
import { CURRENT_STATE_VERSION } from "@/lib/migrations/state-version";
import { EXPECTED_MIGRATION_VERSION } from "@/lib/security/schema-compatibility";
import { RELEASE_APP_VERSION } from "@/lib/release/versions";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? RELEASE_APP_VERSION;
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 text-[13px]"><span className="text-zinc-500">{k}</span><span className="tabular-nums text-zinc-800 dark:text-zinc-100">{v}</span></div>;
}

export default function DiagnosticsCenter() {
  const auth = useAuth();
  const [copied, setCopied] = useState(false);
  // Diagnostics read live persistence/auth/storage state and a generation
  // timestamp — all client-only. Compute AFTER mount so SSR and the first client
  // render match (no hydration mismatch).
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const snapshot = useMemo(() => {
    if (!mounted) return null;
    let health, diag, conflicts = 0, storageStatus = "unknown", lastSync: string | null = null;
    try { health = getHealth(); } catch { health = { mode: "local" as const, state: "unknown" }; }
    try { diag = getSyncDiagnostics(); } catch { diag = { dirtyDomains: [] as string[], pendingLocalChanges: false }; }
    try { conflicts = getSyncStatus().conflicts.filter((c) => c.needsResolution).length; } catch { /* none */ }
    try { storageStatus = probeStorage().status; } catch { /* n/a */ }
    try { lastSync = getLastSyncAt(); } catch { /* n/a */ }
    const compat = evaluateCompatibility({ localStateVersion: CURRENT_STATE_VERSION, remoteMigrationVersion: health?.mode === "supabase" ? EXPECTED_MIGRATION_VERSION : null });
    return buildDiagnostics({
      appVersion: APP_VERSION, buildId: BUILD_ID, stateSchemaVersion: CURRENT_STATE_VERSION, migrationVersion: EXPECTED_MIGRATION_VERSION,
      compat, authCategory: categorize({ loading: auth.loading, email: auth.email }), authEmail: auth.email,
      adapter: health?.mode ?? "local", remoteReachable: health?.mode === "supabase" ? (health?.state !== "failed" && health?.state !== "offline") : null,
      lastSyncAt: lastSync, pendingMutations: diag?.dirtyDomains?.length ?? 0, dirtyDomains: diag?.dirtyDomains ?? [],
      unresolvedConflicts: conflicts, storageStatus,
    });
  }, [auth, mounted]);

  const report = snapshot ? serializeDiagnostics(snapshot) : "";
  const onCopy = async () => { try { await navigator.clipboard.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard optional */ } };
  const onDownload = () => { if (!snapshot) return; const b = new Blob([report], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `lifeos-diagnostics-${snapshot.generatedAt.slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };

  if (!snapshot) return <div className="flex flex-col gap-4" data-diagnostics-center><p className="text-sm text-zinc-400">Loading diagnostics…</p></div>;

  return (
    <div className="flex flex-col gap-4" data-diagnostics-center>
      <section className="divide-y divide-black/[.05] rounded-2xl border border-black/[.06] p-4 dark:divide-white/[.06] dark:border-white/[.08]">
        <Row k="App version" v={snapshot.app.version} />
        <Row k="Build" v={snapshot.app.buildId} />
        <Row k="Schema version" v={snapshot.app.stateSchemaVersion} />
        <Row k="Migration version" v={snapshot.app.migrationVersion} />
        <Row k="Compatibility" v={snapshot.compatibility?.mode ?? "—"} />
        <Row k="Auth" v={snapshot.auth.category + (snapshot.auth.emailMasked ? ` · ${snapshot.auth.emailMasked}` : "")} />
        <Row k="Adapter" v={snapshot.sync.adapter} />
        <Row k="Remote reachable" v={snapshot.sync.remoteReachable == null ? "local-only" : String(snapshot.sync.remoteReachable)} />
        <Row k="Last sync" v={snapshot.sync.lastSyncAt ?? "—"} />
        <Row k="Pending mutations" v={snapshot.sync.pendingMutations} />
        <Row k="Unresolved conflicts" v={snapshot.sync.unresolvedConflicts} />
        <Row k="Storage" v={snapshot.storage.status} />
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCopy} data-copy-diagnostics className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">{copied ? "Copied" : "Copy sanitized report"}</button>
        <button type="button" onClick={onDownload} data-download-diagnostics className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Download report</button>
        <Link href="/backup" className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Export tools</Link>
        <Link href="/recovery" className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Recovery tools</Link>
      </div>
      <p className="text-[12px] text-zinc-400">This report contains no record contents, tokens, or private URLs.</p>
    </div>
  );
}
