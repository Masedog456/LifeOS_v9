/**
 * Review relationships & backlinks (LIFEOS-034, Feature 14).
 *
 * Deterministic two-way links between a DailyReview and the records it
 * references: every ref a review points at (wins/lessons/friction/openLoops/
 * focus + typed goal/project/workspace links + free entity links), and every
 * review that points at a given record. References only — never copies.
 */

import type { DailyReview, RecordRefLite, StoreState } from "@/types/mvp";

/** All record references a single review points at, de-duplicated by kind:id. */
export function reviewReferences(review: DailyReview): RecordRefLite[] {
  const out: RecordRefLite[] = [];
  const seen = new Set<string>();
  const add = (r?: RecordRefLite) => {
    if (!r || !r.id) return;
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  review.wins.forEach((w) => w.links.forEach(add));
  review.lessons.forEach((l) => { l.links.forEach(add); add(l.convertedTo); });
  review.friction.forEach((f) => add(f.linkedEntity));
  review.openLoops.forEach((o) => add(o.ref));
  review.tomorrowFocus.forEach((f) => add(f.ref));
  review.linkedGoals.forEach((id) => add({ kind: "goal", id }));
  review.linkedProjects.forEach((id) => add({ kind: "project", id }));
  review.linkedWorkspaces.forEach((id) => add({ kind: "workspace", id }));
  review.linkedEntities.forEach(add);
  return out;
}

/** Every review that references a given record (most recent date first). */
export function reviewsReferencing(state: StoreState, kind: string, id: string): DailyReview[] {
  return (state.dailyReviews ?? [])
    .filter((r) => reviewReferences(r).some((ref) => ref.kind === kind && ref.id === id))
    .sort((a, b) => b.date.localeCompare(a.date));
}
