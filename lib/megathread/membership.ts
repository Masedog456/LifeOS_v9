/**
 * Deterministic Megathread membership (LIFEOS-012, Phase 3).
 *
 * Candidate association is fully deterministic and EXPLAINABLE — concept /
 * title overlap, shared source/belief ids, comparison & inquiry inputs, and
 * the LIFEOS-009 retrieval layer. AI never silently adds members; the user
 * reviews every candidate. High-stakes items (beliefs, Constitution entries)
 * are only ever added by explicit user action, never auto-included.
 */

import type {
  Megathread,
  MegathreadSeedType,
  StoreState,
  ThreadMemberRef,
  ThreadMemberType,
} from "@/types/mvp";
import { buildRecords } from "@/lib/retrieval/records";
import { search } from "@/lib/retrieval/search";

function snippet(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** Text used to relate candidates to the thread (seed + title + description). */
export function threadSeedText(state: StoreState, thread: Megathread): string {
  const parts = [thread.title, thread.description ?? "", thread.seedLabel ?? ""];
  if (thread.seedType === "belief" && thread.seedId) {
    parts.push(state.beliefs.find((b) => b.id === thread.seedId)?.text ?? "");
  } else if (thread.seedType === "source" && thread.seedId) {
    const s = state.sources.find((x) => x.id === thread.seedId);
    if (s) parts.push(s.title, s.summary ?? "", ...(s.keyConcepts ?? []));
  } else if (thread.seedType === "comparison" && thread.seedId) {
    parts.push(state.comparisons.find((c) => c.id === thread.seedId)?.question ?? "");
  } else if (thread.seedType === "inquiry" && thread.seedId) {
    parts.push(state.inquiries.find((i) => i.id === thread.seedId)?.question ?? "");
  }
  return parts.filter(Boolean).join(" · ");
}

/** Auto members for a freshly-seeded thread (the seed + its direct inputs). */
export function initialMembers(
  state: StoreState,
  seedType: MegathreadSeedType,
  seedId: string | undefined,
): ThreadMemberRef[] {
  const at = new Date().toISOString();
  const out: ThreadMemberRef[] = [];
  const add = (type: ThreadMemberType, id: string, reason: string) => {
    if (!out.some((m) => m.type === type && m.id === id)) out.push({ type, id, addedBy: "auto", reason, at });
  };

  if (seedType === "belief" && seedId) {
    const b = state.beliefs.find((x) => x.id === seedId);
    if (b) {
      add("belief", b.id, "seed belief");
      if (b.captureId) add("capture", b.captureId, "origin capture of the seed belief");
      const cap = state.captures.find((c) => c.id === b.captureId);
      if (cap?.sourceId) add("source", cap.sourceId, "source the seed belief came from");
    }
  } else if (seedType === "source" && seedId) {
    add("source", seedId, "seed source");
  } else if (seedType === "comparison" && seedId) {
    const c = state.comparisons.find((x) => x.id === seedId);
    if (c) {
      add("comparison", c.id, "seed comparison");
      for (const sid of c.sourceIds) add("source", sid, "compared in the seed comparison");
      for (const bid of c.beliefIds) add("belief", bid, "part of the seed comparison");
    }
  } else if (seedType === "inquiry" && seedId) {
    const i = state.inquiries.find((x) => x.id === seedId);
    if (i) {
      add("inquiry", i.id, "seed inquiry");
      for (const sid of i.sourceIds) add("source", sid, "investigated in the seed inquiry");
      for (const bid of i.beliefIds) add("belief", bid, "part of the seed inquiry");
      for (const cid of i.comparisonIds) add("comparison", cid, "used by the seed inquiry");
    }
  }
  return out;
}

export interface Candidate {
  ref: ThreadMemberRef;
  label: string;
  reason: string;
}

/**
 * Deterministic candidate members not already included or excluded. Combines
 * retrieval relatedness with structural links (shared source/belief ids in
 * comparisons/inquiries). Each candidate carries a human-readable reason.
 */
export function candidateMembers(state: StoreState, thread: Megathread): Candidate[] {
  const memberKey = (t: string, id: string) => `${t}:${id}`;
  const present = new Set(thread.members.map((m) => memberKey(m.type, m.id)));
  const excluded = new Set(thread.excluded);
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const push = (type: ThreadMemberType, id: string, label: string, reason: string) => {
    const k = memberKey(type, id);
    if (present.has(k) || excluded.has(id) || seen.has(k)) return;
    seen.add(k);
    out.push({ ref: { type, id, addedBy: "user", reason }, label, reason });
  };

  // 1) Retrieval relatedness to the seed text.
  const seed = threadSeedText(state, thread);
  if (seed.trim().length >= 2) {
    const ranked = search(seed, buildRecords(state), state.feedback, { limit: 40, maxPerSource: 2, semantic: state.embeddings.length > 0 });
    for (const r of ranked) {
      const rec = r.record;
      if (rec.sourceId && (rec.type === "source" || rec.type === "summary")) {
        const s = state.sources.find((x) => x.id === rec.sourceId);
        if (s) push("source", s.id, s.title, `${r.reason.toLowerCase()} with the thread`);
      } else if (rec.type === "capture" && rec.captureId) {
        const c = state.captures.find((x) => x.id === rec.captureId);
        if (c) push("capture", c.id, snippet(c.text), `${r.reason.toLowerCase()} with the thread`);
      } else if (rec.type === "belief" && rec.beliefId) {
        const b = state.beliefs.find((x) => x.id === rec.beliefId);
        // Beliefs are high-stakes — offered as candidates, never auto-added.
        if (b) push("belief", b.id, snippet(b.text), `${r.reason.toLowerCase()} — review before adding`);
      }
    }
  }

  // 2) Structural links: comparisons/inquiries touching member sources/beliefs.
  const memberSourceIds = new Set(thread.members.filter((m) => m.type === "source").map((m) => m.id));
  const memberBeliefIds = new Set(thread.members.filter((m) => m.type === "belief").map((m) => m.id));
  const touches = (ids: string[], set: Set<string>) => ids.some((x) => set.has(x));

  for (const c of state.comparisons) {
    if (touches(c.sourceIds, memberSourceIds) || touches(c.beliefIds, memberBeliefIds)) {
      push("comparison", c.id, snippet(c.title), "compares material already in the thread");
    }
  }
  for (const i of state.inquiries) {
    if (touches(i.sourceIds, memberSourceIds) || touches(i.beliefIds, memberBeliefIds)) {
      push("inquiry", i.id, snippet(i.question), "investigates material already in the thread");
    }
  }

  return out.slice(0, 30);
}

/** Resolve a member ref to a display label + date + link. */
export function resolveMember(
  state: StoreState,
  ref: ThreadMemberRef,
): { label: string; sublabel?: string; date?: string; href?: string } | undefined {
  switch (ref.type) {
    case "source": {
      const s = state.sources.find((x) => x.id === ref.id);
      return s ? { label: s.title, sublabel: s.author, date: s.addedAt, href: `/library/${s.id}` } : undefined;
    }
    case "capture": {
      const c = state.captures.find((x) => x.id === ref.id);
      return c ? { label: snippet(c.text, 80), date: c.createdAt, href: c.sourceId ? `/library/${c.sourceId}` : "/" } : undefined;
    }
    case "belief": {
      const b = state.beliefs.find((x) => x.id === ref.id);
      return b ? { label: snippet(b.text, 80), sublabel: b.status, date: b.updatedAt, href: "/beliefs" } : undefined;
    }
    case "proposal": {
      const p = state.proposals.find((x) => x.id === ref.id);
      return p ? { label: snippet(p.claim, 80), date: p.createdAt, href: "/inbox" } : undefined;
    }
    case "comparison": {
      const c = state.comparisons.find((x) => x.id === ref.id);
      return c ? { label: snippet(c.title, 80), date: c.createdAt, href: `/compare/${c.id}` } : undefined;
    }
    case "inquiry": {
      const i = state.inquiries.find((x) => x.id === ref.id);
      return i ? { label: snippet(i.question, 80), sublabel: i.status, date: i.createdAt, href: `/inquiry/${i.id}` } : undefined;
    }
    default:
      return undefined;
  }
}
