"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ResearchProject, ResearchStatus } from "@/types/mvp";
import {
  addResearchDefinition,
  addResearchItem,
  addResearchNote,
  removeResearchDefinition,
  removeResearchItem,
  removeResearchNote,
  researchProjectById,
  seedAuthorFromResearch,
  setResearchFields,
  toggleResearchEvidence,
  toggleResearchItemResolved,
  useStore,
} from "@/lib/mvpStore";
import { assembleEvidence, assemblyCount } from "@/lib/authoring/assembly";
import { detectResearchGaps } from "@/lib/research/gaps";
import { buildResearchTimeline } from "@/lib/research/timeline";
import { researchDeps } from "@/lib/freshness/fingerprint";
import { markResearchReviewed } from "@/lib/mvpStore";
import EvidencePicker, { ASSEMBLY_FIELDS, pickAssemblyItems } from "@/components/EvidencePicker";
import HypothesisList from "@/components/HypothesisList";
import ArgumentMap from "@/components/ArgumentMap";
import GapList from "@/components/GapList";
import ResearchTimeline from "@/components/ResearchTimeline";
import ResearchExportBar from "@/components/ResearchExportBar";
import FreshnessBadge from "@/components/FreshnessBadge";

const TABS = ["Overview", "Questions", "Evidence", "Hypotheses", "Arguments", "Timeline", "Gaps", "Export"] as const;
type Tab = (typeof TABS)[number];
const STATUSES: ResearchStatus[] = ["open", "investigating", "synthesizing", "concluded", "archived", "abandoned"];

type ItemField = "subquestions" | "unknowns" | "assumptions" | "successCriteria" | "openProblems";

function ItemList({ project, field, label }: { project: ResearchProject; field: ItemField; label: string }) {
  const [text, setText] = useState("");
  const items = project.questions[field];
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</h3>
      {items.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
              <button type="button" onClick={() => toggleResearchItemResolved(project.id, field, it.id)} className={`flex-1 text-left ${it.resolved ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-200"}`}>{it.text}</button>
              <button type="button" onClick={() => removeResearchItem(project.id, field, it.id)} className="text-[11px] text-zinc-400 hover:text-red-500">remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Add ${label.toLowerCase().replace(/s$/, "")}…`} className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/[.12]" />
        <button type="button" onClick={() => { if (text.trim()) { addResearchItem(project.id, field, text); setText(""); } }} disabled={!text.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-30 dark:border-white/[.15]">Add</button>
      </div>
    </div>
  );
}

export default function ResearchProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const state = useStore();
  const project = useMemo(() => researchProjectById(state, id), [state, id]);

  const [tab, setTab] = useState<Tab>("Overview");
  const [search, setSearch] = useState("");
  const [defTerm, setDefTerm] = useState("");
  const [defText, setDefText] = useState("");
  const [note, setNote] = useState("");

  const evidence = useMemo(() => (project ? assembleEvidence(state, project.assembly) : []), [state, project]);
  const gaps = useMemo(() => (project ? detectResearchGaps(state, project) : []), [state, project]);
  const timeline = useMemo(() => (project ? buildResearchTimeline(project) : []), [project]);
  const items = useMemo(() => pickAssemblyItems(state), [state]);

  if (!project) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Research project not found.</p>
        <Link href="/research" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Back to Research</Link>
      </main>
    );
  }
  const p: ResearchProject = project;

  function toAuthor() {
    const authorId = seedAuthorFromResearch(p.id);
    if (authorId) router.push(`/author/${authorId}`);
  }

  const filteredFields = search.trim()
    ? ASSEMBLY_FIELDS.map((f) => ({ ...f, items: items[f.field].filter((it) => it.label.toLowerCase().includes(search.trim().toLowerCase())) }))
    : ASSEMBLY_FIELDS.map((f) => ({ ...f, items: items[f.field] }));

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/research" className="text-sm text-zinc-400 underline-offset-4 hover:underline">← Research</Link>

      <header className="mb-6 mt-3">
        <input defaultValue={p.title} onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && setResearchFields(p.id, { title: e.target.value.trim() })} className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUSES.map((st) => (
            <button key={st} type="button" onClick={() => setResearchFields(p.id, { status: st })} className={`rounded-full px-2.5 py-1 text-[11px] ${p.status === st ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>{st}</button>
          ))}
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1.5 text-xs transition-colors ${tab === t ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}>
            {t}{t === "Gaps" && gaps.length > 0 && <span className="ml-1 text-amber-500">({gaps.length})</span>}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <section className="flex flex-col gap-5">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Primary question</h2>
            <textarea defaultValue={p.question} onBlur={(e) => e.target.value.trim() !== p.question && setResearchFields(p.id, { question: e.target.value.trim() })} rows={2} className="w-full resize-none rounded-lg border border-black/[.10] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.12]" />
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Description · Purpose · Scope</h2>
            <textarea defaultValue={p.description} onBlur={(e) => setResearchFields(p.id, { description: e.target.value.trim() })} rows={2} placeholder="Description…" className="w-full resize-none rounded-lg border border-black/[.10] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.12]" />
            <textarea defaultValue={p.purpose} onBlur={(e) => setResearchFields(p.id, { purpose: e.target.value.trim() })} rows={1} placeholder="Purpose…" className="mt-2 w-full resize-none rounded-lg border border-black/[.10] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.12]" />
            <textarea defaultValue={p.scope} onBlur={(e) => setResearchFields(p.id, { scope: e.target.value.trim() })} rows={1} placeholder="Scope…" className="mt-2 w-full resize-none rounded-lg border border-black/[.10] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.12]" />
          </div>
          <FreshnessBadge state={state} fingerprint={p.fingerprint} currentIds={researchDeps(p)} onRerun={() => markResearchReviewed(p.id)} approxAiCalls={0} />
          <div className="grid grid-cols-2 gap-2 text-sm text-zinc-500 sm:grid-cols-4">
            <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><span className="block text-lg font-semibold text-zinc-900 dark:text-zinc-100">{assemblyCount(p.assembly)}</span>evidence</div>
            <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><span className="block text-lg font-semibold text-zinc-900 dark:text-zinc-100">{p.hypotheses.length}</span>hypotheses</div>
            <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><span className="block text-lg font-semibold text-zinc-900 dark:text-zinc-100">{p.argumentNodes.length}</span>argument nodes</div>
            <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><span className="block text-lg font-semibold text-amber-600 dark:text-amber-400">{gaps.length}</span>gaps</div>
          </div>
          {/* Research → Author handoff */}
          <div className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Write it up</h2>
            <p className="mt-1 text-xs text-zinc-400">Seed the Authoring Engine with this project&apos;s evidence — the same records, no duplication. You direct the writing there.</p>
            {p.seededProjectId ? (
              <Link href={`/author/${p.seededProjectId}`} className="mt-2 inline-block text-sm underline-offset-4 hover:underline">Open the authoring project →</Link>
            ) : (
              <button type="button" onClick={toAuthor} className="mt-2 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Send to the Authoring Engine →</button>
            )}
          </div>
        </section>
      )}

      {tab === "Questions" && (
        <section className="flex flex-col gap-5">
          <ItemList project={p} field="subquestions" label="Subquestions" />
          <ItemList project={p} field="unknowns" label="Unknowns" />
          <ItemList project={p} field="assumptions" label="Assumptions" />
          <ItemList project={p} field="successCriteria" label="Success criteria" />
          <ItemList project={p} field="openProblems" label="Open problems" />
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Definitions</h3>
            {p.questions.definitions.length > 0 && (
              <ul className="mb-2 flex flex-col gap-1 text-sm">
                {p.questions.definitions.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-2"><span><span className="font-medium">{d.term}</span> — {d.definition}</span><button type="button" onClick={() => removeResearchDefinition(p.id, d.id)} className="text-[11px] text-zinc-400 hover:text-red-500">remove</button></li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input value={defTerm} onChange={(e) => setDefTerm(e.target.value)} placeholder="Term" className="w-1/3 rounded-lg border border-black/[.10] bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/[.12]" />
              <input value={defText} onChange={(e) => setDefText(e.target.value)} placeholder="Definition" className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/[.12]" />
              <button type="button" onClick={() => { if (defTerm.trim()) { addResearchDefinition(p.id, defTerm, defText); setDefTerm(""); setDefText(""); } }} disabled={!defTerm.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-30 dark:border-white/[.15]">Add</button>
            </div>
          </div>
        </section>
      )}

      {tab === "Evidence" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">Attach existing records — references only, never duplicated. {assemblyCount(p.assembly)} attached.</p>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter records…" className="mb-4 w-full rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
          <div className="flex flex-col gap-4 rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
            {filteredFields.map(({ field, label, items: fieldItems }) => (
              <EvidencePicker key={field} field={field} label={label} selected={p.assembly[field]} items={fieldItems} onToggle={(f, rid) => toggleResearchEvidence(p.id, f, rid)} />
            ))}
            {assemblyCount(p.assembly) === 0 && <p className="text-xs text-zinc-400">Nothing attached yet.</p>}
          </div>
          {/* Notes */}
          <div className="mt-6">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Notes</h3>
            {p.notes.length > 0 && (
              <ul className="mb-2 flex flex-col gap-1 text-sm">
                {p.notes.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-2"><span className="text-zinc-700 dark:text-zinc-300">{n.text}</span><button type="button" onClick={() => removeResearchNote(p.id, n.id)} className="text-[11px] text-zinc-400 hover:text-red-500">remove</button></li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a research note…" className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/[.12]" />
              <button type="button" onClick={() => { if (note.trim()) { addResearchNote(p.id, note); setNote(""); } }} disabled={!note.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-30 dark:border-white/[.15]">Add</button>
            </div>
          </div>
        </section>
      )}

      {tab === "Hypotheses" && <HypothesisList project={p} evidence={evidence} />}
      {tab === "Arguments" && <ArgumentMap project={p} evidence={evidence} />}
      {tab === "Timeline" && <ResearchTimeline items={timeline} />}
      {tab === "Gaps" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">Surfaced from your own records. Nothing is resolved for you — these are invitations to look.</p>
          <GapList gaps={gaps} />
        </section>
      )}
      {tab === "Export" && (
        <section>
          <p className="mb-3 text-xs text-zinc-400">A complete export of the whole investigation — questions, hypotheses, argument map, gaps, and evidence — with every source preserved as a numbered reference list.</p>
          <ResearchExportBar project={p} />
        </section>
      )}
    </main>
  );
}
