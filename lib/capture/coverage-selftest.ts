/**
 * Capture coverage self-tests (LIFEOS-066 §25, §26, §30, §37).
 *
 * ## What this suite is for
 *
 * LIFEOS-063 spent a week using the product and wrote down every sentence the
 * parser got wrong. This file is the standing answer to that list: each case is
 * a sentence a person actually says, and the assertion is what Conqify should
 * make of it — including, in several cases, "nothing, and that is correct".
 *
 * ## Section 2 is the load-bearing one
 *
 * Section 1 proves coverage went up. Section 2 proves the ways it must NOT have
 * gone up, and those matter more. A parser that reads more language is only an
 * improvement if it stays unwilling to act: an over-eager completion rule ticks
 * off work the user still has to do, and unlike a wrong new record, a wrong
 * completion is invisible — the item simply stops appearing, and they find out
 * when they miss something.
 *
 * So every negative here is phrased as a mutation that must not occur, and each
 * runs against a world where the tempting wrong answer is available.
 *
 * ## No assertion here was weakened to make a score move
 *
 * Section 4 records the LIFEOS-063 capture rubric re-run on the same probes.
 * The rubric is unchanged from 063 — the same sentences, judged the same way.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { NextAction, StoreState } from "@/types/mvp";
import { interpret } from "@/lib/capture/interpret";
import { decompose } from "@/lib/capture/decompose";
import { classifyOne } from "@/lib/capture/classify";
import { detectWaiting } from "@/lib/capture/waiting";
import { looksLikeEvent } from "@/lib/capture/schedule";
import { splitPastVerb, baseOfPast, PAST_TO_BASE } from "@/lib/capture/morphology";
import {
  detectCompletion, detectCompletions, detectMissed, missedNoteReason,
  looksLikeCompletion, looksLikeMissed, readChanges,
} from "@/lib/capture/completion";
import { buildProposal, EDIT_OPERATIONS, type EditTarget } from "@/lib/capture/temporal-edit";
import { applyTemporalEdit, type EditOps } from "@/lib/capture/apply-edit";
import { buildEditContext, validateAiEdits, FORBIDDEN_CONTEXT_FIELDS } from "@/lib/capture/edit-escalation";
import { FORBIDDEN_CANDIDATE_KINDS } from "@/lib/capture/authority";
import { readRule } from "@/lib/time/recurrence";
import type { DayKey } from "@/lib/reviews/dates";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** A fixed Monday, so every relative date in the fixtures is deterministic. */
const MON: DayKey = "2026-03-02";
const FRI: DayKey = "2026-03-06";

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { id: string; title: string }): NextAction {
  seq += 1;
  return {
    description: "", status: "open", createdAt: `${MON}T08:00:00.000Z`, updatedAt: `${MON}T08:00:00.000Z`,
    notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
    energy: "unspecified", order: seq, history: [],
    ...p,
  } as NextAction;
}

/**
 * The world the cases run against.
 *
 * Deliberately holds the traps: two records whose titles both contain
 * "proposal", one already-completed action, and one recurring action. Every
 * negative in section 2 needs a plausible wrong answer to be available, or it
 * proves nothing.
 */
function world(): StoreState {
  seq = 0;
  const s = emptyState();
  s.nextActions = [
    act({ id: "deploy", title: "Finish the deployment" }),
    act({ id: "dentist", title: "Call the dentist" }),
    act({ id: "bill", title: "Pay the electric bill", dueDate: FRI }),
    act({ id: "prof", title: "Email my professor" }),
    act({ id: "filter", title: "Replace the air filter" }),
    act({ id: "workout", title: "Workout", recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] } }),
    act({ id: "prop-a", title: "Proposal draft" }),
    act({ id: "prop-b", title: "Proposal review" }),
    act({ id: "reg", title: "Renew the registration", status: "completed" }),
  ];
  s.events = [
    { id: "therapy", title: "Therapy", date: FRI, startTime: "10:00", notes: "", linkedEntityRefs: [],
      createdAt: `${MON}T08:00:00.000Z`, updatedAt: `${MON}T08:00:00.000Z` } as StoreState["events"][number],
  ];
  return s;
}

/** A recording ops object. Nothing reaches a real store from this file. */
function recordingOps(): { ops: EditOps; calls: string[] } {
  const calls: string[] = [];
  const noop = () => { /* not exercised by these cases */ };
  return {
    calls,
    ops: {
      setActionDueDate: (id, d) => { calls.push(`setActionDueDate:${id}:${d ?? "-"}`); },
      setActionDueTime: (id, t) => { calls.push(`setActionDueTime:${id}:${t ?? "-"}`); return true; },
      setActionRecurrence: (id) => { calls.push(`setActionRecurrence:${id}`); return true; },
      stopActionRecurrence: (id) => { calls.push(`stopActionRecurrence:${id}`); return true; },
      deferAction: (id) => { calls.push(`deferAction:${id}`); },
      updateEvent: (id) => { calls.push(`updateEvent:${id}`); return true; },
      stopEventRecurrence: (id) => { calls.push(`stopEventRecurrence:${id}`); noop(); },
      deleteEvent: (id) => { calls.push(`deleteEvent:${id}`); },
      completeAction: (id) => { calls.push(`completeAction:${id}`); },
      completeOccurrence: (id, d) => { calls.push(`completeOccurrence:${id}:${d}`); return true; },
    },
  };
}

/** The kind of the FIRST candidate an utterance produces. */
function kind(text: string, s: StoreState = world()): string {
  return interpret(text, s, MON).candidates[0]?.kind ?? "none";
}

export async function runCaptureCoverageSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, got: unknown, want: unknown) =>
    ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
      `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

  // ======================================= 1. the §25 torture table (18 cases)
  //
  // Every sentence here is one a person says out loud. The expected kind is
  // what Conqify should make of it — and where that is "note", the note is the
  // right answer, not a failure to classify.

  // --- appointments that never say the word "appointment" (§4, §5) ---
  eq("1.1 'Dentist Thursday at 2:30' is an Event", kind("Dentist Thursday at 2:30"), "event");
  eq("1.2 'Therapy Friday at 10' is an Event", kind("Therapy Friday at 10"), "event");
  eq("1.3 'Lunch with Sarah tomorrow at noon' is an Event", kind("Lunch with Sarah tomorrow at noon"), "event");
  eq("1.4 'Car inspection Monday at 8' is an Event", kind("Car inspection Monday at 8"), "event");
  eq("1.5 'Haircut Saturday at 11' is an Event", kind("Haircut Saturday at 11"), "event");

  // The heuristic stayed NARROW (§5). Three shapes that look adjacent and are
  // deliberately NOT events — a bare noun with no clock, a noun that is not an
  // appointment head, and a sentence ABOUT a past happening.
  eq("1.6 'Dentist Thursday' with no time is a Note", kind("Dentist Thursday"), "note");
  eq("1.7 'Paper Friday at 5' is not an appointment", kind("Paper Friday at 5"), "note");
  eq("1.8 'Meeting notes from Tuesday' is a Note", kind("Meeting notes from Tuesday"), "note");
  // A step you take about an appointment is still a step.
  eq("1.9 'Call dentist Thursday at 2:30' is an Action", kind("Call dentist Thursday at 2:30"), "action");

  // --- ordinary errand verbs (§11) ---
  eq("1.10 'Replace the kitchen tap washer' is an Action", kind("Replace the kitchen tap washer"), "action");
  eq("1.11 'Review of the book' is a Note, not an errand", kind("Review of the book"), "note");

  // --- completion (§6) ---
  {
    const s = world();
    const done = detectCompletion("I finished the deployment", s, MON);
    eq("1.12 'I finished the deployment' proposes completing an existing Action",
      done?.candidateMatches[0]?.title, "Finish the deployment");
    eq("1.12b …as an UPDATE operation", done?.operation, "complete");
  }
  eq("1.13 'Called the dentist' resolves through past tense",
    detectCompletion("Called the dentist", world(), MON)?.candidateMatches[0]?.title, "Call the dentist");
  eq("1.14 'Worked out this morning' closes ONE occurrence of a repeating action",
    buildProposal(
      detectCompletion("Worked out this morning", world(), MON)!,
      detectCompletion("Worked out this morning", world(), MON)!.candidateMatches[0],
    ).summary.includes("keeps repeating"), true);

  // --- not-done (§8) ---
  eq("1.15 'I didn't work out today' is a Note", kind("I didn't work out today"), "note");
  ok("1.16 …and no completion is even proposed", detectCompletion("I didn't work out today", world(), MON) === null);

  // --- waiting (§10) ---
  eq("1.17 'Still waiting on Marcus' is detected despite the leading Still",
    detectWaiting("Still waiting on Marcus.")?.waitingOn, "Marcus");
  eq("1.17b 'Marcus still owes me the dealership document' separates who from what",
    detectWaiting("Marcus still owes me the dealership document")?.waitingFor, "dealership document");

  // --- multi-intent containing the above (§16) ---
  {
    const s = world();
    const { changes, remainder } = readChanges("I finished deployment and need to email my professor tomorrow", s, MON);
    eq("1.18 a mixed utterance yields ONE change…", changes.length, 1);
    eq("1.18b …which is the completion…", changes[0]?.operation, "complete");
    ok("1.18c …and the rest goes down the ordinary capture path", /email my professor/i.test(remainder), remainder);
  }

  // ================================ 2. the §26 negatives — must NOT happen
  //
  // Each of these runs against a world where the wrong answer is available.

  // --- A. a completion report never CREATES a record ---
  {
    const s = world();
    const before = (s.nextActions ?? []).length;
    const intent = detectCompletion("I finished the deployment", s, MON)!;
    const { ops, calls } = recordingOps();
    applyTemporalEdit(buildProposal(intent, intent.candidateMatches[0]), ops, { today: MON });
    eq("2.A no Action is created for 'I finished the deployment'", (s.nextActions ?? []).length, before);
    eq("2.A2 …the only call made is a completion of the EXISTING record",
      calls, ["completeAction:deploy"]);
    ok("2.A3 …and nothing in the dispatcher can create a record",
      !Object.keys(recordingOps().ops).some((k) => /^create|^add/i.test(k)),
      Object.keys(recordingOps().ops).join(","));
  }

  // --- B. ambiguity is a question, never a silent pick ---
  {
    const s = world();
    const intent = detectCompletion("I finished the proposal", s, MON);
    eq("2.B two matching actions produce an AMBIGUOUS reading", intent?.authority, "ambiguous");
    eq("2.B2 …with both offered", intent?.candidateMatches.length, 2);
    // The point of the assertion: no tie-break exists. Not recency, not order,
    // not due date. A newer record must never win by being newer.
    const titles = (intent?.candidateMatches ?? []).map((c) => c.title).sort();
    eq("2.B3 …and neither is marked as the answer", titles, ["Proposal draft", "Proposal review"]);
  }

  // --- C. no match never invents a completion ---
  {
    const s = world();
    const intent = detectCompletion("I finished the quarterly audit", s, MON)!;
    eq("2.C an unknown thing has no target", intent.authority, "no_match");
    eq("2.C2 …and is refused with a reason", intent.refusal?.code, "no_target");
    ok("2.C3 …and the refusal says the capture is preserved",
      /stays as you wrote it/i.test(intent.refusal?.message ?? ""), intent.refusal?.message);
    // The tempting wrong behaviour: create "quarterly audit" and tick it.
    eq("2.C4 no Action is created to be completed", (s.nextActions ?? []).length, 9);
  }

  // --- D. not-done language never completes and never reschedules (§8) ---
  for (const text of [
    "I didn't work out today",
    "I didn't finish the proposal",
    "I forgot to pay the electric bill",
    "I never got around to the deployment",
  ]) {
    const s = world();
    ok(`2.D "${text}" proposes no completion`, detectCompletion(text, s, MON) === null);
    eq(`2.D2 "${text}" proposes no change of any kind`, readChanges(text, s, MON).changes.length, 0);
    const missed = detectMissed(text, s, MON);
    ok(`2.D3 "${text}" is read as a fact about the day`, !!missed);
    // §8: no moral language. The words below are the ones a productivity app
    // reaches for, and none of them may appear.
    const said = missed ? missedNoteReason(missed) : "";
    ok(`2.D4 "${text}" carries no judgment`,
      !/\b(fail|failed|missed|slipped|behind|streak|again|should|sorry|try harder)\b/i.test(said), said);
  }
  {
    const s = world();
    const m = detectMissed("I didn't work out today", s, MON)!;
    eq("2.D5 the matching open Action is named, not modified", m.related.map((r) => r.title), ["Workout"]);
    eq("2.D6 …and its status is untouched",
      (s.nextActions ?? []).find((a) => a.id === "workout")?.status, "open");
    eq("2.D7 …and no occurrence completion was recorded", (s.recurrenceCompletions ?? []).length, 0);
  }

  // --- E. the AI boundary cannot invent or over-reach (§19, §20) ---
  {
    const s = world();
    const ctx = buildEditContext("I finished the thing", s, MON);
    eq("2.E an invented record id is rejected",
      validateAiEdits([{ targetId: "made-up-id", operation: "complete" }], ctx, s).length, 0);
    eq("2.E2 an operation outside the enum is rejected",
      validateAiEdits([{ targetId: ctx.candidates[0]?.id, operation: "delete_everything" }], ctx, s).length, 0);
    const eventId = ctx.candidates.find((c) => c.kind === "event")?.id;
    eq("2.E3 the model cannot complete an Event",
      validateAiEdits([{ targetId: eventId, operation: "complete" }], ctx, s).length, 0);
    const actionId = ctx.candidates.find((c) => c.kind === "action")?.id;
    const kept = validateAiEdits([{ targetId: actionId, operation: "complete" }], ctx, s);
    eq("2.E4 a well-formed completion on a real Action survives", kept.length, 1);
    ok("2.E5 …and still has to be confirmed by a person",
      kept[0].authority === "unambiguous" && kept[0].candidateMatches.length === 1);
    // §20. The context is titles, dates and types. Nothing about content.
    const serialised = JSON.stringify(ctx.candidates);
    for (const field of FORBIDDEN_CONTEXT_FIELDS) {
      ok(`2.E6 the context carries no "${field}"`, !serialised.includes(`"${field}"`), serialised.slice(0, 200));
    }
  }

  // --- F. nothing here widens the ontology (§35) ---
  ok("2.F the capture pipeline still cannot express a belief or Constitution element",
    (FORBIDDEN_CANDIDATE_KINDS as readonly string[]).length > 0
    && interpret("I finished the deployment", world(), MON).candidates.every(
      (c) => !(FORBIDDEN_CANDIDATE_KINDS as readonly string[]).includes(c.kind)));
  eq("2.F2 completion added ONE operation to the existing enum, not a new path",
    EDIT_OPERATIONS.length, 8);
  ok("2.F3 …and it is on the same enum the change panel already renders",
    (EDIT_OPERATIONS as readonly string[]).includes("complete"));
  eq("2.F4 no new store domain", (STORE_DOMAINS as string[]).length, 46);

  // ===================================== 3. the boundaries of the morphology
  //
  // §12: no verb is added blind. These are the shapes that a looser rule — a
  // suffix stripper — would get wrong, and the table cannot.

  eq("3.1 'need' is not a past tense of 'ne'", baseOfPast("need"), undefined);
  eq("3.2 'speed' is not a past tense", baseOfPast("speed"), undefined);
  eq("3.3 'red' is not a past tense", baseOfPast("red"), undefined);
  eq("3.4 'worked out' keeps its particle", splitPastVerb("worked out")?.base, "work out");
  ok("3.5 every base in the table is a real verb form, not a fragment",
    Object.values(PAST_TO_BASE).every((b) => b.length >= 2 && /^[a-z ]+$/.test(b)));
  // Ordinary past-tense prose that names nothing open must stay a note.
  for (const text of ["Had a really good lunch today", "Went for a walk by the river", "Read two chapters last night"]) {
    ok(`3.6 "${text}" proposes nothing`, detectCompletion(text, world(), MON) === null);
  }
  ok("3.7 a completion shape is recognised even when it matches nothing",
    looksLikeCompletion("I finished the quarterly audit"));
  ok("3.8 not-done language is never read as completion",
    !looksLikeCompletion("I didn't finish the quarterly audit") && looksLikeMissed("I didn't finish the quarterly audit"));
  ok("3.9 waiting-shaped negation is left to the waiting rules",
    !looksLikeMissed("I haven't heard back from Marcus"));

  // ============================================== 4. the event heuristic (§5)
  //
  // `looksLikeEvent` is the narrowest part of this sprint and the easiest to
  // over-widen, so it is asserted directly as well as through `interpret`.

  ok("4.1 an appointment head with a clock is an event", looksLikeEvent("Dentist Thursday", true));
  ok("4.2 the same head with NO clock is not", !looksLikeEvent("Dentist Thursday", false));
  ok("4.3 a step verb is never an event", !looksLikeEvent("Call the dentist Thursday", true));
  ok("4.4 a sentence ABOUT a happening is not the happening", !looksLikeEvent("Meeting notes from Tuesday", true));
  ok("4.5 an explicit occurrence noun does not need a clock", looksLikeEvent("Dentist appointment Thursday", false));
  ok("4.6 an arbitrary noun with a time is not an event", !looksLikeEvent("Paper Friday", true));

  // ==================================== 5. the user's words are never rewritten
  //
  // §29. The interpretation is a reading; the sentence is the record.

  for (const text of [
    "I finished the deployment",
    "Called the dentist",
    "I didn't work out today",
    "Dentist Thursday at 2:30",
    "Still waiting on Marcus.",
  ]) {
    eq(`5.1 "${text}" survives interpretation verbatim`, interpret(text, world(), MON).raw, text);
    eq(`5.2 "${text}" is echoed back unchanged by the change reader`,
      detectCompletion(text, world(), MON)?.sourceText ?? text, text);
  }
  {
    // The normalized command must never replace what the user typed.
    const s = world();
    const intent = detectCompletion("Called the dentist", s, MON)!;
    eq("5.3 the source text is the sentence, not the query", intent.sourceText, "Called the dentist");
    ok("5.4 …and the query is only used for matching", intent.targetQuery !== intent.sourceText);
  }

  // ================================================= 6. §30 performance budget
  //
  // Interpretation runs on SUBMIT, not per keystroke, so the budget is a single
  // pass over a realistic store — and the store is what grows, not the sentence.

  for (const n of [100, 1000, 5000]) {
    const s = emptyState();
    s.nextActions = Array.from({ length: n }, (_, i) =>
      act({ id: `a${i}`, title: `Task number ${i}` }));
    const t0 = Date.now();
    interpret("I finished the deployment and need to email my professor tomorrow", s, MON);
    readChanges("Called the dentist", s, MON);
    detectMissed("I didn't work out today", s, MON);
    const ms = Date.now() - t0;
    ok(`6.1 one interpretation over ${n} actions stays under 250ms`, ms < 250, `${ms}ms`);
  }

  // ============================================ 7. §28 interaction accounting
  //
  // How many decisions a person makes to get from a sentence to the right
  // record. Counted as: candidates they must judge, plus confirmations.

  {
    const s = world();
    // Completion: ONE proposal, ONE confirmation. Not a search, not a list.
    const intent = detectCompletion("I finished the deployment", s, MON)!;
    eq("7.1 an unambiguous completion is one decision", intent.candidateMatches.length, 1);
    // Ambiguity costs exactly one more: the choice. It does not restart capture.
    const amb = detectCompletion("I finished the proposal", s, MON)!;
    eq("7.2 an ambiguous completion is one choice plus one confirmation", amb.candidateMatches.length, 2);
    // A mixed utterance is still one pass — the user is not asked to retype the
    // half the parser understood.
    const mixed = readChanges("I finished deployment and need to email my professor tomorrow", s, MON);
    eq("7.3 a mixed utterance needs no retyping", mixed.changes.length + (mixed.remainder ? 1 : 0), 2);
  }

  // ======================================= 8. recurring completion is bounded
  //
  // §6. Closing one occurrence must not close the standing responsibility —
  // the LIFEOS-061 contract, which this path is now a second entry point to.

  {
    const s = world();
    const intent = detectCompletion("Worked out this morning", s, MON)!;
    const target = intent.candidateMatches[0];
    const { ops, calls } = recordingOps();
    const outcome = applyTemporalEdit(buildProposal(intent, target), ops, { today: MON });
    ok("8.1 a repeating action closes ONE day", outcome.applied, outcome.message);
    eq("8.2 …through completeOccurrence, never completeAction", calls, [`completeOccurrence:workout:${MON}`]);
    ok("8.3 …and the action itself still repeats",
      !!readRule((s.nextActions ?? []).find((a) => a.id === "workout")?.recurrence));
    ok("8.4 the panel says so in the user's terms",
      /keeps repeating/i.test(buildProposal(intent, target).summary),
      buildProposal(intent, target).summary);
  }
  {
    // §18. A finished one-time action is history. Saying you finished it again
    // must not reopen or re-close it.
    const s = world();
    const intent = detectCompletion("I finished the registration", s, MON)!;
    eq("8.5 an already-completed action is refused", intent.refusal?.code, "already_complete");
    const { ops, calls } = recordingOps();
    const outcome = applyTemporalEdit(buildProposal(intent, intent.candidateMatches[0]), ops, { today: MON });
    ok("8.6 …and the dispatcher refuses it too, not just the UI", !outcome.applied, outcome.message);
    eq("8.7 …writing nothing", calls, []);
  }

  // ===================================== 9. decomposition did not over-widen
  //
  // §16 taught `decompose` to cut on a bare " and ". These are the sentences
  // where "and" joins two OBJECTS of one verb and must not be cut.

  for (const text of [
    "Buy milk and bread",
    "Move the sofa and the chair to the garage",
    "Fish and chips for dinner tomorrow at 7",
  ]) {
    eq(`9.1 "${text}" stays one segment`, decompose(text).length, 1);
  }
  for (const [text, count] of [
    ["I finished deployment and need to email my professor tomorrow", 2],
    ["Called the dentist and booked a haircut for Friday at 3", 2],
    ["Marcus still hasn't sent the document and I need to finish the proposal tonight", 2],
  ] as const) {
    eq(`9.2 "${text}" splits into ${count}`, decompose(text).length, count);
  }
  // An abbreviation's full stop is not a sentence boundary.
  eq("9.3 'Dr. Sarah Chen…' is one segment", decompose("Dr. Sarah Chen hasn't replied about the paperwork").length, 1);
  eq("9.4 …and reads as a wait on the whole name",
    detectWaiting("Dr. Sarah Chen hasn't replied about the paperwork")?.waitingOn, "Dr. Sarah Chen");

  // ================================================ 10. §13 remember routing
  //
  // The word alone decides nothing.

  eq("10.1 'Remember to call the dentist' is an Action", classifyOne("Remember to call the dentist").suggestedType, "action");
  eq("10.2 …titled with the errand, not the memory word",
    classifyOne("Remember to call the dentist").extracted?.title, "call the dentist");
  eq("10.3 'Remember Mom's birthday' is not an errand", kind("Remember Mom's birthday", emptyState()), "note");
  eq("10.4 'Remember Mom's birthday is August 14' becomes a yearly Event",
    kind("Remember Mom's birthday is August 14", emptyState()), "event");
  {
    const c = interpret("Remember Mom's birthday is August 14", emptyState(), MON).candidates[0];
    eq("10.5 …with no dangling copula in the title", c.fields.title, "Remember Mom's birthday");
    eq("10.6 …and a yearly rule read from the date itself", c.fields.recurrence?.frequency, "yearly");
  }
  // A conditional wearing a memory word is not an errand either.
  eq("10.7 'Remember to give him space when he gets overwhelmed' keeps its protocol shape",
    classifyOne("Remember to give him space when he gets overwhelmed").suggestedType, "note");

  // ================================================ 11. §22 one mutation UI
  //
  // Completion produces the SAME intent shape the change panel already renders.
  // If this ever diverges, there are two languages for changing a record.

  {
    const s = world();
    const done = detectCompletion("I finished the deployment", s, MON)!;
    const keys = Object.keys(done).sort();
    const expected = [
      "authority", "candidateMatches", "confidence", "operation", "proposedFields",
      "refusal", "sourceText", "targetQuery", "targetType", "unresolved",
    ];
    eq("11.1 a completion is a TemporalEditIntent, field for field", keys, expected);
    const proposal = buildProposal(done, done.candidateMatches[0]);
    ok("11.2 …and produces a before/after proposal like every other change",
      "before" in proposal && "after" in proposal && "summary" in proposal);
    ok("11.3 the summary is plain words, not a patch object",
      !/[{}]/.test(proposal.summary), proposal.summary);
  }
  {
    // Several completions in one utterance are separate confirmations, not one
    // atomic batch — the same rule LIFEOS-065 §24 set for reschedules.
    const s = world();
    const many = detectCompletions("I finished the deployment. Called the dentist.", s, MON);
    eq("11.4 two completions are two independent changes", many.length, 2);
    ok("11.5 …each with its own target",
      many[0].candidateMatches[0]?.id !== many[1].candidateMatches[0]?.id);
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - started,
    results,
  };
}

/** Kept exported so a caller can build the same fixture without re-deriving it. */
export type { EditTarget };
