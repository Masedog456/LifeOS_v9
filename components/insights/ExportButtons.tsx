"use client";

/**
 * Export buttons (LIFEOS-039, Feature 17). CSV + JSON export of the current view
 * with a self-describing metadata header (range, timezone, filters, timestamp).
 */

import { exportMetadata, toCSV, toJSON, downloadText } from "@/lib/insights/export";
import type { ResolvedRange } from "@/lib/insights/range";

export default function ExportButtons({ insight, range, columns, rows, filters = {} }: {
  insight: string; range: ResolvedRange; columns: string[]; rows: Record<string, unknown>[]; filters?: Record<string, unknown>;
}) {
  const csv = () => { const meta = exportMetadata(insight, range, filters); downloadText(`${insight}-${range.startKey}_${range.endKey}.csv`, toCSV(meta, columns, rows), "text/csv"); };
  const json = () => { const meta = exportMetadata(insight, range, filters); downloadText(`${insight}-${range.startKey}_${range.endKey}.json`, toJSON(meta, rows), "application/json"); };
  return (
    <div className="mb-3 flex gap-1.5" data-export>
      <button type="button" data-export-csv onClick={csv} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Export CSV</button>
      <button type="button" data-export-json onClick={json} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Export JSON</button>
    </div>
  );
}
