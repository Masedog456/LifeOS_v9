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

import { classifyOne, extractConditional, type ClassificationConfidence } from "@/lib/capture/classify";
import { decompose, type Segment } from "@/lib/capture/decompose";
import { detectWaiting, waitingTitle } from "@/lib/capture/waiting";
import { detectOccasion, extractTemporal, stripResolvedTemporal, type TemporalFinding } from "@/lib/capture/dates";
import { matchRecords, NO_MATCH, type MatchResult } from "@/lib/capture/match";
import { authorityFor, type AuthorityLevel, type CandidateKind } from "@/lib/capture/authority";
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
  dueDate?: DayKey;
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
  goal: ["action", "project", "note"],
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
function interpretSegment(segment: Segment, index: number, state: StoreState, today: DayKey): Candidate {
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

  // 1. Conditional → protocol. Checked first: a conditional usually CONTAINS an
  //    action verb, so testing actions first would misroute every protocol.
  const cond = extractConditional(text);
  if (cond?.leading) {
    return {
      ...base,
      kind: "protocol",
      fields: { trigger: cond.trigger, response: cond.response, body: text },
      confidence: "high",
      reason: "Reads as a when → then protocol.",
      authority: authorityFor("protocol", "high"),
      alternates: ALTERNATES.protocol,
    };
  }

  // 2. Waiting — now including the ordinary phrasings LIFEOS-059 found missing.
  const waiting = detectWaiting(text);
  if (waiting) {
    return {
      ...base,
      kind: "waiting",
      fields: {
        title: stripResolvedTemporal(waitingTitle(text), temporal) || waitingTitle(text),
        waitingOn: waiting.waitingOn || undefined,
        dueDate: temporal.dueDate,
      },
      confidence: "high",
      reason: waiting.reason,
      authority: authorityFor("waiting", "high"),
      alternates: ALTERNATES.waiting,
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
    return {
      ...base,
      kind: "note",
      fields: { body: text, title: titleOf(text), dueDate: temporal.dueDate },
      confidence: "possible",
      reason:
        "This sounds like a date or occasion. Conqify can keep it as a note for now, but timed events aren't supported yet.",
      // Never pre-ticked: the user should see the limitation before agreeing to it.
      authority: authorityFor("note", "possible"),
      alternates: ALTERNATES.note,
    };
  }

  // 4. "I want to learn Spanish" is a GOAL, not a next action (§7).
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
  const aspiration = /^i\s+want\s+to\s+(.+)$/i.exec(text);
  if (aspiration) {
    const rest = aspiration[1].trim().replace(/[.,;:!?]+$/, "").trim();
    const restIsErrand = classifyOne(rest).confidence === "high" && classifyOne(rest).suggestedType === "action";
    if (!restIsErrand) {
      return {
        ...base,
        kind: "goal",
        fields: { title: stripResolvedTemporal(rest, temporal) || rest, dueDate: temporal.dueDate },
        confidence: "possible",
        reason: "Reads as something you want, not a single next step. Conqify won't create a goal unless you say so.",
        authority: authorityFor("goal", "possible"),
        alternates: ALTERNATES.goal,
      };
    }
  }

  // 5. Everything else goes through the existing, proven classifier.
  const classified = classifyOne(text);
  const titled = stripResolvedTemporal(classified.extracted?.title ?? text, temporal) || text;

  switch (classified.suggestedType) {
    case "action":
      return {
        ...base,
        kind: "action",
        fields: { title: titled, dueDate: temporal.dueDate },
        confidence: classified.confidence,
        reason: classified.reason,
        authority: authorityFor("action", classified.confidence),
        alternates: ALTERNATES.action,
      };

    case "project":
      return {
        ...base,
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
        ...base,
        kind: "note",
        fields: { body: text, title: titled, dueDate: temporal.dueDate },
        confidence: classified.confidence,
        reason: "Reads as a reflection — kept as a note unless you'd rather file it.",
        authority: authorityFor("note", classified.confidence),
        alternates: ["reflection", "note"],
      };

    case "question":
      return {
        ...base,
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
        ...base,
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
    .map((s, i) => interpretSegment(s, i, state, today));

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
  return !!candidate.fields.dueDate && candidate.kind !== "action" && candidate.kind !== "waiting";
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
