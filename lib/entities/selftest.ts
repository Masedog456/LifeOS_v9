/**
 * Entity workspace self-tests (LIFEOS-029).
 *
 * Fixture-driven, deterministic assertions for the unified entity API —
 * relationship generation, backlinks, activity timeline, context description,
 * previews/hover cards, graph neighbors, navigation-memory shape, and a
 * performance budget. Surfaced at `/dev/entity-tests`, asserted by the
 * `entity.mjs` E2E suite. Pure: no store, no localStorage, no AI.
 */

import type {
  Belief, Capture, Concept, Decision, DialogueSession, ReadingDocument, Citation, StoreState,
} from "@/types/mvp";
import { makeEntityContext, describeEntity, entityRef } from "@/lib/entities/entity";
import { entityRelationships, relationshipCount } from "@/lib/entities/relationships";
import { entityBacklinks, backlinkCount } from "@/lib/entities/backlinks";
import { entityActivity } from "@/lib/entities/activity";
import { entityTimeline, relativeTime } from "@/lib/entities/timeline";
import { entityPreview, entityNeighbors } from "@/lib/entities/preview";
import { INSPECTOR_TABS } from "@/lib/entities/inspector";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const iso = (d: number) => new Date(NOW - d * 86400000).toISOString();

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [],
    megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [],
    formationSessions: [], concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [],
    researchProjects: [], dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [], sessions: [], goals: [], projects: [], dailyReviews: [],
  };
}
const belief =(p: Partial<Belief> & { id: string; text: string }): Belief => ({ captureId: "", proposalId: "", status: "accepted", createdAt: iso(40), updatedAt: iso(40), revisions: [], judgments: [], ...p });
const capture = (p: Partial<Capture> & { id: string; text: string }): Capture => ({ createdAt: iso(50), ...p });
const concept = (p: Partial<Concept> & { id: string; name: string }): Concept => ({ aliases: [], definition: "", description: "", relatedBeliefs: [], relatedThreads: [], relatedSources: [], relatedPractices: [], parentConcepts: [], childConcepts: [], relatedConcepts: [], opposingConcepts: [], principleIds: [], questions: [], history: [], status: "active", source: "user", createdAt: iso(45), updatedAt: iso(10), ...p });
const decision = (p: Partial<Decision> & { id: string; title: string }): Decision => ({ question: "", status: "exploring", options: [], criteria: [], ratings: {}, constraints: [], assumptions: [], seedRefs: [], evidence: [], history: [], judgments: [], revisions: [], outcomeReviews: [], aiModel: "mock", source: "mock", coverage: null, partial: false, verified: false, createdAt: iso(30), updatedAt: iso(30), ...p });
const dialogue = (p: Partial<DialogueSession> & { id: string; title: string }): DialogueSession => ({ topic: "", purpose: "", status: "open", participants: [], seedRefs: [], turns: [], outcomes: [], history: [], createdAt: iso(20), updatedAt: iso(20), ...p });

function richState(): StoreState {
  const s = emptyState();
  s.captures = [capture({ id: "cap-1", text: "A thought about attention and focus." })];
  s.beliefs = [
    belief({ id: "b-attn", captureId: "cap-1", text: "Attention is the scarcest resource.", theme: "attention", updatedAt: iso(5), revisions: [{ text: "Attention matters.", at: iso(40), reason: "proposed" }, { text: "Attention is the scarcest resource.", at: iso(12), reason: "rewritten" }], judgments: [{ decision: "accepted", at: iso(12) }] }),
    belief({ id: "b-free", text: "Freedom needs discipline." }),
  ];
  s.concepts = [concept({ id: "c-attn", name: "attention", aliases: ["focus"], relatedBeliefs: ["b-attn"] })];
  s.decisions = [decision({ id: "d-1", title: "Quit social media", question: "does it cost attention?", seedRefs: ["b-attn"] })];
  s.dialogueSessions = [dialogue({ id: "dlg-1", title: "On attention", seedRefs: ["b-attn"] })];
  s.documents = [{
    id: "doc-1", title: "The Attention Essays", subtitle: "", authors: ["Simone Weil"], kind: "book", status: "reading",
    tags: [], notes: "", sections: [{ id: "sec-1", title: "One", order: 0, passages: [{ id: "p-1", sectionId: "sec-1", text: "Attention is generosity.", order: 0, highlights: [{ id: "h-1", passageId: "p-1", color: "yellow", text: "generosity", start: 13, end: 23, linked: [{ kind: "belief", id: "b-attn" }], createdAt: iso(8), updatedAt: iso(8) }], annotations: [{ id: "an-1", passageId: "p-1", text: "key idea", createdAt: iso(7), updatedAt: iso(7) }], linked: [{ kind: "belief", id: "b-attn" }] }] }],
    progress: { status: "reading", percent: 20, readPassageIds: [], startedAt: iso(9) }, sourceMetadata: { importFormat: "markdown" }, createdAt: iso(15), updatedAt: iso(6),
  } as ReadingDocument];
  s.citations = [{ id: "cit-1", recordKind: "belief", recordId: "b-attn", documentId: "doc-1", documentTitle: "The Attention Essays", author: "Simone Weil", sectionId: "sec-1", passageId: "p-1", highlightId: "h-1", createdAt: iso(8) } as Citation];
  return s;
}

function check(results: SelfTestResult[], name: string, cond: boolean, detail = ""): void {
  results.push({ name, pass: Boolean(cond), detail: cond ? detail || "ok" : detail || "assertion failed" });
}

export function runEntitySelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const state = richState();
  const ctx = makeEntityContext(state);

  // ---- Context description ----
  const b = describeEntity(ctx, "belief", "b-attn");
  check(results, "entity: describes a belief (title/summary/exists)", b.ref.exists && b.ref.title.includes("Attention") && b.ref.href === "/constitution");
  check(results, "entity: tags from theme", b.tags.includes("attention"));
  check(results, "entity: deleted record → exists=false", describeEntity(ctx, "belief", "ghost").ref.exists === false);
  check(results, "entity: resolves a document", entityRef(ctx, "document", "doc-1").href === "/document/doc-1");
  check(results, "entity: resolves an author", entityRef(ctx, "author", "Simone Weil").exists && entityRef(ctx, "author", "Simone Weil").href.includes("/reading/author/"));
  check(results, "entity: resolves a highlight into the reader", entityRef(ctx, "highlight", "h-1").href.includes("passage=p-1") && entityRef(ctx, "highlight", "h-1").href.includes("highlight=h-1"));

  // ---- Relationships ----
  const rels = entityRelationships(ctx, "belief", "b-attn");
  const label = (l: string) => rels.find((g) => g.label === l);
  check(results, "rel: belief referenced by its concept", label("Referenced by")?.items.some((i) => i.ref.kind === "concept") ?? false);
  check(results, "rel: belief referenced by the decision (seed)", (label("References") ?? label("Referenced by"))?.items.some((i) => i.ref.kind === "decision") ?? false, JSON.stringify(rels.map((g) => `${g.label}:${g.items.map((i) => i.ref.kind)}`)));
  check(results, "rel: belief derived from its capture", label("Derived from")?.items.some((i) => i.ref.kind === "capture") ?? false);
  check(results, "rel: citations group links the document", label("Citations")?.items.some((i) => i.ref.kind === "document") ?? false);
  check(results, "rel: related authors from the citing document", label("Related authors")?.items.some((i) => i.ref.kind === "author") ?? false);
  check(results, "rel: concept relationships include the belief", entityRelationships(ctx, "concept", "c-attn").some((g) => g.items.some((i) => i.ref.id === "b-attn")));
  check(results, "rel: dialogue contains no self-links", entityRelationships(ctx, "dialogue", "dlg-1").every((g) => g.items.every((i) => i.ref.id !== "dlg-1")));

  // ---- Backlinks ----
  const back = entityBacklinks(ctx, "belief", "b-attn");
  const kinds = new Set(back.map((g) => g.kind));
  check(results, "backlinks: grouped by source kind", kinds.has("concept") && kinds.has("decision") && kinds.has("dialogue"));
  check(results, "backlinks: reading document/passage cite the belief", kinds.has("document") || kinds.has("passage"));
  check(results, "backlinks: count is positive", backlinkCount(ctx, "belief", "b-attn") >= 3, `${backlinkCount(ctx, "belief", "b-attn")}`);
  check(results, "backlinks: navigable refs", back.every((g) => g.items.every((r) => r.href && r.exists)));

  // ---- Activity timeline ----
  const acts = entityActivity(ctx, "belief", "b-attn");
  check(results, "timeline: belief has created + revised + judged", acts.some((a) => a.kind === "created") && acts.some((a) => a.kind === "revised") && acts.some((a) => a.kind === "judged"));
  check(results, "timeline: newest-first", acts.every((a, i) => i === 0 || acts[i - 1].at >= a.at));
  const docActs = entityActivity(ctx, "document", "doc-1");
  check(results, "timeline: document shows highlight + annotation + reading", docActs.some((a) => a.kind === "highlight") && docActs.some((a) => a.kind === "annotation") && docActs.some((a) => a.kind === "reading"));
  const tl = entityTimeline(ctx, "belief", "b-attn", NOW);
  check(results, "timeline: relative labels present", tl.every((e) => e.relative.length > 0));
  check(results, "timeline: relativeTime formats", relativeTime(iso(0), NOW) === "today" && relativeTime(iso(1), NOW) === "yesterday" && /d ago/.test(relativeTime(iso(5), NOW)));

  // ---- Preview / hover card ----
  const pv = entityPreview(ctx, "belief", "b-attn");
  check(results, "preview: hover card has type + counts", pv.kindLabel === "Belief" && pv.relationships > 0 && pv.backlinks > 0);
  check(results, "preview: summary + last activity", pv.summary.length > 0 && Boolean(pv.lastActivityAt));

  // ---- Graph neighbors (mini graph) ----
  const nb = entityNeighbors(ctx, "belief", "b-attn");
  check(results, "graph: neighbors center is the entity", nb.center.id === "b-attn");
  check(results, "graph: immediate neighbors present + capped", nb.neighbors.length > 0 && nb.neighbors.length <= 12);
  check(results, "graph: neighbors are navigable + existing", nb.neighbors.every((n) => n.ref.exists && n.ref.href));

  // ---- Navigation memory shape ----
  check(results, "nav: inspector tabs defined", INSPECTOR_TABS.includes("overview") && INSPECTOR_TABS.includes("relationships") && INSPECTOR_TABS.length === 5);

  // ---- Determinism ----
  const ctx2 = makeEntityContext(richState());
  check(results, "determinism: same inputs → same relationships", JSON.stringify(entityRelationships(ctx2, "belief", "b-attn")) === JSON.stringify(entityRelationships(makeEntityContext(richState()), "belief", "b-attn")));

  // ---- Performance: many entities, cached relationships ----
  const big = scaleState(300);
  const bctx = makeEntityContext(big);
  const p0 = Date.now();
  let rel = 0;
  for (const bb of big.beliefs.slice(0, 200)) rel += relationshipCount(bctx, "belief", bb.id);
  // Re-run (cache hit) should be trivially fast; correctness is the count stability.
  for (const bb of big.beliefs.slice(0, 200)) rel += relationshipCount(bctx, "belief", bb.id);
  const perfMs = Date.now() - p0;
  check(results, "perf: 400 relationship builds under budget", perfMs < 1500, `${perfMs}ms, ${rel} rels, graph ${big.beliefs.length} beliefs`);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}

function scaleState(n: number): StoreState {
  const base = richState();
  const s = emptyState();
  for (let k = 0; k < n; k++) {
    const suf = `-${k}`;
    s.captures.push(...base.captures.map((c) => ({ ...c, id: c.id + suf })));
    s.beliefs.push(...base.beliefs.map((b) => ({ ...b, id: b.id + suf, captureId: b.captureId ? b.captureId + suf : "" })));
    s.concepts.push(...base.concepts.map((c) => ({ ...c, id: c.id + suf, relatedBeliefs: c.relatedBeliefs.map((r) => r + suf) })));
    s.decisions.push(...base.decisions.map((d) => ({ ...d, id: d.id + suf, seedRefs: d.seedRefs.map((r) => r + suf) })));
  }
  // Rebuild graph once by returning; makeEntityContext builds it.
  return s;
}
