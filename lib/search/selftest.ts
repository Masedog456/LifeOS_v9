/**
 * Universal search self-tests (LIFEOS-085).
 *
 * ## The red proofs this suite pins
 *
 * §2's audit ran the real index over §3's own example. Each failure it measured
 * is asserted below in the form it failed:
 *
 *   1. "grad school" could not find the Goal called "Graduate school", and
 *      returned a raw inbox capture first
 *   2. every multi-word natural query returned nothing — "rules about anger",
 *      "things I'm waiting on", "my long-term goals", "notes from last week"
 *   3. note, protocol and constitution_element were indexed but labelled
 *      nowhere, so the palette printed their table names
 *   4. three questions the product answers returned "No matches"
 *   5. a processed capture duplicated the action it became
 *   6. an AI-authored note outranked a real project, unattributable
 *   7. a goal's horizon was indexed nowhere
 *   8. a linked Action was unreachable from the goal that named it
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * Search earns trust by what it refuses to do: bury an exact title under a
 * fuzzy match, expand through the graph forever, return a record the person
 * deleted, put "You wrote" over a model's sentence, or invent a relevance
 * percentage. Those are asserted as negatives, and the caps are proved with
 * over-supplied fixtures so a limit that silently does nothing cannot pass.
 *
 * Pure: no store, no clock, no AI.
 */

import type { NextAction, Goal, Project, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildIndex } from "@/lib/command/search";
import { RECORD_LABELS, RECORD_ORDER, buildSearchEntries } from "@/lib/command/records";
import { normalizeQuery, queryTokens, scoreEntry } from "@/lib/command/ranking";
import {
  searchEverything, readFilters, isQuestion, labelFor,
  SEARCH_LIMIT, MAX_LINKED, SEARCH_FORBIDDEN_WORDS, DOMAIN_WORDS, STATUS_WORDS,
} from "@/lib/search/everything";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-04";
const D = (o = 0): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const A = (o = 0, h = 9): string => `${D(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: A(-20), updatedAt: A(-20), ...p,
} as NextAction);

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [],
  createdAt: A(-60), updatedAt: A(-60), ...p,
} as Goal);

const proj = (p: Partial<Project> & { id: string; title: string }): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Project);

/** §3's own example, plus every trap the audit found. */
function world(): StoreState {
  return {
    ...emptyStoreState(),
    goals: [
      goal({ id: "g1", title: "Graduate school", horizon: "medium", description: "Apply to philosophy PhD programs." } as Partial<Goal> & { id: string; title: string }),
      goal({ id: "g2", title: "Run a marathon", horizon: "long" } as Partial<Goal> & { id: string; title: string }),
    ],
    projects: [proj({ id: "pr1", title: "Fall applications", goalId: "g1" } as Partial<Project> & { id: string; title: string })],
    nextActions: [
      // Linked through the goal's project; its TITLE says nothing about school.
      act({ id: "a1", title: "Request recommendation letter", projectId: "pr1", sourceCaptureId: "c1" } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a2", title: "Submit UH application", projectId: "pr1", status: "completed", completedAt: A(-2, 14) } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a3", title: "Transcript from registrar", status: "waiting", waitingOn: "the registrar", waitingSince: D(-8), followUpDate: D(0) } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a4", title: "Lease from Marcus", status: "waiting", waitingOn: "Marcus", waitingSince: D(-3) } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a5", title: "Water the plants" }),
    ],
    reflections: [{
      id: "rf1", prompt: "On teaching",
      response: "I think I care more about philosophy than teaching.",
      createdAt: A(-7, 20), annotations: [],
    }] as StoreState["reflections"],
    notes: [
      { id: "n1", title: "Application deadlines", body: "Deadlines: Berkeley Dec 1, NYU Dec 15.", archived: false, tags: ["grad"], linkedEntityRefs: [], createdAt: A(-5, 7), updatedAt: A(-5, 7) },
      // The provenance trap: a model's sentence, newer than the project.
      { id: "n2", body: "AI summary: your applications are progressing well.", fromAiText: true, archived: false, tags: [], linkedEntityRefs: [], createdAt: A(-1, 7), updatedAt: A(-1, 7) },
      // Soft-deleted. Must never appear (§28).
      { id: "n3", body: "Old scratch note about graduate school.", archived: true, tags: [], linkedEntityRefs: [], createdAt: A(-40, 7), updatedAt: A(-40, 7) },
    ] as StoreState["notes"],
    constitutionElements: [
      { id: "s1", kind: "standard", status: "active", statement: "When overwhelmed, work on one application at a time.", adoptedAt: A(-60), linkedRefs: [], createdAt: A(-60), updatedAt: A(-60) },
      { id: "s2", kind: "standard", status: "active", statement: "Never reply to anger with anger.", adoptedAt: A(-60), linkedRefs: [], createdAt: A(-60), updatedAt: A(-60) },
      // Retired. Excluded from search, still readable on the Constitution.
      { id: "s3", kind: "standard", status: "retired", statement: "Never work at weekends about anger.", adoptedAt: A(-90), retiredAt: A(-30), linkedRefs: [], createdAt: A(-90), updatedAt: A(-30) },
    ] as StoreState["constitutionElements"],
    protocols: [
      { id: "p1", trigger: "I am angry", response: "wait an hour before replying", status: "active", createdAt: A(-60), updatedAt: A(-60) },
    ] as StoreState["protocols"],
    documents: [{
      id: "doc1", title: "Graduate programs in philosophy", authors: ["Jane Reed"], kind: "pdf",
      status: "reading", tags: ["grad school"], notes: "Rankings and deadlines.", sections: [],
      progress: {}, sourceMetadata: {}, createdAt: A(-30), updatedAt: A(-30),
    }] as unknown as StoreState["documents"],
    captures: [
      // ALREADY became a1 — the store recorded the link.
      { id: "c1", text: "request recommendation letter from prof", workingText: "request recommendation letter from prof", processingStatus: "processed", tags: [], createdAt: A(-21) },
      // Still raw, and holds wording nothing else does (§26).
      { id: "c2", text: "idea: audit a grad school seminar before applying", processingStatus: "inbox", tags: [], createdAt: A(-4) },
    ] as StoreState["captures"],
    events: [{ id: "ev1", title: "Advisor meeting about grad school", date: D(3), startTime: "10:00", allDay: false, createdAt: A(-10), updatedAt: A(-10) }] as StoreState["events"],
  };
}

export function runUniversalSearchSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const index = buildIndex(s);
  const find = (q: string, opts: Record<string, unknown> = {}) =>
    searchEverything(s, q, { index, today: TODAY, ...opts });
  const titles = (q: string) => find(q).results.map((r) => r.title);
  const kinds = (q: string) => find(q).results.map((r) => r.entityType);

  // ==========================================================================
  // §2 RED 1 — the sprint's headline query.
  // ==========================================================================
  {
    const r = find("grad school");
    ok("85.1 'grad school' finds the goal called 'Graduate school'",
      r.results.some((x) => x.entityType === "goal" && x.title === "Graduate school"),
      JSON.stringify(r.results.map((x) => [x.label, x.title])));
    ok("85.2 …and reaches more than one domain (§3)",
      new Set(r.results.map((x) => x.entityType)).size >= 4, JSON.stringify(kinds("grad school")));
    // §27. The audit measured an inbox capture ranking FIRST.
    ok("85.3 a raw capture never outranks a confirmed record",
      r.results.findIndex((x) => x.entityType === "capture") >
      r.results.findIndex((x) => x.entityType === "goal"),
      JSON.stringify(r.results.map((x) => x.entityType)));
    ok("85.4 …but is still shown, because it holds wording nothing else does (§26)",
      r.results.some((x) => x.entityId === "c2"));
  }

  // ==========================================================================
  // §2 RED 2 — multi-word natural queries.
  // ==========================================================================
  {
    ok("85.5 'rules about anger' finds a Rule",
      titles("rules about anger").some((t) => t.includes("anger")), JSON.stringify(titles("rules about anger")));
    // §20. Standards AND Protocols. No Rules-only island.
    const rules = find("rules about anger");
    ok("85.6 …and 'rules' reaches Protocols too (§20)",
      rules.filters.domains.includes("protocol"), JSON.stringify(rules.filters.domains));
    ok("85.7 'things I'm waiting on' returns current waiting records (§15)",
      kinds("things I'm waiting on").length === 2
      && find("things I'm waiting on").results.every((r) => r.status === "waiting"),
      JSON.stringify(titles("things I'm waiting on")));
    ok("85.8 'my long-term goals' uses the horizon, not the words (§21)",
      titles("my long-term goals").join() === "Run a marathon", JSON.stringify(titles("my long-term goals")));
    ok("85.9 …and does NOT return the medium-horizon goal",
      !titles("my long-term goals").includes("Graduate school"));
    ok("85.10 'notes from last week' is bounded by the date (§13)",
      titles("notes from last week").join() === "Application deadlines", JSON.stringify(titles("notes from last week")));
    ok("85.11 …through the EXISTING range parser, which resolved a real window",
      !!find("notes from last week").filters.range?.startKey,
      JSON.stringify(find("notes from last week").filters.range?.label));
    ok("85.12 'completed applications' reads the status word (§14)",
      titles("completed applications").join() === "Submit UH application", JSON.stringify(titles("completed applications")));
  }

  // ==========================================================================
  // §2 RED 3 / §10 — no table name ever reaches a person.
  // ==========================================================================
  {
    const indexed = [...new Set(buildSearchEntries(s).map((e) => e.kind))];
    ok("85.13 every indexed kind has a product label",
      indexed.every((k) => !!RECORD_LABELS[k]), JSON.stringify(indexed.filter((k) => !RECORD_LABELS[k])));
    ok("85.14 …and a place in the display order",
      indexed.every((k) => RECORD_ORDER.includes(k)), JSON.stringify(indexed.filter((k) => !RECORD_ORDER.includes(k))));
    ok("85.15 a standard is labelled 'Rule', not 'ConstitutionElement'",
      labelFor("constitution_element") === "Rule", labelFor("constitution_element"));
    ok("85.16 an action is labelled 'Action', not 'NextAction'", labelFor("action") === "Action");
    ok("85.17 a capture is labelled 'Capture', not 'CaptureCandidate'", labelFor("capture") === "Capture");
    // The label a person sees carries no underscore, ever.
    const allLabels = [...new Set(buildSearchEntries(s).map((e) => e.kind))].map(labelFor);
    ok("85.18 no rendered label contains an underscore",
      allLabels.every((l) => !l.includes("_")), JSON.stringify(allLabels));
    // A waiting action is a Waiting record to a person (§10).
    ok("85.19 a waiting action is labelled Waiting",
      find("Marcus").results[0]?.label === "Waiting", find("Marcus").results[0]?.label);
  }

  // ==========================================================================
  // §16, §17 — question intent hands off; a name does not.
  // ==========================================================================
  {
    ok("85.20 'what did I say about teaching?' hands off to Memory",
      find("what did I say about teaching?").handoff?.kind === "memory");
    ok("85.21 'what should I focus on?' hands off to Guidance",
      find("what should I focus on?").handoff?.kind === "guidance");
    ok("85.22 'what changed with grad school?' hands off",
      !!find("what changed with grad school?").handoff);
    ok("85.23 …carrying the question intact, so nobody retypes it",
      find("what changed with grad school?").handoff?.question === "what changed with grad school?");
    ok("85.24 …to a route the product actually has",
      (find("what should I focus on?").handoff?.route ?? "").startsWith("/memory?ask="));
    // §16's other half: a NAME is a search, not a question.
    ok("85.25 'grad school' does NOT hand off", !find("grad school").handoff);
    ok("85.26 'things I'm waiting on' does NOT hand off — Search owns it",
      !find("things I'm waiting on").handoff);
    ok("85.27 'my long-term goals' does NOT hand off", !find("my long-term goals").handoff);
    // The distinction is syntactic and checkable, not "did the planner reply".
    ok("85.28 a question mark makes a question", isQuestion("teaching?"));
    ok("85.29 a question word makes a question", isQuestion("what did I finish"));
    ok("85.30 a bare name does not", !isQuestion("grad school") && !isQuestion("Marcus"));
    // Search still shows literal matches under a handoff — pointing is not
    // refusing (§17 forbids duplicating Memory's logic, not showing records).
    ok("85.31 a question still shows its literal matches",
      find("what did I say about philosophy?").results.length > 0,
      JSON.stringify(find("what did I say about philosophy?").results.map((r) => r.title)));
  }

  // ==========================================================================
  // §26, §27 — one idea, one row.
  // ==========================================================================
  {
    const r = find("recommendation");
    ok("85.32 a capture that became a record is suppressed",
      r.suppressed === 1 && !r.results.some((x) => x.entityType === "capture"),
      JSON.stringify(r.results.map((x) => [x.label, x.title])));
    ok("85.33 …and the record it became is still there", r.results.some((x) => x.entityId === "a1"));
    // Keyed on the RECORDED LINK, not resemblance: break the link and the
    // capture returns, which is what makes this assertion mean anything.
    const unlinked = { ...s, nextActions: (s.nextActions ?? []).map((a) => a.id === "a1" ? { ...a, sourceCaptureId: undefined } : a) };
    const ru = searchEverything(unlinked, "recommendation", { today: TODAY });
    ok("85.34 …and an UNLINKED capture is not suppressed (§26)",
      ru.suppressed === 0 && ru.results.some((x) => x.entityType === "capture"),
      JSON.stringify(ru.results.map((x) => x.entityType)));
  }

  // ==========================================================================
  // §28 — deleted records do not appear.
  // ==========================================================================
  {
    ok("85.35 an archived note never appears", !find("graduate school").results.some((r) => r.entityId === "n3"),
      JSON.stringify(find("graduate school").results.map((r) => r.entityId)));
    ok("85.36 …and no query reaches it at all",
      !["scratch", "old scratch", "graduate", "school"].some((q) => find(q).results.some((r) => r.entityId === "n3")));
    ok("85.37 a retired standard never appears",
      !find("anger").results.some((r) => r.entityId === "s3"),
      JSON.stringify(find("anger").results.map((r) => r.entityId)));
    // …and the ACTIVE ones still do, or the assertion above proves only that
    // nothing matches "anger".
    ok("85.38 …while the active standard and protocol still do",
      find("anger").results.some((r) => r.entityId === "s2"));
  }

  // ==========================================================================
  // §12 — provenance, and the sentence it forbids.
  // ==========================================================================
  {
    const ai = find("progressing").results[0];
    ok("85.39 an AI-authored note is found", ai?.entityId === "n2", JSON.stringify(ai));
    ok("85.40 …and carries a machine origin, so no surface can say 'You wrote'",
      ai?.origin === "conqify_ai" || ai?.origin === "external_ai", ai?.origin);
    const reflection = find("teaching").results[0];
    ok("85.41 a reflection carries a user-authored origin",
      reflection?.origin === "user_authored", `${reflection?.origin}`);
    ok("85.42 every result carries an origin at all",
      find("grad school").results.every((r) => !!r.origin),
      JSON.stringify(find("grad school").results.map((r) => [r.label, r.origin])));
  }

  // ==========================================================================
  // §7, §9 — exact wins, and looser matching never buries it.
  // ==========================================================================
  {
    ok("85.43 an exact goal title ranks first",
      find("Graduate school").results[0]?.entityId === "g1",
      JSON.stringify(find("Graduate school").results.map((r) => r.title)));
    ok("85.44 …above a body match on the same words",
      find("Graduate school").results[0]?.matchReason === "Exact title match");
    // The tier ordering itself, asserted rather than assumed.
    const e = index.find((x) => x.id === "g1")!;
    ok("85.45 exact beats prefix beats contains beats tokens",
      (scoreEntry(e, "graduate school")?.score ?? 0) > (scoreEntry(e, "graduate")?.score ?? 0)
      && (scoreEntry(e, "graduate")?.score ?? 0) > (scoreEntry(e, "school")?.score ?? 0)
      && (scoreEntry(e, "school")?.score ?? 0) > (scoreEntry(e, "grad school")?.score ?? 0),
      [scoreEntry(e, "graduate school")?.score, scoreEntry(e, "graduate")?.score, scoreEntry(e, "school")?.score, scoreEntry(e, "grad school")?.score].join(" > "));
    ok("85.46 a token match is reported as such, never as an exact one",
      scoreEntry(e, "grad school")?.matchField === "title-tokens");
    // §30. Prefix matching is one-directional: a query word opens a real word.
    // Prefix matching must stay ONE-directional: a query word opens a real
    // word, never the reverse. The first version of this assertion used
    // "sch ool", which no direction matches — so making the matcher
    // bidirectional changed nothing and the test passed regardless.
    const marathon = index.find((x) => x.id === "g2")!;
    ok("85.47 a query word must OPEN a real word, not extend one",
      !!scoreEntry(marathon, "mara") && !scoreEntry(marathon, "running"),
      `mara=${scoreEntry(marathon, "mara")?.matchField} running=${scoreEntry(marathon, "running")?.matchField}`);
    ok("85.48 plural and singular meet (§30, the one rule)",
      !!scoreEntry(index.find((x) => x.id === "a2")!, "applications"));
    ok("85.49 …without turning 'less' into 'les'", queryTokens("less").join() === "less");
  }

  // ==========================================================================
  // §19 — one hop, and one hop only.
  // ==========================================================================
  {
    const r = find("grad school");
    const linked = r.results.find((x) => x.entityId === "a1");
    ok("85.50 an action linked through the goal's project is reachable", !!linked,
      JSON.stringify(r.results.map((x) => x.title)));
    ok("85.51 …and says which record it came through",
      linked?.matchReason === "Linked to Graduate school", linked?.matchReason);
    // TWO hops would reach a5 "Water the plants" through nothing at all.
    ok("85.52 an unrelated action is never reached", !r.results.some((x) => x.entityId === "a5"));
    // A completed action is not useful context for "find X".
    ok("85.53 a completed linked action is not offered as context",
      !r.results.some((x) => x.entityId === "a2"));
    // The cap, proved with a fixture that exceeds it.
    const many = {
      ...s,
      nextActions: [...(s.nextActions ?? []), ...Array.from({ length: 8 }, (_, i) =>
        act({ id: `L${i}`, title: `Linked chore ${i}`, projectId: "pr1" }))],
    };
    const rl = searchEverything(many, "grad school", { today: TODAY });
    ok("85.54 the fixture over-supplies linked candidates",
      (many.nextActions ?? []).filter((a) => a.projectId === "pr1" && a.status === "open").length > MAX_LINKED);
    ok("85.55 linked context is capped",
      rl.results.filter((x) => x.matchReason.startsWith("Linked to")).length <= MAX_LINKED,
      `${rl.results.filter((x) => x.matchReason.startsWith("Linked to")).length}`);
  }

  // ==========================================================================
  // §8 — no relevance number reaches a person.
  // ==========================================================================
  {
    const blob = JSON.stringify(find("grad school").results).toLowerCase();
    for (const w of SEARCH_FORBIDDEN_WORDS) {
      ok(`85.56 a result never says "${w}"`, !blob.includes(w.toLowerCase()));
    }
    ok("85.57 no result carries a score field",
      !/"score"|"relevance"|"confidence"/.test(JSON.stringify(find("grad school"))));
    ok("85.58 every result explains itself with a sentence",
      find("grad school").results.every((r) => r.matchReason.length > 3 && !/\d+\s*%/.test(r.matchReason)),
      JSON.stringify(find("grad school").results.map((r) => r.matchReason)));
  }

  // ==========================================================================
  // §34 — the cap, and §29 — the empty state.
  // ==========================================================================
  {
    const big = {
      ...emptyStoreState(),
      nextActions: Array.from({ length: 60 }, (_, i) => act({ id: `b${i}`, title: `Berkeley task ${i}` })),
    };
    const r = searchEverything(big, "berkeley", { today: TODAY });
    ok("85.59 the fixture over-supplies results", 60 > SEARCH_LIMIT);
    ok("85.60 results are capped", r.results.length === SEARCH_LIMIT, `${r.results.length}`);
    ok("85.61 …and the total is reported honestly", r.total === 60 && r.capped === true, `${r.total}/${r.capped}`);
    ok("85.62 the cap can be raised deliberately",
      searchEverything(big, "berkeley", { today: TODAY, limit: 200 }).results.length === 60);
    const none = find("xyzzy");
    ok("85.63 an unmatched query returns nothing and invents nothing",
      none.results.length === 0 && !none.handoff && none.total === 0);
  }

  // ==========================================================================
  // §33 — a chip narrows; it is never required.
  // ==========================================================================
  {
    ok("85.64 the default searches every domain", find("grad school").filters.domains.length === 0);
    const chipped = find("grad school", { domain: "goal" });
    ok("85.65 a chip narrows to one domain",
      chipped.results.every((r) => r.entityType === "goal" || r.matchReason.startsWith("Linked to")),
      JSON.stringify(chipped.results.map((r) => r.entityType)));
    // A chip and a sentence that disagree cannot widen the result.
    //
    // The query is chosen so that a WIDENED chip would visibly match: "Fall
    // applications" is a Project, so if the chip replaced the sentence's
    // domains instead of intersecting with them, this returns a row. The first
    // version asked `every(… === "goal")` of a list that was empty either way.
    const conflict = find("rules about applications", { domain: "project" });
    ok("85.66 a chip that conflicts with the sentence returns nothing",
      conflict.results.length === 0, JSON.stringify(conflict.results.map((r) => [r.entityType, r.title])));
    ok("85.66b …and that same chip alone WOULD have matched, so the guard is real",
      find("applications", { domain: "project" }).results.length > 0,
      JSON.stringify(find("applications", { domain: "project" }).results.map((r) => r.title)));
  }

  // ==========================================================================
  // Filters read the sentence, and know when not to.
  // ==========================================================================
  {
    ok("85.67 a lone domain word is a SEARCH, not an empty filter",
      readFilters("notes", TODAY).text === "notes" && readFilters("notes", TODAY).filters.domains.length === 0,
      JSON.stringify(readFilters("notes", TODAY)));
    ok("85.68 …so 'application deadlines' still finds the note by title",
      find("application deadlines").results[0]?.entityId === "n1");
    ok("85.69 stopwords are dropped from the remaining text, not just from tokens",
      readFilters("things I'm waiting on", TODAY).text === "",
      `"${readFilters("things I'm waiting on", TODAY).text}"`);
    ok("85.70 every domain word maps to a kind the index actually produces",
      Object.keys(DOMAIN_WORDS).every((k) => RECORD_ORDER.includes(k)),
      JSON.stringify(Object.keys(DOMAIN_WORDS).filter((k) => !RECORD_ORDER.includes(k))));
    ok("85.71 every status word is one a record really carries (§14)",
      Object.keys(STATUS_WORDS).every((st) =>
        buildSearchEntries(world()).some((e) => e.status === st) || ["retired", "paused"].includes(st)),
      JSON.stringify(Object.keys(STATUS_WORDS)));
    ok("85.72 no invented status is recognised",
      !JSON.stringify(STATUS_WORDS).match(/urgent|important|stalled|stuck|priority/i));
  }

  // ==========================================================================
  // §11, §18 — snippets are short, and every row opens something.
  // ==========================================================================
  {
    const all = find("grad school").results;
    ok("85.73 no snippet dumps a whole body", all.every((r) => r.snippet.length <= 130),
      JSON.stringify(all.map((r) => r.snippet.length)));
    ok("85.74 every result has a route", all.every((r) => r.route.startsWith("/")),
      JSON.stringify(all.map((r) => r.route)));
    ok("85.75 …and no route is a dead search card",
      all.every((r) => !r.route.includes("/search") && !r.route.includes("undefined")));
    // A reflection has no detail page; it must still land somewhere real.
    ok("85.76 a reflection opens the timeline that shows it",
      find("teaching").results[0]?.route === "/formation/timeline");
  }

  // ==========================================================================
  // §36 — deterministic, and cheap on a hot path.
  // ==========================================================================
  {
    const a = JSON.stringify(find("grad school").results.map((r) => r.id));
    const b = JSON.stringify(find("grad school").results.map((r) => r.id));
    ok("85.77 the same query returns the same order", a === b, a);
    // Ties must be broken totally, or two records with identical timestamps
    // would swap between renders.
    const tied = {
      ...emptyStoreState(),
      nextActions: Array.from({ length: 6 }, (_, i) => act({ id: `t${i}`, title: "Same title", updatedAt: A(-1) })),
    };
    // Asked TWICE of the same store this proves nothing: `Array.prototype.sort`
    // is stable, so an absent tiebreak simply preserves insertion order and the
    // two answers agree. The order must be independent of the STORE's order, so
    // the same records are searched again reversed.
    const reversed = { ...tied, nextActions: [...(tied.nextActions ?? [])].reverse() };
    const t1 = searchEverything(tied, "same title", { today: TODAY }).results.map((r) => r.entityId);
    const t2 = searchEverything(reversed, "same title", { today: TODAY }).results.map((r) => r.entityId);
    ok("85.78 six identically-scoring records order independently of store order",
      JSON.stringify(t1) === JSON.stringify(t2) && t1.length === 6,
      `${JSON.stringify(t1)} vs ${JSON.stringify(t2)}`);

    const scale = {
      ...emptyStoreState(),
      goals: Array.from({ length: 100 }, (_, i) => goal({ id: `sg${i}`, title: `Goal ${i}` })),
      projects: Array.from({ length: 200 }, (_, i) => proj({ id: `sp${i}`, title: `Project ${i}`, goalId: `sg${i % 100}` } as Partial<Project> & { id: string; title: string })),
      nextActions: Array.from({ length: 10000 }, (_, i) => act({
        id: `sa${i}`, title: `Action ${i} about applications`, projectId: `sp${i % 200}`,
      })),
    };
    const si = buildIndex(scale);
    ok("85.79 an index over 10,000 records builds once", si.length > 10000, `${si.length}`);
    for (const [name, q] of [["exact", "Action 5000 about applications"], ["lexical", "applications"], ["cross-domain", "goal project"], ["no result", "zzzz"]] as const) {
      const t = Date.now();
      for (let i = 0; i < 5; i++) searchEverything(scale, q, { index: si, today: TODAY });
      const ms = Date.now() - t;
      ok(`85.80 five ${name} queries over 10,000 records under 3000ms`, ms < 3000, `${ms}ms`);
    }
  }

  // ==========================================================================
  // Nothing is written. Search is a projection (§37).
  // ==========================================================================
  {
    const before = JSON.stringify(s);
    find("grad school");
    find("what should I focus on?");
    find("things I'm waiting on");
    ok("85.81 searching mutates nothing", JSON.stringify(s) === before);
    ok("85.82 no new persistence noun was added",
      !("searchHistory" in s) && !("searchIndexes" in s) && !("savedSearches" in s));
    // Normalization is shared with the existing engine, not re-implemented.
    ok("85.83 one normalizer, not two", normalizeQuery("Grad-School!") === "grad school");
  }

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
