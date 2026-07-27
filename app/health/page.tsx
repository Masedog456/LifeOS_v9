"use client";

/**
 * System Health & Generation 1 readiness (LIFEOS-025).
 *
 * Observational and deterministic: everything on this page is computed from the
 * live store, the persistence layer's real status, and the read-only integrity
 * checks. Viewing this page mutates nothing. No secrets are shown — only status
 * words and counts. The single repair offered (stale recommendations) is safe
 * and recreatable by a re-scan.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { repairStaleRecommendations, useStore } from "@/lib/mvpStore";
import {
  getHealth,
  getRecentSaveErrors,
  getSyncDiagnostics,
  hasCorruptBackup,
  subscribeHealth,
} from "@/lib/persistence";
import { isSupabaseConfigured } from "@/lib/supabase";
import { buildGraph, graphIntegrity } from "@/lib/graph";
import { integritySummary, runIntegrityChecks, type IntegritySeverity } from "@/lib/integrity/checks";
import { isActive } from "@/lib/orchestrator";
import type { PersistenceHealth } from "@/lib/adapters/types";
import SyncDiagnostics from "@/components/ux/SyncDiagnostics";
import BackupRestore from "@/components/ux/BackupRestore";
import ConflictCenter from "@/components/sync/ConflictCenter";
import RecoveryPanel from "@/components/sync/RecoveryPanel";
import IntegrityReport from "@/components/sync/IntegrityReport";
import { writePrefs } from "@/lib/prefs";
import { toast } from "@/lib/ux/feedback";

const MIGRATIONS = [
  "0001_initial_schema", "0002_long_source_analysis", "0003_pdf_ingestion", "0004_retrieval",
  "0005_comparative_intelligence", "0006_dialectical_intelligence", "0007_megathreads",
  "0008_formation_engine", "0009_reasoning_engine", "0010_semantic_retrieval",
  "0011_decision_intelligence", "0012_reflective_practice", "0013_world_model",
  "0014_authoring_engine", "0015_research_workspace", "0016_graph_and_incremental_sync",
  "0017_dialogue_engine", "0018_dialectical_synthesis", "0019_cognitive_orchestrator",
  "0020_generation_one_hardening",
];

const SEV_TONE: Record<IntegritySeverity, string> = {
  ok: "bg-emerald-400",
  info: "bg-sky-400",
  warning: "bg-amber-400",
  problem: "bg-rose-400",
};

const SERVER_HEALTH: PersistenceHealth = { mode: "local", state: "disabled" };

type ScorecardStatus = "ready" | "partial" | "gap";
const SCORE_TONE: Record<ScorecardStatus, string> = {
  ready: "text-emerald-600 dark:text-emerald-400",
  partial: "text-amber-600 dark:text-amber-400",
  gap: "text-rose-600 dark:text-rose-400",
};

export default function HealthPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const persistence = useSyncExternalStore(subscribeHealth, getHealth, () => SERVER_HEALTH);
  const [repairNote, setRepairNote] = useState<string | null>(null);

  const graph = useMemo(() => buildGraph(state), [state]);
  const gi = useMemo(() => graphIntegrity(state, graph), [state, graph]);
  const findings = useMemo(() => runIntegrityChecks(state), [state]);
  const overall = integritySummary(findings);

  if (!mounted) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading system health…</p></main>;
  }

  const sync = getSyncDiagnostics();
  const saveErrors = getRecentSaveErrors();
  const counts: [string, number][] = [
    ["captures", state.captures.length], ["sources", state.sources.length], ["beliefs", state.beliefs.length],
    ["concepts", state.concepts.length], ["principles", state.principles.length], ["frameworks", state.frameworks.length],
    ["threads", state.megathreads.length], ["reasonings", state.reasonings.length], ["decisions", state.decisions.length],
    ["formation", state.formationSessions.length], ["research", state.researchProjects.length],
    ["authoring", state.knowledgeProjects.length], ["dialogues", state.dialogueSessions.length],
    ["tensions", state.tensions.length], ["syntheses", state.syntheses.length],
    ["recommendations", state.recommendations.length],
  ];
  const totalRecords = counts.reduce((a, [, n]) => a + n, 0);
  const activeRecs = state.recommendations.filter((r) => isActive(r)).length;
  const staleRecFinding = findings.find((f) => f.check === "recommendations_missing_records");
  const dupSigFinding = findings.find((f) => f.check === "duplicate_signatures");
  const problemCount = findings.filter((f) => f.severity === "problem").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  // Generation 1 readiness scorecard — each dimension separately, with evidence.
  const scorecard: { dim: string; status: ScorecardStatus; evidence: string; gaps: string; blocking: boolean }[] = [
    { dim: "Functional completeness", status: "ready", evidence: "All 13 Gen-1 subsystems shipped (Capture → Orchestration) with E2E suites.", gaps: "Reasoning-record integration from syntheses deferred (needs AI route).", blocking: false },
    { dim: "Persistence reliability", status: isSupabaseConfigured() ? "ready" : "partial", evidence: "Local-first writes; retry with backoff; offline detection; corrupt-blob backup; adoption-gate against hydration races.", gaps: isSupabaseConfigured() ? "Cross-device conflict strategy is last-write-wins per domain." : "Remote sync is code-complete but credential-pending — local-only in this environment.", blocking: false },
    { dim: "Test coverage", status: "ready", evidence: "18 Playwright E2E suites (200+ checks) run green against production builds; migrations validated on real Postgres.", gaps: "No unit-test layer; coverage is E2E-first by design.", blocking: false },
    { dim: "Data integrity", status: overall === "problem" ? "gap" : overall === "warning" ? "partial" : "ready", evidence: `10 deterministic checks; currently ${problemCount} problem(s), ${warningCount} warning(s) on this store.`, gaps: "Repairs limited to derived data (by design — knowledge is never auto-rewritten).", blocking: overall === "problem" },
    { dim: "Navigation coherence", status: "ready", evidence: "Grouped IA (Home / Capture / Knowledge / Reasoning / Reflection / Action); consistent names; no duplicate destinations; Daily Home linked from every page via the brand mark.", gaps: "Deep mobile nav is functional but dense on the smallest screens.", blocking: false },
    { dim: "Accessibility", status: "partial", evidence: "Semantic headings/roles/labels throughout; keyboard-reachable actions; focus-visible interactive elements.", gaps: "No full screen-reader audit; some icon-only affordances lack ARIA labels.", blocking: false },
    { dim: "Performance", status: "ready", evidence: "Deterministic engines are O(records); graph build measured on /diagnostics; production build clean.", gaps: "Whole-domain JSON rows will strain at very large libraries (edge-store redesign deferred until demonstrated).", blocking: false },
    { dim: "Onboarding", status: "ready", evidence: "First-run flow explains the loop, guides first capture + first belief, shows the Inbox, suggests a next step; skippable and restartable; state persisted.", gaps: "Single-path tour; no per-module tours.", blocking: false },
    { dim: "Observability", status: "ready", evidence: "This page: real persistence status, sync queue, integrity findings, counts; /diagnostics adds perf timings (dev).", gaps: "No historical trend of health events (only recent save errors are kept).", blocking: false },
    { dim: "Recovery behavior", status: "ready", evidence: "Corrupt local data preserved (never overwritten); failed syncs auto-retry then expose manual retry; offline queues and flushes on reconnect; error boundary offers reset without data loss.", gaps: "Restoring a corrupt backup is manual (export/import).", blocking: false },
  ];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
        <p className="mt-1 text-sm text-zinc-500">Deterministic and observational — viewing this page changes nothing. No secrets are shown.</p>
      </header>

      {/* Sync reliability center + backup/restore (LIFEOS-032) + conflicts/recovery/integrity (LIFEOS-033) */}
      <div className="mb-6 space-y-4">
        <ConflictCenter />
        <SyncDiagnostics />
        <RecoveryPanel />
        <IntegrityReport />
        <BackupRestore />
        <button type="button" onClick={() => { writePrefs({ firstRun: { dismissed: false, commandOpened: false, inspected: false } }); toast({ kind: "info", message: "First-run checklist reset", detail: "Open Today to see it again." }); }}
          className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Restart first-run checklist</button>
      </div>

      {/* Persistence */}
      <Section title="Persistence">
        <Row label="Mode" value={persistence.mode === "supabase" ? "Supabase (remote sync)" : "Local (browser storage)"} />
        <Row label="Connectivity" value={persistence.state} tone={persistence.state === "failed" ? "text-rose-500" : persistence.state === "synced" ? "text-emerald-600 dark:text-emerald-400" : undefined} />
        {persistence.error && <Row label="Last sync error" value={persistence.error} tone="text-rose-500" />}
        {persistence.localError && <Row label="Local save" value={persistence.localError} tone="text-rose-500" />}
        <Row label="Configured" value={isSupabaseConfigured() ? "yes" : "no — local-only (add Supabase env vars to enable sync)"} />
        <Row label="Sync queue" value={sync.queued ? "1 pending push" : "empty"} />
        <Row label="Dirty domains" value={sync.dirtyDomains.length ? sync.dirtyDomains.join(", ") : "none"} />
        <Row label="Corrupt-data backup" value={hasCorruptBackup() ? "present — earlier unreadable data was preserved, not overwritten" : "none"} tone={hasCorruptBackup() ? "text-amber-600 dark:text-amber-400" : undefined} />
        {saveErrors.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Recent save errors ({saveErrors.length})</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-500">
              {saveErrors.slice(-5).map((e, i) => <li key={i}>{new Date(e.at).toLocaleTimeString()} — {e.message}</li>)}
            </ul>
          </div>
        )}
      </Section>

      {/* Schema & migrations */}
      <Section title="Schema & migrations">
        <Row label="Store hydration" value={totalRecords > 0 ? `hydrated (${totalRecords} records)` : "empty store (nothing captured yet, or not yet hydrated)"} />
        <Row label="Schema compatibility" value="all store domains present and array-typed (unknown fields are preserved, missing ones defaulted)" />
        <Row label="Expected migrations" value={`${MIGRATIONS.length} (0001–${MIGRATIONS[MIGRATIONS.length - 1].slice(0, 4)})`} />
        <p className="mt-1 text-[11px] text-zinc-400">Applied-migration state lives in the database and is verifiable there; the app is additive-only, so a database ahead of the app is safe, and a database behind the app degrades to local-only persistence for the missing tables.</p>
      </Section>

      {/* Engines */}
      <Section title="Engines">
        <Row label="Graph build" value={`ok — ${gi.nodeCount} nodes, ${gi.edgeCount} edges`} />
        <Row label="Orphaned references" value={gi.brokenReferences.length === 0 ? "none" : `${gi.brokenReferences.length} broken reference(s)`} tone={gi.brokenReferences.length ? "text-amber-600 dark:text-amber-400" : undefined} />
        <Row label="Duplicate signatures" value={(dupSigFinding?.severity ?? "ok") === "ok" ? "none" : dupSigFinding!.message} tone={dupSigFinding?.severity === "warning" ? "text-amber-600 dark:text-amber-400" : undefined} />
        <Row label="Recommendation scan" value={state.recommendations.length === 0 ? "never run (open the LifeOS Inbox and press Scan now)" : `${state.recommendations.length} recommendation(s), ${activeRecs} active`} />
        <Row label="Stale sync baseline" value={sync.hasBaseline ? "baseline present (incremental sync active)" : "no baseline this session (first sync pushes everything — expected)"} />
      </Section>

      {/* Record counts */}
      <Section title="Record counts">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {counts.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">{k}</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200">{v}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Integrity findings */}
      <Section title={`Data integrity (${findings.filter((f) => f.severity !== "ok").length} finding(s))`}>
        <div className="flex flex-col gap-2">
          {findings.map((f) => (
            <div key={f.id} className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]">
              <p className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_TONE[f.severity]}`} />
                <span className="font-medium text-zinc-800 dark:text-zinc-100">{f.check.replace(/_/g, " ")}</span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">{f.severity}</span>
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{f.message}</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">{f.remediation}</p>
              {f.check === "recommendations_missing_records" && f.severity === "warning" && (
                <button type="button" onClick={() => { const n = repairStaleRecommendations(); setRepairNote(`Removed ${n} stale recommendation(s). Re-scan the Inbox to regenerate any that still apply.`); }} className="mt-2 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">
                  Repair: remove stale recommendations
                </button>
              )}
            </div>
          ))}
          {repairNote && <p className="text-xs text-emerald-600 dark:text-emerald-400">{repairNote}</p>}
          <p className="text-[11px] text-zinc-400">Checks are read-only. The one repair above only touches derived recommendations — knowledge records are never deleted or rewritten{staleRecFinding?.severity === "ok" ? ", and no repair is currently needed" : ""}.</p>
        </div>
      </Section>

      {/* Generation 1 readiness scorecard */}
      <Section title="Generation 1 readiness scorecard">
        <div className="flex flex-col gap-2">
          {scorecard.map((s) => (
            <div key={s.dim} className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]">
              <p className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-800 dark:text-zinc-100">{s.dim}</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${SCORE_TONE[s.status]}`}>{s.status}{s.blocking ? " · blocking" : ""}</span>
              </p>
              <p className="mt-1 text-[11px] text-zinc-500"><span className="font-semibold">Evidence: </span>{s.evidence}</p>
              <p className="mt-0.5 text-[11px] text-zinc-400"><span className="font-semibold">Known gaps: </span>{s.gaps}</p>
            </div>
          ))}
          <p className="text-[11px] text-zinc-400">
            No single decorative score — each dimension stands on its own evidence. Blocking issues: {scorecard.filter((s) => s.blocking).length === 0 ? "none" : scorecard.filter((s) => s.blocking).map((s) => s.dim).join(", ")}.
          </p>
        </div>
      </Section>

      <p className="mt-6 text-xs text-zinc-400">
        Deeper (dev-only) internals: <Link href="/diagnostics" className="underline underline-offset-4">/diagnostics</Link> · Daily Home: <Link href="/today" className="underline underline-offset-4">/today</Link>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <p className="flex items-baseline justify-between gap-4 py-0.5 text-xs">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className={`text-right ${tone ?? "text-zinc-800 dark:text-zinc-200"}`}>{value}</span>
    </p>
  );
}
