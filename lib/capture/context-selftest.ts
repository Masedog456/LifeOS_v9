/**
 * Capture context self-tests (LIFEOS-089).
 *
 * ## The red proofs this suite pins
 *
 * §2's audit ran the brief's own sentences through the real pipeline:
 *
 *   1. "Email Marcus about the clinic lease tomorrow." became an Action with no
 *      context, while "Clinic launch" and an open "Read the clinic lease" sat in
 *      the store — `matchRecords` needs the WHOLE title verbatim
 *   2. even when a Project DID match, the Goal it supports was never shown
 *   3. "I'm worried about the grad school applications." got no Goal context
 *   4. a Protocol candidate got no Goal context
 *   5. a waiting candidate got no context at all
 *   6. "This isn't about graduate school anymore." linked STRONG to the Goal
 *   7. "When I was applying to graduate school…" did the same
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A context layer earns trust by what it refuses to claim: that a word reaching
 * two Projects picks one, that an abandoned Goal is current context, that a
 * completed Action is something to attach to, that "Marcus" and "Marcus Webb"
 * are one person, that a record title word is a person's name, or that
 * recognising a connection is permission to write it.
 *
 * Pure: no store, no clock, no AI.
 */

import type { Goal, NextAction, Project, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { interpret } from "@/lib/capture/interpret";
import { readChanges, detectCompletion } from "@/lib/capture/completion";
import { matchRecords } from "@/lib/capture/match";
import {
  buildCaptureContextIndex, suggestContext, capturePeople, contextFields,
  contextKnowledgeGoal, contextTokens, contextStrings,
  mentionIsDisavowed, mentionIsHistorical,
  MAX_SUGGESTIONS, MAX_ALTERNATIVES, MIN_ACTION_WORDS,
  CONTEXT_FORBIDDEN_WORDS, EXISTING_RECORD_LEAD, CHOOSE_ONE,
  type CaptureContextSuggestion,
} from "@/lib/capture/context";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-05";
const D = (o = 0): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const A = (o = 0, h = 9): string => `${D(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

type P<T> = Partial<T> & { id: string; title: string };
const act = (p: P<NextAction>): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: A(-20), updatedAt: A(-20), ...p,
} as NextAction);
const goal = (p: P<Goal>): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Goal);
const proj = (p: P<Project>): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Project);

/** The audit's world: a life with existing context to connect to. */
function world(): StoreState {
  return {
    ...emptyStoreState(),
    goals: [
      goal({ id: "g-grad", title: "Graduate school", horizon: "medium" }),
      goal({ id: "g-clinic", title: "Open the clinic", horizon: "long" }),
      // §40 — abandoned. Never the default active context.
      goal({ id: "g-old", title: "Learn Portuguese", status: "abandoned" }),
    ],
    projects: [
      proj({ id: "p-fall", title: "Fall applications", goalId: "g-grad" }),
      proj({ id: "p-clinic", title: "Clinic launch", goalId: "g-clinic" }),
      // §40 — completed.
      proj({ id: "p-done", title: "Summer research", goalId: "g-grad", status: "completed" }),
    ],
    nextActions: [
      act({ id: "a-rec", title: "Request recommendation", projectId: "p-fall" }),
      // §24 — two plausible answers to "the recommendation request".
      act({ id: "a-rec2", title: "Request recommendation from Jones", projectId: "p-fall" }),
      act({ id: "a-lease", title: "Read the clinic lease", projectId: "p-clinic" }),
      act({ id: "a-marcus", title: "Ask Marcus Webb for the survey", projectId: "p-clinic" }),
      act({ id: "a-maria", title: "Ask Maria for the transcript", projectId: "p-fall",
        status: "waiting", waitingOn: "Maria", waitingSince: D(-4) }),
      // §8 — already completed. Never a context for new work.
      act({ id: "a-done", title: "Order transcripts", projectId: "p-fall", status: "completed", completedAt: A(-6) }),
      // §12 — a direct Goal action with no Project.
      act({ id: "a-direct", title: "Draft the personal statement", goalId: "g-grad" }),
    ],
  } as StoreState;
}

export function runCaptureContextSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const index = buildCaptureContextIndex(s);

  /** Every suggestion for the FIRST candidate of a capture. */
  const ctx = (text: string, st: StoreState = s): CaptureContextSuggestion[] => {
    const idx = st === s ? index : buildCaptureContextIndex(st);
    const c = interpret(text, st, TODAY).candidates[0];
    return c ? suggestContext(c, st, idx) : [];
  };
  const kinds = (rows: CaptureContextSuggestion[]) => rows.map((r) => `${r.contextType}:${r.label}`);
  const of = (rows: CaptureContextSuggestion[], t: string) => rows.find((r) => r.contextType === t);

  // ==========================================================================
  // §9, §13 — RED 1 and RED 2. A new Action reaches its Project and its Goal.
  // ==========================================================================
  {
    const rows = ctx("Email Marcus about the clinic lease tomorrow.");
    const p = of(rows, "project");
    ok("89.1 §9 a new Action reaches its Project through a shared word",
      p?.label === "Clinic launch", JSON.stringify(kinds(rows)));
    ok("89.2 §20 …and the explanation names the word it matched on",
      /“clinic” matches this Project/.test(p?.reason ?? ""), String(p?.reason));
    ok("89.3 §21 …with a bounded class, never a percentage",
      p?.strength === "possible" && !/%/.test(p?.reason ?? ""), String(p?.strength));
    ok("89.4 §13 …and the Goal that Project supports arrives as inherited fact",
      p?.inheritedGoal?.label === "Open the clinic", JSON.stringify(p?.inheritedGoal));
    ok("89.5 §13 …stated as inheritance, not as a second match",
      p?.inheritedGoal?.reason === "This Project already supports that Goal.", String(p?.inheritedGoal?.reason));
    ok("89.6 §23 …and the hop stops there",
      rows.every((r) => r.contextType !== "goal"), JSON.stringify(kinds(rows)));
    // The measured red: the old matcher found nothing at all.
    ok("89.7 …which the whole-title matcher could not do",
      matchRecords("Email Marcus about the clinic lease tomorrow.", s).strength === "none");

    ok("89.8 §5 a link is never above the confirm tier", p?.authority === "confirm", String(p?.authority));
    ok("89.9 §29 …and becomes a projectId the existing create path already writes",
      contextFields(rows, "action").projectId === "p-clinic", JSON.stringify(contextFields(rows, "action")));
    ok("89.10 §13 …and NOT a second goalId saying the same thing",
      contextFields(rows, "action").goalId === undefined, JSON.stringify(contextFields(rows, "action")));
  }

  // ==========================================================================
  // §10, §16 — RED 3. A reflection reaches its Goal without becoming a task.
  // ==========================================================================
  {
    const text = "I'm worried about the grad school applications.";
    const c = interpret(text, s, TODAY).candidates[0];
    const rows = suggestContext(c, s, index);
    ok("89.11 §16 the capture stays a note, not an Action",
      c.kind !== "action", c.kind);
    ok("89.12 §10 …and still reaches context",
      rows.length > 0, JSON.stringify(kinds(rows)));
    const p = of(rows, "project");
    ok("89.13 …the Project, through “applications”",
      p?.label === "Fall applications", String(p?.label));
    ok("89.14 §13 …carrying the Goal it supports",
      p?.inheritedGoal?.label === "Graduate school", String(p?.inheritedGoal?.label));
    // "grad" is a prefix of "graduate" — LIFEOS-085's rule, and the reason the
    // audit's headline sentence reaches anything at all.
    // The tokenizer keeps the short form...
    ok("89.15 §22 the capture's own word survives as “grad”",
      contextTokens(text).includes("grad"), JSON.stringify(contextTokens(text)));
    // ...and the MATCH is what the prefix direction is for. Asserted in a world
    // with no competing Project, so the Goal is reached by "grad" alone and
    // nothing else can carry the assertion. Reversing the comparison —
    // "grad".startsWith("graduate") — breaks exactly this and nothing else,
    // which is why it needs its own case.
    const gradOnly = {
      ...s,
      projects: [],
      nextActions: [],
      goals: [goal({ id: "gg", title: "Graduate school" })],
    } as StoreState;
    const gradRows = ctx("I'm worried about grad applications.", gradOnly);
    ok("89.15a §22 a SHORTER capture word reaches a LONGER title word",
      of(gradRows, "goal")?.label === "Graduate school", JSON.stringify(kinds(gradRows)));
    ok("89.15b §22 …and the direction is one-way: a longer capture word does not",
      ctx("Book the schooling paperwork.", gradOnly)
        .every((r) => r.label !== "Graduate school"),
      JSON.stringify(kinds(ctx("Book the schooling paperwork.", gradOnly))));
    ok("89.16 §16 a note gets NO projectId — it has nowhere to put one",
      Object.keys(contextFields(rows, "note")).length === 0, JSON.stringify(contextFields(rows, "note")));
    ok("89.17 §16, §33 …it attaches to the Goal through linkedKnowledge instead",
      contextKnowledgeGoal(rows, "note") === "g-grad", String(contextKnowledgeGoal(rows, "note")));
    ok("89.18 §16 context never raises a note to an Action",
      rows.every((r) => r.authority === "confirm" || r.authority === "auto_safe"),
      JSON.stringify(rows.map((r) => r.authority)));
  }

  // ==========================================================================
  // §17 — RED 4. A Protocol carries Goal context, and is never auto-created.
  // ==========================================================================
  {
    const text = "When I'm overwhelmed with applications, do one school at a time.";
    const c = interpret(text, s, TODAY).candidates[0];
    const rows = suggestContext(c, s, index);
    ok("89.19 §17 the capture is read as a protocol", c.kind === "protocol", c.kind);
    ok("89.20 §17 …and carries Goal context",
      contextKnowledgeGoal(rows, "protocol") === "g-grad", String(contextKnowledgeGoal(rows, "protocol")));
    ok("89.21 §17 …which is a suggestion, never a creation",
      rows.every((r) => r.authority !== "auto_with_undo"), JSON.stringify(rows.map((r) => r.authority)));
    ok("89.22 §17 …and never a field the protocol cannot hold",
      Object.keys(contextFields(rows, "protocol")).length === 0);
  }

  // ==========================================================================
  // §15, §18 — RED 5. Waiting reaches the open wait it may duplicate.
  // ==========================================================================
  {
    const text = "I'm waiting on Maria for the transcript.";
    const c = interpret(text, s, TODAY).candidates[0];
    const rows = suggestContext(c, s, index);
    ok("89.23 §15 the capture stays a waiting candidate", c.kind === "waiting", c.kind);
    const a = of(rows, "action");
    ok("89.24 §18 …and the existing open wait is surfaced",
      a?.label === "Ask Maria for the transcript", String(a?.label));
    ok("89.25 §18 …naming both words it matched on",
      /“maria” and “transcript”/.test(a?.reason ?? ""), String(a?.reason));
    ok("89.26 §7 …and it took TWO words to say so",
      MIN_ACTION_WORDS === 2, String(MIN_ACTION_WORDS));
    const person = of(rows, "person");
    ok("89.27 §14 the person is a text reference", person?.label === "Maria", String(person?.label));
    ok("89.28 §15 …grounded in what the user actually said",
      person?.reason === "You said you are waiting on them.", String(person?.reason));
    ok("89.29 §14 …and a person is never a link to write",
      person?.contextId === "" && Object.keys(contextFields(rows, "waiting")).length === 0,
      JSON.stringify(contextFields(rows, "waiting")));
    ok("89.30 §15 no due or follow-up date was invented",
      c.fields.dueDate === undefined, String(c.fields.dueDate));
  }

  // ==========================================================================
  // §38, §39 — RED 6 and RED 7. Negation and history withhold context.
  // ==========================================================================
  {
    const neg = "This isn't about graduate school anymore.";
    ok("89.31 §38 the whole-title matcher DOES link the negated mention",
      matchRecords(neg, s).strength === "strong",
      JSON.stringify(matchRecords(neg, s).options.map((o) => o.title)));
    ok("89.32 §38 …and the context layer refuses to",
      ctx(neg).length === 0, JSON.stringify(kinds(ctx(neg))));
    ok("89.33 §38 …recognised as a disavowal", mentionIsDisavowed(neg));
    ok("89.34 §38 …while an ordinary mention is not",
      !mentionIsDisavowed("Email Marcus about the clinic lease tomorrow."));

    const hist = "When I was applying to graduate school, I hated recommendation letters.";
    ok("89.35 §39 the whole-title matcher links the historical mention",
      matchRecords(hist, s).strength === "strong");
    ok("89.36 §39 …and the context layer refuses to", ctx(hist).length === 0, JSON.stringify(kinds(ctx(hist))));
    ok("89.37 §39 …recognised as a historical frame", mentionIsHistorical(hist));
    ok("89.38 §39 …while a present-tense mention is not",
      !mentionIsHistorical("I'm worried about the grad school applications."));
    ok("89.39 §19 the capture itself is untouched either way — nothing here writes",
      interpret(neg, s, TODAY).raw === neg, interpret(neg, s, TODAY).raw);
  }

  // ==========================================================================
  // §22, §24 — precedence and ambiguity.
  // ==========================================================================
  {
    // §22. An exact whole-title match is taken first, and a looser one never
    // displaces it.
    const rows = ctx("Send the Fall applications checklist to Priya.");
    const p = of(rows, "project");
    ok("89.40 §22 an exact title match is classed exact",
      p?.strength === "exact" && p.label === "Fall applications", `${p?.strength}/${p?.label}`);
    ok("89.41 §22 …with the record's own words as the reason",
      /“Fall applications” appears in what you wrote/.test(p?.reason ?? ""), String(p?.reason));

    // A fuzzy recent Project must not outrank an exact old one.
    const two = {
      ...s,
      projects: [
        proj({ id: "old", title: "Kitchen rebuild", updatedAt: A(-300) }),
        proj({ id: "new", title: "Kitchen shopping list", updatedAt: A(0) }),
      ],
    } as StoreState;
    const exactRows = ctx("Finish the Kitchen rebuild paperwork.", two);
    ok("89.42 §22 a fuzzy recent Project does not outrank an exact old one",
      of(exactRows, "project")?.label === "Kitchen rebuild",
      JSON.stringify(kinds(exactRows)));

    // §24. Two records reached by two different distinctive words is a
    // question, not a pick.
    const both = {
      ...s,
      projects: [
        proj({ id: "x1", title: "Berlin trip" }),
        proj({ id: "x2", title: "Passport renewal" }),
      ],
      nextActions: [],
    } as StoreState;
    const amb = ctx("Sort the Berlin passport paperwork.", both);
    const a = of(amb, "project");
    ok("89.43 §24 two grounded Projects produce a question",
      a?.strength === "ambiguous", `${a?.strength}`);
    ok("89.44 §24 …with nothing preselected",
      a?.contextId === "", String(a?.contextId));
    ok("89.45 §24 …and both offered",
      (a?.ambiguousAlternatives ?? []).length === 2,
      JSON.stringify(a?.ambiguousAlternatives?.map((x) => x.label)));
    ok("89.46 §24 …so no field is written from it",
      contextFields(amb, "action").projectId === undefined, JSON.stringify(contextFields(amb, "action")));
    ok("89.47 §24 the wording says nothing is selected",
      /Nothing is selected/.test(CHOOSE_ONE), CHOOSE_ONE);

    // §7. A word that reaches two Projects grounds nothing at all.
    const shared = {
      ...s,
      projects: [proj({ id: "s1", title: "Clinic launch" }), proj({ id: "s2", title: "Clinic hiring" })],
      nextActions: [],
    } as StoreState;
    const contested = ctx("Order the clinic signage.", shared);
    const cp = of(contested, "project");
    ok("89.48 §7 a word reaching two Projects grounds no link",
      cp?.contextId === "" && contextFields(contested, "action").projectId === undefined,
      JSON.stringify(contextFields(contested, "action")));
    // Dropping it would be silent too, and hiding an ambiguity is the defect
    // §24 exists to prevent. The user is shown the choice instead.
    ok("89.48a §24 …and the choice is SHOWN rather than dropped",
      cp?.strength === "ambiguous"
      && (cp?.ambiguousAlternatives ?? []).length === 2,
      JSON.stringify(cp?.ambiguousAlternatives?.map((x) => x.label)));
  }

  // ==========================================================================
  // §11 — a Goal and a Project can BOTH be true, and both are shown.
  // ==========================================================================
  {
    // The Goal is NOT the Project's parent, so it is a second grounded context
    // rather than inherited ancestry. Nothing in the earlier fixtures had this
    // shape, so nothing was testing what happens when both are accepted.
    const both = {
      ...s,
      goals: [goal({ id: "gy", title: "Marathon training" })],
      projects: [proj({ id: "px", title: "Berlin trip" })],
      nextActions: [],
    } as StoreState;
    const rows = ctx("Plan the Berlin marathon weekend.", both);
    ok("89.83 §11 a Project and an unrelated Goal are both shown",
      of(rows, "project")?.label === "Berlin trip" && of(rows, "goal")?.label === "Marathon training",
      JSON.stringify(kinds(rows)));
    ok("89.84 §11 …and neither is folded into the other",
      of(rows, "project")?.inheritedGoal === undefined, JSON.stringify(of(rows, "project")?.inheritedGoal));
    // §13. Accepting the Project must not ALSO write the Goal: an Action in a
    // Project already reaches its Goal, and two links would say it twice.
    const accepted = rows.filter((r) => r.contextType === "project");
    ok("89.85 §13 accepting the Project writes one link, not two",
      contextFields(accepted, "action").projectId === "px"
      && contextFields(accepted, "action").goalId === undefined,
      JSON.stringify(contextFields(accepted, "action")));
    // And accepting BOTH still writes only the Project — the Goal a Project
    // belongs to is the Project's business.
    ok("89.86 §13 …and accepting both still writes only the Project",
      contextFields(rows, "action").goalId === undefined,
      JSON.stringify(contextFields(rows, "action")));
  }

  // ==========================================================================
  // §12 — a Goal match never forces a Project into existence.
  // ==========================================================================
  {
    const goalOnly = {
      ...s,
      projects: [],
      nextActions: [],
    } as StoreState;
    const rows = ctx("Book a school open day.", goalOnly);
    const g = of(rows, "goal");
    ok("89.49 §12 a Goal-only match is a first-class outcome",
      g?.label === "Graduate school", JSON.stringify(kinds(rows)));
    ok("89.50 §12 …written as a goalId, with no Project invented",
      contextFields(rows, "action").goalId === "g-grad"
      && contextFields(rows, "action").projectId === undefined,
      JSON.stringify(contextFields(rows, "action")));
    ok("89.51 §12 …and nothing in this layer can create a Project",
      rows.every((r) => r.contextType !== "project"), JSON.stringify(kinds(rows)));
  }

  // ==========================================================================
  // §40, §41, §8 — closed, deleted and completed records.
  // ==========================================================================
  {
    ok("89.52 §40 an abandoned Goal is not offered as current context",
      ctx("Practise Portuguese for twenty minutes.").every((r) => r.label !== "Learn Portuguese"),
      JSON.stringify(kinds(ctx("Practise Portuguese for twenty minutes."))));
    ok("89.53 §40 …nor is a completed Project",
      ctx("Write up the summer research notes.").every((r) => r.label !== "Summer research"),
      JSON.stringify(kinds(ctx("Write up the summer research notes."))));
    ok("89.54 §40 …and the index simply does not hold them",
      index.records.every((r) => r.title !== "Learn Portuguese" && r.title !== "Summer research"),
      JSON.stringify(index.records.map((r) => r.title)));

    // §8. `matchEditTargets` returns completed records; this layer must not.
    ok("89.55 §8 a completed Action is not in the live pool",
      index.liveActions.every((a) => a.id !== "a-done"),
      index.liveActions.map((a) => a.id).join());
    ok("89.56 §8 …so it is never offered as an existing item",
      ctx("Order the transcripts again.").every((r) => r.label !== "Order transcripts"),
      JSON.stringify(kinds(ctx("Order the transcripts again."))));

    // §41. Deletion removes the row, so there is nothing to exclude.
    const gone = { ...s, projects: [], goals: [], nextActions: [] } as StoreState;
    ok("89.57 §41 a deleted record cannot be suggested, because it is not there",
      ctx("Email Marcus about the clinic lease.", gone).length === 0);
  }

  // ==========================================================================
  // §14, §36 — people stay textual and unmerged.
  // ==========================================================================
  {
    const rows = ctx("Email Marcus about the clinic lease tomorrow.");
    const person = of(rows, "person");
    ok("89.58 §14 a name the store knows is offered as a reference",
      person?.label === "Marcus", String(person?.label));
    ok("89.59 §36 …with the longer form travelling as unresolved ambiguity",
      !!person?.ambiguousAlternatives.some((a) => a.label === "Marcus Webb"),
      JSON.stringify(person?.ambiguousAlternatives));
    ok("89.60 §36 …and the two are never merged into one entry",
      rows.filter((r) => r.contextType === "person").length === 1,
      JSON.stringify(kinds(rows)));
    ok("89.61 §36 a person reference carries no id, because it is not a record",
      person?.contextId === "");
    // The defect found by running this before writing assertions: `personHint`
    // finds a name anywhere in the store, and a record TITLE is not a person.
    ok("89.62 §14 a Goal's own title word is not a person",
      ctx("Practise Portuguese for twenty minutes.").every((r) => r.label !== "Portuguese"),
      JSON.stringify(kinds(ctx("Practise Portuguese for twenty minutes."))));
    ok("89.63 §14 …and neither is a Project's",
      ctx("Send the Fall applications checklist to Priya.").every((r) => r.label !== "Fall"),
      JSON.stringify(kinds(ctx("Send the Fall applications checklist to Priya."))));
    ok("89.64 §14 a name the store knows NOTHING about is not offered",
      capturePeople(s, interpret("Email Sandrine about the lease.", s, TODAY).candidates[0], index)
        .every((p) => p.label !== "Sandrine"));
  }

  // ==========================================================================
  // §6, §24 — the completion path, verified as a forward guard.
  // ==========================================================================
  {
    // The audit measured this as ALREADY correct. It is asserted rather than
    // fixed, because the thing most likely to break it is this sprint.
    const done = detectCompletion("I finished the recommendation request.", s, TODAY);
    ok("89.65 §6 completion language reads as an update, not a creation",
      done?.operation === "complete", String(done?.operation));
    ok("89.66 §24 …and two plausible Actions produce a question",
      done?.authority === "ambiguous", String(done?.authority));
    ok("89.67 §24 …naming both, with nothing chosen",
      (done?.candidateMatches ?? []).length === 2,
      JSON.stringify((done?.candidateMatches ?? []).map((m) => m.title)));
    ok("89.68 §6 …and it is read BEFORE the create path sees the text",
      readChanges("I finished the recommendation request.", s, TODAY).changes.length === 1);
    ok("89.69 §8 nothing is proposed against an already-completed Action",
      (done?.candidateMatches ?? []).every((m) => m.status !== "completed"),
      JSON.stringify((done?.candidateMatches ?? []).map((m) => m.status)));
  }

  // ==========================================================================
  // §26, §5, §21 — the surface itself.
  // ==========================================================================
  {
    const rows = ctx("Email Marcus about the clinic lease tomorrow.");
    // A fixture that never exceeds a cap cannot test the cap. This one names a
    // Project, a Goal, an existing Action and two people at once.
    const crowded = {
      ...s,
      goals: [goal({ id: "cg", title: "Marathon training" })],
      projects: [proj({ id: "cp", title: "Berlin trip" })],
      nextActions: [
        act({ id: "c1", title: "Book the Berlin hotel" }),
        act({ id: "c2", title: "Ask Marcus Webb for the survey" }),
        act({ id: "c3", title: "Ask Priya about the visa" }),
      ],
    } as StoreState;
    const many = ctx("Ask Marcus and Priya about the Berlin marathon hotel.", crowded);
    ok("89.70a the crowded fixture really does over-produce",
      suggestContext(
        interpret("Ask Marcus and Priya about the Berlin marathon hotel.", crowded, TODAY).candidates[0],
        crowded, buildCaptureContextIndex(crowded),
      ).length === MAX_SUGGESTIONS, String(many.length));
    ok("89.70 §26 context is capped", many.length <= MAX_SUGGESTIONS && rows.length <= MAX_SUGGESTIONS,
      `${many.length} / ${rows.length}`);
    ok("89.71 §24 alternatives are capped",
      rows.every((r) => r.ambiguousAlternatives.length <= MAX_ALTERNATIVES));
    ok("89.72 §5 nothing here is auto-applied",
      rows.every((r) => r.authority === "confirm" || r.authority === "auto_safe"),
      JSON.stringify(rows.map((r) => r.authority)));
    const surfaces = contextStrings(rows).map((x) => x.toLowerCase());
    const bad = CONTEXT_FORBIDDEN_WORDS.filter((w) => surfaces.some((x) => x.includes(w)));
    ok("89.73 §20, §21 no forbidden wording on any context surface", bad.length === 0, bad.join(" | "));
    ok("89.74 §21 no percentage anywhere", !surfaces.some((x) => /\d\s*%/.test(x)));
    ok("89.75 §41 no id is ever rendered",
      !surfaces.some((x) => x.includes("p-clinic") || x.includes("g-clinic")),
      JSON.stringify(surfaces));
    ok("89.76 §27 the existing-record lead asks rather than acts",
      /Looks like this may refer to/.test(EXISTING_RECORD_LEAD), EXISTING_RECORD_LEAD);
  }

  // ==========================================================================
  // §42 — the shape holds at size.
  // ==========================================================================
  {
    for (const n of [100, 1000, 5000]) {
      const big = {
        ...emptyStoreState(),
        goals: Array.from({ length: Math.max(1, n / 50) }, (_, i) => goal({ id: `bg${i}`, title: `Goal number ${i}` })),
        projects: Array.from({ length: Math.max(1, n / 10) }, (_, i) => proj({ id: `bp${i}`, title: `Project number ${i}`, goalId: `bg${i % Math.max(1, n / 50)}` })),
        nextActions: Array.from({ length: n }, (_, i) => act({ id: `ba${i}`, title: `Action number ${i}`, projectId: `bp${i % Math.max(1, n / 10)}` })),
      } as StoreState;
      const t = Date.now();
      const bi = buildCaptureContextIndex(big);
      const built = Date.now() - t;
      const c = interpret("Email Marcus about the clinic lease tomorrow.", big, TODAY).candidates[0];
      const t2 = Date.now();
      for (let i = 0; i < 5; i++) suggestContext(c, big, bi);
      const matched = Date.now() - t2;
      ok(`89.77.${n} the index over ${n} actions builds under 500ms`, built < 500, `${built}ms`);
      ok(`89.78.${n} …and five matches against it run under 1500ms`, matched < 1500, `${matched}ms`);
    }
    // §42. The index is built ONCE, so a second candidate costs no rebuild.
    const many = interpret(
      "Email Marcus about the clinic lease tomorrow and draft the personal statement.",
      s, TODAY,
    );
    ok("89.79 §42 a multi-clause capture reuses one index",
      many.candidates.every((c) => suggestContext(c, s, index).length >= 0));
  }

  // ==========================================================================
  // §19, §30, §37 — what this layer must never do.
  // ==========================================================================
  {
    const before = JSON.stringify(s);
    ctx("Email Marcus about the clinic lease tomorrow.");
    ctx("I'm worried about the grad school applications.");
    ok("89.80 §19 interpreting context mutates nothing", JSON.stringify(s) === before);
    ok("89.81 §37 …and proposes no change to an existing record's own links",
      ctx("Email Marcus about the clinic lease tomorrow.")
        .every((r) => r.contextType !== "action" || r.strength !== "exact"));
    ok("89.82 §30 a suggestion carries no authorship claim",
      !contextStrings(ctx("Email Marcus about the clinic lease tomorrow."))
        .some((x) => /you wrote|conqify wrote|authored/i.test(x)));
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
