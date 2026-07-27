"use client";

/**
 * Inbox page (LIFEOS-035, Feature 2). The processing queue: view tabs, sort, a
 * text filter, multi-select with the batch action bar, and keyboard navigation.
 * Queue memory (view/sort/filter/scroll) is persisted so it restores after
 * reload. Deferred captures whose date has arrived return to the inbox on load.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useStore, returnDueCaptures } from "@/lib/mvpStore";
import { deriveQueue, nextToProcess, type QueueSort } from "@/lib/inbox/queue";
import { QUEUE_VIEWS, type QueueView } from "@/lib/inbox/capture-status";
import { readInboxMemory, writeInboxMemory } from "@/lib/inbox/memory";
import InboxQueue from "@/components/inbox/InboxQueue";
import BatchActionBar from "@/components/inbox/BatchActionBar";

const SORTS: { key: QueueSort; label: string }[] = [
  { key: "newest", label: "Newest" }, { key: "oldest", label: "Oldest" }, { key: "source", label: "Source" },
  { key: "workspace", label: "Workspace" }, { key: "project", label: "Project" }, { key: "deferred", label: "Deferred date" },
];
const VIEW_LABEL: Record<QueueView, string> = { inbox: "Inbox", processing: "Processing", deferred: "Deferred", processed: "Processed", archived: "Archived" };

export default function InboxPage() {
  const state = useStore();
  const router = useRouter();
  const search = useSearchParams();

  const mem = readInboxMemory();
  const [view, setView] = useState<QueueView>((search.get("view") as QueueView) && QUEUE_VIEWS.includes(search.get("view") as QueueView) ? (search.get("view") as QueueView) : mem.view);
  const [sort, setSort] = useState<QueueSort>(mem.sort);
  const [text, setText] = useState(mem.filter.text ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);

  // Return due deferrals once on mount, and honor ?process=next/oldest.
  useEffect(() => {
    returnDueCaptures();
    const process = search.get("process");
    if (process === "next" || process === "oldest") {
      const n = nextToProcess(state, process === "oldest" ? "oldest" : "newest");
      if (n) router.replace(`/process/${n.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { writeInboxMemory({ view, sort, filter: { text } }); }, [view, sort, text]);

  const queue = useMemo(() => deriveQueue(state, { view, sort, filter: { text: text.trim() || undefined } }), [state, view, sort, text]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = () => setSelected(new Set(queue.items.map((c) => c.id)));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Capture inbox</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Decide what each capture means — clarify, connect, convert, defer, or set aside. The system suggests; you decide.</p>
        </div>
        {queue.items.length > 0 && <Link href={`/process/${queue.items[0].id}`} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Process next →</Link>}
      </header>

      {/* View tabs. */}
      <nav aria-label="Queue views" className="mb-3 -mx-1 flex gap-1 overflow-x-auto pb-1">
        {QUEUE_VIEWS.map((v) => (
          <button key={v} type="button" onClick={() => { setView(v); setSelected(new Set()); setActiveIndex(0); }} data-view={v} aria-current={view === v ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${view === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]"}`}>
            {VIEW_LABEL[v]} <span className="opacity-60">· {queue.counts[v]}</span>
          </button>
        ))}
      </nav>

      {/* Filter + sort. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter…" aria-label="Filter captures" className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/12" />
        <select value={sort} onChange={(e) => setSort(e.target.value as QueueSort)} aria-label="Sort" className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {queue.items.length > 0 && <button type="button" onClick={selected.size === queue.items.length ? () => setSelected(new Set()) : selectAll} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] dark:border-white/[.15]">{selected.size === queue.items.length ? "Clear" : "Select all"}</button>}
      </div>

      <InboxQueue items={queue.items} selected={selected} activeIndex={activeIndex} onToggle={toggle} onActiveIndex={setActiveIndex} />

      <BatchActionBar ids={[...selected]} onClear={() => setSelected(new Set())} />
    </main>
  );
}
