/**
 * The model output contract (LIFEOS-058 §22).
 *
 * ## The rule this file exists to enforce
 *
 *   THE MODEL PROPOSES DATA. APPLICATION CODE OWNS ALL STATE TRANSITIONS.
 *
 * Everything the model returns arrives here first, as untrusted JSON, and leaves
 * as either a validated value or a logged rejection. Nothing reaches session
 * state — let alone the store — by any other path.
 *
 * ## Why validation is subtractive, not corrective
 *
 * A validator that *repairs* malformed output is a validator that will one day
 * repair an attack into something well-formed. So every check here drops the
 * offending item and records why. A synthesis that returns six proposals, two of
 * them malformed, yields four proposals and two rejections — never four
 * proposals and two guesses.
 *
 * ## The id rule
 *
 * The model never sees a `ConstitutionElement` id and can never emit one. It may
 * cite QUESTION ids (which are compile-time constants from the question bank)
 * and INFLUENCE refs the user personally attached — and each is checked against
 * the set actually offered in this session. An id the model invented is not a
 * broken reference to be dropped quietly; it is the signature of a model
 * hallucinating a record, so it is rejected loudly.
 *
 * This is what closes the gap between "AI suggested wording" and "AI edited my
 * Constitution": there is no id in the model's vocabulary that names anything
 * mutable.
 *
 * ## Fields the model may not send
 *
 * `adoptedAt`, `status`, `id`, `elementId`, `supersedesId`, `excludeFromAi`,
 * `fromAiText`, `origin`, `provenance`, `userAuthored`. Their presence is not a
 * typo to be stripped — it means the output was shaped by something trying to
 * write state or claim authorship, so the whole item is rejected.
 */

import type { ConstitutionKind, RecordRefLite } from "@/types/mvp";
import { CONSTITUTION_KINDS } from "@/types/mvp";
import type { InterviewProposal, InterviewTension } from "@/lib/interview/session";
import { proposalSignature } from "@/lib/interview/session";
import { MAX_PROPOSALS } from "@/lib/interview/questions";

/** Why one item was rejected. Surfaced in the dev diagnostics, counted in tests. */
export type RejectionCode =
  | "not_an_object"
  | "unknown_kind"
  | "forbidden_field"
  | "invented_answer_id"
  | "invented_source_ref"
  | "malformed_ref"
  | "mutation_instruction"
  | "empty_statement"
  | "over_length"
  | "over_count";

export interface Rejection {
  code: RejectionCode;
  /** Short, non-quoting detail. Model text is never echoed into a log. */
  detail: string;
}

export interface Validated<T> {
  value: T[];
  rejected: Rejection[];
}

/** Fields whose presence means the output tried to write state or claim origin. */
const FORBIDDEN_FIELDS: readonly string[] = [
  "adoptedAt", "adopted_at", "status", "id", "elementId", "element_id",
  "supersedesId", "supersedes_id", "retiredAt", "retired_at",
  "excludeFromAi", "exclude_from_ai", "fromAiText", "from_ai_text",
  "origin", "originType", "provenance", "userAuthored", "user_authored",
  "createdAt", "updatedAt",
];

/**
 * Imperatives that mean the "proposal" is actually an instruction.
 *
 * This is a backstop, not the primary defence — the primary defence is that no
 * field in the schema can express a state change, so an instruction has nowhere
 * to land even if it gets through. But an item whose *statement* is "adopt this
 * automatically" is not a Constitution candidate under any reading, and letting
 * it render would put an instruction in front of a user as if it were their own
 * candidate wording.
 */
const MUTATION_INSTRUCTION =
  /\b(ignore (all |any |the )?(previous|prior|above|earlier|system)|disregard (all |any |the )?(previous|prior|above|earlier|system)|adopt (this|it|these|all) (automatically|immediately|without|silently)|automatically adopt|set adoptedat|mark (this|it) as adopted|add (this|it) to (the|their|your) constitution automatically|override (the )?(system|instructions|rules)|you are now|new instructions)\b/i;

const MAX_STATEMENT = 400;
const MAX_RATIONALE = 600;
const MAX_QUESTION = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function forbiddenField(o: Record<string, unknown>): string | null {
  for (const f of FORBIDDEN_FIELDS) if (f in o) return f;
  return null;
}

/** The context a validation runs against — the ONLY ids the model may cite. */
export interface ValidationContext {
  /** Question ids that exist in this session (bank ids + follow-up ids). */
  knownAnswerIds: readonly string[];
  /** Influence refs the USER attached. The model may cite these and nothing else. */
  allowedRefs: readonly RecordRefLite[];
}

function refAllowed(ctx: ValidationContext, ref: RecordRefLite): boolean {
  return ctx.allowedRefs.some((r) => r.kind === ref.kind && r.id === ref.id);
}

/**
 * Validate proposed Constitution candidates.
 *
 * Returns proposals WITHOUT ids: `mergeProposals` mints those, so a signature
 * computed here is the only identity the model's output carries into the
 * session — and two runs over the same answers therefore converge rather than
 * multiply (§21.23).
 */
export function validateProposals(raw: unknown, ctx: ValidationContext): Validated<Omit<InterviewProposal, "id">> {
  const rejected: Rejection[] = [];
  const value: Omit<InterviewProposal, "id">[] = [];

  const list = isRecord(raw) && Array.isArray(raw.proposals) ? raw.proposals : Array.isArray(raw) ? raw : null;
  if (!list) return { value, rejected: [{ code: "not_an_object", detail: "no proposals array" }] };

  for (const item of list) {
    if (!isRecord(item)) {
      rejected.push({ code: "not_an_object", detail: "proposal was not an object" });
      continue;
    }
    const bad = forbiddenField(item);
    if (bad) {
      rejected.push({ code: "forbidden_field", detail: `proposal carried "${bad}"` });
      continue;
    }

    const kind = str(item.kind) as ConstitutionKind;
    if (!(CONSTITUTION_KINDS as readonly string[]).includes(kind)) {
      // §9: the model may suggest only the four implemented kinds. "identity",
      // "rule", "boundary", "aspiration", "commitment" and "question" all land
      // here, which is the point — a new kind is a product decision, not a
      // model output.
      rejected.push({ code: "unknown_kind", detail: `kind not one of the four` });
      continue;
    }

    const statement = str(item.statement);
    if (!statement) {
      rejected.push({ code: "empty_statement", detail: "empty statement" });
      continue;
    }
    if (statement.length > MAX_STATEMENT) {
      rejected.push({ code: "over_length", detail: `statement ${statement.length} chars` });
      continue;
    }
    if (MUTATION_INSTRUCTION.test(statement)) {
      rejected.push({ code: "mutation_instruction", detail: "statement contained an instruction" });
      continue;
    }

    const rationale = str(item.rationale ?? item.why ?? item.explanation).slice(0, MAX_RATIONALE);
    if (MUTATION_INSTRUCTION.test(rationale)) {
      rejected.push({ code: "mutation_instruction", detail: "rationale contained an instruction" });
      continue;
    }

    // Supporting answers: every cited id must exist in this session.
    const citedRaw = Array.isArray(item.supportingAnswerIds) ? item.supportingAnswerIds : [];
    const cited = citedRaw.filter((x): x is string => typeof x === "string").map((x) => x.trim());
    const invented = cited.filter((c) => !ctx.knownAnswerIds.includes(c));
    if (invented.length > 0) {
      rejected.push({ code: "invented_answer_id", detail: `${invented.length} unknown answer id(s)` });
      continue;
    }

    // Source refs: only what the user actually attached.
    const refsRaw = Array.isArray(item.sourceRefs) ? item.sourceRefs : [];
    const refs: RecordRefLite[] = [];
    let refProblem: Rejection | null = null;
    for (const r of refsRaw) {
      if (!isRecord(r) || typeof r.kind !== "string" || typeof r.id !== "string") {
        refProblem = { code: "malformed_ref", detail: "source ref missing kind or id" };
        break;
      }
      const ref = { kind: r.kind, id: r.id };
      if (!refAllowed(ctx, ref)) {
        // §15: "fabricate sources" is on the MAY NOT list. A ref the user never
        // attached is a fabricated source even when the id happens to be real.
        refProblem = { code: "invented_source_ref", detail: `ref not offered in this session` };
        break;
      }
      refs.push(ref);
    }
    if (refProblem) {
      rejected.push(refProblem);
      continue;
    }

    const fit = str(item.fitConfidence ?? item.confidence).toLowerCase();
    const fitConfidence = fit === "low" || fit === "medium" || fit === "high" ? fit : undefined;

    if (value.length >= MAX_PROPOSALS) {
      rejected.push({ code: "over_count", detail: `more than ${MAX_PROPOSALS} proposals` });
      continue;
    }

    value.push({
      kind,
      statement,
      rationale,
      supportingAnswerIds: cited,
      sourceRefs: refs,
      fitConfidence,
      signature: proposalSignature(kind, statement),
    });
  }

  return { value, rejected };
}

/**
 * Validate model-generated follow-up questions.
 *
 * A follow-up is the lowest-stakes thing the model produces, but it is still
 * text placed in front of a person mid-interview, so it gets the same treatment:
 * an item that reads as an instruction rather than a question is dropped.
 */
export function validateFollowups(raw: unknown): Validated<string> {
  const rejected: Rejection[] = [];
  const value: string[] = [];
  const list =
    isRecord(raw) && Array.isArray(raw.followups) ? raw.followups
      : isRecord(raw) && Array.isArray(raw.questions) ? raw.questions
        : Array.isArray(raw) ? raw : null;
  if (!list) return { value, rejected: [{ code: "not_an_object", detail: "no followups array" }] };

  for (const item of list) {
    const text = typeof item === "string" ? item.trim() : isRecord(item) ? str(item.text ?? item.question) : "";
    if (!text) {
      rejected.push({ code: "empty_statement", detail: "empty follow-up" });
      continue;
    }
    if (text.length > MAX_QUESTION) {
      rejected.push({ code: "over_length", detail: `follow-up ${text.length} chars` });
      continue;
    }
    if (MUTATION_INSTRUCTION.test(text)) {
      rejected.push({ code: "mutation_instruction", detail: "follow-up contained an instruction" });
      continue;
    }
    value.push(text);
  }
  return { value, rejected };
}

/**
 * Validate possible-tension observations (§12).
 *
 * The hard rule: a tension must rest on at least TWO answers the user actually
 * gave. An observation grounded in one answer, or in none, is the model
 * inferring inconsistency about a person from thin air — which the brief
 * forbids, and which this check makes structurally impossible rather than a
 * matter of prompt discipline.
 */
export function validateTensions(raw: unknown, ctx: ValidationContext): Validated<Omit<InterviewTension, "id">> {
  const rejected: Rejection[] = [];
  const value: Omit<InterviewTension, "id">[] = [];
  const list = isRecord(raw) && Array.isArray(raw.tensions) ? raw.tensions : [];

  for (const item of list) {
    if (!isRecord(item)) {
      rejected.push({ code: "not_an_object", detail: "tension was not an object" });
      continue;
    }
    const bad = forbiddenField(item);
    if (bad) {
      rejected.push({ code: "forbidden_field", detail: `tension carried "${bad}"` });
      continue;
    }
    const observation = str(item.observation ?? item.text);
    if (!observation) {
      rejected.push({ code: "empty_statement", detail: "empty observation" });
      continue;
    }
    if (MUTATION_INSTRUCTION.test(observation)) {
      rejected.push({ code: "mutation_instruction", detail: "observation contained an instruction" });
      continue;
    }
    const betweenRaw = Array.isArray(item.betweenAnswerIds) ? item.betweenAnswerIds : [];
    const between = betweenRaw.filter((x): x is string => typeof x === "string").map((x) => x.trim());
    if (between.some((b) => !ctx.knownAnswerIds.includes(b))) {
      rejected.push({ code: "invented_answer_id", detail: "tension cited an unknown answer" });
      continue;
    }
    if (between.length < 2) {
      rejected.push({ code: "invented_answer_id", detail: "tension not grounded in two answers" });
      continue;
    }
    value.push({ observation, betweenAnswerIds: between });
  }
  return { value, rejected };
}
