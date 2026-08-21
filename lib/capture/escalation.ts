/**
 * AI escalation boundary for capture (LIFEOS-060 §11, §12, §13).
 *
 * ## The thesis change
 *
 * The old rule was "AI only if the user presses a special button" — which put
 * the user in charge of picking an engine, a decision they have no basis to make
 * and no reason to care about. The new rule is: deterministic first, and if the
 * rules are out of their depth, ask the model. The user manages their life, not
 * our parser selection.
 *
 * ## What escalation may and may not do
 *
 * The model may **propose structure**. It may not **acquire authority**.
 * Concretely, output from the model is subjected to the same gate as everything
 * else, plus two extra constraints:
 *
 *   1. Only `action`, `waiting`, `note` may come back. A model-proposed protocol,
 *      project or goal is dropped — those are normative or structural, and a
 *      machine's reading is not a good enough reason to put them in front of a
 *      user as a pre-filled option.
 *   2. `authority` is forced to `confirm`, whatever the kind. A model reading is
 *      never pre-selected. The user's eye is the gate.
 *
 * Belief and Constitution are not reachable at all: `CandidateKind` has no
 * member for them, so there is no value the model could return that would
 * become one. Structural, not procedural.
 *
 * ## Context sent is the smallest thing that works
 *
 * §12: not `StoreState`. What goes to the model is the capture text and the
 * TITLES of matchable projects — nothing else. No note bodies, no beliefs, no
 * Constitution, no source text, no other captures. Project matching itself
 * already ran locally; the titles go only so the model can attribute a segment
 * to one it would otherwise miss.
 *
 * ## Failure is a no-op, never a dead end
 *
 * §13: if the call fails, `mergeAiCandidates` is simply never reached and the
 * deterministic candidates stand unchanged. There is no state to unwind, no
 * error to show, and — specifically — no message blaming an API key, which was
 * the LIFEOS-055T defect.
 */

import type { Candidate, Interpretation } from "@/lib/capture/interpret";
import { NO_MATCH } from "@/lib/capture/match";
import type { StoreState } from "@/types/mvp";
import type { CandidateKind } from "@/lib/capture/authority";

/** The only kinds a model may propose. Narrower than `CandidateKind` on purpose. */
export const AI_PROPOSABLE_KINDS: readonly CandidateKind[] = ["action", "waiting", "note"];

/** Longest capture we will escalate. Beyond this the rules' answer is good enough. */
export const MAX_ESCALATION_CHARS = 2_000;

/** Most project titles we will send. A ceiling, not a target. */
export const MAX_CONTEXT_TITLES = 40;

/** Exactly what leaves the device on an escalation. Nothing else. */
export interface EscalationContext {
  /** The capture, as typed. */
  text: string;
  /** Titles only — never ids, never descriptions, never notes. */
  projectTitles: string[];
}

/**
 * Build the escalation payload.
 *
 * Deliberately reads only `state.projects`. Any future need for more context
 * should have to change this function and its test, which is the point.
 */
export function buildEscalationContext(text: string, state: StoreState): EscalationContext {
  const titles = ((state.projects ?? []) as Array<{ title?: string; status?: string }>)
    .filter((p) => p.status !== "archived" && p.status !== "completed" && p.status !== "abandoned")
    .map((p) => (p.title ?? "").trim())
    .filter((t) => t.length >= 3)
    .slice(0, MAX_CONTEXT_TITLES);
  return { text: (text ?? "").slice(0, MAX_ESCALATION_CHARS), projectTitles: titles };
}

/** One raw item as it arrives from the route, before validation. */
interface RawAiCandidate {
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  waitingOn?: unknown;
  reason?: unknown;
}

const MAX_FIELD_CHARS = 500;

function str(v: unknown, max = MAX_FIELD_CHARS): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || undefined;
}

/**
 * Validate model output into candidates.
 *
 * Anything unrecognised is DROPPED rather than repaired. A model that returns a
 * shape we did not ask for has misunderstood the task, and guessing at what it
 * meant is how machine output turns into user data by accident.
 *
 * Note what is absent: no `dueDate`. Dates stay deterministic. A model that
 * hallucinates "October 1st" for "October" would defeat §19 in one field, and
 * `lib/capture/dates.ts` already refuses to do that.
 */
export function validateAiCandidates(raw: unknown, offset: number): Candidate[] {
  if (!Array.isArray(raw)) return [];
  const out: Candidate[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const r = item as RawAiCandidate;
    const kind = typeof r.kind === "string" ? r.kind : "";
    if (!(AI_PROPOSABLE_KINDS as readonly string[]).includes(kind)) continue;

    const title = str(r.title);
    const body = str(r.body, 2_000);
    if (!title && !body) continue;

    out.push({
      id: `ai${offset + out.length}`,
      kind: kind as CandidateKind,
      fields: {
        title: title ?? body,
        body: kind === "note" ? (body ?? title) : undefined,
        waitingOn: kind === "waiting" ? str(r.waitingOn, 80) : undefined,
      },
      confidence: "possible",
      reason: str(r.reason, 160) ?? "Suggested by AI from your capture.",
      evidence: { text: title ?? body ?? "", start: -1, end: -1 },
      // Never pre-selected, whatever the kind. The user's eye is the gate.
      authority: "confirm",
      unresolved: [],
      association: NO_MATCH,
      alternates: ["note", "action"],
      producedBy: "ai",
    });
  }
  return out;
}

/**
 * Merge AI candidates into a deterministic interpretation.
 *
 * Additive only. A deterministic candidate is never replaced, re-scored or
 * removed by the model — the rules were right about the sentences they matched,
 * and escalation exists for the ones they did not. Duplicates (same normalised
 * title as something already present) are dropped so the user does not see the
 * same errand twice.
 */
export function mergeAiCandidates(interpretation: Interpretation, aiCandidates: Candidate[]): Interpretation {
  if (aiCandidates.length === 0) return interpretation;
  const seen = new Set(
    interpretation.candidates.map((c) => (c.fields.title ?? c.fields.body ?? "").toLowerCase().trim()),
  );
  const additions = aiCandidates.filter((c) => {
    const key = (c.fields.title ?? c.fields.body ?? "").toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (additions.length === 0) return interpretation;
  return { ...interpretation, candidates: [...interpretation.candidates, ...additions] };
}
