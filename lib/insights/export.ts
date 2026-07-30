/**
 * Export insights (LIFEOS-039, Feature 17).
 *
 * Deterministic CSV and JSON export of the currently-selected view. Every export
 * carries a metadata header — selected range, timezone, filters, generation
 * timestamp — plus raw values with clear field names. There are NO hidden
 * derived scores to export because none exist. Pure serialization.
 */

import type { ResolvedRange } from "@/lib/insights/range";

export interface ExportMetadata {
  insight: string;
  rangeKind: string;
  startKey: string;
  endKey: string;
  timezone: string;
  filters: Record<string, unknown>;
  generatedAt: string;
}

/** Build the metadata block shared by every export. */
export function exportMetadata(insight: string, range: ResolvedRange, filters: Record<string, unknown> = {}, timezone?: string): ExportMetadata {
  const tz = timezone ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC") ?? "UTC";
  return { insight, rangeKind: range.kind, startKey: range.startKey, endKey: range.endKey, timezone: tz, filters, generatedAt: new Date().toISOString() };
}

/** Escape a CSV field (RFC-4180: quote when it contains comma/quote/newline). */
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize tabular rows to CSV, prefixed with a commented metadata block so the
 * export is self-describing. `columns` fixes field order and names.
 */
export function toCSV(meta: ExportMetadata, columns: string[], rows: Record<string, unknown>[]): string {
  const header = [
    `# insight,${csvField(meta.insight)}`,
    `# range,${csvField(meta.rangeKind)},${meta.startKey},${meta.endKey}`,
    `# timezone,${csvField(meta.timezone)}`,
    `# filters,${csvField(JSON.stringify(meta.filters))}`,
    `# generated_at,${meta.generatedAt}`,
  ].join("\n");
  const head = columns.map(csvField).join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\n");
  return `${header}\n${head}${body ? "\n" + body : ""}\n`;
}

/** Serialize the view to JSON with the metadata header + raw values. */
export function toJSON(meta: ExportMetadata, payload: unknown): string {
  return JSON.stringify({ metadata: meta, data: payload }, null, 2);
}

/** A browser download trigger (no-op on the server). */
export function downloadText(filename: string, text: string, mime: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
