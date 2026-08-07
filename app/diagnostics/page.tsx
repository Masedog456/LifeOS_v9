"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { useStore } from "@/lib/mvpStore";
import { getSyncDiagnostics } from "@/lib/persistence";
import { buildGraph, graphIntegrity } from "@/lib/graph";
import { measureStore } from "@/lib/perf/profile";

const MIGRATIONS = [
  "0001_initial_schema", "0002_long_source_analysis", "0003_pdf_ingestion", "0004_retrieval",
  "0005_comparative_intelligence", "0006_dialectical_intelligence", "0007_megathreads",
  "0008_formation_engine", "0009_reasoning_engine", "0010_semantic_retrieval",
  "0011_decision_intelligence", "0012_reflective_practice", "0013_world_model",
  "0014_authoring_engine", "0015_research_workspace", "0016_graph_and_incremental_sync",
];

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-black/[.05] py-1.5 text-sm dark:border-white/[.06]">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Developer diagnostics (LIFEOS-021, Phase 8). Read-only, deterministic; shows
 * record counts, dirty domains, sync queue, graph size, integrity (orphan /
 * broken references, duplicate ids), hydration + migration status, and
 * performance metrics. Hidden outside development.
 */
export default function DiagnosticsPage() {
  const state = useStore();
  // Content is client-only: it renders measured timings and module-level sync
  // state that differ between server and client, so gate on mount to avoid a
  // hydration mismatch (fine for a dev tool). This idiom returns false during
  // SSR/hydration and true once on the client — no setState-in-effect.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const graph = useMemo(() => buildGraph(state), [state]);
  const integrity = useMemo(() => graphIntegrity(state, graph), [state, graph]);
  const perf = useMemo(() => measureStore(state), [state]);
  const sync = getSyncDiagnostics();

  const hydrated = perf.totalRecords > 0;
  const topDomains = Object.entries(perf.bytes.byDomain).sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 2).slice(0, 8);

  if (process.env.NODE_ENV === "production") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Diagnostics are available in development builds only.</p>
        <Link href="/" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Home</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1>
        <p className="mt-1 text-sm text-zinc-500">Developer-only. A snapshot of the store, graph, sync, and performance.</p>
      </header>
      {!mounted ? (
        <p className="text-sm text-zinc-400">Measuring…</p>
      ) : (
      <>

      <Section title="Overview">
        <Row label="Total records" value={perf.totalRecords} />
        <Row label="Store size (serialized)" value={bytes(perf.bytes.total)} />
        <Row label="Graph nodes" value={perf.graph.nodes} />
        <Row label="Graph edges" value={perf.graph.edges} />
        <Row label="Hydration status" value={hydrated ? "hydrated" : "empty / not hydrated"} />
      </Section>

      <Section title="Sync (incremental)">
        <Row label="Mode" value={sync.mode} />
        <Row label="Baseline established" value={String(sync.hasBaseline)} />
        <Row label="Flush queued" value={String(sync.queued)} />
        <Row label="Dirty domains" value={sync.dirtyDomains.length ? sync.dirtyDomains.join(", ") : "none"} />
      </Section>

      <Section title="Integrity">
        <Row label="Broken references" value={integrity.brokenReferences.length} />
        <Row label="Orphan records" value={integrity.orphanRecords.length} />
        <Row label="Duplicate ids" value={integrity.duplicateIds.length} />
        {integrity.brokenReferences.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
            {integrity.brokenReferences.slice(0, 8).map((e, i) => <li key={i}>{e.fromKind} → missing {e.to.slice(0, 8)}… ({e.relation})</li>)}
          </ul>
        )}
      </Section>

      <Section title="Performance (ms)">
        <Row label="Graph build" value={perf.timings.graphBuildMs} />
        <Row label="Graph lookup (all nodes)" value={perf.timings.graphLookupMs} />
        <Row label="Integrity scan" value={perf.timings.integrityMs} />
        <Row label="Timeline generation" value={perf.timings.timelineMs} />
        <Row label="Authoring assembly" value={perf.timings.authoringAssemblyMs} />
        <Row label="Research assembly" value={perf.timings.researchAssemblyMs} />
        <Row label="Full serialize" value={perf.timings.serializeMs} />
      </Section>

      <Section title="Largest domains">
        {topDomains.length === 0 ? <p className="text-sm text-zinc-500">No data yet.</p> : topDomains.map(([k, n]) => <Row key={k} label={k} value={`${perf.counts[k]} · ${bytes(n)}`} />)}
      </Section>

      <Section title="Migrations (expected order)">
        <ul className="flex flex-col gap-0.5 text-xs text-zinc-500">
          {MIGRATIONS.map((m, i) => <li key={m}><span className="font-mono">{String(i + 1).padStart(2, "0")}</span> — {m}</li>)}
        </ul>
        <p className="mt-1 text-[11px] text-zinc-400">Applied state is confirmed in Supabase, not from the client. This lists the expected sequence.</p>
      </Section>
      </>
      )}
    </main>
  );
}
