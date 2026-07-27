/**
 * Unified entity API (LIFEOS-029).
 *
 * ONE deterministic way to describe ANY object in LifeOS — a capture, belief,
 * concept, research project, dialogue, decision, theme, author, document,
 * passage, synthesis, tension, formation, question, and every graph node type —
 * as a normalized Entity: a reference (kind + id + title + href + exists), a
 * summary, timestamps, tags, status, and notes. Built on the existing LIFEOS-021
 * graph, the LIFEOS-027 record catalog, and the LIFEOS-028 reading model — no
 * new storage, no AI, no page-specific logic. The inspector, relationship
 * explorer, backlinks, timeline, hover cards, and graph preview all consume it.
 */

import type { StoreState } from "@/types/mvp";
import { buildGraph, lookup, type KnowledgeGraph } from "@/lib/graph";
import { resolveRecord } from "@/lib/command/records";

/** Every entity kind the workspace can inspect. */
export type EntityKind = string;

export interface EntityRef {
  kind: EntityKind;
  id: string;
  title: string;
  href: string;
  /** False when the record no longer exists (deleted) — callers degrade gracefully. */
  exists: boolean;
}

export interface Entity {
  ref: EntityRef;
  summary: string;
  createdAt?: string;
  updatedAt?: string;
  tags: string[];
  status?: string;
  notes?: string;
}

/** Shared, memoizable context: the store snapshot + its graph (built once). */
export interface EntityContext {
  state: StoreState;
  graph: KnowledgeGraph;
}
export function makeEntityContext(state: StoreState, graph?: KnowledgeGraph): EntityContext {
  return { state, graph: graph ?? buildGraph(state) };
}

/** Singular, human labels (RECORD_LABELS is plural). */
export const ENTITY_LABEL: Record<string, string> = {
  capture: "Capture", belief: "Belief", concept: "Concept", theme: "Theme", dialogue: "Dialogue",
  research_project: "Research", synthesis: "Synthesis", tension: "Tension", decision: "Decision",
  formation: "Reflection", knowledge_project: "Authoring", source: "Source", inquiry: "Question",
  document: "Document", author: "Author", passage: "Passage", highlight: "Highlight", annotation: "Note",
  proposal: "Proposal", comparison: "Comparison", megathread: "Thread", reflection: "Reflection",
  practice: "Practice", review: "Review", reasoning: "Reasoning", principle: "Principle", framework: "Framework",
  workspace: "Workspace",
  goal: "Goal", project: "Project", milestone: "Milestone",
  daily_review: "Daily review",
};

const snip = (s: string | undefined, n = 80): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/** The document + passage a passage/highlight belongs to (for reader deep-links). */
function locateInReading(state: StoreState, kind: string, id: string): { docId?: string; passageId?: string; title?: string } {
  if (kind === "passage") {
    for (const d of state.documents) for (const s of d.sections) for (const p of s.passages) if (p.id === id) return { docId: d.id, passageId: p.id, title: snip(p.heading || p.text, 60) };
  }
  if (kind === "highlight") {
    for (const d of state.documents) for (const s of d.sections) for (const p of s.passages) for (const h of p.highlights) if (h.id === id) return { docId: d.id, passageId: p.id, title: snip(h.text, 60) };
  }
  if (kind === "annotation") {
    for (const d of state.documents) for (const s of d.sections) for (const p of s.passages) for (const a of p.annotations) if (a.id === id) return { docId: d.id, passageId: p.id, title: snip(a.text, 60) };
  }
  return {};
}

/**
 * The full description of an entity — title, href, existence, summary,
 * timestamps, tags, status, notes — for ANY kind. Reuses `resolveRecord` for the
 * catalog kinds and extends it for graph-only and reading kinds. Deterministic.
 */
export function describeEntity(ctx: EntityContext, kind: EntityKind, id: string): Entity {
  const { state, graph } = ctx;
  const base = resolveRecord(state, kind, id); // title/href/status for catalog kinds
  const node = lookup(graph, id);

  // Per-kind summary / timestamps / tags / notes.
  let summary = "";
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  let tags: string[] = [];
  let notes: string | undefined;
  let title = base?.title;
  let href = base?.href;
  const status = base?.status;
  let exists = Boolean(base);

  switch (kind) {
    case "capture": { const c = state.captures.find((x) => x.id === id); if (c) { summary = c.text; createdAt = c.createdAt; } exists ||= !!c; break; }
    case "belief": { const b = state.beliefs.find((x) => x.id === id); if (b) { summary = b.text; createdAt = b.createdAt; updatedAt = b.updatedAt; if (b.theme) tags = [b.theme]; } exists ||= !!b; break; }
    case "concept": case "theme": { const c = state.concepts.find((x) => x.id === id); if (c) { summary = c.definition || c.description || c.name; createdAt = c.createdAt; updatedAt = c.updatedAt; tags = c.aliases ?? []; } exists ||= !!c; break; }
    case "dialogue": { const d = state.dialogueSessions.find((x) => x.id === id); if (d) { summary = d.purpose || d.topic; createdAt = d.createdAt; updatedAt = d.updatedAt; } exists ||= !!d; break; }
    case "research_project": { const r = state.researchProjects.find((x) => x.id === id); if (r) { summary = r.question || r.description; createdAt = r.createdAt; updatedAt = r.updatedAt; } exists ||= !!r; break; }
    case "synthesis": { const s = state.syntheses.find((x) => x.id === id); if (s) { summary = s.statement; createdAt = s.createdAt; updatedAt = s.updatedAt; } exists ||= !!s; break; }
    case "tension": { const t = state.tensions.find((x) => x.id === id); if (t) { summary = t.detail || `${t.thesis} ↔ ${t.antithesis}`; createdAt = t.createdAt; updatedAt = t.updatedAt; } exists ||= !!t; break; }
    case "decision": { const d = state.decisions.find((x) => x.id === id); if (d) { summary = d.question; createdAt = d.createdAt; updatedAt = d.updatedAt; } exists ||= !!d; break; }
    case "inquiry": { const i = state.inquiries.find((x) => x.id === id); if (i) { summary = i.question; createdAt = i.createdAt; updatedAt = i.updatedAt; } exists ||= !!i; break; }
    case "formation": { const f = state.formationSessions.find((x) => x.id === id); if (f) { summary = f.prompt || f.title; createdAt = f.createdAt; updatedAt = f.updatedAt; tags = [f.type]; } exists ||= !!f; break; }
    case "knowledge_project": { const k = state.knowledgeProjects.find((x) => x.id === id); if (k) { summary = k.title; createdAt = k.createdAt; updatedAt = k.updatedAt; } exists ||= !!k; break; }
    case "source": { const s = state.sources.find((x) => x.id === id); if (s) { summary = s.author ? `by ${s.author}` : s.title; createdAt = s.addedAt; if (s.author) tags = [s.author]; } exists ||= !!s; break; }
    case "document": { const d = state.documents.find((x) => x.id === id); if (d) { summary = d.description || d.subtitle || d.authors.join(", "); createdAt = d.createdAt; updatedAt = d.updatedAt; tags = [...d.authors, ...d.tags]; notes = d.notes || undefined; } exists ||= !!d; break; }
    case "passage": case "highlight": case "annotation": {
      const loc = locateInReading(state, kind, id);
      exists = Boolean(loc.docId);
      if (loc.docId) {
        const d = state.documents.find((x) => x.id === loc.docId);
        title = title ?? loc.title;
        href = href ?? `/document/${loc.docId}?passage=${loc.passageId}${kind === "highlight" ? `&highlight=${id}` : ""}`;
        summary = loc.title ?? "";
        updatedAt = d?.updatedAt;
      }
      break;
    }
    case "author": {
      const docs = state.documents.filter((d) => d.authors.some((a) => a.toLowerCase() === id.toLowerCase()));
      exists = docs.length > 0;
      title = title ?? id;
      href = href ?? `/reading/author/${encodeURIComponent(id)}`;
      summary = `${docs.length} document${docs.length === 1 ? "" : "s"} in your library`;
      break;
    }
    case "proposal": { const p = state.proposals.find((x) => x.id === id); if (p) { summary = p.claim; createdAt = p.createdAt; href = href ?? "/inbox"; title = title ?? snip(p.claim, 60); exists = true; } break; }
    case "comparison": { const c = state.comparisons.find((x) => x.id === id); if (c) { summary = c.title; createdAt = c.createdAt; href = href ?? `/compare/${id}`; title = title ?? c.title; exists = true; } break; }
    case "megathread": { const t = state.megathreads.find((x) => x.id === id); if (t) { summary = t.title; createdAt = t.createdAt; updatedAt = t.updatedAt; href = href ?? `/threads/${id}`; title = title ?? t.title; exists = true; } break; }
    case "reasoning": { const q = state.reasonings.find((x) => x.id === id); if (q) { summary = q.question; createdAt = q.createdAt; updatedAt = q.updatedAt; href = href ?? `/reason/${id}`; title = title ?? snip(q.question, 60); exists = true; } break; }
    case "principle": { const p = state.principles.find((x) => x.id === id); if (p) { summary = p.statement; createdAt = p.createdAt; updatedAt = p.updatedAt; href = href ?? "/world"; title = title ?? snip(p.statement, 60); exists = true; } break; }
    case "framework": { const f = state.frameworks.find((x) => x.id === id); if (f) { summary = f.name; createdAt = f.createdAt; updatedAt = f.updatedAt; href = href ?? "/world"; title = title ?? f.name; exists = true; } break; }
    case "reflection": { const r = state.reflections.find((x) => x.id === id); if (r) { summary = r.response; createdAt = r.createdAt; href = href ?? "/formation"; title = title ?? snip(r.response, 60); exists = true; } break; }
    case "practice": { const p = state.practices.find((x) => x.id === id); if (p) { summary = p.userWording || p.title; createdAt = p.createdAt; href = href ?? "/formation"; title = title ?? snip(p.userWording || p.title, 60); exists = true; } break; }
    case "review": { const r = state.reviews.find((x) => x.id === id); if (r) { summary = `${r.type} review`; href = href ?? "/review"; title = title ?? `${r.type} review`; exists = true; } break; }
    case "workspace": { const w = (state.workspaces ?? []).find((x) => x.id === id); if (w) { summary = w.description || `${w.members.length} entities · ${w.goals.filter((g) => !g.done).length} open goals`; createdAt = w.createdAt; updatedAt = w.updatedAt; href = href ?? `/workspace/${w.id}`; title = title ?? w.name; exists = true; } break; }
    case "goal": { const g = (state.goals ?? []).find((x) => x.id === id); if (g) { summary = g.description || g.title; createdAt = g.createdAt; updatedAt = g.updatedAt; tags = g.tags; notes = g.notes || undefined; href = href ?? `/goal/${g.id}`; title = title ?? g.title; exists = true; } break; }
    case "project": { const p = (state.projects ?? []).find((x) => x.id === id); if (p) { summary = p.description || p.title; createdAt = p.createdAt; updatedAt = p.updatedAt; notes = p.notes || undefined; href = href ?? `/project/${p.id}`; title = title ?? p.title; exists = true; } break; }
    case "milestone": { for (const p of state.projects ?? []) { const m = p.milestones.find((x) => x.id === id); if (m) { summary = m.notes || m.title; createdAt = m.createdAt; updatedAt = m.updatedAt; href = href ?? `/project/${p.id}`; title = title ?? m.title; exists = true; break; } } break; }
    case "daily_review": { const r = (state.dailyReviews ?? []).find((x) => x.id === id); if (r) { summary = r.summary || `${r.wins.length} win(s) · ${r.lessons.length} lesson(s) · ${r.friction.length} friction · ${r.tomorrowFocus.length} focus`; createdAt = r.createdAt; updatedAt = r.updatedAt; notes = r.notes || undefined; href = href ?? `/daily/${r.date}`; title = title ?? `Review · ${r.date}`; exists = true; } break; }
    default: break;
  }

  // Fallbacks for anything the switch didn't fully resolve (graph node label).
  if (!title) title = (node?.label ?? snip(summary, 60)) || id;
  if (!href) href = "/";
  if (!summary) summary = node?.label ?? "";
  if (!exists) exists = Boolean(node) || Boolean(base);

  return { ref: { kind, id, title: title || "(untitled)", href, exists }, summary: snip(summary, 200), createdAt, updatedAt, tags, status, notes };
}

/** Just the reference (title/href/exists) — the common case for links & lists. */
export function entityRef(ctx: EntityContext, kind: EntityKind, id: string): EntityRef {
  return describeEntity(ctx, kind, id).ref;
}

/** Human label for a kind (singular). */
export function entityKindLabel(kind: string): string {
  return ENTITY_LABEL[kind] ?? kind.replace(/_/g, " ");
}
