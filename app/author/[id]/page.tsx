"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { KnowledgeProject, ProjectStatus } from "@/types/mvp";
import {
  addProjectSection,
  chooseProjectOutline,
  getStoreSnapshot,
  knowledgeProjectById,
  markProjectReviewed,
  setProjectFields,
  setProjectOutlines,
  toggleProjectEvidence,
  useStore,
} from "@/lib/mvpStore";
import { runOutlineGeneration, projectKindLabel } from "@/lib/authoring/outline";
import { assemblyCount } from "@/lib/authoring/assembly";
import { citationCoverage, unsupportedAcrossProject } from "@/lib/authoring/citations";
import { projectDeps } from "@/lib/freshness/fingerprint";
import AuthoringSection from "@/components/AuthoringSection";
import ExportBar from "@/components/ExportBar";
import FreshnessBadge from "@/components/FreshnessBadge";
import EvidencePicker, { ASSEMBLY_FIELDS, pickAssemblyItems } from "@/components/EvidencePicker";

const STATUSES: ProjectStatus[] = ["planning", "outlining", "drafting", "revising", "complete", "archived"];

function snippet(s: string, n = 44): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export default function AuthorProjectPage() {
  const { id } = useParams<{ id: string }>();
  const state = useStore();
  const project = useMemo(() => knowledgeProjectById(state, id), [state, id]);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");

  const items = useMemo(() => pickAssemblyItems(state), [state]);
  const coverage = useMemo(() => (project ? citationCoverage(state, project) : null), [state, project]);
  const unsupported = useMemo(() => (project ? unsupportedAcrossProject(project) : []), [project]);

  if (!project) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Project not found.</p>
        <Link href="/author" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Back to Author</Link>
      </main>
    );
  }
  const p: KnowledgeProject = project;

  async function generate() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await runOutlineGeneration(getStoreSnapshot(), p);
      setProjectOutlines(p.id, r.options, r.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outline generation failed.");
    } finally {
      setRunning(false);
    }
  }

  const sortedSections = [...p.sections].sort((a, b) => a.order - b.order);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/author" className="text-sm text-zinc-400 underline-offset-4 hover:underline">← Author</Link>

      <header className="mb-6 mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{projectKindLabel(p.kind)}</p>
        <input defaultValue={p.title} onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && setProjectFields(p.id, { title: e.target.value.trim() })} className="mt-1 w-full bg-transparent text-2xl font-semibold tracking-tight outline-none" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUSES.map((st) => (
            <button key={st} type="button" onClick={() => setProjectFields(p.id, { status: st })} className={`rounded-full px-2.5 py-1 text-[11px] ${p.status === st ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>{st}</button>
          ))}
        </div>
      </header>

      {/* Assembly */}
      <section className="mb-8">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">1 · Assemble evidence</h2>
        <p className="mb-3 text-xs text-zinc-400">Choose what this work draws on. Everything keeps provenance; {assemblyCount(p.assembly)} record{assemblyCount(p.assembly) === 1 ? "" : "s"} assembled.</p>
        <div className="flex flex-col gap-4 rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
          {ASSEMBLY_FIELDS.map(({ field, label }) => (
            <EvidencePicker key={field} field={field} label={label} selected={p.assembly[field]} items={items[field]} onToggle={(f, rid) => toggleProjectEvidence(p.id, f, rid)} />
          ))}
          {assemblyCount(p.assembly) === 0 && <p className="text-xs text-zinc-400">Nothing assembled yet — select records above (or add some elsewhere in LifeOS first).</p>}
        </div>
      </section>

      {/* Outlines */}
      <section className="mb-8">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">2 · Choose an outline</h2>
        <p className="mb-3 text-xs text-zinc-400">Several structures are proposed from your evidence. Compare and pick one — nothing is chosen for you.</p>
        <button type="button" onClick={generate} disabled={running} className="mb-3 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
          {running ? "Generating…" : p.outlineOptions.length ? "Regenerate outlines" : "Generate outlines"}
        </button>
        {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {p.outlineOptions.length > 0 && (
          <div className="flex flex-col gap-3">
            {p.outlineOptions.map((o) => (
              <div key={o.id} className={`rounded-2xl border p-4 ${p.chosenOutlineId === o.id ? "border-zinc-900 dark:border-zinc-100" : "border-black/[.06] dark:border-white/[.08]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{o.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">{o.rationale} · {o.source}</p>
                  </div>
                  <button type="button" onClick={() => chooseProjectOutline(p.id, o.id)} disabled={p.sections.length > 0 && p.chosenOutlineId !== o.id} title={p.sections.length > 0 && p.chosenOutlineId !== o.id ? "Already drafting — remove sections to switch" : ""} className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-30 dark:border-white/[.15]">
                    {p.chosenOutlineId === o.id ? "Chosen" : "Choose"}
                  </button>
                </div>
                <ol className="mt-2 list-decimal pl-5 text-xs text-zinc-500">
                  {o.sections.map((s, i) => <li key={i}>{s.heading}</li>)}
                </ol>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sections */}
      {p.sections.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">3 · Draft, one section at a time</h2>
          <div className="mb-3">
            <FreshnessBadge state={state} fingerprint={p.fingerprint} currentIds={projectDeps(p)} onRerun={() => markProjectReviewed(p.id)} approxAiCalls={0} />
          </div>
          <div className="flex flex-col gap-4">
            {sortedSections.map((s) => <AuthoringSection key={s.id} project={p} section={s} />)}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="Add a section…" className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
            <button type="button" onClick={() => { if (newSection.trim()) { addProjectSection(p.id, newSection); setNewSection(""); } }} disabled={!newSection.trim()} className="rounded-full border border-black/[.12] px-4 py-2 text-sm disabled:opacity-30 dark:border-white/[.15]">Add</button>
          </div>
        </section>
      )}

      {/* Citations */}
      {p.sections.some((s) => s.paragraphs.length > 0) && coverage && (
        <section className="mb-8">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Citations</h2>
          <p className="text-xs text-zinc-400">{coverage.used} of {coverage.assembled} assembled records cited · {unsupported.length} unsupported paragraph{unsupported.length === 1 ? "" : "s"}.</p>
          {unsupported.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
              {unsupported.slice(0, 8).map((u) => <li key={u.paragraphId}>In “{u.heading}”: {snippet(u.text, 80)}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* Export */}
      <section className="mb-8">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">4 · Export</h2>
        <p className="mb-2 text-xs text-zinc-400">Export in any format — citations preserved as a numbered reference list every time.</p>
        <ExportBar project={p} />
      </section>

      {/* Project history */}
      {p.history.length > 0 && (
        <section className="text-xs text-zinc-400">
          <h2 className="mb-1 font-semibold uppercase tracking-wide">History</h2>
          <ul className="flex flex-col gap-0.5">
            {[...p.history].reverse().slice(0, 15).map((h, i) => <li key={i}>{new Date(h.at).toLocaleDateString()} — {h.note} ({h.source})</li>)}
          </ul>
        </section>
      )}
    </main>
  );
}
