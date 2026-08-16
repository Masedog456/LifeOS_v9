/**
 * Record catalog (LIFEOS-027).
 *
 * ONE deterministic mapping from every searchable/openable record type to: a
 * human label, a route (href), and how to read a title / body / status /
 * timestamp off the store. Search, recent-history, and pinning all consume this
 * so there is a single source of truth for "how do I show and open a record" —
 * no per-feature duplication. Pure and offline; no AI.
 */

import { noteDisplayTitle } from "@/lib/notes/notes";
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
  document: "Documents",
  author: "Authors",
  passage: "Passages",
  highlight: "Highlights",
  annotation: "Reading notes",
  workspace: "Workspaces",
  goal: "Goals",
  project: "Projects",
  milestone: "Milestones",
  daily_review: "Daily reviews",
  action: "Next actions",
  action_template: "Action templates",
};

/** Deterministic group ordering for search output (index = priority). */
export const RECORD_ORDER: string[] = [
  "action", "daily_review", "goal", "project", "milestone", "action_template", "workspace", "document", "author", "belief", "concept", "theme", "capture", "dialogue", "research_project",
  "synthesis", "tension", "decision", "inquiry", "formation", "knowledge_project", "source",
  "passage", "highlight", "annotation",
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

  for (const c of state.captures) add("capture", c.id, c.workingText ?? c.text, { body: `${c.text} ${c.workingText ?? ""} ${(c.tags ?? []).join(" ")}`, aliases: c.tags, status: c.processingStatus ?? "inbox", updatedAt: c.createdAt, href: "/" });
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

  // Workspaces (LIFEOS-030): first-class, searchable groupings of existing work.
  for (const w of state.workspaces ?? []) {
    if (w.archived) continue;
    add("workspace", w.id, w.name, { body: `${w.name} ${w.description} ${w.goals.map((g) => g.text).join(" ")}`, status: w.archived ? "archived" : "active", updatedAt: w.updatedAt, href: `/workspace/${w.id}` });
  }

  // Goals, projects & milestones (LIFEOS-031): searchable execution objects.
  for (const g of state.goals ?? []) {
    add("goal", g.id, g.title, { body: `${g.title} ${g.description} ${g.notes} ${g.tags.join(" ")}`, aliases: g.tags, status: g.status, updatedAt: g.updatedAt, href: `/goal/${g.id}` });
  }
  for (const p of state.projects ?? []) {
    add("project", p.id, p.title, { body: `${p.title} ${p.description} ${p.notes}`, status: p.status, updatedAt: p.updatedAt, href: `/project/${p.id}` });
    for (const m of p.milestones) {
      add("milestone", m.id, m.title, { body: `${m.title} ${m.notes}`, status: m.status, updatedAt: m.updatedAt, href: `/project/${p.id}` });
    }
  }

  // Daily reviews (LIFEOS-034): searchable by date, summary, and their entries.
  for (const r of state.dailyReviews ?? []) {
    const body = `${r.date} ${r.summary} ${r.notes} ${r.wins.map((w) => w.text).join(" ")} ${r.lessons.map((l) => l.text).join(" ")} ${r.friction.map((f) => f.description).join(" ")}`;
    add("daily_review", r.id, `Review · ${r.date}`, { body, aliases: [r.date], status: r.status, updatedAt: r.updatedAt, href: `/daily/${r.date}` });
  }

  // Next actions (LIFEOS-036): title, description, notes, tags, context, waitingOn.
  for (const a of state.nextActions ?? []) {
    const body = `${a.title} ${a.description} ${a.notes} ${a.tags.join(" ")} ${a.context ?? ""} ${a.waitingOn ?? ""}`;
    add("action", a.id, a.title || "(untitled action)", { body, status: a.status, updatedAt: a.updatedAt, href: `/actions/${a.id}` });
  }
  for (const t of state.actionTemplates ?? []) {
    add("action_template", t.id, t.title || "(untitled template)", { body: `${t.title} ${t.description} ${t.tags.join(" ")} ${t.context ?? ""} ${t.suggestedRecurrence ?? ""}`, updatedAt: t.updatedAt, href: `/actions?template=${t.id}` });
  }

  // ---- Reading companion (LIFEOS-028): documents, authors, passages, highlights, notes ----
  const authorSeen = new Set<string>();
  // Notes are registered with the EXISTING command index rather than getting an
  // index of their own — a second retrieval island is exactly what the Gap Audit
  // warned about (LIFEOS-052).
  for (const n of state.notes ?? []) {
    if (n.archived) continue;
    add("note", n.id, noteDisplayTitle(n), { body: `${n.title ?? ""} ${n.body} ${(n.tags ?? []).join(" ")}`, aliases: n.tags, updatedAt: n.updatedAt, href: `/notes?note=${n.id}` });
  }
  for (const doc of state.documents) {
    const sectionNotes = doc.sections.map((s) => s.note ?? "").join(" ");
    add("document", doc.id, doc.title, {
      body: `${doc.title} ${doc.subtitle ?? ""} ${doc.authors.join(" ")} ${doc.publication ?? ""} ${doc.description ?? ""} ${doc.tags.join(" ")} ${doc.notes} ${sectionNotes}`,
      aliases: [...doc.authors, ...doc.tags],
      status: doc.status, updatedAt: doc.updatedAt, href: `/document/${doc.id}`,
    });
    for (const a of doc.authors) {
      const key = a.toLowerCase().trim();
      if (!key || authorSeen.has(key)) continue;
      authorSeen.add(key);
      add("author", key, a, { body: a, updatedAt: doc.updatedAt, href: `/reading/author/${encodeURIComponent(a)}` });
    }
    for (const s of doc.sections) for (const p of s.passages) {
      add("passage", p.id, p.heading || snip(p.text, 60), { body: p.text, updatedAt: doc.updatedAt, href: `/document/${doc.id}?passage=${p.id}` });
      for (const h of p.highlights) add("highlight", h.id, snip(h.text, 60), { body: `${h.text} ${h.note ?? ""}`, updatedAt: h.updatedAt, href: `/document/${doc.id}?passage=${p.id}&highlight=${h.id}` });
      for (const an of p.annotations) add("annotation", an.id, snip(an.text, 60), { body: an.text, updatedAt: an.updatedAt, href: `/document/${doc.id}?passage=${p.id}` });
    }
  }

  return out;
}

/**
 * Resolve a record's CURRENT title + href from the store, or undefined if it no
 * longer exists. Used by recent-history and pinning to survive renames (title
 * refreshed) and deletions (entry dropped) without any stored duplicate.
 */
export function resolveRecord(state: StoreState, kind: string, id: string): { title: string; href: string; status?: string } | undefined {
  switch (kind) {
    case "note": { const n = (state.notes ?? []).find((x) => x.id === id); return n && { title: noteDisplayTitle(n), href: `/notes?note=${n.id}` }; }
    case "capture": { const c = state.captures.find((x) => x.id === id); return c && { title: snip(c.workingText ?? c.text, 60), href: "/", status: c.processingStatus ?? "inbox" }; }
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
    case "document": { const d = state.documents.find((x) => x.id === id); return d && { title: d.title, href: `/document/${d.id}`, status: d.status }; }
    case "workspace": { const w = (state.workspaces ?? []).find((x) => x.id === id); return w && { title: w.name, href: `/workspace/${w.id}`, status: w.archived ? "archived" : "active" }; }
    case "goal": { const g = (state.goals ?? []).find((x) => x.id === id); return g && { title: g.title, href: `/goal/${g.id}`, status: g.status }; }
    case "project": { const p = (state.projects ?? []).find((x) => x.id === id); return p && { title: p.title, href: `/project/${p.id}`, status: p.status }; }
    case "milestone": { for (const p of state.projects ?? []) { const m = p.milestones.find((x) => x.id === id); if (m) return { title: m.title, href: `/project/${p.id}`, status: m.status }; } return undefined; }
    case "daily_review": { const r = (state.dailyReviews ?? []).find((x) => x.id === id); return r && { title: `Review · ${r.date}`, href: `/daily/${r.date}`, status: r.status }; }
    case "action": { const a = (state.nextActions ?? []).find((x) => x.id === id); return a && { title: a.title || "(untitled action)", href: `/actions/${a.id}`, status: a.status }; }
    case "action_template": { const t = (state.actionTemplates ?? []).find((x) => x.id === id); return t && { title: t.title || "(untitled template)", href: `/actions?template=${t.id}` }; }
    default: return undefined;
  }
}
