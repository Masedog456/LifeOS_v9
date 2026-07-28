"use client";

/**
 * Action filters (LIFEOS-036, Feature 3). Deterministic filter controls over the
 * queue — text, context, energy, size, source, and linked/unlinked. No
 * importance/score filters exist. The page owns the filter state.
 */

import type { ActionFilter } from "@/lib/actions/queue";
import type { ActionEnergy, ActionSize } from "@/types/mvp";
import { SIZE_LABEL, ENERGY_LABEL } from "@/lib/actions/status";

const ENERGIES: ActionEnergy[] = ["low", "medium", "high"];
const SIZES: ActionSize[] = ["tiny", "small", "medium", "large"];

export default function ActionFilters({ filter, onChange }: { filter: ActionFilter; onChange: (f: ActionFilter) => void }) {
  const set = (patch: Partial<ActionFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input value={filter.text ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder="Filter…" aria-label="Filter actions" className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/12" />
      <input value={filter.context ?? ""} onChange={(e) => set({ context: e.target.value || undefined })} placeholder="Context" aria-label="Filter context" className="w-24 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12" />
      <select value={filter.energy ?? ""} onChange={(e) => set({ energy: (e.target.value || undefined) as ActionEnergy | undefined })} aria-label="Filter energy" className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12">
        <option value="">Any energy</option>
        {ENERGIES.map((s) => <option key={s} value={s}>{ENERGY_LABEL[s]}</option>)}
      </select>
      <select value={filter.size ?? ""} onChange={(e) => set({ size: (e.target.value || undefined) as ActionSize | undefined })} aria-label="Filter size" className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12">
        <option value="">Any size</option>
        {SIZES.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
      </select>
      <select value={filter.linked ?? ""} onChange={(e) => set({ linked: (e.target.value || undefined) as "linked" | "unlinked" | undefined })} aria-label="Filter linked" className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12">
        <option value="">All</option>
        <option value="linked">Linked</option>
        <option value="unlinked">Unlinked</option>
      </select>
    </div>
  );
}
