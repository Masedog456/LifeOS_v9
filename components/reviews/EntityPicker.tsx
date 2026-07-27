"use client";

/**
 * Compact entity-link picker (LIFEOS-034).
 *
 * Reuses the existing LIFEOS-027 search index + ranking to let a review link a
 * win / lesson / focus item / friction point to an existing record — references
 * only, never copies. No new search engine, no AI.
 */

import { useMemo, useState } from "react";
import { useStore } from "@/lib/mvpStore";
import { buildIndex, searchFlat } from "@/lib/command/search";
import { RECORD_LABELS } from "@/lib/command/records";
import type { RecordRefLite } from "@/types/mvp";

export default function EntityPicker({ onPick, placeholder = "Link a record…", kinds }: { onPick: (ref: RecordRefLite, title: string) => void; placeholder?: string; kinds?: string[] }) {
  const state = useStore();
  const [q, setQ] = useState("");
  const index = useMemo(() => buildIndex(state), [state]);
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const all = searchFlat(index, q, 20).map((r) => r.entry);
    const filtered = kinds ? all.filter((e) => kinds.includes(e.kind)) : all;
    return filtered.slice(0, 6);
  }, [index, q, kinds]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-black/10 bg-transparent px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:border-white/12"
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-black/10 bg-white p-1 text-xs shadow-lg dark:border-white/12 dark:bg-zinc-900">
          {results.map((e) => (
            <li key={`${e.kind}:${e.id}`}>
              <button
                type="button"
                onClick={() => { onPick({ kind: e.kind, id: e.id }, e.title); setQ(""); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-black/[.05] dark:hover:bg-white/[.06]"
              >
                <span className="shrink-0 rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.08]">{RECORD_LABELS[e.kind] ?? e.kind}</span>
                <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">{e.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
