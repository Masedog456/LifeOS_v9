/**
 * Proposal → Constitution element (LIFEOS-058 §7, §8).
 *
 * ## What this file is, and what it deliberately is not
 *
 * It is a PLANNER. It turns a session-local proposal plus the user's decision
 * into the exact argument list for `createConstitutionElement`. It does not call
 * the store, does not adopt anything, and has no way to.
 *
 * Adoption itself stays where it already lives:
 *
 *   const id = createConstitutionElement(planToInput(plan));
 *   if (plan.adopt) adoptConstitutionElement(id);
 *
 * Two lines, in a click handler. `adoptConstitutionElement` remains the single
 * gate that can set `adoptedAt` — the brief's "do not introduce a second
 * adoption mechanism" is satisfied by not writing one, rather than by writing a
 * second one carefully.
 *
 * ## The authorship rule, and why it is stricter here
 *
 * `updateConstitutionElement` clears `fromAiText` on ANY statement change: for
 * an element the user already owns, editing is authoring. That rule is right
 * there and wrong here.
 *
 * A proposal is machine prose the user has never owned. If any edit cleared the
 * flag, fixing one word in a sentence the model wrote would launder it into
 * user-authored provenance — precisely what §15 forbids. So on this path
 * authorship transfers only when the user has actually REPLACED the sentence:
 * fewer than half of the proposal's meaning-bearing words survive.
 *
 * The bias is deliberate and it is the safe direction. Marking a user's own
 * sentence as machine-origin costs them a label; marking machine prose as their
 * own thinking costs the product its central guarantee. `fromAiText` fails
 * safe — it removes grounding authority, never grants it.
 *
 * Once the element exists, the ordinary rule takes over: a later rewrite on
 * `/constitution` clears the flag through the existing, already-tested path.
 *
 * ## Adoption is not authorship
 *
 * Nothing here changes provenance when the user adopts. `adopt: true` and
 * `adopt: false` produce the SAME `fromAiText`. Adoption changes constitutional
 * status; it has never changed where the words came from.
 */

import type { ConstitutionKind, RecordRefLite } from "@/types/mvp";
import { significantWords } from "@/lib/constitution/revision";
import type { InterviewProposal } from "@/lib/interview/session";

/** The exact shape `createConstitutionElement` accepts, and nothing more. */
export interface AdoptionPlan {
  kind: ConstitutionKind;
  statement: string;
  /** True when the prose is still substantially the model's. See the header. */
  fromAiText: boolean;
  /** The influences the user attached. References, never copies. */
  linkedRefs: RecordRefLite[];
  /** Whether to call the adoption gate after creating the draft. */
  adopt: boolean;
}

/**
 * Did the user replace the sentence, or adjust it?
 *
 * Overlap is measured against the ORIGINAL proposal, so a chain of small edits
 * cannot creep past the threshold one word at a time — each comparison is
 * against where the model started, not against the previous edit.
 */
export function userRewroteProposal(original: string, edited: string): boolean {
  const wo = significantWords(original);
  const we = significantWords(edited);
  if (wo.length === 0) return we.length > 0;
  const kept = new Set(we);
  const survived = wo.filter((w) => kept.has(w)).length;
  return survived / wo.length < 0.5;
}

/**
 * Build the plan for one decision.
 *
 * `editedStatement` is the text currently on screen, which equals
 * `proposal.statement` when the user did not edit it — so the rewrite check is
 * simply a no-op in the common case rather than a special case.
 */
export function planFromProposal(
  proposal: InterviewProposal,
  originalStatement: string,
  opts: { adopt: boolean },
): AdoptionPlan {
  return {
    kind: proposal.kind,
    statement: proposal.statement,
    fromAiText: !userRewroteProposal(originalStatement, proposal.statement),
    linkedRefs: proposal.sourceRefs,
    adopt: opts.adopt,
  };
}

/** The plan as `NewElementInput`. Kept separate so the plan stays assertable. */
export function planToInput(plan: AdoptionPlan): {
  kind: ConstitutionKind;
  statement: string;
  linkedRefs: RecordRefLite[];
  fromAiText?: true;
} {
  return {
    kind: plan.kind,
    statement: plan.statement,
    linkedRefs: plan.linkedRefs,
    // `undefined` rather than `false`, matching `normalizeNewElement`'s contract
    // that the flag is either `true` or absent.
    fromAiText: plan.fromAiText ? true : undefined,
  };
}

/**
 * The answers, rendered as a Note body for the optional "keep my answers" step.
 *
 * This is the ONLY way an interview answer becomes durable, and it is entirely
 * opt-in. The body is the user's own words with the questions as headings —
 * nothing generated, no summary, no interpretation — so the resulting Note is
 * user-authored by construction and `classifyOrigin` reads it as such without
 * any special case.
 *
 * Deliberately excludes proposals, rationales, tensions and follow-up questions:
 * saving the model's prose into a user-authored record is exactly the laundering
 * this sprint exists to prevent.
 */
export function answersAsNoteBody(
  entries: readonly { question: string; answer: string }[],
): string {
  return entries
    .filter((e) => e.answer.trim().length > 0)
    .map((e) => `**${e.question}**\n\n${e.answer.trim()}`)
    .join("\n\n");
}
