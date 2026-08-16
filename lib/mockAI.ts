/**
 * Deterministic mock generators for the non-belief AI tasks (summary,
 * quotes, concepts, question). Used by the single AI route and by the
 * client fallback when no ANTHROPIC_API_KEY is configured or a call
 * fails. Given the same input, output is always the same.
 *
 * Belief-claim mocking lives in lib/proposals.ts (mockProposals) and is
 * reused as-is — this file does not duplicate it.
 */

import { mockProposals } from "@/lib/proposals";

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function substantive(text: string): string[] {
  const s = sentences(text).filter((x) => x.length >= 12);
  return s.length > 0 ? s : sentences(text);
}

export function mockSummary(text: string): string {
  const first = substantive(text).slice(0, 2).join(" ");
  const capped = first.length > 320 ? first.slice(0, 317) + "…" : first;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `(Mock summary of ~${words} words) ${capped}`;
}

export function mockQuotes(text: string): string[] {
  // Pick the longest substantive sentences, verbatim, as "key quotes".
  return [...substantive(text)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .map((s) => s.replace(/\s+/g, " ").trim());
}

export function mockConcepts(text: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
    if (raw.length > 5) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function mockAnswer(text: string, question: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const q = question.trim() || "(no question)";
  // Cause-neutral on purpose (LIFEOS-055T): this text is produced for an
  // expired session, a rate limit, a provider outage AND a missing key. The
  // caller knows which one it was and says so; asserting "no AI key configured"
  // here sent signed-in users to re-check an environment variable that was fine.
  return `(Offline answer) I can't reason over this ~${words}-word source right now. Your question was: "${q}".`;
}

// ---------- Long-source map/reduce mocks (LIFEOS-007) ----------

export interface ChunkMap {
  summary: string;
  concepts: string[];
  quotes: { text: string; start?: number; end?: number }[];
  claims: string[];
}

/** Deterministic per-chunk map result (mirrors the real "map" task shape). */
export function mockMapChunk(text: string): ChunkMap {
  const quotes = mockQuotes(text).map((q) => {
    const start = text.indexOf(q);
    return start < 0 ? { text: q } : { text: q, start, end: start + q.length };
  });
  return {
    summary: mockSummary(text),
    concepts: mockConcepts(text),
    quotes,
    claims: mockProposals(text).map((p) => p.claim),
  };
}

/** Deterministic reduce of chunk summaries into a source-wide summary. */
export function mockReduceSummary(summaries: string[]): string {
  const joined = summaries.map((s) => s.replace(/^\(Mock summary[^)]*\)\s*/, "")).join(" ");
  const words = joined.split(/\s+/).filter(Boolean).length;
  const capped = joined.length > 500 ? joined.slice(0, 497) + "…" : joined;
  return `(Mock full-source summary · ${summaries.length} chunks · ~${words} words) ${capped}`;
}
