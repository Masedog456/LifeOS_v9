/**
 * Record catalog (LIFEOS-027).
 *
 * ONE deterministic mapping from every searchable/openable record type to: a
 * human label, a route (href), and how to read a title / body / status /
 * timestamp off the store. Search, recent-history, and pinning all consume this
 * so there is a single source of truth for "how do I show and open a record" —
 * no per-feature duplication. Pure and offline; no AI.
 */

import type { StoreState } from "@/types/mvp";
import type { SearchEntry } from "@/lib/command/types";

/** Display order for grouped results (also the group label source). */
export const RECORD_LABELS: Record<string, string> = {
  capture: "Captures",
  belief: "Beliefs",
  concept: "Concepts",
  theme: "Themes",
  dialogue: "Dialogues",
  research_project: "Research",
  synthesis: "Syntheses",
  tension: "Tensions",
  decision: "Decisions",
  formation: "Reflections",
  knowledge_project: "Authoring",
  source: "Library",
  inquiry: "Questions",
};

/** Deterministic group ordering for search output (index = priority). */
export const RECORD_ORDER: string[] = [
  "belief", "concept", "theme", "capture", "dialogue", "research_project",
  "synthesis", "tension", "decision", "inquiry", "formation", "knowledge_project", "source",
];

const norm = (s: string | undefined): string => (s ?? "").toLowerCase();
const snip = (s: string, n = 120): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/**
 * Build the flat, normalized search index over all meaningful user-owned
 * records. Every entry precomputes its lowercased title/aliases/body so the
 * hot query path allocates nothing — the index is rebuilt only when the store
 * changes, never per keystroke.
 */
export function buildSearchEntries(state: StoreState): SearchEntry[] {
  const out: SearchEntry[] = [];
  const add = (
    kind: string, id: string, title: string, opts: { body?: string; aliases?: string[]; status?: string; updatedAt?: string; href: string },
  ) => {
    const t = (title ?? "").trim() || "(untitled)";
    out.push({
      kind, id, title: t,
      titleLower: norm(t),
      aliasesLower: (opts.aliases ?? []).map(norm).filter(Boolean),
      bodyLower: norm(opts.body),
      snippet: snip(opts.body || t),
      status: opts.status,
      updatedAt: opts.updatedAt ?? "",
      href: opts.href,
    });
  };

  for (const c of state.captures) add("capture", c.id, c.text, { body: c.text, updatedAt: c.createdAt, href: "/" });
  for (const b of state.beliefs) {
    if (b.status === "rejected") continue;
    add("belief", b.id, b.text, { body: `${b.text} ${b.theme ?? ""}`, aliases: b.theme ? [b.theme] : [], status: b.status, updatedAt: b.updatedAt, href: "/constitution" });
  }
  for (const c of state.concepts) {
    if (c.status === "archived" || c.status === "merged") continue;
    add("concept", c.id, c.name, { body: `${c.definition} ${c.description}`, aliases: c.aliases, status: c.status, updatedAt: c.updatedAt, href: `/world/concept/${c.id}` });
    // A concept is also a Theme destination (LIFEOS-026). Indexed separately so
    // "themes" are searchable and open the theme-evolution view — a distinct
    // destination from the world-model concept page.
    add("theme", c.id, c.name, { aliases: c.aliases, status: c.status, updatedAt: c.updatedAt, href: `/themes/${c.id}` });
  }
  for (const d of state.dialogueSessions) add("dialogue", d.id, d.title, { body: `${d.title} ${d.topic} ${d.purpose}`, status: d.status, updatedAt: d.updatedAt, href: `/dialogue/${d.id}` });
  for (const r of state.researchProjects) add("research_project", r.id, r.title, { body: `${r.title} ${r.question} ${r.description}`, status: r.status, updatedAt: r.updatedAt, href: `/research/${r.id}` });
  for (const s of state.syntheses) add("synthesis", s.id, s.statement, { body: s.statement, status: s.status, updatedAt: s.updatedAt, href: `/dialogue/${s.dialogueId}` });
  for (const t of state.tensions) add("tension", t.id, t.title, { body: `${t.title} ${t.thesis} ${t.antithesis}`, status: t.status, updatedAt: t.updatedAt, href: `/dialogue/${t.dialogueId}` });
  for (const d of state.decisions) add("decision", d.id, d.title, { body: `${d.title} ${d.question}`, status: d.status, updatedAt: d.updatedAt, href: `/decisions/${d.id}` });
  for (const i of state.inquiries) add("inquiry", i.id, i.question, { body: i.question, status: i.status, updatedAt: i.updatedAt, href: `/inquiry/${i.id}` });
  for (const f of state.formationSessions) add("formation", f.id, f.title || f.prompt, { body: `${f.title} ${f.prompt}`, status: f.status, updatedAt: f.updatedAt, href: `/formation/${f.id}` });
  for (const k of state.knowledgeProjects) add("knowledge_project", k.id, k.title, { body: k.title, status: k.status, updatedAt: k.updatedAt, href: `/author/${k.id}` });
  for (const s of state.sources) add("source", s.id, s.title, { body: `${s.title} ${s.author ?? ""}`, aliases: s.author ? [s.author] : [], status: s.status, updatedAt: s.addedAt, href: `/library/${s.id}` });

  return out;
}

/**
 * Resolve a record's CURRENT title + href from the store, or undefined if it no
 * longer exists. Used by recent-history and pinning to survive renames (title
 * refreshed) and deletions (entry dropped) without any stored duplicate.
 */
export function resolveRecord(state: StoreState, kind: string, id: string): { title: string; href: string; status?: string } | undefined {
  switch (kind) {
    case "capture": { const c = state.captures.find((x) => x.id === id); return c && { title: snip(c.text, 60), href: "/" }; }
    case "belief": { const b = state.beliefs.find((x) => x.id === id); return b && { title: snip(b.text, 60), href: "/constitution", status: b.status }; }
    case "concept": { const c = state.concepts.find((x) => x.id === id); return c && { title: c.name, href: `/world/concept/${c.id}`, status: c.status }; }
    case "theme": { const c = state.concepts.find((x) => x.id === id); return c && { title: c.name, href: `/themes/${c.id}`, status: c.status }; }
    case "dialogue": { const d = state.dialogueSessions.find((x) => x.id === id); return d && { title: d.title, href: `/dialogue/${d.id}`, status: d.status }; }
    case "research_project": { const r = state.researchProjects.find((x) => x.id === id); return r && { title: r.title, href: `/research/${r.id}`, status: r.status }; }
    case "synthesis": { const s = state.syntheses.find((x) => x.id === id); return s && { title: snip(s.statement, 60), href: `/dialogue/${s.dialogueId}`, status: s.status }; }
    case "tension": { const t = state.tensions.find((x) => x.id === id); return t && { title: t.title, href: `/dialogue/${t.dialogueId}`, status: t.status }; }
    case "decision": { const d = state.decisions.find((x) => x.id === id); return d && { title: d.title, href: `/decisions/${d.id}`, status: d.status }; }
    case "inquiry": { const i = state.inquiries.find((x) => x.id === id); return i && { title: snip(i.question, 60), href: `/inquiry/${i.id}`, status: i.status }; }
    case "formation": { const f = state.formationSessions.find((x) => x.id === id); return f && { title: f.title || snip(f.prompt, 60), href: `/formation/${f.id}`, status: f.status }; }
    case "knowledge_project": { const k = state.knowledgeProjects.find((x) => x.id === id); return k && { title: k.title, href: `/author/${k.id}`, status: k.status }; }
    case "source": { const s = state.sources.find((x) => x.id === id); return s && { title: s.title, href: `/library/${s.id}`, status: s.status }; }
    default: return undefined;
  }
}
