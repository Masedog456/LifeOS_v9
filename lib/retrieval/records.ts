/**
 * Build normalized retrieval records from the existing store (LIFEOS-009).
 *
 * Records are a searchable VIEW over data already in memory — they are not
 * persisted and do not duplicate large source text on disk. Every record
 * keeps provenance (source id, page, links) so results are explainable.
 */

import type { RetrievalRecord, StoreState } from "@/types/mvp";

function pageForOffset(
  pageMap: { page: number; start: number; end: number }[] | undefined,
  offset: number,
): number | undefined {
  return pageMap?.find((p) => offset >= p.start && offset < p.end)?.page;
}

export function buildRecords(state: StoreState): RetrievalRecord[] {
  const records: RetrievalRecord[] = [];

  for (const s of state.sources) {
    const href = `/library/${s.id}`;
    const concepts = s.keyConcepts ?? [];

    records.push({
      id: `source:${s.id}`,
      type: "source",
      text: [s.title, s.author, s.summary].filter(Boolean).join(" — "),
      title: s.title,
      sourceId: s.id,
      concepts,
      createdAt: s.addedAt,
      href,
    });

    if (s.summary) {
      records.push({
        id: `summary:${s.id}`,
        type: "summary",
        text: s.summary,
        title: s.title,
        sourceId: s.id,
        concepts,
        href,
      });
    }

    for (const c of concepts) {
      records.push({
        id: `concept:${s.id}:${c}`,
        type: "concept",
        text: c,
        title: s.title,
        sourceId: s.id,
        concepts: [c],
        href,
      });
    }

    for (let i = 0; i < (s.keyQuotes ?? []).length; i++) {
      const q = s.keyQuotes[i];
      const off = s.originalText.indexOf(q);
      records.push({
        id: `quote:${s.id}:${i}`,
        type: "quote",
        text: q,
        title: s.title,
        sourceId: s.id,
        page: off >= 0 ? pageForOffset(s.pageMap, off) : undefined,
        concepts,
        href,
      });
    }

    for (const cb of s.candidateBeliefs ?? []) {
      records.push({
        id: `candidate:${s.id}:${cb}`,
        type: "proposal",
        text: cb,
        title: s.title,
        sourceId: s.id,
        concepts,
        href,
      });
    }

    // Chunks give full-text (incl. PDF passages with page provenance).
    for (const ch of s.chunks ?? []) {
      records.push({
        id: `chunk:${ch.id}`,
        type: "chunk",
        text: ch.text,
        title: s.title,
        sourceId: s.id,
        page: ch.pageStart,
        concepts,
        href,
      });
    }
  }

  for (const c of state.captures) {
    records.push({
      id: `capture:${c.id}`,
      type: "capture",
      text: c.text,
      captureId: c.id,
      sourceId: c.sourceId,
      createdAt: c.createdAt,
      href: c.sourceId ? `/library/${c.sourceId}` : "/",
    });
  }

  for (const p of state.proposals) {
    if (p.resolved) continue;
    records.push({
      id: `proposal:${p.id}`,
      type: "proposal",
      text: p.claim,
      captureId: p.captureId,
      concepts: p.theme ? [p.theme] : undefined,
      createdAt: p.createdAt,
      href: "/inbox",
    });
  }

  for (const b of state.beliefs) {
    records.push({
      id: `belief:${b.id}`,
      type: "belief",
      text: b.text,
      beliefId: b.id,
      captureId: b.captureId,
      status: b.status,
      concepts: b.theme ? [b.theme] : undefined,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      href: "/beliefs",
    });
    // Earlier wordings as revision records.
    for (let i = 0; i < b.revisions.length - 1; i++) {
      const r = b.revisions[i];
      if (!r.text || r.text === b.text) continue;
      records.push({
        id: `revision:${b.id}:${i}`,
        type: "revision",
        text: r.text,
        beliefId: b.id,
        status: b.status,
        createdAt: r.at,
        href: "/beliefs",
      });
    }
  }

  return records;
}
