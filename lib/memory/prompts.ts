/**
 * Reflection Prompts (LIFEOS-026, Feature 6).
 *
 * Deterministic, evidence-bearing prompts generated ONLY from existing records:
 * a view that has changed repeatedly, a belief never challenged, an idea backed
 * by several independent sources, or two beliefs that look unrelated yet share a
 * concept. Every prompt carries the exact records it was derived from — no
 * inference, nothing stored, nothing mutated.
 */

import type { StoreState } from "@/types/mvp";
import { buildGraph, relationshipsOf, type KnowledgeGraph } from "@/lib/graph";
import { explain, type MemoryExplanation, type MemoryRecordRef } from "@/lib/memory/explanation";

export type ReflectionKind = "changed_view" | "never_challenged" | "multi_source" | "hidden_link";

export interface ReflectionPrompt {
  id: string;
  kind: ReflectionKind;
  text: string;
  explanation: MemoryExplanation;
}

const CHANGED_MIN = 3;   // revisions (excluding the initial proposal)
const SOURCE_MIN = 3;    // independent supporting sources

function snip(s: string, n = 60): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

export function buildReflectionPrompts(state: StoreState, opts?: { graph?: KnowledgeGraph; limit?: number }): ReflectionPrompt[] {
  const graph = opts?.graph ?? buildGraph(state);
  const out: ReflectionPrompt[] = [];

  // 1. changed_view — a belief revised (rewritten/reaffirmed/questioned) several times.
  for (const b of state.beliefs) {
    const changes = b.revisions.filter((r) => r.reason !== "proposed");
    if (changes.length >= CHANGED_MIN) {
      out.push({
        id: `cv:${b.id}`, kind: "changed_view",
        text: `You have changed your view on “${snip(b.theme || b.text, 48)}” ${changes.length} times.`,
        explanation: explain({
          triggers: [{ rule: "changed_view", label: `${changes.length} recorded revisions` }],
          evidence: [{ kind: "belief", id: b.id, label: b.text, href: "/constitution", note: `revised ${changes.length}×` }],
        }),
      });
    }
  }

  // 2. never_challenged — an accepted belief with no contradiction, no dialogue, no 'questioned' judgment.
  for (const b of state.beliefs) {
    if (b.status !== "accepted") continue;
    const contradicted = relationshipsOf(graph, b.id).some((e) => e.relation === "contradicts");
    const inDialogue = state.dialogueSessions.some((d) => d.seedRefs.includes(b.id));
    const questioned = b.judgments.some((j) => j.decision === "questioned") || b.revisions.some((r) => r.reason === "questioned");
    if (!contradicted && !inDialogue && !questioned) {
      out.push({
        id: `nc:${b.id}`, kind: "never_challenged",
        text: `The belief “${snip(b.text, 52)}” has never been challenged.`,
        explanation: explain({
          triggers: [{ rule: "never_challenged", label: "no contradiction, dialogue, or questioning on record" }],
          evidence: [{ kind: "belief", id: b.id, label: b.text, href: "/constitution" }],
        }),
      });
    }
  }

  // 3. multi_source — an idea (belief/concept) supported by ≥3 independent sources.
  const supportSources = (id: string): MemoryRecordRef[] => {
    const refs = relationshipsOf(graph, id)
      .filter((e) => e.relation === "supports" && e.fromKind === "source")
      .map((e) => e.from);
    return [...new Set(refs)].map((sid) => {
      const s = state.sources.find((x) => x.id === sid);
      return { kind: "source", id: sid, label: s?.title ?? sid, href: `/library` } as MemoryRecordRef;
    });
  };
  for (const c of state.concepts) {
    const srcs = c.relatedSources?.length
      ? [...new Set(c.relatedSources)].map((sid) => ({ kind: "source", id: sid, label: state.sources.find((x) => x.id === sid)?.title ?? sid, href: "/library" } as MemoryRecordRef))
      : supportSources(c.id);
    if (srcs.length >= SOURCE_MIN) {
      out.push({
        id: `ms:${c.id}`, kind: "multi_source",
        text: `${srcs.length} independent sources support the idea “${snip(c.name, 48)}”.`,
        explanation: explain({
          triggers: [{ rule: "multi_source", label: `${srcs.length} distinct supporting sources` }],
          evidence: [{ kind: "concept", id: c.id, label: c.name, href: `/world/concept/${c.id}` }, ...srcs.slice(0, 4)],
        }),
      });
    }
  }

  // 4. hidden_link — two beliefs with no direct edge that share a concept.
  const seenPair = new Set<string>();
  for (const c of state.concepts) {
    const related = (c.relatedBeliefs ?? []).filter((bid) => state.beliefs.some((b) => b.id === bid && b.status !== "rejected"));
    for (let i = 0; i < related.length; i++) {
      for (let j = i + 1; j < related.length; j++) {
        const a = related[i], bb = related[j];
        const pair = [a, bb].sort().join("|");
        if (seenPair.has(pair)) continue;
        const directlyLinked = relationshipsOf(graph, a).some((e) => e.from === bb || e.to === bb);
        if (directlyLinked) continue;
        seenPair.add(pair);
        const ba = state.beliefs.find((x) => x.id === a)!, bj = state.beliefs.find((x) => x.id === bb)!;
        out.push({
          id: `hl:${pair}`, kind: "hidden_link",
          text: `These two beliefs seem unrelated but share the concept “${c.name}”: “${snip(ba.text, 34)}” and “${snip(bj.text, 34)}”.`,
          explanation: explain({
            triggers: [{ rule: "hidden_link", label: `both connect to the concept “${c.name}”, with no direct link between them` }],
            evidence: [
              { kind: "belief", id: a, label: ba.text, href: "/constitution" },
              { kind: "belief", id: bb, label: bj.text, href: "/constitution" },
              { kind: "concept", id: c.id, label: c.name, href: `/world/concept/${c.id}` },
            ],
          }),
        });
      }
    }
  }

  return typeof opts?.limit === "number" ? out.slice(0, opts.limit) : out;
}
