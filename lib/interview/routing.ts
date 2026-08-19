/**
 * Philosophy vs. operations (LIFEOS-058 §9).
 *
 * ## The distinction this defends
 *
 * A Constitution is what a person has decided about how to live. It is not a
 * to-do list, and the fastest way to ruin it is to let operational sentences in:
 *
 *   "Move my phone charger out of the bedroom"   ← an Action
 *   "When I notice I am scrolling, I stop"       ← a Protocol
 *   "Read twenty books this year"                ← a Goal
 *   "Direct my attention deliberately"           ← a Guiding Principle
 *
 * The first three are real and worth keeping — in the objects Conqify already
 * has for them. Filing them as Constitution elements would produce a document
 * that expires, and a document that expires is not a constitution.
 *
 * ## Why deterministic
 *
 * This runs BEFORE and AFTER the model. Before, so the interview can suggest a
 * better home for an operational answer without spending a call. After, so a
 * model that proposes "buy a standing desk" as a Value is caught by code rather
 * than by the user's patience. `classifyStatement` is a pure function of a
 * string and has no idea a model exists.
 *
 * ## What it does NOT do
 *
 * It never decides FOR the user. `constitution` is the default for anything it
 * cannot confidently place, and a non-constitution verdict is a *suggestion* the
 * UI offers — "this sounds more like an action; want to put it there instead?" —
 * with the Constitution route always still available. Being wrong about a
 * sentence must cost a click, not a decision.
 */

import type { ConstitutionKind } from "@/types/mvp";

/** Where a statement most plausibly belongs. */
export type StatementRoute = "constitution" | "protocol" | "action" | "goal";

export interface RouteVerdict {
  route: StatementRoute;
  /** Plain-language reason, shown to the user. Never a judgment of the content. */
  reason: string;
  /** Suggested Constitution kind when `route === "constitution"`. */
  kind?: ConstitutionKind;
}

/**
 * Conditional shape: "when/if X, (then) I will/I do Y".
 *
 * Both halves are required. "If I am honest, I want to write more" is not a
 * protocol — it is a hedge in front of a wish — so the trigger must be followed
 * by a commitment verb, not merely by more sentence.
 */
const CONDITIONAL = /\b(when|whenever|if|any\s?time|as soon as)\b[^.!?]{3,}?\b(i\s+(will|shall|do|stop|start|pause|leave|put|switch|close|call|text|write|walk|breathe|choose|decline|say)|then\s+i)\b/i;

/** Task shape: an errand with a completion moment. */
const TASK = /\b(i need to|i have to|i must|i should|i've got to|i want to)\s+(buy|call|email|text|book|schedule|cancel|move|clean|fix|set ?up|install|uninstall|delete|order|pay|file|sign|send|print|return|renew|unsubscribe|throw out|tidy)\b/i;

/** Achievement shape: an outcome with a finish line. */
const OUTCOME = /\b(i want to|i'?d like to|i plan to|i aim to|my goal is to|i'?m trying to)\s+(accomplish|achieve|finish|complete|launch|ship|publish|reach|hit|earn|save|lose|run|write|build|learn|get)\b/i;

/** A measured target — "twenty books", "10kg", "by June". Reinforces OUTCOME. */
const QUANTIFIED = /\b(\d+\s*(books?|pages?|kg|lbs?|pounds?|miles?|km|hours?|minutes?|days?|weeks?|months?|times?)|by\s+(january|february|march|april|may|june|july|august|september|october|november|december|next\s+(week|month|year)|the end of))\b/i;

/**
 * Standing-commitment shape. This is the one that most resembles a task and is
 * most emphatically not one: "I keep my word" has no completion moment.
 */
const STANDING = /\b(always|never|refuse to|will not|won'?t|by default|as a rule|no matter what)\b/i;

/**
 * Route a statement.
 *
 * Order matters, and it is ordered by how *specific* each shape is. STANDING is
 * checked before the operational patterns because "I never check my phone before
 * breakfast" contains a task-shaped fragment but is a standard, not an errand.
 */
export function classifyStatement(statement: string): RouteVerdict {
  const s = (statement ?? "").trim();
  if (!s) return { route: "constitution", reason: "Nothing to place yet.", kind: "value" };

  if (STANDING.test(s) && !CONDITIONAL.test(s)) {
    return {
      route: "constitution",
      kind: "standard",
      reason: "This reads as a standing commitment rather than a one-off task.",
    };
  }
  if (CONDITIONAL.test(s)) {
    return {
      route: "protocol",
      reason: "This has the shape of a trigger and a response, which is what a Protocol is for.",
    };
  }
  if (TASK.test(s)) {
    return {
      route: "action",
      reason: "This is something to do once, which is what an Action is for.",
    };
  }
  if (OUTCOME.test(s) || QUANTIFIED.test(s)) {
    return {
      route: "goal",
      reason: "This describes something to accomplish, which is what a Goal or Project is for.",
    };
  }
  return { route: "constitution", reason: "This reads as something you hold, rather than something you do." };
}

/** True when the statement belongs somewhere other than the Constitution. */
export function isOperational(statement: string): boolean {
  return classifyStatement(statement).route !== "constitution";
}

/** Human label for the object a route points at. */
export const ROUTE_LABEL: Record<StatementRoute, string> = {
  constitution: "Constitution",
  protocol: "Protocol",
  action: "Action",
  goal: "Goal or Project",
};

/**
 * The offer shown when a proposal is routed away from the Constitution.
 *
 * Phrased as a question with the Constitution still on the table, because the
 * classifier is a heuristic over English and the user is the authority on what
 * their own sentence means.
 */
export function routeOffer(v: RouteVerdict): string {
  if (v.route === "constitution") return "";
  return `${v.reason} Would you rather put it in ${ROUTE_LABEL[v.route]}? You can still keep it here.`;
}
