"use client";

/**
 * Range picker (LIFEOS-039, Feature 2). Preset chips plus explicit custom start/
 * end inputs. Shows the resolved inclusive label so the range is never
 * ambiguous.
 */

import { RANGE_KINDS, RANGE_LABEL, type RangeKind, type ResolvedRange } from "@/lib/insights/range";

export default function RangePicker({ kind, customStart, customEnd, range, onChange }: {
  kind: RangeKind; customStart?: string; customEnd?: string; range: ResolvedRange;
  onChange: (kind: RangeKind, customStart?: string, customEnd?: string) => void;
}) {
  return (
    <div className="mb-4" data-range-picker>
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_KINDS.filter((k) => k !== "custom").map((k) => (
          <button key={k} type="button" data-range={k} aria-current={kind === k ? "true" : undefined} onClick={() => onChange(k)}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${kind === k ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-black/[.12] dark:border-white/[.15]"}`}>
            {RANGE_LABEL[k]}
          </button>
        ))}
        <button type="button" data-range="custom" aria-current={kind === "custom" ? "true" : undefined} onClick={() => onChange("custom", customStart || range.startKey, customEnd || range.endKey)}
          className={`rounded-full border px-2.5 py-1 text-[11px] ${kind === "custom" ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-black/[.12] dark:border-white/[.15]"}`}>
          Custom
        </button>
      </div>
      {kind === "custom" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1">From <input type="date" data-custom-start value={customStart ?? range.startKey} onChange={(e) => onChange("custom", e.target.value, customEnd ?? range.endKey)} className="rounded-md border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/12" /></label>
          <label className="flex items-center gap-1">to <input type="date" data-custom-end value={customEnd ?? range.endKey} onChange={(e) => onChange("custom", customStart ?? range.startKey, e.target.value)} className="rounded-md border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/12" /></label>
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-zinc-400" data-range-label>{range.label} · {range.startKey} → {range.endKey} (inclusive)</p>
    </div>
  );
}
