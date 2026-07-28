"use client";

/**
 * Action queue page (LIFEOS-036, Features 3, 4, 11, 12, 21). View tabs, sort, a
 * filter row, multi-select with the batch bar, keyboard navigation, a create
 * affordance, and templates. Queue memory (view/sort/filter/scroll) persists so
 * it restores after reload. Deferred actions whose date has arrived return to
 * Next on load. Query params drive entry points: ?new, ?start=next,
 * ?fromCapture=<id>, ?template=<id>.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useStore, returnDueActionsNow, toggleActionPin } from "@/lib/mvpStore";
import { deriveQueue, nextToStart, type ActionSort, type ActionFilter } from "@/lib/actions/queue";
import { ACTION_VIEWS, VIEW_LABEL, type ActionView } from "@/lib/actions/status";
import { inheritFromCapture, type NewActionInput } from "@/lib/actions/action";
import { readActionMemory, writeActionMemory } from "@/lib/actions/memory";
import ActionList from "@/components/actions/ActionList";
import ActionFilters from "@/components/actions/ActionFilters";
import ActionCreator from "@/components/actions/ActionCreator";
import ActionTemplatePicker from "@/components/actions/ActionTemplatePicker";
import BatchActionBar from "@/components/actions/BatchActionBar";

const SORTS: { key: ActionSort; label: string }[] = [
  { key: "manual", label: "Manual order" }, { key: "created", label: "Created" }, { key: "updated", label: "Updated" },
  { key: "deferred", label: "Deferred date" }, { key: "project", label: "Project" }, { key: "context", label: "Context" }, { key: "size", label: "Size" },
];

export default function ActionQueue() {
  const state = useStore();
  const router = useRouter();
  const search = useSearchParams();
  const mem = readActionMemory();

  const initialView = (search.get("view") as ActionView) && ACTION_VIEWS.includes(search.get("view") as ActionView) ? (search.get("view") as ActionView) : mem.view;
  const [view, setView] = useState<ActionView>(initialView);
  const [sort, setSort] = useState<ActionSort>(mem.sort);
  const [filter, setFilter] = useState<ActionFilter>(mem.filter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  // Entry-point query params drive the initial creator state (read once at mount).
  const fromCapture = search.get("fromCapture");
  const [creating, setCreating] = useState(search.get("new") === "1" || !!fromCapture);
  const [prefill, setPrefill] = useState<Partial<NewActionInput>>(() => fromCapture ? inheritFromCapture(state, fromCapture) : {});
  const [showTemplates, setShowTemplates] = useState(false);

  // Return due deferrals + honor ?start=next, once on mount (navigation only, no setState).
  useEffect(() => {
    returnDueActionsNow();
    if (search.get("start") === "next") { const n = nextToStart(state); if (n) router.replace(`/actions/${n.id}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { writeActionMemory({ view, sort, filter }); }, [view, sort, filter]);

  const queue = useMemo(() => deriveQueue(state, { view, sort, filter }), [state, view, sort, filter]);
  const deps = state.actionDependencies ?? [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = () => setSelected(new Set(queue.items.map((a) => a.id)));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Next actions</h1>
          <p className="mt-0.5 text-sm text-zinc-500">What can you concretely do next? You choose what matters — nothing is generated or prioritized for you.</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => { setPrefill({}); setCreating((v) => !v); }} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">+ New action</button>
        </div>
      </header>

      {creating && (
        <div className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
          <ActionCreator prefill={prefill} onCreated={(id) => { setCreating(false); setPrefill({}); router.push(`/actions/${id}`); }} onCancel={() => { setCreating(false); setPrefill({}); }} />
        </div>
      )}

      {/* View tabs. */}
      <nav aria-label="Action views" className="mb-3 -mx-1 flex gap-1 overflow-x-auto pb-1">
        {ACTION_VIEWS.map((v) => (
          <button key={v} type="button" onClick={() => { setView(v); setSelected(new Set()); setActiveIndex(0); }} data-view={v} aria-current={view === v ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${view === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]"}`}>
            {VIEW_LABEL[v]} <span className="opacity-60">· {queue.counts[v]}</span>
          </button>
        ))}
      </nav>

      <ActionFilters filter={filter} onChange={setFilter} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={sort} onChange={(e) => setSort(e.target.value as ActionSort)} aria-label="Sort" className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {queue.items.length > 0 && <button type="button" onClick={selected.size === queue.items.length ? () => setSelected(new Set()) : selectAll} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] dark:border-white/[.15]">{selected.size === queue.items.length ? "Clear" : "Select all"}</button>}
        <button type="button" onClick={() => setShowTemplates((v) => !v)} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] dark:border-white/[.15]">{showTemplates ? "Hide templates" : "Templates"}</button>
        {view === "next" && queue.items[0] && <Link href={`/actions/${queue.items[0].id}`} className="ml-auto rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] dark:border-white/[.15]">Start next →</Link>}
      </div>

      {showTemplates && (
        <div className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
          <ActionTemplatePicker onInstantiate={(pf) => { setPrefill(pf); setCreating(true); setShowTemplates(false); }} />
        </div>
      )}

      <ActionList items={queue.items} deps={deps} selected={selected} activeIndex={activeIndex} onToggle={toggle} onActiveIndex={setActiveIndex} onPin={toggleActionPin} />

      <BatchActionBar ids={[...selected]} onClear={() => setSelected(new Set())} />
    </main>
  );
}
