/**
 * Command Center self-tests (LIFEOS-027).
 *
 * Fixture-driven, deterministic assertions for the whole command subsystem —
 * command registration + duplicate prevention, search ranking (exact / prefix /
 * contains / alias / body), grouped output, stable sorting, recent-history
 * dedupe/cap/reconciliation (incl. deleted + renamed records), pinning, keyboard
 * shortcut guards, user isolation, projection purity, and a performance budget.
 * Surfaced at `/dev/command-tests`, asserted by the `command.mjs` E2E suite.
 * Pure: no store, no localStorage, no AI.
 */

import type {
  Belief, Capture, Concept, Decision, DialogueSession, Inquiry, ResearchProject,
  StoreState, Synthesis, Tension,
} from "@/types/mvp";
import { buildIndex, searchFlat, searchGrouped } from "@/lib/command/search";
import { compareResults, normalizeQuery, scoreEntry } from "@/lib/command/ranking";
import { buildCommands, CommandRegistry } from "@/lib/command/registry";
import { applyToggle, applyVisit, reconcile, RECENT_CAP } from "@/lib/command/recent";
import { resolveKey, isTypingTarget } from "@/lib/command/shortcuts";
import type { RecordRef } from "@/lib/prefs";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const NOW = Date.parse("2026-08-01T00:00:00.000Z");
const iso = (d: number) => new Date(NOW - d * 86400000).toISOString();

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [],
    inquiries: [], megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [],
    embeddings: [], decisions: [], formationSessions: [], concepts: [], conceptRelationships: [],
    principles: [], frameworks: [], knowledgeProjects: [], researchProjects: [], dialogueSessions: [],
    tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [], sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [], planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [],
  };
}
const CONF = { factual: "moderate", logical: "moderate", evidential: "moderate", experiential: "moderate" } as const;
const belief = (p: Partial<Belief> & { id: string; text: string }): Belief => ({ captureId: "", proposalId: "", status: "accepted", createdAt: iso(60), updatedAt: iso(60), revisions: [], judgments: [], ...p });
const capture = (p: Partial<Capture> & { id: string; text: string }): Capture => ({ createdAt: iso(1), ...p });
const concept = (p: Partial<Concept> & { id: string; name: string }): Concept => ({ aliases: [], definition: "", description: "", relatedBeliefs: [], relatedThreads: [], relatedSources: [], relatedPractices: [], parentConcepts: [], childConcepts: [], relatedConcepts: [], opposingConcepts: [], principleIds: [], questions: [], history: [], status: "active", source: "user", createdAt: iso(90), updatedAt: iso(10), ...p });
const dialogue = (p: Partial<DialogueSession> & { id: string; title: string }): DialogueSession => ({ topic: "", purpose: "", status: "open", participants: [], seedRefs: [], turns: [], outcomes: [], history: [], createdAt: iso(30), updatedAt: iso(30), ...p });
const tension = (p: Partial<Tension> & { id: string; dialogueId: string; title: string }): Tension => ({ kind: "conflicting_beliefs", thesis: "", antithesis: "", thesisRefs: [], antithesisRefs: [], evidence: [], confidence: { ...CONF }, unresolvedQuestions: [], status: "open", origin: "detected", signature: p.id, history: [], createdAt: iso(20), updatedAt: iso(20), ...p });
const synthesis = (p: Partial<Synthesis> & { id: string; dialogueId: string; statement: string }): Synthesis => ({ tensionIds: [], preservedInsights: [], discardedAssumptions: [], commonGround: [], remainingUncertainty: [], confidence: { ...CONF }, evidenceLinks: [], status: "candidate", origin: "generated", revisions: [], outcomes: [], createdAt: iso(15), updatedAt: iso(15), ...p });
const decision = (p: Partial<Decision> & { id: string; title: string }): Decision => ({ question: "", status: "exploring", options: [], criteria: [], ratings: {}, constraints: [], assumptions: [], seedRefs: [], evidence: [], history: [], judgments: [], revisions: [], outcomeReviews: [], aiModel: "mock", source: "mock", coverage: null, partial: false, verified: false, createdAt: iso(40), updatedAt: iso(40), ...p });
const research = (p: Partial<ResearchProject> & { id: string; title: string }): ResearchProject => ({ question: "", description: "", purpose: "", scope: "", status: "investigating", questions: { subquestions: [], unknowns: [], assumptions: [], definitions: [], successCriteria: [], openProblems: [] }, assembly: { sourceIds: [], beliefIds: [], conceptIds: [], threadIds: [], reasoningIds: [], frameworkIds: [], principleIds: [], formationIds: [], decisionIds: [] }, notes: [], hypotheses: [], argumentNodes: [], argumentEdges: [], history: [], createdAt: iso(50), updatedAt: iso(50), ...p });
const inquiry = (p: Partial<Inquiry> & { id: string; question: string }): Inquiry => ({ status: "open", sourceIds: [], beliefIds: [], comparisonIds: [], judgments: [], history: [], createdAt: iso(25), updatedAt: iso(25), ...p } as Inquiry);

function richState(): StoreState {
  const s = emptyState();
  s.beliefs = [
    belief({ id: "b-attn", text: "Attention is the scarcest resource I have.", theme: "attention", updatedAt: iso(5) }),
    belief({ id: "b-disc", text: "Discipline is the foundation of freedom.", theme: "discipline", updatedAt: iso(96), status: "accepted" }),
  ];
  s.captures = [capture({ id: "cap-1", text: "A note about attention and focus.", createdAt: iso(2) })];
  s.concepts = [
    concept({ id: "c-attn", name: "attention", aliases: ["focus", "awareness"], definition: "the allocation of cognitive resources", updatedAt: iso(3) }),
    concept({ id: "c-free", name: "freedom", updatedAt: iso(30) }),
  ];
  s.dialogueSessions = [dialogue({ id: "d-1", title: "On attention", topic: "attention", status: "open", updatedAt: iso(10) })];
  s.tensions = [tension({ id: "t-1", dialogueId: "d-1", title: "Attention vs. rest", status: "open" })];
  s.syntheses = [synthesis({ id: "sy-1", dialogueId: "d-1", statement: "Attention and rest reinforce each other." })];
  s.decisions = [decision({ id: "dec-1", title: "Whether to quit social media", question: "does it cost my attention?" })];
  s.researchProjects = [research({ id: "rp-1", title: "The economics of attention" })];
  s.inquiries = [inquiry({ id: "iq-1", question: "What is attention, really?" })];
  return s;
}

function check(results: SelfTestResult[], name: string, cond: boolean, detail = ""): void {
  results.push({ name, pass: Boolean(cond), detail: cond ? detail || "ok" : detail || "assertion failed" });
}

export function runCommandSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const state = richState();
  const frozen = JSON.stringify(state);

  // ---- Registry: registration + duplicate prevention ----
  const cmds = buildCommands({ state, recent: [], pinned: [] });
  check(results, "registry: builds the static command set", cmds.some((c) => c.id === "nav:today") && cmds.some((c) => c.id === "create:capture"));
  check(results, "registry: navigation covers memory/timeline/themes", ["nav:memory", "nav:timeline", "nav:themes"].every((id) => cmds.some((c) => c.id === id)));
  const reg = new CommandRegistry()
    .registerStatic([{ id: "dup", title: "First", group: "A", kind: "action" }])
    .registerStatic([{ id: "dup", title: "Second (should be ignored)", group: "B", kind: "action" }]);
  const built = reg.build({ state, recent: [], pinned: [] });
  check(results, "registry: duplicate ids prevented (first wins)", built.filter((c) => c.id === "dup").length === 1 && built[0].title === "First");
  const custom = new CommandRegistry().register(() => [{ id: "ext:x", title: "Extension command", group: "Ext", kind: "action" }]).build({ state, recent: [], pinned: [] });
  check(results, "registry: extensible via custom provider", custom.some((c) => c.id === "ext:x"));

  // ---- Continue Work integration (reuses LIFEOS-026 projection) ----
  check(results, "commands: continue-work surfaced", cmds.some((c) => c.kind === "continue"));

  // ---- Search: index + ranking ----
  const index = buildIndex(state);
  check(results, "search: index covers all record kinds", ["belief", "concept", "theme", "capture", "dialogue", "research_project", "synthesis", "tension", "decision", "inquiry"].every((k) => index.some((e) => e.kind === k)));

  const exact = searchFlat(index, "attention");
  check(results, "search: exact title match ranks first", exact[0]?.matchField === "title-exact" && exact[0]?.entry.kind === "concept", `${exact[0]?.matchField} / ${exact[0]?.entry.kind}`);
  check(results, "search: exact scores above prefix/contains", (scoreEntry(index.find((e) => e.titleLower === "attention")!, "attention")?.score ?? 0) === 1000);

  const prefix = scoreEntry({ kind: "x", id: "1", title: "Attention economy", titleLower: "attention economy", aliasesLower: [], bodyLower: "", snippet: "", updatedAt: "", href: "" }, "attention");
  check(results, "search: title prefix match", prefix?.matchField === "title-prefix" && prefix.score === 800);

  const contains = searchFlat(index, "economics");
  check(results, "search: title-contains match found", contains.some((r) => r.entry.kind === "research_project"));

  const alias = searchFlat(index, "focus");
  check(results, "search: alias match (concept alias 'focus')", alias.some((r) => r.entry.kind === "concept" && r.matchField === "alias"));

  const body = searchFlat(index, "cognitive resources");
  check(results, "search: body/notes match", body.some((r) => r.matchField === "body"));

  check(results, "search: case-insensitive", searchFlat(index, "ATTENTION").length === searchFlat(index, "attention").length);
  check(results, "search: punctuation-tolerant", searchFlat(index, "self discipline").length === searchFlat(index, "self-discipline").length);
  check(results, "search: empty query returns nothing", searchFlat(index, "   ").length === 0);
  check(results, "search: normalizeQuery strips punctuation", normalizeQuery("Self-Discipline?!") === "self discipline");

  // Grouped output + group ordering (beliefs before concepts before themes…).
  const groups = searchGrouped(index, "attention");
  check(results, "search: results grouped by kind", groups.length > 1 && groups.every((g) => g.results.length > 0));
  const order = groups.map((g) => g.kind);
  check(results, "search: belief group precedes theme group", order.indexOf("belief") < order.indexOf("theme") || !order.includes("belief") || !order.includes("theme"));

  // Stable sorting on tie: same score → deterministic order, re-run identical.
  const a1 = JSON.stringify(searchFlat(index, "attention"));
  const a2 = JSON.stringify(searchFlat(index, "attention"));
  check(results, "search: deterministic / stable sort", a1 === a2);
  // Comparator is a total order on equal scores.
  const e = index[0];
  check(results, "ranking: comparator stable on equal entries", compareResults({ entry: e, score: 500, matchField: "title" }, { entry: e, score: 500, matchField: "title" }) === 0);

  // ---- Recent history: dedupe / cap / deleted / renamed ----
  let recent: RecordRef[] = [];
  recent = applyVisit(recent, { kind: "belief", id: "b-attn", title: "Attention…", at: iso(0) });
  recent = applyVisit(recent, { kind: "concept", id: "c-attn", title: "attention", at: iso(0) });
  recent = applyVisit(recent, { kind: "belief", id: "b-attn", title: "Attention…", at: iso(0) }); // revisit
  check(results, "recent: revisiting moves to top, no duplicate", recent.length === 2 && recent[0].id === "b-attn");
  let capped: RecordRef[] = [];
  for (let i = 0; i < 30; i++) capped = applyVisit(capped, { kind: "capture", id: `x${i}`, title: `c${i}`, at: iso(0) });
  check(results, "recent: capped at RECENT_CAP", capped.length === RECENT_CAP);
  const reconciled = reconcile(
    [{ kind: "belief", id: "b-attn", title: "stale title", at: iso(0) }, { kind: "belief", id: "ghost", title: "deleted", at: iso(0) }],
    (kind, id) => (id === "b-attn" ? { title: "Attention is the scarcest resource I have." } : undefined),
  );
  check(results, "recent: deleted records dropped, renamed refreshed", reconciled.length === 1 && reconciled[0].title.startsWith("Attention"));

  // ---- Pinning ----
  let pinned: RecordRef[] = [];
  const pin1 = applyToggle(pinned, { kind: "concept", id: "c-attn", title: "attention", at: iso(0) });
  pinned = pin1.next;
  check(results, "pin: toggling on adds", pin1.pinned === true && pinned.length === 1);
  const pin2 = applyToggle(pinned, { kind: "concept", id: "c-attn", title: "attention", at: iso(0) });
  check(results, "pin: toggling off removes", pin2.pinned === false && pin2.next.length === 0);

  // ---- Shortcut guards ----
  const mk = (key: string, o: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({ key, ctrl: false, meta: false, shift: false, alt: false, ...o });
  check(results, "shortcut: Cmd+K opens palette", resolveKey(mk("k", { meta: true }), { typing: false, chordPending: false }).type === "palette");
  check(results, "shortcut: Ctrl+K opens palette", resolveKey(mk("k", { ctrl: true }), { typing: false, chordPending: false }).type === "palette");
  check(results, "shortcut: Shift+Cmd+K quick capture", resolveKey(mk("k", { meta: true, shift: true }), { typing: false, chordPending: false }).type === "quick-capture");
  check(results, "shortcut: palette works even while typing (modifier combo)", resolveKey(mk("k", { meta: true }), { typing: true, chordPending: false }).type === "palette");
  check(results, "shortcut: '/' focuses search when not typing", resolveKey(mk("/"), { typing: false, chordPending: false }).type === "focus-search");
  check(results, "shortcut: '/' suppressed while typing", resolveKey(mk("/"), { typing: true, chordPending: false }).type === "none");
  check(results, "shortcut: 'g' starts a chord", resolveKey(mk("g"), { typing: false, chordPending: false }).type === "start-chord");
  const goto = resolveKey(mk("t"), { typing: false, chordPending: true });
  check(results, "shortcut: 'g then t' navigates to Today", goto.type === "goto" && goto.type === "goto" && goto.href === "/today");
  check(results, "shortcut: chord suppressed while typing", resolveKey(mk("t"), { typing: true, chordPending: true }).type === "none");
  check(results, "shortcut: '?' opens help", resolveKey(mk("?"), { typing: false, chordPending: false }).type === "shortcut-help");
  check(results, "shortcut: isTypingTarget detects inputs", isTypingTarget({ tagName: "INPUT", isContentEditable: false, getAttribute: () => null } as unknown as EventTarget) === true && isTypingTarget({ tagName: "DIV", isContentEditable: false, getAttribute: () => null } as unknown as EventTarget) === false);

  // ---- User isolation: results derive ONLY from the given state ----
  const otherState = emptyState();
  otherState.beliefs = [belief({ id: "other", text: "A belief from a different user." })];
  const otherIndex = buildIndex(otherState);
  check(results, "isolation: search reflects only the provided state", searchFlat(otherIndex, "attention").length === 0 && searchFlat(index, "different user").length === 0);

  // ---- Projection purity: building index/commands never mutates the store ----
  buildIndex(state); buildCommands({ state, recent: getRefs(), pinned: [] }); searchGrouped(index, "a");
  check(results, "purity: store untouched by index/command/search builds", JSON.stringify(state) === frozen);

  // ---- Performance: large synthetic store ----
  const big = scaleState(400);
  const p0 = Date.now();
  const bigIndex = buildIndex(big);
  let hits = 0;
  for (const q of ["attention", "freedom", "disc", "econom", "rest"]) hits += searchFlat(bigIndex, q).length;
  const perfMs = Date.now() - p0;
  check(results, "perf: index build + 5 queries under budget", perfMs < 1000, `${perfMs}ms over ${bigIndex.length} entries, ${hits} hits`);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}

function getRefs(): RecordRef[] { return [{ kind: "belief", id: "b-attn", title: "x", at: iso(0) }]; }

function scaleState(n: number): StoreState {
  const base = richState();
  const s = emptyState();
  for (let k = 0; k < n; k++) {
    const suf = `-${k}`;
    s.beliefs.push(...base.beliefs.map((b) => ({ ...b, id: b.id + suf })));
    s.captures.push(...base.captures.map((c) => ({ ...c, id: c.id + suf })));
    s.concepts.push(...base.concepts.map((c) => ({ ...c, id: c.id + suf })));
    s.dialogueSessions.push(...base.dialogueSessions.map((d) => ({ ...d, id: d.id + suf })));
    s.researchProjects.push(...base.researchProjects.map((r) => ({ ...r, id: r.id + suf })));
    s.decisions.push(...base.decisions.map((d) => ({ ...d, id: d.id + suf })));
    s.inquiries.push(...base.inquiries.map((i) => ({ ...i, id: i.id + suf })));
  }
  return s;
}
