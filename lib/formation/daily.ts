/**
 * Deterministic daily review selection (LIFEOS-013, Phase 3).
 *
 * Calm and finite: at most THREE items, each with an explicit reason. Nothing
 * is random. Items the user dismissed/snoozed/postponed (via the LIFEOS-009
 * feedback store) or already reviewed in the last day do not immediately
 * return. No infinite feed, no streaks, no scores.
 */

import type {
  FeedbackEntry,
  ReviewSurfacedItem,
  StoreState,
} from "@/types/mvp";

export const MAX_DAILY_ITEMS = 3;
const STALE_DAYS = 7;

function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function snippet(s: string, n = 90): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** Latest feedback verdict per record id (reuses the retrieval feedback store). */
function latestFeedback(feedback: FeedbackEntry[]): Map<string, FeedbackEntry> {
  const m = new Map<string, FeedbackEntry>();
  for (const f of feedback) {
    const prev = m.get(f.recordId);
    if (!prev || f.at > prev.at) m.set(f.recordId, f);
  }
  return m;
}

/** True when an item id is currently suppressed by feedback (dismissed/snoozed). */
function suppressed(fb: Map<string, FeedbackEntry>, id: string, now: string): boolean {
  const f = fb.get(id);
  if (!f) return false;
  if (f.verdict === "dismissed" || f.verdict === "not_relevant") return true;
  if (f.verdict === "snoozed" && f.snoozeUntil && f.snoozeUntil > now) return true;
  return false;
}

/** Item ids reviewed in the last day — avoids same-day repeats. */
function recentlyReviewed(state: StoreState): Set<string> {
  const out = new Set<string>();
  for (const r of state.reviews) {
    if (daysSince(r.startedAt) > 1) continue;
    for (const j of r.judgments) out.add(j.itemId);
  }
  return out;
}

/**
 * Build the (≤3) deterministic daily candidate list. Ordered by a fixed
 * priority so the same state always yields the same review.
 */
export function buildDailyReview(state: StoreState): ReviewSurfacedItem[] {
  const fb = latestFeedback(state.feedback);
  const now = new Date().toISOString();
  const reviewed = recentlyReviewed(state);
  const candidates: ReviewSurfacedItem[] = [];

  const active = state.beliefs.filter((b) => b.status !== "rejected");

  // 1) A belief you marked questioned (most recently questioned first).
  const questioned = active
    .filter((b) => b.status === "questioned")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (questioned) {
    candidates.push({
      id: `daily:questioned:${questioned.id}`,
      kind: "questioned_belief",
      beliefId: questioned.id,
      refId: questioned.id,
      title: questioned.text,
      reason: `You marked this questioned on ${new Date(questioned.updatedAt).toLocaleDateString()}.`,
      href: "/beliefs",
    });
  }

  // 2) An unresolved question (from an inquiry, else an open thread question).
  const openInquiry = state.inquiries
    .filter((i) => i.status === "unresolved")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (openInquiry) {
    candidates.push({
      id: `daily:inquiry:${openInquiry.id}`,
      kind: "unresolved_question",
      refId: openInquiry.id,
      title: openInquiry.question,
      reason: "This inquiry is still unresolved.",
      href: `/inquiry/${openInquiry.id}`,
    });
  } else {
    for (const t of state.megathreads) {
      const q = t.unresolvedQuestions.find((x) => !x.resolved);
      if (q) {
        candidates.push({
          id: `daily:threadq:${t.id}`,
          kind: "unresolved_question",
          threadId: t.id,
          refId: t.id,
          title: q.text,
          reason: `An open question in your thread “${snippet(t.title, 40)}”.`,
          href: `/threads/${t.id}`,
        });
        break;
      }
    }
  }

  // 3) A Megathread that changed recently.
  const recentThread = state.megathreads
    .filter((t) => t.status !== "archived" && daysSince(t.updatedAt) <= STALE_DAYS)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (recentThread) {
    candidates.push({
      id: `daily:thread:${recentThread.id}`,
      kind: "thread_change",
      threadId: recentThread.id,
      refId: recentThread.id,
      title: recentThread.title,
      reason: `This thread changed on ${new Date(recentThread.updatedAt).toLocaleDateString()}.`,
      href: `/threads/${recentThread.id}`,
    });
  }

  // 4) A belief you haven't revisited in a while.
  const stale = [...active]
    .filter((b) => b.status !== "questioned" && daysSince(b.updatedAt) >= STALE_DAYS)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))[0];
  if (stale) {
    const d = Math.floor(daysSince(stale.updatedAt));
    candidates.push({
      id: `daily:stale:${stale.id}`,
      kind: "stale_belief",
      beliefId: stale.id,
      refId: stale.id,
      title: stale.text,
      reason: `You haven't revisited this in ${d} day${d === 1 ? "" : "s"}.`,
      href: "/beliefs",
    });
  }

  // 5) A past thought or quote worth revisiting.
  const oldCapture = [...state.captures]
    .filter((c) => daysSince(c.createdAt) >= STALE_DAYS)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
  if (oldCapture) {
    candidates.push({
      id: `daily:capture:${oldCapture.id}`,
      kind: "capture",
      refId: oldCapture.id,
      sourceId: oldCapture.sourceId,
      title: oldCapture.text,
      reason: `You wrote this on ${new Date(oldCapture.createdAt).toLocaleDateString()}.`,
      href: oldCapture.sourceId ? `/library/${oldCapture.sourceId}` : "/",
    });
  } else {
    const src = state.sources.find((s) => (s.keyQuotes ?? []).length > 0);
    if (src) {
      candidates.push({
        id: `daily:quote:${src.id}:0`,
        kind: "quote",
        sourceId: src.id,
        refId: src.id,
        title: src.keyQuotes[0],
        reason: `A quote from “${snippet(src.title, 40)}”, which you added.`,
        href: `/library/${src.id}`,
      });
    }
  }

  // Filter (feedback + same-day repeats) and cap, keeping kind diversity.
  const seenKinds = new Set<string>();
  const seenRefs = new Set<string>();
  const out: ReviewSurfacedItem[] = [];
  for (const item of candidates) {
    if (out.length >= MAX_DAILY_ITEMS) break;
    if (suppressed(fb, item.id, now) || reviewed.has(item.id)) continue;
    if (item.refId && seenRefs.has(item.refId)) continue;
    if (seenKinds.has(item.kind)) continue;
    seenKinds.add(item.kind);
    if (item.refId) seenRefs.add(item.refId);
    out.push(item);
  }
  return out;
}
