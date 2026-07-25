/**
 * Memory engine self-tests (LIFEOS-026).
 *
 * The repository ships no unit-test runner, so these deterministic, fixture-
 * driven assertions live in-tree and are surfaced by a dev-only route
 * (`/dev/memory-tests`) that an E2E suite asserts against. They cover every
 * memory engine: the shared explanation contract, Living Memory surfacing and
 * multi-reason accumulation, timeline derivation and ordering, theme
 * connections, recommendation explanation, Continue Thinking, reflection
 * prompts, PROJECTION PURITY (the engines never mutate the store), determinism
 * (identical inputs → identical outputs), and a performance budget.
 *
 * Pure: no I/O, no store, no AI. Import and run anywhere.
 */

import type {
  Belief, Capture, Concept, Decision, DialogueSession, Recommendation,
  ResearchProject, StoreState, Synthesis, Tension,
} from "@/types/mvp";
import { buildLivingMemory } from "@/lib/memory/living";
import { buildInsightTimeline } from "@/lib/memory/timeline";
import { buildThemes, buildTheme } from "@/lib/memory/themes";
import { explainRecommendation } from "@/lib/memory/recommendation";
import { buildContinueThinking } from "@/lib/memory/continue";
import { buildReflectionPrompts } from "@/lib/memory/prompts";
import { explain, isCompleteExplanation, daysSince } from "@/lib/memory/explanation";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport {
  pass: boolean;
  total: number;
  passed: number;
  failed: number;
  ms: number;
  results: SelfTestResult[];
}

// ---------------------------------------------------------------- fixtures ----

const NOW = Date.parse("2026-07-01T00:00:00.000Z");
const iso = (daysAgo: number): string => new Date(NOW - daysAgo * 86400000).toISOString();

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [],
    comparisons: [], inquiries: [], megathreads: [], reflections: [], practices: [],
    reviews: [], reasonings: [], embeddings: [], decisions: [], formationSessions: [],
    concepts: [], conceptRelationships: [], principles: [], frameworks: [],
    knowledgeProjects: [], researchProjects: [], dialogueSessions: [], tensions: [],
    syntheses: [], recommendations: [],
  };
}

function belief(p: Partial<Belief> & { id: string; text: string }): Belief {
  return {
    captureId: "", proposalId: "", theme: undefined, status: "accepted",
    createdAt: iso(120), updatedAt: iso(120), revisions: [], judgments: [], ...p,
  };
}

function capture(p: Partial<Capture> & { id: string; text: string }): Capture {
  return { createdAt: iso(1), ...p };
}

function concept(p: Partial<Concept> & { id: string; name: string }): Concept {
  return {
    aliases: [], definition: "", description: "", relatedBeliefs: [], relatedThreads: [],
    relatedSources: [], relatedPractices: [], parentConcepts: [], childConcepts: [],
    relatedConcepts: [], opposingConcepts: [], principleIds: [], questions: [], history: [],
    status: "active", source: "user", createdAt: iso(200), updatedAt: iso(10), ...p,
  };
}

function dialogue(p: Partial<DialogueSession> & { id: string; title: string }): DialogueSession {
  return {
    topic: "", purpose: "", status: "open", participants: [], seedRefs: [], turns: [],
    outcomes: [], history: [], createdAt: iso(60), updatedAt: iso(60), ...p,
  };
}

const CONF = { factual: "moderate", logical: "moderate", evidential: "moderate", experiential: "moderate" } as const;

function tension(p: Partial<Tension> & { id: string; dialogueId: string; title: string }): Tension {
  return {
    kind: "conflicting_beliefs", thesis: "", antithesis: "", thesisRefs: [], antithesisRefs: [],
    evidence: [], confidence: { ...CONF }, unresolvedQuestions: [], status: "open", origin: "detected",
    signature: p.id, history: [], createdAt: iso(40), updatedAt: iso(40), ...p,
  };
}

function synthesis(p: Partial<Synthesis> & { id: string; dialogueId: string; statement: string }): Synthesis {
  return {
    tensionIds: [], preservedInsights: [], discardedAssumptions: [], commonGround: [],
    remainingUncertainty: [], confidence: { ...CONF }, evidenceLinks: [], status: "candidate",
    origin: "generated", revisions: [], outcomes: [], createdAt: iso(20), updatedAt: iso(20), ...p,
  };
}

function decision(p: Partial<Decision> & { id: string; title: string }): Decision {
  return {
    question: "", status: "exploring", options: [], criteria: [], ratings: {}, constraints: [],
    assumptions: [], seedRefs: [], evidence: [], history: [], judgments: [], revisions: [],
    outcomeReviews: [], aiModel: "mock", source: "mock", coverage: null, partial: false,
    verified: false, createdAt: iso(90), updatedAt: iso(90), ...p,
  };
}

function research(p: Partial<ResearchProject> & { id: string; title: string }): ResearchProject {
  return {
    question: "", description: "", purpose: "", scope: "", status: "investigating",
    questions: { subquestions: [], unknowns: [], assumptions: [], definitions: [], successCriteria: [], openProblems: [] },
    assembly: { sourceIds: [], beliefIds: [], conceptIds: [], threadIds: [], reasoningIds: [], frameworkIds: [], principleIds: [], formationIds: [], decisionIds: [] },
    notes: [], hypotheses: [], argumentNodes: [], argumentEdges: [], history: [],
    createdAt: iso(120), updatedAt: iso(120), ...p,
  };
}

function recommendation(p: Partial<Recommendation> & { id: string; type: Recommendation["type"] }): Recommendation {
  return {
    priority: "medium", confidence: "moderate", rationale: "", subsystem: "belief",
    suggestedAction: "", affected: [], signature: p.id, createdAt: iso(2),
    dismissed: false, accepted: false, completed: false, ...p,
  };
}

/** A moderately rich, internally-consistent fixture exercising every engine. */
function richState(): StoreState {
  const s = emptyState();

  // A stale accepted belief that also (a) drifted, (b) has been revised 3× and
  // (c) is referenced by an open dialogue → multi-reason Living Memory + prompts.
  s.beliefs = [
    belief({
      id: "b-discipline", text: "Discipline is the foundation of freedom.", theme: "discipline",
      createdAt: iso(400), updatedAt: iso(96),
      revisions: [
        { text: "Discipline matters.", at: iso(400), reason: "proposed" },
        { text: "Discipline is important for freedom.", at: iso(300), reason: "rewritten" },
        { text: "Discipline enables freedom.", at: iso(200), reason: "reaffirmed" },
        { text: "Discipline is the foundation of freedom.", at: iso(96), reason: "rewritten" },
      ],
      judgments: [{ decision: "accepted", at: iso(96) }],
    }),
    belief({
      id: "b-freedom", text: "Freedom requires the absence of coercion.", theme: "freedom",
      createdAt: iso(300), updatedAt: iso(5), status: "accepted",
    }),
    belief({
      id: "b-questioned", text: "Certainty is possible.", status: "questioned",
      createdAt: iso(150), updatedAt: iso(3),
      judgments: [{ decision: "questioned", at: iso(3) }],
    }),
  ];

  s.captures = [
    capture({ id: "cap-1", text: "A note on discipline and daily practice.", createdAt: iso(2) }),
    capture({ id: "cap-2", text: "Thinking again about discipline this week.", createdAt: iso(4) }),
    capture({ id: "cap-src", text: "From a book on freedom.", createdAt: iso(3), sourceId: "src-x" }),
  ];

  s.concepts = [
    concept({
      id: "c-discipline", name: "discipline", aliases: ["self-discipline"],
      relatedBeliefs: ["b-discipline"], relatedSources: ["src-a", "src-b", "src-c"],
      createdAt: iso(500), updatedAt: iso(96),
    }),
    concept({
      id: "c-freedom", name: "freedom", relatedBeliefs: ["b-discipline", "b-freedom"],
      createdAt: iso(450), updatedAt: iso(30),
    }),
  ];

  s.dialogueSessions = [
    dialogue({ id: "d-open", title: "On discipline", status: "open", seedRefs: ["b-discipline"], createdAt: iso(60), updatedAt: iso(40) }),
    dialogue({ id: "d-done", title: "On certainty", status: "concluded", createdAt: iso(80), updatedAt: iso(70) }),
  ];

  s.tensions = [
    tension({ id: "t-1", dialogueId: "d-open", title: "Discipline vs. spontaneity", status: "open", createdAt: iso(40), updatedAt: iso(40) }),
  ];

  s.syntheses = [
    synthesis({ id: "syn-cand", dialogueId: "d-open", statement: "Discipline and freedom co-produce each other.", status: "candidate", updatedAt: iso(15) }),
    synthesis({ id: "syn-acc", dialogueId: "d-done", statement: "Certainty is a feeling, not a proof.", status: "accepted", updatedAt: iso(65) }),
  ];

  s.decisions = [
    decision({ id: "dec-stale", title: "Whether to wake at 5am", status: "exploring", createdAt: iso(120), updatedAt: iso(90) }),
    decision({ id: "dec-unreviewed", title: "Move cities", status: "decided", createdAt: iso(120), updatedAt: iso(80), outcomeReviews: [] }),
  ];

  s.researchProjects = [
    research({ id: "rp-1", title: "The history of discipline", question: "Where does discipline come from?", createdAt: iso(120), updatedAt: iso(100) }),
  ];

  s.recommendations = [
    recommendation({
      id: "rec-1", type: "review_belief", subsystem: "belief", confidence: "high",
      rationale: "not reviewed in months", affected: [{ kind: "belief", id: "b-discipline", label: "Discipline is the foundation of freedom." }],
      createdAt: iso(1), actionHref: "/constitution",
    }),
  ];

  return s;
}

// ------------------------------------------------------------------ harness ----

function check(results: SelfTestResult[], name: string, cond: boolean, detail = ""): void {
  results.push({ name, pass: Boolean(cond), detail: cond ? detail || "ok" : detail || "assertion failed" });
}

export function runMemorySelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const state = richState();
  const frozen = JSON.stringify(state);

  // ---- Explanation API (Feature 7) ----
  const e = explain({ triggers: [{ rule: "a", label: "reason a" }, { rule: "b", label: "reason b" }] });
  check(results, "explain: summary format", e.summary === "Suggested because: reason a; reason b.", e.summary);
  check(results, "explain: confidence from trigger count", e.confidence === "moderate", `got ${e.confidence}`);
  check(results, "explain: injectable generatedAt", explain({ triggers: [{ rule: "x", label: "y" }], generatedAt: iso(1) }).generatedAt === iso(1));
  check(results, "isCompleteExplanation: accepts complete", isCompleteExplanation(e) === true);
  check(results, "isCompleteExplanation: rejects empty triggers", isCompleteExplanation({ ...e, triggers: [] }) === false);
  check(results, "daysSince: whole days", daysSince(iso(96), NOW) === 96, `got ${daysSince(iso(96), NOW)}`);
  check(results, "daysSince: never negative", daysSince(iso(-5), NOW) === 0);

  // ---- Living Memory (Feature 1) ----
  const lm = buildLivingMemory(state, { now: NOW, generatedAt: iso(0) });
  const disc = lm.find((c) => c.recordId === "b-discipline");
  check(results, "living: surfaces the stale belief", Boolean(disc), `candidates=${lm.length}`);
  check(results, "living: primary kind is not_revisited", disc?.kind === "not_revisited", disc?.kind);
  check(results, "living: accumulates multiple reasons", (disc?.explanation.triggers.length ?? 0) >= 2, `triggers=${disc?.explanation.triggers.length}`);
  const rules = new Set(disc?.explanation.triggers.map((t) => t.rule));
  check(results, "living: reason — last reviewed", rules.has("not_revisited"));
  check(results, "living: reason — recent captures", rules.has("related_to_recent_capture"));
  check(results, "living: reason — unresolved dialogue", rules.has("unresolved_dialogue_exists"));
  check(results, "living: every candidate is fully explained", lm.every((c) => isCompleteExplanation(c.explanation)));
  check(results, "living: surfaces unresolved tension", lm.some((c) => c.kind === "unresolved_tension"));
  check(results, "living: surfaces abandoned research", lm.some((c) => c.kind === "abandoned_research" && c.recordId === "rp-1"));
  check(results, "living: surfaces forgotten decision", lm.some((c) => c.kind === "forgotten_decision"));
  check(results, "living: stable ids (no dupes)", new Set(lm.map((c) => c.id)).size === lm.length);
  check(results, "living: sorted most-reasons-first", isDescendingByTriggers(lm.map((c) => c.explanation.triggers.length)));

  // Determinism: identical inputs → identical outputs.
  const lm2 = buildLivingMemory(state, { now: NOW, generatedAt: iso(0) });
  check(results, "living: deterministic", JSON.stringify(lm) === JSON.stringify(lm2));

  // ---- Insight Timeline (Feature 2) ----
  const tl = buildInsightTimeline(state);
  check(results, "timeline: has belief_formed", tl.some((x) => x.kind === "belief_formed" && x.id === "bf:b-discipline"));
  check(results, "timeline: has belief_changed", tl.filter((x) => x.kind === "belief_changed" && x.id.startsWith("br:b-discipline")).length === 3, `changes=${tl.filter((x) => x.kind === "belief_changed" && x.id.startsWith("br:b-discipline")).length}`);
  check(results, "timeline: accepted synthesis only", tl.some((x) => x.kind === "synthesis" && x.id === "syn:syn-acc") && !tl.some((x) => x.id === "syn:syn-cand"));
  check(results, "timeline: dialogue completion", tl.some((x) => x.kind === "dialogue_completed" && x.id === "dc:d-done"));
  check(results, "timeline: newest-first ordering", isDescendingByDate(tl.map((x) => x.at)));
  check(results, "timeline: every entry carries evidence", tl.every((x) => x.evidence.length > 0));

  // ---- Theme Evolution (Feature 3) ----
  const themes = buildThemes(state, { min: 1 });
  const disciplineTheme = buildTheme(state, state.concepts[0]);
  check(results, "themes: builds at least one", themes.length >= 1, `themes=${themes.length}`);
  check(results, "themes: connects belief by reference", disciplineTheme.beliefs.some((c) => c.id === "b-discipline" && c.via === "reference"));
  check(results, "themes: connects capture by mention", disciplineTheme.captures.some((c) => c.via === "mention"));
  check(results, "themes: has frequency buckets", disciplineTheme.buckets.length >= 1);
  check(results, "themes: buckets chronological", isAscending(disciplineTheme.buckets.map((b) => b.month)));
  check(results, "themes: total equals connection count", disciplineTheme.total === (disciplineTheme.beliefs.length + disciplineTheme.captures.length + disciplineTheme.research.length + disciplineTheme.dialogues.length + disciplineTheme.syntheses.length + disciplineTheme.tensions.length));
  check(results, "themes: fully explained", isCompleteExplanation(disciplineTheme.explanation));

  // ---- Recommendation explanation (Feature 4) ----
  const rec = state.recommendations[0];
  const rx = explainRecommendation(state, rec);
  check(results, "rec: explanation complete", isCompleteExplanation(rx));
  check(results, "rec: trigger names the type", rx.triggers.some((t) => t.rule === "review_belief"));
  check(results, "rec: trigger names the subsystem", rx.triggers.some((t) => t.rule === "subsystem_belief"));
  check(results, "rec: carries recommendation confidence", rx.confidence === rec.confidence);
  check(results, "rec: generatedAt = createdAt", rx.generatedAt === rec.createdAt);
  check(results, "rec: evidence hrefs resolved", rx.evidence.every((v) => Boolean(v.href)));

  // ---- Continue Thinking (Feature 5) ----
  const cont = buildContinueThinking(state, { now: NOW });
  check(results, "continue: open dialogue", cont.some((c) => c.kind === "dialogue" && c.id === "dlg:d-open"));
  check(results, "continue: unfinished research", cont.some((c) => c.kind === "research" && c.id === "rp:rp-1"));
  check(results, "continue: open tension", cont.some((c) => c.kind === "tension" && c.id === "t:t-1"));
  check(results, "continue: stale belief review", cont.some((c) => c.kind === "belief_review" && c.id === "b:b-discipline"));
  check(results, "continue: questioned belief", cont.some((c) => c.kind === "belief_review" && c.id === "bq:b-questioned"));
  check(results, "continue: candidate synthesis", cont.some((c) => c.kind === "synthesis" && c.id === "s:syn-cand"));
  check(results, "continue: stale decision", cont.some((c) => c.kind === "decision"));
  check(results, "continue: newest-first ordering", isDescendingByDate(cont.map((c) => c.at)));

  // ---- Reflection Prompts (Feature 6) ----
  const prompts = buildReflectionPrompts(state);
  check(results, "prompts: changed_view", prompts.some((p) => p.kind === "changed_view" && p.explanation.evidence.some((v) => v.id === "b-discipline")));
  check(results, "prompts: never_challenged", prompts.some((p) => p.kind === "never_challenged" && p.explanation.evidence.some((v) => v.id === "b-freedom")));
  check(results, "prompts: multi_source", prompts.some((p) => p.kind === "multi_source"));
  check(results, "prompts: hidden_link", prompts.some((p) => p.kind === "hidden_link"));
  check(results, "prompts: every prompt fully explained", prompts.every((p) => isCompleteExplanation(p.explanation)));

  // ---- Projection purity: no engine mutated the store ----
  check(results, "purity: store untouched after all engines", JSON.stringify(state) === frozen);

  // ---- Performance budget over a larger synthetic state ----
  const big = scaleState(300);
  const p0 = Date.now();
  buildLivingMemory(big, { now: NOW });
  buildInsightTimeline(big);
  buildThemes(big);
  buildContinueThinking(big, { now: NOW });
  buildReflectionPrompts(big);
  const perfMs = Date.now() - p0;
  check(results, "perf: all engines under budget", perfMs < 1500, `${perfMs}ms for 300× records`);

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - t0,
    results,
  };
}

// ------------------------------------------------------------------ helpers ----

function isDescendingByTriggers(ns: number[]): boolean {
  for (let i = 1; i < ns.length; i++) if (ns[i] > ns[i - 1]) return false;
  return true;
}
function isDescendingByDate(ds: string[]): boolean {
  for (let i = 1; i < ds.length; i++) if (ds[i] > ds[i - 1]) return false;
  return true;
}
function isAscending(xs: string[]): boolean {
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1]) return false;
  return true;
}

/** Blow the rich fixture up N× with fresh ids for the performance budget. */
function scaleState(n: number): StoreState {
  const base = richState();
  const s = emptyState();
  for (let k = 0; k < n; k++) {
    const suffix = `-${k}`;
    s.beliefs.push(...base.beliefs.map((b) => ({ ...b, id: b.id + suffix })));
    s.captures.push(...base.captures.map((c) => ({ ...c, id: c.id + suffix })));
    s.concepts.push(...base.concepts.map((c) => ({ ...c, id: c.id + suffix, relatedBeliefs: c.relatedBeliefs.map((r) => r + suffix), relatedSources: c.relatedSources.map((r) => r + suffix) })));
    s.dialogueSessions.push(...base.dialogueSessions.map((d) => ({ ...d, id: d.id + suffix, seedRefs: d.seedRefs.map((r) => r + suffix) })));
    s.tensions.push(...base.tensions.map((t) => ({ ...t, id: t.id + suffix, dialogueId: t.dialogueId + suffix })));
    s.syntheses.push(...base.syntheses.map((y) => ({ ...y, id: y.id + suffix, dialogueId: y.dialogueId + suffix })));
    s.decisions.push(...base.decisions.map((d) => ({ ...d, id: d.id + suffix })));
    s.researchProjects.push(...base.researchProjects.map((r) => ({ ...r, id: r.id + suffix })));
  }
  return s;
}
