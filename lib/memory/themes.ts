/**
 * Theme Evolution (LIFEOS-026, Feature 3).
 *
 * Detects recurring concepts across the user's whole history and projects each
 * into a theme: frequency over time plus every connected belief, capture,
 * research project, dialogue, synthesis, and open tension. A "theme" is an
 * existing world-model concept; connections come from EXPLICIT references
 * (graph / id fields) and from the concept's own name/aliases appearing in a
 * record's text — both deterministic and explainable. Read-only; stores nothing.
 */

import type { Concept, StoreState } from "@/types/mvp";
import { explain, type MemoryExplanation } from "@/lib/memory/explanation";

export interface ThemeConnection {
  kind: string;
  id: string;
  label: string;
  href: string;
  at: string;
  /** How the connection was established: an explicit id link or a text mention. */
  via: "reference" | "mention";
}

export interface ThemeBucket { month: string; count: number }

export interface Theme {
  id: string;
  name: string;
  aliases: string[];
  total: number;
  firstAt?: string;
  lastAt?: string;
  buckets: ThemeBucket[];
  beliefs: ThemeConnection[];
  captures: ThemeConnection[];
  research: ThemeConnection[];
  dialogues: ThemeConnection[];
  syntheses: ThemeConnection[];
  tensions: ThemeConnection[];
  explanation: MemoryExplanation;
}

function terms(c: Concept): string[] {
  return [c.name, ...(c.aliases ?? [])].map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3);
}
/**
 * A mention matcher for a concept's terms. Single-word terms are collapsed into
 * ONE precompiled word-boundary regex and multi-word terms into substring
 * checks — so scanning a record costs one regex test, not one per term (and the
 * regex is compiled once per theme, not once per record).
 */
function matcher(ts: string[]): (text: string) => boolean {
  const phrases = ts.filter((t) => t.includes(" "));
  const words = ts.filter((t) => !t.includes(" "));
  const re = words.length ? new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`) : null;
  return (text: string) => {
    const lower = ` ${text.toLowerCase()} `;
    if (re && re.test(lower)) return true;
    for (const p of phrases) if (lower.includes(p)) return true;
    return false;
  };
}
function month(iso: string): string { return iso.slice(0, 7); }

export function buildTheme(state: StoreState, concept: Concept): Theme {
  const ts = terms(concept);
  const mentions = matcher(ts);
  const seen = { b: new Set<string>(), c: new Set<string>(), r: new Set<string>(), d: new Set<string>(), s: new Set<string>(), t: new Set<string>() };

  const beliefs: ThemeConnection[] = [];
  for (const b of state.beliefs) {
    if (b.status === "rejected") continue;
    const ref = concept.relatedBeliefs.includes(b.id);
    if ((ref || mentions(b.text)) && !seen.b.has(b.id)) {
      seen.b.add(b.id);
      beliefs.push({ kind: "belief", id: b.id, label: b.text, href: "/constitution", at: b.createdAt, via: ref ? "reference" : "mention" });
    }
  }
  const captures: ThemeConnection[] = [];
  for (const c of state.captures) {
    if (mentions(c.text) && !seen.c.has(c.id)) { seen.c.add(c.id); captures.push({ kind: "capture", id: c.id, label: c.text, href: "/", at: c.createdAt, via: "mention" }); }
  }
  const research: ThemeConnection[] = [];
  for (const rp of state.researchProjects) {
    const ref = rp.assembly?.conceptIds?.includes(concept.id);
    if ((ref || mentions(`${rp.title} ${rp.question}`)) && !seen.r.has(rp.id)) { seen.r.add(rp.id); research.push({ kind: "research_project", id: rp.id, label: rp.title, href: `/research/${rp.id}`, at: rp.createdAt, via: ref ? "reference" : "mention" }); }
  }
  const dialogues: ThemeConnection[] = [];
  for (const d of state.dialogueSessions) {
    const ref = d.seedRefs.includes(concept.id);
    if ((ref || mentions(`${d.title} ${d.topic}`)) && !seen.d.has(d.id)) { seen.d.add(d.id); dialogues.push({ kind: "dialogue", id: d.id, label: d.title, href: `/dialogue/${d.id}`, at: d.createdAt, via: ref ? "reference" : "mention" }); }
  }
  const syntheses: ThemeConnection[] = [];
  for (const s of state.syntheses) {
    const ref = s.evidenceLinks.some((e) => e.refId === concept.id);
    if ((ref || mentions(s.statement)) && !seen.s.has(s.id)) { seen.s.add(s.id); syntheses.push({ kind: "synthesis", id: s.id, label: s.statement, href: `/dialogue/${s.dialogueId}`, at: s.createdAt, via: ref ? "reference" : "mention" }); }
  }
  const tensions: ThemeConnection[] = [];
  for (const t of state.tensions) {
    if (!(t.status === "open" || t.status === "under_synthesis")) continue;
    const ref = [...t.thesisRefs, ...t.antithesisRefs, ...t.evidence.map((e) => e.refId)].includes(concept.id);
    if ((ref || mentions(`${t.title} ${t.thesis} ${t.antithesis}`)) && !seen.t.has(t.id)) { seen.t.add(t.id); tensions.push({ kind: "tension", id: t.id, label: t.title, href: `/dialogue/${t.dialogueId}`, at: t.createdAt, via: ref ? "reference" : "mention" }); }
  }

  const all = [...beliefs, ...captures, ...research, ...dialogues, ...syntheses, ...tensions];
  const byMonth = new Map<string, number>();
  for (const x of all) byMonth.set(month(x.at), (byMonth.get(month(x.at)) ?? 0) + 1);
  const buckets = [...byMonth.entries()].map(([m, count]) => ({ month: m, count })).sort((a, b) => (a.month < b.month ? -1 : 1));
  const ats = all.map((x) => x.at).filter(Boolean).sort();

  return {
    id: concept.id,
    name: concept.name,
    aliases: concept.aliases ?? [],
    total: all.length,
    firstAt: ats[0],
    lastAt: ats[ats.length - 1],
    buckets,
    beliefs, captures, research, dialogues, syntheses, tensions,
    explanation: explain({
      triggers: [
        { rule: "recurring_concept", label: `appears across ${all.length} record${all.length === 1 ? "" : "s"}` },
        ...(buckets.length >= 2 ? [{ rule: "spans_time", label: `spans ${buckets.length} months of your thinking` }] : []),
        ...(tensions.length > 0 ? [{ rule: "open_tension", label: `${tensions.length} open tension${tensions.length === 1 ? "" : "s"} involve it` }] : []),
      ],
      evidence: all.slice(0, 6).map((x) => ({ kind: x.kind, id: x.id, label: x.label, href: x.href })),
    }),
  };
}

/** All themes with at least one connection, most-connected first. */
export function buildThemes(state: StoreState, opts?: { min?: number }): Theme[] {
  const min = opts?.min ?? 2;
  return state.concepts
    .filter((c) => c.status !== "archived" && c.status !== "merged")
    .map((c) => buildTheme(state, c))
    .filter((t) => t.total >= min)
    .sort((a, b) => b.total - a.total);
}

export function themeById(state: StoreState, id: string): Theme | undefined {
  const c = state.concepts.find((x) => x.id === id);
  return c ? buildTheme(state, c) : undefined;
}
