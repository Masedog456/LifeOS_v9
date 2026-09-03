/**
 * Capture interpretation (LIFEOS-060 §3, §7).
 *
 * ## Three layers, kept apart
 *
 *   RAW CAPTURE       the sentence the user typed — persisted, never rewritten
 *   INTERPRETATION    this file — TRANSIENT, never persisted
 *   LIFE RECORDS      actions, notes, protocols — created only on confirm
 *
 * The middle layer exists in memory for the length of one confirmation and is
 * then discarded. That is a deliberate choice over persisting it: an
 * interpretation is a machine's reading, and a stored reading is a second
 * account of the user's life that can drift from the first. The raw capture is
 * already the durable record, and re-running a pure function over it reproduces
 * the interpretation exactly whenever it is needed again.
 *
 * This is why LIFEOS-060 adds **no migration and no new store domain**.
 *
 * ## Deterministic first
 *
 * `classifyCapture` is not replaced. LIFEOS-059 measured it at 4 clean, 2
 * partial, 4 failures, and every one of those failures was a missing CAPABILITY
 * (dates, recurrence, events, waiting phrasing) rather than a wrong rule. So the
 * rules stay and the capabilities are added around them:
 *
 *   decompose → per segment: waiting? → conditional? → classify → dates → match
 *
 * A model is consulted only when this pass says it is out of its depth, and it
 * can only ever propose the same constrained candidate kinds.
 *
 * ## Never-auto is structural
 *
 * `CandidateKind` has no `belief` and no `constitution_element`. This pipeline
 * cannot write one by any path, including the AI path, because the type it would
 * have to produce does not exist. See `lib/capture/authority.ts`.
 *
 * ## Pure
 *
 * `interpret()` is a function of (text, state, today). No clock of its own, no
 * network, no mutation. The AI escalation is a SEPARATE call the caller makes
 * after seeing `escalate` — this module never performs I/O.
 */

import { classifyOne, extractConditional, looksReflective, type ClassificationConfidence } from "@/lib/capture/classify";
import { detectStance, stanceDisclosure } from "@/lib/capture/stance";
import { detectAspiration, hasAspirationMarker, ASPIRATION_SUGGESTION_REASON } from "@/lib/capture/aspiration";
import { decompose, type Segment } from "@/lib/capture/decompose";
import { detectWaiting, waitingTitle } from "@/lib/capture/waiting";
import { detectMissed, missedNoteReason } from "@/lib/capture/completion";
import { detectOccasion, extractTemporal, stripResolvedTemporal, type TemporalFinding } from "@/lib/capture/dates";
import { completeRule, extractRecurrence, extractTimeOfDay, looksLikeEvent } from "@/lib/capture/schedule";
import { nextOccurrenceOnOrAfter, type RecurrenceRule } from "@/lib/time/recurrence";
import { matchRecords, NO_MATCH, type MatchResult } from "@/lib/capture/match";
import { authorityFor, type AuthorityLevel, type CandidateKind } from "@/lib/capture/authority";
import { detectStandard, hasNormativeMarker, STANDARD_SUGGESTION_REASON } from "@/lib/code/normative";
import type { StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";

/** Bumped when the rules change, so a stale UI can be told to re-interpret. */
export const PARSER_VERSION = "capture/2.0";

/** The fields a candidate proposes. All optional; the UI shows what is present. */
export interface CandidateFields {
  title?: string;
  body?: string;
  trigger?: string;
  response?: string;
  waitingOn?: string;
  /**
   * LIFEOS-066 §10. WHAT is being waited for, when the sentence separates it
   * from the person. Interpretation data, shown in the panel — the record still
   * stores the user's whole sentence, so nothing here is a second copy of it.
   */
  waitingFor?: string;
  dueDate?: DayKey;
  /** LIFEOS-061: wall-clock time. On an action this is `dueTime`; on an event, `startTime`. */
  time?: string;
  /** LIFEOS-061: recurrence rule, already completed against the anchor. */
  recurrence?: RecurrenceRule;
  projectId?: string;
  goalId?: string;
  workspaceId?: string;
}

export interface Candidate {
  /** Transient id, stable within one interpretation so the UI can key on it. */
  id: string;
  kind: CandidateKind;
  fields: CandidateFields;
  confidence: ClassificationConfidence;
  /** Plain language, shown to the user. Never a regex, never a percentage. */
  reason: string;
  /** The exact text this came from, and where it sat in the original. */
  evidence: { text: string; start: number; end: number };
  authority: AuthorityLevel;
  /** Temporal detail that could not be stored. Shown, never dropped. */
  unresolved: TemporalFinding[];
  /** An existing record this could attach to. */
  association: MatchResult;
  /**
   * Something the user must SEE, regardless of how certain the routing is.
   *
   * `reason` is a hedge and the panel hides it when confidence is high — which
   * is right for "starts with an action verb" and wrong for "nothing was marked
   * complete". LIFEOS-066 §8 needs the second kind: a statement about what did
   * NOT happen, on a candidate the parser is completely sure about. Rendered
   * unconditionally, the same way an unstorable date is (§18).
   */
  disclosure?: string;
  /** Other kinds the user may switch this to without retyping. */
  alternates: CandidateKind[];
  producedBy: "deterministic" | "ai";
}

export interface Interpretation {
  /** The capture exactly as typed. Never modified. */
  raw: string;
  candidates: Candidate[];
  /** Every unstorable temporal phrase across all candidates, deduplicated. */
  unresolved: TemporalFinding[];
  /** True when the deterministic pass wants help. The CALLER decides whether to ask. */
  escalate: boolean;
  /** Why escalation was suggested — shown in dev, never shown as an excuse. */
  escalateReason?: string;
  parserVersion: string;
}

/** Alternates offered per kind, so switching never requires retyping. */
const ALTERNATES: Record<CandidateKind, CandidateKind[]> = {
  action: ["note", "waiting", "project"],
  waiting: ["action", "note"],
  note: ["action", "reflection", "waiting"],
  protocol: ["note", "action"],
  reflection: ["note"],
  project: ["action", "note"],
  // LIFEOS-080. "Rule" joins the goal's alternates because the two genuinely
  // overlap — "I want to be someone who doesn't put things off" is an ambition
  // and a commitment at once, and the tie-break in `aspiration.ts` picks one.
  // Being able to disagree in a tap is what makes a tie-break acceptable.
  goal: ["action", "project", "note", "standard"],
  event: ["action", "note"],
  // LIFEOS-079 §19. A normative sentence is genuinely ambiguous — "I want to be
  // more patient" could be a rule, a goal or a note — so the alternates are the
  // bounded choice that ambiguity deserves.
  standard: ["goal", "note", "protocol"],
};

function seg(text: string): Segment {
  return { text, start: 0, end: text.length };
}

/** A display title from raw text, without stripping anything meaning-bearing. */
function titleOf(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "").trim();
}

/**
 * Interpret ONE segment.
 *
 * Rule order mirrors `classifyOne` — waiting before actions, conditionals before
 * everything — because those orderings were derived from real failures and
 * re-deriving them differently here would let the two disagree.
 */
function primaryCandidate(segment: Segment, index: number, state: StoreState, today: DayKey): Candidate {
  const text = segment.text.trim();
  const temporal = extractTemporal(text, today);
  const association = matchRecords(text, state);
  const base = {
    id: `c${index}`,
    evidence: { text, start: segment.start, end: segment.end },
    unresolved: temporal.unresolved,
    association,
    producedBy: "deterministic" as const,
  };

  // 0. TIME FOUNDATION (LIFEOS-061). Recurrence and time-of-day are now values,
  //    not apologies. Both are read before the routing rules below, because both
  //    change WHICH record the sentence should become.
  const timeFinding = extractTimeOfDay(text);
  const recFinding = extractRecurrence(text);
  const rule: RecurrenceRule | undefined =
    recFinding?.rule ? completeRule(recFinding.rule, temporal.dueDate ?? today) : undefined;

  // A recurrence phrase that could NOT become a rule keeps being reported, in
  // the user's own words. The channel narrowed; it did not disappear.
  const scheduleUnresolved: TemporalFinding[] = [];
  if (recFinding?.unsupported) {
    scheduleUnresolved.push({
      phrase: recFinding.phrase,
      // The two are different failures and the copy says which: "twice a week"
      // names a count with no days; "third Thursday" names days this model has
      // no way to express. Collapsing them would tell the user less than we know.
      reason: recFinding.unsupported === "ambiguous_frequency" ? "recurrence_ambiguous" : "recurrence",
    });
  }

  //    Recurrence and time strip out of the unresolved list once they ARE
  //    representable — reporting "time of day isn't stored yet" beside a stored
  //    time would be false.
  const stillUnresolved = temporal.unresolved.filter((u) => {
    if (u.reason === "time_of_day" && timeFinding) return false;
    if (u.reason === "recurrence" && rule) return false;
    return true;
  });
  const base2 = { ...base, unresolved: [...stillUnresolved, ...scheduleUnresolved] };

  //    EVENT vs ACTION is decided by intent shape, never by the presence of a
  //    time (§11, §13). "Dinner with Mom Friday at 7" happens; "Send Mom the form
  //    Friday at 7" is a step. Getting this wrong toward Action is the worse
  //    failure — it puts a checkbox on dinner.

  // 1. Conditional → protocol. Checked first: a conditional usually CONTAINS an
  //    action verb, so testing actions first would misroute every protocol.
  const cond = extractConditional(text);
  if (cond?.leading) {
    // LIFEOS-080. An un-delimited conditional ("If I feel overwhelmed I go for a
    // walk") is read from the subject alone, so it is `likely` rather than
    // `high` — the routing is a good reading, not a certain one. A protocol is
    // `confirm` either way; what changes is that the hedge is now shown.
    const confidence: ClassificationConfidence = cond.explicit ? "high" : "likely";
    return {
      ...base2,
      kind: "protocol",
      fields: { trigger: cond.trigger, response: cond.response, body: text },
      confidence,
      reason: "Reads as a when → then protocol.",
      authority: authorityFor("protocol", confidence),
      alternates: ALTERNATES.protocol,
    };
  }

  // LIFEOS-080 §15–§17. Both consequential detectors below consult
  // `detectStance` internally and refuse a sentence that only NAMES a
  // commitment — so nothing here has to remember to check. `interpretSegment`
  // reads the stance separately, to say why the reading was withheld.
  const aspiration = detectAspiration(text);

  // 1b. Unconditional standard → a Personal Code suggestion (LIFEOS-079 §8).
  //
  //     After the conditional test, because a when/then normative sentence has a
  //     working home already. Before the action rules, for the reason protocols
  //     are: "always tell the truth even when it makes me look bad" contains an
  //     action verb and would otherwise become an errand with a checkbox — which
  //     is the LIFEOS-059 defect pointed at a commitment.
  //
  //     This kind is `never_auto` and no conversion path can write it. The
  //     candidate exists so the sentence reaches Personal Code, not so capture
  //     can create a rule.
  //
  //     LIFEOS-080: and only when the sentence is not better read as an
  //     AMBITION. "I want to be debt free in two years" matched a normative
  //     marker and became a rule the person is held to — in the one tier capture
  //     cannot write at all, so the sentence went nowhere. `detectAspiration`
  //     returns null whenever its own remainder reads as a rule, so the two
  //     detectors cannot both claim a sentence: if the aspiration fired, the
  //     remainder was an outcome, and rule 5 below files it as a goal.
  const standard = aspiration ? null : detectStandard(text);
  if (standard) {
    return {
      ...base2,
      kind: "standard",
      fields: { title: standard.statement, body: standard.statement },
      confidence: "likely",
      reason: STANDARD_SUGGESTION_REASON,
      authority: authorityFor("standard", "likely"),
      alternates: ALTERNATES.standard,
    };
  }

  // 2. Waiting — now including the ordinary phrasings LIFEOS-059 found missing.
  const waiting = detectWaiting(text);
  if (waiting) {
    return {
      ...base2,
      kind: "waiting",
      fields: {
        title: stripResolvedTemporal(waitingTitle(text), temporal) || waitingTitle(text),
        waitingOn: waiting.waitingOn || undefined,
        // LIFEOS-066 §10. Who and what are separate facts now, and both are
        // shown. The TITLE still carries the user's whole sentence — the object
        // is surfaced beside it, never subtracted from what they wrote.
        waitingFor: waiting.waitingFor,
        dueDate: temporal.dueDate,
        time: temporal.dueDate ? timeFinding?.time : undefined,
      },
      confidence: "high",
      reason: waiting.reason,
      authority: authorityFor("waiting", "high"),
      alternates: ALTERNATES.waiting,
    };
  }

  // 2c. NOT-DONE language (LIFEOS-066 §8).
  //
  //     "I didn't work out today." is a fact about a day. It is not a completion
  //     and it is not a reschedule, so nothing here proposes either — the
  //     sentence becomes an ordinary note, kept exactly as typed.
  //
  //     What it adds is a factual pointer: if an open Action matches those
  //     words, the note says the Action is still open. That is the whole
  //     association, and it is deliberately one-directional — the note mentions
  //     the Action, the Action learns nothing about the note. No missed flag, no
  //     broken streak, no judgment. Placed after WAITING so "I haven't heard back
  //     from Marcus" keeps its correct reading.
  const missed = detectMissed(text, state, today);
  if (missed) {
    return {
      ...base2,
      kind: "note",
      fields: { body: text, title: titleOf(text) },
      confidence: "high",
      reason: "Kept as a note — a record of the day.",
      // The routing is certain; what the user must see is what did NOT happen.
      // That is a disclosure, not a hedge, so it does not live in `reason`.
      disclosure: missedNoteReason(missed),
      authority: authorityFor("note", "high"),
      alternates: ALTERNATES.note,
    };
  }

  // The bare-noun event path needs a clock: "Dentist Thursday at 2:30" names a
  // moment, "Dentist Thursday" is a reminder to ring them (§4, §5).
  const eventShaped = looksLikeEvent(text, !!timeFinding);
  if (eventShaped && (timeFinding || temporal.dueDate || rule)) {
    // A recurring event anchors to its FIRST ACTUAL occurrence. "Staff meeting
    // every Tuesday" captured on a Wednesday must not anchor to that Wednesday:
    // the anchor is a real instance, and one the rule does not produce would
    // show a meeting on a day it never happens.
    const anchor = temporal.dueDate
      ?? (rule ? (nextOccurrenceOnOrAfter(rule, today, today) ?? today) : today);
    // An occasion noun with a known date is annual by definition — "Mom's
    // birthday is August 14" recurs, and saying so is reading the sentence
    // rather than guessing at it. Without a date there is nothing to anchor and
    // this branch is not reached at all.
    const occasionHere = detectOccasion(text);
    const [, om, od] = anchor.split("-").map(Number);
    const effectiveRule = rule ?? (occasionHere && temporal.dueDate
      ? { frequency: "yearly" as const, interval: 1, month: om - 1, dayOfMonth: od }
      : undefined);
    return {
      ...base2,
      kind: "event",
      fields: {
        title: stripResolvedTemporal(titleOf(text), temporal).replace(timeFinding?.phrase ?? "\u0000", "").replace(/\s+/g, " ").trim() || titleOf(text),
        dueDate: anchor,
        time: timeFinding?.time,
        recurrence: effectiveRule,
      },
      // Once the occasion IS represented, continuing to report it as unresolved
      // would be a false disclosure — this channel's own failure mode, pointed
      // the other way.
      unresolved: base2.unresolved.filter((u) => u.reason !== "occasion"),
      confidence: "high",
      reason: effectiveRule ? "Something that happens, on a repeating schedule." : "Something that happens at a set time.",
      authority: authorityFor("event", "high"),
      alternates: ALTERNATES.event,
    };
  }

  // 2b. A recurrence rule on a non-event sentence names something you DO
  //     repeatedly, which is an ACTION regardless of how the sentence opens.
  //
  //     "Every Sunday refill my medication box" begins with "Every", so
  //     `classifyOne` finds no leading action verb and falls through to Note.
  //     That was the right answer when recurrence was unrepresentable; it is the
  //     wrong one now, because a standing responsibility with a schedule is
  //     exactly what a recurring action is for.
  if (rule && !eventShaped) {
    const cleaned = [recFinding?.phrase, timeFinding?.phrase]
      .filter((p): p is string => !!p)
      .reduce((acc, p) => acc.replace(p, ""), titleOf(text))
      .replace(/\s+/g, " ")
      .replace(/^[,;:\s]+/, "")
      .trim();
    return {
      ...base2,
      kind: "action",
      fields: {
        title: cleaned || titleOf(text),
        time: timeFinding?.time,
        recurrence: rule,
        // No dueDate: a recurring action's schedule IS its rule. A one-off date
        // here would be the arbitrary occurrence the whole model refuses.
      },
      confidence: "high",
      reason: "Something to do, on a repeating schedule.",
      authority: authorityFor("action", "high"),
      alternates: ALTERNATES.action,
    };
  }

  // 3. An OCCASION is not a task.
  //
  //    "I need to remember Mom's birthday" reads as an action to every rule in
  //    `classify.ts`, and filing it as one reproduces the LIFEOS-059 defect in a
  //    new place: an Action carries completion semantics and a birthday has
  //    none. Ticking it off is meaningless; leaving it open makes it permanent
  //    debris in the Next list.
  //
  //    Conqify cannot represent an occasion until LIFEOS-061, so it says so
  //    rather than pretending. A note keeps the sentence, the limitation is
  //    stated in the user's own words, and no date is invented. Checked BEFORE
  //    the action rules for the same reason protocols are: the sentence contains
  //    the shape that would otherwise capture it.
  const occasion = detectOccasion(text);
  if (occasion) {
    // §13 splits what LIFEOS-060 could not: a KNOWN occasion date and an
    // occasion with no date are different situations.
    //
    // "Mom's birthday is August 14" names a day, and a birthday recurs yearly —
    // that is a complete Event, and yearly recurrence is read from the date
    // itself rather than assumed, because a birthday is annual by definition.
    if (temporal.dueDate) {
      const [, mm, dd] = temporal.dueDate.split("-").map(Number);
      return {
        ...base2,
        kind: "event",
        fields: {
          title: stripResolvedTemporal(titleOf(text), temporal) || titleOf(text),
          dueDate: temporal.dueDate,
          time: timeFinding?.time,
          recurrence: rule ?? { frequency: "yearly", interval: 1, month: mm - 1, dayOfMonth: dd },
        },
        // The occasion is now represented, so continuing to report it as
        // unresolved would be a false disclosure — the failure mode this whole
        // channel exists to prevent, pointed the other way.
        unresolved: base2.unresolved.filter((u) => u.reason !== "occasion"),
        confidence: "likely",
        reason: "An occasion on a known date — kept as a yearly event.",
        authority: authorityFor("event", "likely"),
        alternates: ALTERNATES.event,
      };
    }
    // No date anywhere in the sentence. Still nothing to invent (§13).
    return {
      ...base2,
      kind: "note",
      fields: { body: text, title: titleOf(text) },
      confidence: "possible",
      reason:
        "This sounds like an occasion, but no date was given. Conqify keeps it as a note rather than guessing one — add a date and it becomes an event.",
      authority: authorityFor("note", "possible"),
      alternates: ALTERNATES.note,
    };
  }

  // 5. "I want to learn Spanish" is a GOAL, not a next action (§7).
  //
  //    `classifyOne` reads it as an action because "I want to" shares a rule with
  //    "I need to", and LIFEOS-059 measured the cost: "learn Spanish" lands in the
  //    Next list and sits there forever, which is precisely how people come to
  //    distrust a task system. Goal semantics already exist (`createGoal`), so
  //    this routes to the structure that fits rather than inventing one — and at
  //    `possible` confidence, so it is confirmed rather than assumed.
  //
  //    Handled here and not in `classify.ts` deliberately: that module's rules are
  //    load-bearing for four other surfaces, and this is a capture-pipeline
  //    judgment about where something should GO, not about what it IS.
  //    LIFEOS-080 §7 replaced that single anchored regex with
  //    `lib/capture/aspiration.ts`. The anchor was the defect: any prefix
  //    defeated it, so "Someday I want to move closer to my parents" and even
  //    "My goal is to save six months of expenses" were notes.
  //
  //    The one case that does NOT become a goal here is a reflective opener.
  //    "I've been thinking I want to change careers" is a person thinking out
  //    loud, and answering it with a Goal asserts a decision they are still
  //    making. The reflection stays what the sentence IS; the ambition is
  //    offered beside it, unticked, by `secondaryCandidates`.
  if (aspiration && !looksReflective(text)) {
    return {
      ...base2,
      kind: "goal",
      fields: {
        title: stripResolvedTemporal(aspiration.objective, temporal) || aspiration.objective,
        dueDate: temporal.dueDate,
      },
      confidence: "possible",
      reason: ASPIRATION_SUGGESTION_REASON,
      authority: authorityFor("goal", "possible"),
      alternates: ALTERNATES.goal,
    };
  }

  // 6. Everything else goes through the existing, proven classifier.
  const classified = classifyOne(text);
  const titled = stripResolvedTemporal(classified.extracted?.title ?? text, temporal) || text;

  switch (classified.suggestedType) {
    case "action":
      return {
        ...base2,
        kind: "action",
        fields: {
          // A resolved time leaves the title the same way a resolved date does —
          // the field owns it now, and two copies would drift.
          title: (timeFinding ? titled.replace(timeFinding.phrase, "").replace(/\s+/g, " ").trim() : titled) || titled,
          dueDate: temporal.dueDate,
          // A due TIME needs a due DATE. Without one it names no moment, so it
          // is dropped rather than stored as a half-fact.
          time: temporal.dueDate ? timeFinding?.time : undefined,
          recurrence: rule,
        },
        confidence: classified.confidence,
        reason: rule ? "Something to do, on a repeating schedule." : classified.reason,
        authority: authorityFor("action", classified.confidence),
        alternates: ALTERNATES.action,
      };

    case "project":
      return {
        ...base2,
        kind: "project",
        fields: { title: titled, dueDate: temporal.dueDate },
        confidence: classified.confidence,
        // §10: never created automatically, and the copy says so.
        reason: `${classified.reason} Conqify won't create a project unless you say so.`,
        authority: authorityFor("project", classified.confidence),
        alternates: ALTERNATES.project,
      };

    // A reflection is a statement about the user's inner life. It is offered as
    // a NOTE — the safe fallback of §16 — with the reflective reading named, and
    // `reflection` one tap away for anyone who wants it. Coercing formal
    // structure onto someone thinking out loud is exactly what §16 forbids.
    case "reflection":
      return {
        ...base2,
        kind: "note",
        fields: { body: text, title: titled, dueDate: temporal.dueDate },
        confidence: classified.confidence,
        reason: "Reads as a reflection — kept as a note unless you'd rather file it.",
        authority: authorityFor("note", classified.confidence),
        alternates: ["reflection", "note"],
      };

    case "question":
      return {
        ...base2,
        kind: "note",
        fields: { body: text, title: titled, dueDate: temporal.dueDate },
        confidence: classified.confidence,
        reason: "Reads as an open question — a note keeps it.",
        authority: authorityFor("note", classified.confidence),
        alternates: ALTERNATES.note,
      };

    case "note":
    case "unknown":
    default:
      return {
        ...base2,
        kind: "note",
        fields: { body: text, title: titled, dueDate: temporal.dueDate },
        confidence: classified.confidence,
        reason: classified.reason,
        authority: authorityFor("note", classified.confidence),
        alternates: ALTERNATES.note,
      };
  }
}

/**
 * Readings the sentence also supports (LIFEOS-080 §3).
 *
 * ## Why this exists
 *
 * The north star says a capture may hold several things at once, and until now
 * "several" meant several CLAUSES: `primaryCandidate` has a `return` in every
 * branch, so one segment produced exactly one candidate no matter what was in
 * it. A single clause that is genuinely two things could not be read as two.
 *
 * ## Kept narrow on purpose
 *
 * Exactly one case qualifies today: a REFLECTIVE sentence that also names an
 * ambition or a rule.
 *
 *   "I've been thinking I want to change careers"
 *     → Note (reflection)  ·  Goal "change careers", unticked
 *
 * Suppressing the goal loses what the person said; asserting it decides a career
 * change on their behalf. Offering both is the honest answer, and it is only
 * honest while the second one arrives unselected — which is why every candidate
 * here is `confirm` or `never_auto` and why none is ever `high` confidence.
 *
 * A second candidate is not a second opinion about the same record. If the
 * sentence supports one reading, this returns nothing.
 */
function secondaryCandidates(primary: Candidate, index: number): Candidate[] {
  const text = primary.evidence.text;
  // Only a reflection carries a second reading, and only when the sentence is
  // actually asserting something — a remembered or declined ambition is not one.
  if (primary.kind !== "note" || !looksReflective(text)) return [];
  if (detectStance(text).stance !== "asserted") return [];

  const base = {
    id: `c${index}b`,
    evidence: primary.evidence,
    unresolved: [],
    association: primary.association,
    producedBy: "deterministic" as const,
    // Never pre-selected, whatever the kind. The primary reading is the one the
    // sentence makes; this is the one it leaves open.
    confidence: "possible" as const,
  };

  const aspiration = detectAspiration(text);
  if (aspiration) {
    return [{
      ...base,
      kind: "goal",
      fields: { title: aspiration.objective },
      reason: "You're thinking this through — if it's a goal, Conqify can keep it as one.",
      authority: authorityFor("goal", "possible"),
      alternates: ALTERNATES.goal,
    }];
  }

  const standard = detectStandard(text);
  if (standard) {
    return [{
      ...base,
      kind: "standard",
      fields: { title: standard.statement, body: standard.statement },
      reason: "You're thinking this through — if it's a rule you hold, it belongs in your Personal Code.",
      authority: authorityFor("standard", "possible"),
      alternates: ALTERNATES.standard,
    }];
  }

  return [];
}

/**
 * Interpret one segment: the reading the sentence makes, plus any it leaves open.
 */
function interpretSegment(segment: Segment, index: number, state: StoreState, today: DayKey): Candidate[] {
  const primary = primaryCandidate(segment, index, state, today);
  const text = primary.evidence.text;

  // LIFEOS-080 §15–§17. When a guard withheld a Goal or a Rule, say so. The
  // sentence still becomes a note, kept exactly as typed — but a person who
  // writes "I used to always answer emails immediately" should be able to see
  // that Conqify read them correctly, and that reading them correctly is
  // precisely why it did not hand them a rule.
  //
  // Only when the sentence really did carry one of those markers: a disclosure
  // about a reading that was never available would be noise at best and a
  // fabricated near-miss at worst.
  const stance = detectStance(text);
  if (primary.kind === "note" && !primary.disclosure && stance.stance !== "asserted"
      && (hasNormativeMarker(text) || hasAspirationMarker(text))) {
    primary.disclosure = stanceDisclosure(stance) ?? undefined;
  }

  return [primary, ...secondaryCandidates(primary, index)];
}

/**
 * Should the model be asked?
 *
 * Conservative on purpose. Escalation costs money and latency, and the
 * deterministic pass is right about ordinary life most of the time. It asks only
 * when a segment is substantial AND the rules could not place it — a long
 * sentence that fell through to the note fallback is the shape of something the
 * rules genuinely do not cover.
 */
function shouldEscalate(candidates: Candidate[]): { escalate: boolean; reason?: string } {
  const vague = candidates.filter(
    (c) => c.kind === "note" && c.confidence === "possible" && c.evidence.text.split(/\s+/).length >= 8,
  );
  if (vague.length > 0) {
    return { escalate: true, reason: `${vague.length} segment(s) didn't match any rule` };
  }
  return { escalate: false };
}

/**
 * Interpret a whole capture.
 *
 * Always returns at least one candidate for non-empty text: a capture that
 * produces nothing would leave the user staring at their own sentence with no
 * way forward, and Note exists precisely so that cannot happen.
 */
export function interpret(text: string, state: StoreState, today: DayKey): Interpretation {
  const raw = text ?? "";
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw, candidates: [], unresolved: [], escalate: false, parserVersion: PARSER_VERSION };
  }

  const segments = decompose(trimmed);
  const candidates = (segments.length > 0 ? segments : [seg(trimmed)])
    .flatMap((s, i) => interpretSegment(s, i, state, today));

  // Deduplicate unresolved phrases across candidates for the summary line.
  const unresolved: TemporalFinding[] = [];
  for (const c of candidates) {
    for (const u of c.unresolved) {
      if (!unresolved.some((x) => x.phrase.toLowerCase() === u.phrase.toLowerCase() && x.reason === u.reason)) {
        unresolved.push(u);
      }
    }
  }

  const { escalate, reason } = shouldEscalate(candidates);
  return { raw, candidates, unresolved, escalate, escalateReason: reason, parserVersion: PARSER_VERSION };
}

/**
 * True when a candidate resolved a date that its kind cannot store.
 *
 * "Dentist appointment Tuesday at 2:30" reads as a note — an appointment is not
 * a task, and inventing an Event is LIFEOS-061's job. But a note has no date
 * field, so the Tuesday this parser successfully resolved would silently vanish
 * on commit. §18 forbids exactly that: no silent dropping of time phrases.
 *
 * So the date rides along on `fields` as interpretation data, the UI says it is
 * not being kept, and switching the candidate to an Action keeps it — one tap,
 * no retyping. The user is told what the trade is instead of discovering it.
 */
export function dateNotKept(candidate: Candidate): boolean {
  return !!candidate.fields.dueDate && candidate.kind !== "action" && candidate.kind !== "waiting" && candidate.kind !== "event";
}

/**
 * The whole capture as a single note candidate — the §16 escape hatch.
 *
 * Always available, never dependent on interpretation succeeding. If every rule
 * in this file were wrong, this still works.
 */
export function wholeCaptureAsNote(text: string): Candidate {
  const t = (text ?? "").trim();
  return {
    id: "whole",
    kind: "note",
    fields: { body: t },
    confidence: "high",
    reason: "Kept exactly as you wrote it.",
    evidence: { text: t, start: 0, end: t.length },
    authority: "auto_with_undo",
    unresolved: [],
    association: NO_MATCH,
    alternates: [],
    producedBy: "deterministic",
  };
}
