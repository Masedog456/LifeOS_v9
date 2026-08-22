/**
 * The confirm → create boundary (LIFEOS-060 §3, §4).
 *
 * `CommitCandidate` is the ONLY thing `commitCapture` accepts. It is a flat,
 * plain object with no reasons, no confidence, no evidence spans and no
 * provenance flags — deliberately. Interpretation metadata explains a suggestion
 * to a person; it has no business travelling into the store, where it would
 * become a second, machine-authored account of why a record exists.
 *
 * The narrowing also gives the never-auto tier a second wall. `CommitCandidate`
 * has no member for belief or Constitution, so even a caller that bypassed the
 * UI entirely could not construct an argument that creates one.
 */

import type { CandidateKind } from "@/lib/capture/authority";
import type { Candidate } from "@/lib/capture/interpret";
import { associationFields, type MatchOption } from "@/lib/capture/match";
import type { DayKey } from "@/lib/reviews/dates";

/** A candidate the user confirmed, reduced to the fields that become a record. */
export interface CommitCandidate {
  kind: CandidateKind;
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

/**
 * Reduce a candidate for commit, applying the association the user accepted.
 *
 * `chosen` is passed explicitly rather than read off the candidate: a STRONG
 * match is offered but still only attaches because the user left it attached,
 * and an AMBIGUOUS one requires them to pick. Neither is inferred here.
 */
export function toCommitCandidate(candidate: Candidate, chosen?: MatchOption): CommitCandidate {
  const f = candidate.fields;
  return {
    kind: candidate.kind,
    title: f.title,
    body: f.body,
    trigger: f.trigger,
    response: f.response,
    waitingOn: f.waitingOn,
    dueDate: f.dueDate,
    ...associationFields(chosen),
  };
}

/**
 * Is this candidate complete enough to create a record?
 *
 * Used by the UI to disable confirmation rather than to fail silently at commit
 * time. `commitCapture` skips anything incomplete too — belt and braces, because
 * a half-built record is worse than none.
 */
export function isCommittable(c: CommitCandidate): boolean {
  switch (c.kind) {
    case "protocol": return !!c.trigger?.trim() && !!c.response?.trim();
    case "note":
    case "reflection": return !!(c.body?.trim() || c.title?.trim());
    default: return !!c.title?.trim();
  }
}
