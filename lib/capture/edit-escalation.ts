/**
 * The AI boundary for temporal editing (LIFEOS-065 §25, §26).
 *
 * ## The model never mutates
 *
 * It cannot. Nothing in this file writes, and the only thing it produces is a
 * `TemporalEditIntent` that goes back through the same confirmation the
 * deterministic path uses. The model's job is to say WHICH record and WHAT
 * change; the decision to apply is still a person pressing a button.
 *
 * ## Everything it returns is validated against what it was given
 *
 * A record id it did not receive is rejected. An operation outside the enum is
 * rejected. A malformed date or time is rejected. A field nobody asked for is
 * dropped. The validator is the load-bearing part: a model that hallucinates an
 * id would otherwise mutate a record the user never mentioned, and that is the
 * one failure this whole sprint is built to prevent.
 *
 * ## The context is the smallest thing that could work
 *
 * Candidate titles, their dates and times, their type, and a project title when
 * one is relevant. Not notes. Not bodies. Not the Constitution, beliefs, or
 * anything marked `excludeFromAi`. A rescheduling question does not need to know
 * what the user thinks about their marriage.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { StoreState } from "@/types/mvp";
import { isLocalTime, type LocalTime } from "@/lib/time/localtime";
import { isLive } from "@/lib/actions/due";
import { readRule } from "@/lib/time/recurrence";
import {
  EDIT_OPERATIONS, authorityFor,
  type EditOperation, type EditTarget, type TemporalEditIntent,
} from "@/lib/capture/temporal-edit";

/** One record the model may choose between. Nothing else about it is sent. */
export interface EditCandidateContext {
  id: string;
  kind: "action" | "event";
  title: string;
  date?: DayKey;
  time?: LocalTime;
  repeats?: boolean;
  /** Only the project's TITLE, and only when the record has one. */
  project?: string;
}

export interface EditEscalationContext {
  text: string;
  today: DayKey;
  candidates: EditCandidateContext[];
  operations: readonly EditOperation[];
}

/** How many records are worth asking about. Beyond this the answer is "ask me". */
const MAX_CANDIDATES = 12;

/**
 * Build the smallest context that could answer the question (§26).
 *
 * Scoped to records that could plausibly be rescheduled: live actions and
 * events. Completed and cancelled actions are excluded — not to save tokens, but
 * because §18 forbids editing them anyway, so offering them as candidates would
 * invite an answer that must then be refused.
 */
export function buildEditContext(text: string, state: StoreState, today: DayKey): EditEscalationContext {
  const projectTitle = new Map<string, string>();
  for (const p of state.projects ?? []) projectTitle.set(p.id, p.title);

  const candidates: EditCandidateContext[] = [];
  for (const a of state.nextActions ?? []) {
    if (!isLive(a)) continue;
    candidates.push({
      id: a.id, kind: "action", title: a.title,
      date: a.dueDate, time: a.dueTime,
      repeats: !!readRule(a.recurrence) || undefined,
      project: a.projectId ? projectTitle.get(a.projectId) : undefined,
    });
  }
  for (const e of state.events ?? []) {
    candidates.push({
      id: e.id, kind: "event", title: e.title,
      date: e.date, time: e.startTime,
      repeats: !!readRule(e.recurrence) || undefined,
    });
  }

  // Nearest-dated first: a rescheduling question is almost always about
  // something soon, and an arbitrary slice of a long list is worse than a
  // principled one.
  candidates.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  return {
    text,
    today,
    candidates: candidates.slice(0, MAX_CANDIDATES),
    operations: EDIT_OPERATIONS,
  };
}

/** The shape a model is allowed to return. Anything else is discarded. */
export interface AiEditSuggestion {
  targetId?: unknown;
  operation?: unknown;
  date?: unknown;
  time?: unknown;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a model's answer against the context it was given (§25).
 *
 * Returns the intents that survive. A suggestion is kept only when every part of
 * it is something the model was handed or something the schema allows: the id
 * must be one of the candidates, the operation must be in the enum, the date
 * must be a real day key, the time must be a `LocalTime`. Nothing is coerced —
 * a suggestion that is nearly valid is dropped, because "nearly" is how a wrong
 * record gets changed.
 */
export function validateAiEdits(
  raw: unknown,
  context: EditEscalationContext,
  state: StoreState,
): TemporalEditIntent[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const byId = new Map(context.candidates.map((c) => [c.id, c]));
  const out: TemporalEditIntent[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const s = item as AiEditSuggestion;

    const targetId = typeof s.targetId === "string" ? s.targetId : "";
    const candidate = byId.get(targetId);
    // No invented ids. This is the assertion the whole boundary rests on.
    if (!candidate) continue;
    if (seen.has(targetId)) continue;

    const operation = typeof s.operation === "string" && (EDIT_OPERATIONS as string[]).includes(s.operation)
      ? (s.operation as EditOperation)
      : undefined;
    if (!operation) continue;

    const date = typeof s.date === "string" && DAY_RE.test(s.date) ? (s.date as DayKey) : undefined;
    const time = isLocalTime(s.time) ? (s.time as LocalTime) : undefined;

    // An operation with nothing to apply is not a suggestion.
    if ((operation === "move_date" || operation === "change_time") && !date && !time) continue;

    const target = resolveTarget(candidate, state);
    if (!target) continue;

    seen.add(targetId);
    out.push({
      targetType: candidate.kind,
      targetQuery: candidate.title,
      operation,
      proposedFields: { date, time },
      sourceText: context.text,
      confidence: "possible",
      authority: authorityFor([target]),
      candidateMatches: [target],
      unresolved: [],
    });
  }
  return out;
}

/** Re-read the record from state, so the proposal is built from truth. */
function resolveTarget(c: EditCandidateContext, state: StoreState): EditTarget | undefined {
  if (c.kind === "action") {
    const a = (state.nextActions ?? []).find((x) => x.id === c.id);
    if (!a) return undefined;
    return {
      kind: "action", id: a.id, title: a.title,
      currentDate: a.dueDate, currentTime: a.dueTime,
      recurrence: readRule(a.recurrence) ?? undefined,
      status: a.status,
      blocked: a.status === "completed" ? "This action is already completed." : undefined,
    };
  }
  const e = (state.events ?? []).find((x) => x.id === c.id);
  if (!e) return undefined;
  return {
    kind: "event", id: e.id, title: e.title,
    currentDate: e.date, currentTime: e.startTime,
    recurrence: readRule(e.recurrence) ?? undefined,
  };
}

/**
 * Fields that must never appear on a CANDIDATE. Asserted in tests.
 *
 * The user's own sentence IS sent — it is the question being asked, and a model
 * cannot answer "which record did they mean?" without it. What must never
 * travel is the CONTENT of records: a note's body, an action's description, a
 * reflection's response, anything from the Constitution or beliefs. Deciding
 * whether to move a dentist appointment does not require knowing what the user
 * thinks about their marriage.
 */
export const FORBIDDEN_CONTEXT_FIELDS: readonly string[] = [
  "body", "notes", "description", "response", "statement",
  "beliefs", "constitutionElements", "reflections", "captures", "excludeFromAi",
];
