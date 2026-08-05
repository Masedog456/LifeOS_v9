"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { FrameworkKind, WorldProposal } from "@/types/mvp";
import {
  createConcept,
  createFramework,
  createPrinciple,
  getStoreSnapshot,
  toggleFrameworkConcept,
  useStore,
} from "@/lib/mvpStore";
import { runWorldProposals, estimateWorldProposals } from "@/lib/world/run";
import { detectTensions } from "@/lib/world/tensions";
import { buildWorldTimeline } from "@/lib/world/timeline";
import TensionList from "@/components/TensionList";
import WorldTimeline from "@/components/WorldTimeline";

const TABS = ["Concepts", "Frameworks", "Principles", "Tensions", "Review", "Timeline"] as const;
type Tab = (typeof TABS)[number];
const FRAMEWORK_KINDS: FrameworkKind[] = ["framework", "tradition", "school", "paradigm", "map"];

function snippet(s: string, n = 70): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function ProposalCard({ p }: { p: WorldProposal }) {
  const [done, setDone] = useState<string | null>(null);
  const state = useStore();

  function act() {
    if (p.kind === "new_concept" && p.concepts[0]) {
      createConcept({ name: p.concepts[0], relatedSources: p.citations, source: "ai" });
      setDone("Concept created — open it to define and relate it.");
    } else if (p.kind === "possible_principle") {
      createPrinciple({ statement: p.suggestion || p.statement, citations: p.citations, source: "ai" });
      setDone("Principle created.");
    } else if (p.kind === "worldview_cluster") {
      createFramework({ name: "New framework", kind: "framework", source: "ai" });
      setDone("Framework created — add concepts to it under Frameworks.");
    } else {
      setDone("Reviewed.");
    }
  }

  const conceptForDef = p.kind === "missing_definition" ? state.concepts.find((c) => c.id === p.concepts[0]) : undefined;

  return (
    <li className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{p.kind.replace(/_/g, " ")}</p>
      <p className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200">{p.statement}</p>
      {p.suggestion && <p className="mt-1 text-xs text-zinc-500">Suggestion: {p.suggestion}</p>}
      {done ? (
        <p className="mt-2 text-xs text-zinc-400">{done}</p>
      ) : conceptForDef ? (
        <Link href={`/world/concept/${conceptForDef.id}`} className="mt-2 inline-block text-xs underline-offset-4 hover:underline">Open concept to define →</Link>
      ) : (p.kind === "new_concept" || p.kind === "possible_principle" || p.kind === "worldview_cluster") ? (
        <div className="mt-2 flex gap-2 text-[11px]">
          <button type="button" onClick={act} className="rounded-full border border-black/[.12] px-2.5 py-1 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">
            {p.kind === "new_concept" ? "Create concept" : p.kind === "possible_principle" ? "Create principle" : "Create framework"}
          </button>
          <button type="button" onClick={() => setDone("Dismissed.")} className="rounded-full px-2.5 py-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Dismiss</button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-400">Review the concepts involved and relate them yourself under each concept.</p>
      )}
    </li>
  );
}

function WorldWorkspace() {
  const params = useSearchParams();
  const state = useStore();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "Concepts");

  const [conceptName, setConceptName] = useState(params.get("name") ?? "");
  const [fwName, setFwName] = useState("");
  const [fwKind, setFwKind] = useState<FrameworkKind>("framework");
  const [prinText, setPrinText] = useState("");

  const [proposals, setProposals] = useState<WorldProposal[] | null>(null);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [propSource, setPropSource] = useState<string | null>(null);

  const tensions = useMemo(() => detectTensions(state), [state]);
  const timeline = useMemo(() => buildWorldTimeline(state), [state]);
  const est = useMemo(() => estimateWorldProposals(state), [state]);

  async function runProposals() {
    if (running) return;
    setRunning(true);
    try {
      const r = await runWorldProposals(getStoreSnapshot());
      setProposals(r.proposals);
      setFlagged(r.flagged);
      setPropSource(r.source);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Your evolving map of reality — concepts, the relationships between them, reusable principles,
          and the frameworks that organize them. Deterministic and human-reviewed: nothing is inferred
          silently, and nothing changes a belief for you.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
              tab === t ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {t}
            {t === "Tensions" && tensions.length > 0 && <span className="ml-1 text-amber-500">({tensions.length})</span>}
          </button>
        ))}
      </div>

      {tab === "Concepts" && (
        <section>
          <div className="mb-5 flex gap-2">
            <input value={conceptName} onChange={(e) => setConceptName(e.target.value)} placeholder="New concept (e.g. Non-duality)" className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12] dark:focus:border-white/[.30]" />
            <button type="button" onClick={() => { if (conceptName.trim()) { createConcept({ name: conceptName }); setConceptName(""); } }} disabled={!conceptName.trim()} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Create</button>
          </div>
          {state.concepts.length === 0 ? (
            <p className="text-sm text-zinc-500">No concepts yet. Create one above, or use Review to surface candidates from your material.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {state.concepts.map((c) => (
                <li key={c.id}>
                  <Link href={`/world/concept/${c.id}`} className="flex items-start gap-3 py-3">
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                      <span className="mt-0.5 block text-xs text-zinc-400">
                        {c.definition ? snippet(c.definition, 80) : "No definition yet"}
                        {" · "}{c.status}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "Frameworks" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">Frameworks organize concepts — they never own beliefs. A tradition, school, paradigm, or map you build.</p>
          <div className="mb-5 flex flex-wrap gap-2">
            <select value={fwKind} onChange={(e) => setFwKind(e.target.value as FrameworkKind)} className="rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.15]">
              {FRAMEWORK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={fwName} onChange={(e) => setFwName(e.target.value)} placeholder="Name (e.g. Stoicism)" className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
            <button type="button" onClick={() => { if (fwName.trim()) { createFramework({ name: fwName, kind: fwKind }); setFwName(""); } }} disabled={!fwName.trim()} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Create</button>
          </div>
          {state.frameworks.length === 0 ? (
            <p className="text-sm text-zinc-500">No frameworks yet.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {state.frameworks.map((f) => (
                <li key={f.id} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400">{f.kind}</p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{f.name}</p>
                  <p className="mt-1 text-xs text-zinc-400">Organizes {f.conceptIds.length} concept{f.conceptIds.length === 1 ? "" : "s"}.</p>
                  {state.concepts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {state.concepts.map((c) => (
                        <button key={c.id} type="button" onClick={() => toggleFrameworkConcept(f.id, c.id)} className={`rounded-full px-2.5 py-1 text-[11px] ${f.conceptIds.includes(c.id) ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] text-zinc-500 dark:border-white/[.15]"}`}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "Principles" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">Reusable principles. A principle may support many beliefs; a belief may derive from many principles.</p>
          <div className="mb-5 flex gap-2">
            <input value={prinText} onChange={(e) => setPrinText(e.target.value)} placeholder="e.g. Awareness precedes interpretation." className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
            <button type="button" onClick={() => { if (prinText.trim()) { createPrinciple({ statement: prinText }); setPrinText(""); } }} disabled={!prinText.trim()} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Create</button>
          </div>
          {state.principles.length === 0 ? (
            <p className="text-sm text-zinc-500">No principles yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {state.principles.map((p) => (
                <li key={p.id} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
                  <p className="text-sm text-zinc-900 dark:text-zinc-100">{p.statement}</p>
                  <p className="mt-1 text-xs text-zinc-400">Supports {p.beliefIds.length} belief{p.beliefIds.length === 1 ? "" : "s"} · in {p.conceptIds.length} concept{p.conceptIds.length === 1 ? "" : "s"}.</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "Tensions" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">Surfaced deterministically. Nothing is resolved for you — these are invitations to look.</p>
          <TensionList tensions={tensions} />
        </section>
      )}

      {tab === "Review" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">Proposals from your own material — deterministic first, then one AI pass. Everything here is reviewable; nothing is applied automatically.</p>
          <button type="button" onClick={runProposals} disabled={running} className="mb-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
            {running ? "Analyzing…" : `Suggest concepts & links (~1 AI · ${est.evidenceCount} records)`}
          </button>
          {propSource && <span className="ml-2 text-xs text-zinc-400">Source: {propSource === "ai" ? "AI" : "offline (mock)"}</span>}
          {flagged.length > 0 && (
            <ul className="mb-3 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{flagged.map((f, i) => <li key={i}>{f}</li>)}</ul>
          )}
          {proposals && proposals.length === 0 && <p className="text-sm text-zinc-500">No proposals right now — add more material or concepts first.</p>}
          {proposals && proposals.length > 0 && (
            <ul className="flex flex-col gap-3">{proposals.map((p, i) => <ProposalCard key={i} p={p} />)}</ul>
          )}
        </section>
      )}

      {tab === "Timeline" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">How your understanding evolved — read-only, chronological.</p>
          <WorldTimeline items={timeline} />
        </section>
      )}
    </main>
  );
}

export default function WorldPage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12" />}>
      <WorldWorkspace />
    </Suspense>
  );
}
