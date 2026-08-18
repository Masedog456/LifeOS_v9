/**
 * Deterministic Megathread timeline (LIFEOS-012, Phase 4).
 *
 * A chronological READ-MODEL built from existing records — it is never stored
 * and never rewrites history. Each event keeps provenance (record type, date,
 * source, page, human/AI origin, relationship to the thread). Members that
 * were excluded by the user are skipped.
 */

import type { Megathread, StoreState, TimelineItem } from "@/types/mvp";

function snippet(s: string, n = 100): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function pageForOffset(
  pageMap: { page: number; start: number; end: number }[] | undefined,
  offset: number,
): number | undefined {
  return pageMap?.find((p) => offset >= p.start && offset < p.end)?.page;
}

export function buildTimeline(state: StoreState, thread: Megathread): TimelineItem[] {
  const excluded = new Set(thread.excluded);
  const items: TimelineItem[] = [];
  const memberIds = (type: string) =>
    new Set(thread.members.filter((m) => m.type === type && !excluded.has(m.id)).map((m) => m.id));

  const sourceIds = memberIds("source");
  const beliefIds = memberIds("belief");
  const captureIds = memberIds("capture");
  const comparisonIds = memberIds("comparison");
  const inquiryIds = memberIds("inquiry");

  // Sources + their saved quotes.
  for (const s of state.sources) {
    if (!sourceIds.has(s.id)) continue;
    items.push({
      id: `src:${s.id}`,
      type: "source_added",
      at: s.addedAt,
      title: `Added source: ${s.title}`,
      detail: s.author,
      origin: "human",
      sourceId: s.id,
      href: `/library/${s.id}`,
      relation: "a source in this thread",
    });
    for (let i = 0; i < (s.keyQuotes ?? []).length; i++) {
      const q = s.keyQuotes[i];
      const off = s.originalText.indexOf(q);
      items.push({
        id: `quote:${s.id}:${i}`,
        type: "quote",
        at: s.addedAt,
        title: snippet(q),
        origin: "human",
        sourceId: s.id,
        page: off >= 0 ? pageForOffset(s.pageMap, off) : undefined,
        href: `/library/${s.id}`,
        relation: `quote from ${s.title}`,
      });
    }
  }

  // Captures.
  for (const c of state.captures) {
    if (!captureIds.has(c.id)) continue;
    items.push({
      id: `cap:${c.id}`,
      type: "capture",
      at: c.createdAt,
      title: snippet(c.text),
      origin: "human",
      sourceId: c.sourceId,
      href: c.sourceId ? `/library/${c.sourceId}` : "/",
      relation: "a thought you captured",
    });
  }

  // Beliefs: proposal → judgments → revisions → current status.
  for (const b of state.beliefs) {
    if (!beliefIds.has(b.id)) continue;
    items.push({
      id: `belief:${b.id}:created`,
      type: "proposal",
      at: b.createdAt,
      title: `Belief formed: ${snippet(b.text, 80)}`,
      origin: "human",
      beliefId: b.id,
      href: "/beliefs",
      relation: "a belief in this thread",
    });
    b.revisions.forEach((r, i) => {
      if (i === 0) return; // first revision == formation, already shown
      items.push({
        id: `belief:${b.id}:rev:${i}`,
        type: "revision",
        at: r.at,
        title: `Belief ${r.reason}: ${snippet(r.text, 80)}`,
        origin: "human",
        beliefId: b.id,
        href: "/beliefs",
        relation: "how this belief changed",
      });
    });
    b.judgments.forEach((j, i) => {
      if (i === 0) return; // first judgment == formation
      items.push({
        id: `belief:${b.id}:jud:${i}`,
        type: j.decision === "reaffirmed" || j.decision === "questioned" ? "belief_status" : "judgment",
        at: j.at,
        title: `You ${j.decision} this belief`,
        origin: "human",
        beliefId: b.id,
        href: "/beliefs",
        relation: "a judgment on this belief",
      });
    });
  }

  // Comparisons + their judgments.
  for (const c of state.comparisons) {
    if (!comparisonIds.has(c.id)) continue;
    items.push({
      id: `cmp:${c.id}`,
      type: "comparison",
      at: c.createdAt,
      title: `Comparison: ${snippet(c.title, 80)}`,
      detail: c.question,
      origin: c.source,
      href: `/compare/${c.id}`,
      relation: "a comparison affecting this thread",
    });
  }

  // Inquiries: creation + evolution history + provisional conclusion.
  for (const i of state.inquiries) {
    if (!inquiryIds.has(i.id)) continue;
    items.push({
      id: `inq:${i.id}`,
      type: "inquiry",
      at: i.createdAt,
      title: `Inquiry: ${snippet(i.question, 80)}`,
      origin: i.source,
      href: `/inquiry/${i.id}`,
      relation: "an inquiry affecting this thread",
    });
    for (let h = 0; h < i.history.length; h++) {
      items.push({
        id: `inq:${i.id}:h:${h}`,
        type: "inquiry",
        at: i.history[h].at,
        title: `Inquiry evolved${i.history[h].addedInputs?.length ? ` (added ${i.history[h].addedInputs!.join(", ")})` : ""}`,
        origin: i.history[h].source,
        href: `/inquiry/${i.id}`,
        relation: "the inquiry gained new evidence",
      });
    }
    if (i.provisionalConclusion) {
      items.push({
        id: `inq:${i.id}:concl`,
        type: "provisional_conclusion",
        at: i.updatedAt,
        title: `Your provisional conclusion: ${snippet(i.provisionalConclusion, 100)}`,
        origin: "human",
        href: `/inquiry/${i.id}`,
        relation: "where you landed on the inquiry",
      });
    }
  }

  // Oldest → newest. Stable, deterministic, never mutates the source records.
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)));
}
