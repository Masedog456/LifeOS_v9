/**
 * Explicit tester feedback (LIFEOS-059 §6).
 *
 * ## Why this is separate from evidence
 *
 * `lib/beta/events.ts` is automatic and content-free by construction. This is
 * the opposite: free text, written deliberately by a person who chose to write
 * it. Mixing them would be the worst of both — automatic capture that happens to
 * contain prose. So they live in different keys, with different rules, and the
 * founder summary shows them in different sections.
 *
 * ## Provenance
 *
 * Feedback is USER-AUTHORED, and it is feedback — not a Note, not a belief, not
 * Constitution material, not knowledge. It is never promoted into any of those,
 * never indexed, and never enters an AI request.
 *
 * The last of those is the one worth proving rather than promising, so the beta
 * suite (§6.12–6.14) builds the interview context with feedback stored and with
 * the key empty and asserts the two are byte-identical: nothing on the AI path
 * reads this key.
 *
 * ## What leaves the device
 *
 * Nothing, on its own. Feedback sits in the browser until the tester chooses to
 * copy or send it. There is no upload path in this module, deliberately: the
 * existing `components/FeedbackLink.tsx` already routes to whatever channel the
 * deployment configured, and adding a second silent one would break the promise
 * the disclosure makes.
 */

import { useSyncExternalStore } from "react";
import type { BetaEvent } from "@/lib/beta/events";

export const BETA_FEEDBACK_KEY = "conqify.beta.feedback.v1";

/** At most this many kept locally; oldest pruned first. */
export const MAX_FEEDBACK = 100;

/** The categories offered. `other` exists so nobody is forced into a wrong one. */
export const FEEDBACK_CATEGORIES = [
  "confusing",
  "wrong_suggestion",
  "too_many_questions",
  "privacy_trust",
  "bug",
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  confusing: "Confusing",
  wrong_suggestion: "Wrong suggestion",
  too_many_questions: "Too many questions",
  privacy_trust: "Privacy or trust concern",
  bug: "Something broke",
  other: "Something else",
};

/** One piece of feedback a tester chose to write. */
export interface BetaFeedback {
  id: string;
  /** What happened, in their words. */
  happened: string;
  /** What they expected instead. Optional. */
  expected?: string;
  category: FeedbackCategory;
  at: string;
  /**
   * Always `"user_authored"`. Stored explicitly rather than assumed, so anything
   * reading this file can see the claim it is making without inferring it.
   */
  origin: "user_authored";
}

const MAX_FIELD_CHARS = 2_000;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

let seq = 0;

/** Build a feedback record. Pure, so the shape is testable without a browser. */
export function makeFeedback(
  input: { happened: string; expected?: string; category: string },
  at: string,
  id?: string,
): BetaFeedback | null {
  const happened = (input.happened ?? "").trim().slice(0, MAX_FIELD_CHARS);
  if (!happened) return null;
  const expected = (input.expected ?? "").trim().slice(0, MAX_FIELD_CHARS);
  const category = (FEEDBACK_CATEGORIES as readonly string[]).includes(input.category)
    ? (input.category as FeedbackCategory)
    : "other";
  seq += 1;
  return {
    id: id ?? `fb_${seq}_${Math.random().toString(36).slice(2, 8)}`,
    happened,
    expected: expected || undefined,
    category,
    at,
    origin: "user_authored",
  };
}

export function readFeedback(): BetaFeedback[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(BETA_FEEDBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is BetaFeedback =>
        !!f && typeof f === "object" && typeof f.happened === "string" && f.origin === "user_authored",
    );
  } catch {
    return [];
  }
}

/** Save feedback. Best-effort, like everything else in the beta layer. */
export function saveFeedback(entry: BetaFeedback): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const all = [...readFeedback(), entry];
    const pruned = all.length > MAX_FEEDBACK ? all.slice(all.length - MAX_FEEDBACK) : all;
    s.setItem(BETA_FEEDBACK_KEY, JSON.stringify(pruned));
    emit();
    return true;
  } catch {
    return false;
  }
}

export function clearFeedback(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(BETA_FEEDBACK_KEY);
  } catch {
    /* no-op */
  }
  emit();
}

// ---- React binding ----
//
// See the note in `lib/beta/store.ts`: an explicit server snapshot rather than a
// `localStorage` read in a state initializer, so the first client render matches
// the server HTML.

const SERVER_FEEDBACK: BetaFeedback[] = [];

let version = 0;
let cached: BetaFeedback[] = SERVER_FEEDBACK;
let cachedVersion = -1;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* a broken subscriber is not the write's problem */
    }
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getFeedbackSnapshot(): BetaFeedback[] {
  if (cachedVersion !== version) {
    cached = readFeedback();
    cachedVersion = version;
  }
  return cached;
}

export function useBetaFeedback(): BetaFeedback[] {
  return useSyncExternalStore(subscribe, getFeedbackSnapshot, () => SERVER_FEEDBACK);
}

/**
 * The counts the founder summary may show.
 *
 * Deliberately returns COUNTS, not text. The founder summary renders categories
 * and totals; reading what a tester actually wrote is a separate, deliberate act
 * on their own device — not something a dashboard does by default.
 */
export function feedbackCounts(entries: readonly BetaFeedback[]): Record<FeedbackCategory, number> {
  const out = Object.fromEntries(FEEDBACK_CATEGORIES.map((c) => [c, 0])) as Record<FeedbackCategory, number>;
  for (const f of entries) out[f.category] = (out[f.category] ?? 0) + 1;
  return out;
}

/** Events that record only that feedback happened, never what it said. */
export function feedbackEventCount(events: readonly BetaEvent[]): number {
  return events.filter((e) => e.event === "feedback_submitted").length;
}
