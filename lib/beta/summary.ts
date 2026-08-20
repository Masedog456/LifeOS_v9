/**
 * The founder beta summary (LIFEOS-059 §7).
 *
 * ## Deliberately not a dashboard
 *
 * This derives counts from the local event log and nothing else. There is no
 * admin surface, no cross-user view, no funnel, no charts, no island. It exists
 * to answer the fourteen beta questions and stop.
 *
 * ## What it can never show
 *
 * Interview answers · Constitution prose · Note bodies · source text · proposal
 * statements · names · emails. Not because the renderer omits them, but because
 * `lib/beta/events.ts` cannot store them — there is no field they fit in. The
 * summary is a projection of the log, so it inherits that guarantee rather than
 * re-implementing it.
 *
 * ## No scoring
 *
 * No engagement score, no discipline score, no alignment score, no success rate,
 * no percentage of anything about a person. Counts and ratios about PROPOSALS
 * are fine — a proposal is a machine artefact, not a life. A number about a
 * tester is not, and there is none here.
 *
 * Pure over its inputs, so the whole thing is testable without a browser.
 */

import type { BetaEvent } from "@/lib/beta/events";
import type { BetaFeedback, FeedbackCategory } from "@/lib/beta/feedback";
import { feedbackCounts } from "@/lib/beta/feedback";
import type { CanaryReport } from "@/lib/beta/canary";

export interface InterviewSummary {
  started: number;
  startedStruggle: number;
  startedStocktake: number;
  reviewOpened: number;
  reviewOpenedEarly: number;
  finished: number;
  discarded: number;
  /** Mean questions answered when the review was opened. `null` when none. */
  avgQuestionsBeforeReview: number | null;
  /** Mean domains visited when the review was opened. `null` when none. */
  avgDomainsBeforeReview: number | null;
  followupsShown: number;
}

export interface ProposalSummary {
  produced: number;
  adopted: number;
  keptDraft: number;
  dismissed: number;
  /** Adoptions by how much of the model's wording survived. */
  adoptedUnchanged: number;
  adoptedMinorEdit: number;
  adoptedSubstantialRewrite: number;
  /** Decisions by proposed kind — is one kind rejected far more than others? */
  byKind: { kind: string; adopted: number; draft: number; dismissed: number }[];
}

export interface TrustSummary {
  aiExclusionEnabled: number;
  aiExclusionDisabled: number;
  feedbackTotal: number;
  feedbackByCategory: Record<FeedbackCategory, number>;
  privacyTrustReports: number;
  canary: CanaryReport;
}

export interface ModelSummary {
  calls: number;
  fromProvider: number;
  fromOffline: number;
  degraded: number;
}

export interface BetaSummary {
  startedAt: string | null;
  eventCount: number;
  interview: InterviewSummary;
  proposals: ProposalSummary;
  trust: TrustSummary;
  model: ModelSummary;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/** Build the summary. Pure: same log in, same numbers out. */
export function buildBetaSummary(
  events: readonly BetaEvent[],
  feedback: readonly BetaFeedback[],
  canary: CanaryReport,
  startedAt: string | null,
): BetaSummary {
  const of = (name: string) => events.filter((e) => e.event === name);

  const reviews = of("interview_review_opened");
  const decisions = of("proposal_decision");
  const adoptedDecisions = decisions.filter((e) => e.decision === "adopt");

  const kinds = ["purpose", "value", "principle", "standard"];
  const byKind = kinds.map((kind) => ({
    kind,
    adopted: decisions.filter((e) => e.kind === kind && e.decision === "adopt").length,
    draft: decisions.filter((e) => e.kind === kind && e.decision === "draft").length,
    dismissed: decisions.filter((e) => e.kind === kind && e.decision === "dismiss").length,
  }));

  const exclusions = of("ai_exclusion_changed");
  const calls = of("ai_call");
  const counts = feedbackCounts(feedback);

  return {
    startedAt,
    eventCount: events.length,
    interview: {
      started: of("interview_started").length,
      startedStruggle: of("interview_started").filter((e) => e.mode === "struggle").length,
      startedStocktake: of("interview_started").filter((e) => e.mode === "stocktake").length,
      reviewOpened: reviews.length,
      reviewOpenedEarly: reviews.filter((e) => e.early === true).length,
      finished: of("interview_finished").length,
      discarded: of("interview_discarded").length,
      avgQuestionsBeforeReview: mean(reviews.map((e) => e.questionsAnswered ?? 0)),
      avgDomainsBeforeReview: mean(reviews.map((e) => e.domainsVisited ?? 0)),
      followupsShown: reviews.reduce((n, e) => n + (e.followupsShown ?? 0), 0),
    },
    proposals: {
      produced: reviews.reduce((n, e) => n + (e.proposalsProduced ?? 0), 0),
      adopted: adoptedDecisions.length,
      keptDraft: decisions.filter((e) => e.decision === "draft").length,
      dismissed: decisions.filter((e) => e.decision === "dismiss").length,
      adoptedUnchanged: adoptedDecisions.filter((e) => e.edit === "unchanged").length,
      adoptedMinorEdit: adoptedDecisions.filter((e) => e.edit === "minor").length,
      adoptedSubstantialRewrite: adoptedDecisions.filter((e) => e.edit === "substantial").length,
      byKind,
    },
    trust: {
      aiExclusionEnabled: exclusions.filter((e) => e.enabled === true).length,
      aiExclusionDisabled: exclusions.filter((e) => e.enabled === false).length,
      feedbackTotal: feedback.length,
      feedbackByCategory: counts,
      privacyTrustReports: counts.privacy_trust ?? 0,
      canary,
    },
    model: {
      calls: calls.length,
      fromProvider: calls.filter((e) => e.source === "ai").length,
      fromOffline: calls.filter((e) => e.source === "mock").length,
      degraded: calls.filter((e) => !!e.degraded).length,
    },
  };
}

/**
 * The summary as plain text, for pasting into an observation note.
 *
 * Markdown rather than JSON because the founder reads this; the JSON form is the
 * event log itself, which the dev page also offers.
 */
export function summaryToMarkdown(s: BetaSummary): string {
  const i = s.interview;
  const p = s.proposals;
  const t = s.trust;
  const lines: string[] = [
    "# Conqify closed-beta evidence",
    "",
    `Recording since: ${s.startedAt ?? "not started"}`,
    `Events recorded: ${s.eventCount}`,
    "",
    "## Interview",
    `- Started: ${i.started} (struggle ${i.startedStruggle} · take-stock ${i.startedStocktake})`,
    `- Review opened: ${i.reviewOpened}${i.reviewOpenedEarly ? ` (${i.reviewOpenedEarly} stopped early)` : ""}`,
    `- Finished: ${i.finished} · discarded: ${i.discarded}`,
    `- Average questions answered before review: ${i.avgQuestionsBeforeReview ?? "—"}`,
    `- Average domains visited before review: ${i.avgDomainsBeforeReview ?? "—"}`,
    `- Follow-ups shown in total: ${i.followupsShown}`,
    "",
    "## Proposals",
    `- Produced: ${p.produced}`,
    `- Adopted: ${p.adopted} · kept as draft: ${p.keptDraft} · dismissed: ${p.dismissed}`,
    `- Adopted unchanged: ${p.adoptedUnchanged} · after a minor edit: ${p.adoptedMinorEdit} · after a substantial rewrite: ${p.adoptedSubstantialRewrite}`,
    ...p.byKind.map((k) => `  - ${k.kind}: ${k.adopted} adopted · ${k.draft} draft · ${k.dismissed} dismissed`),
    "",
    "## Trust",
    `- Hidden from AI: ${t.aiExclusionEnabled} enabled · ${t.aiExclusionDisabled} re-enabled`,
    `- Feedback submitted: ${t.feedbackTotal} (privacy/trust: ${t.privacyTrustReports})`,
    `- Silent-adoption canary: ${t.canary.verdict.toUpperCase()} — ${t.canary.headline}`,
    "",
    "## Model use",
    `- Calls: ${s.model.calls} (provider ${s.model.fromProvider} · offline ${s.model.fromOffline} · degraded ${s.model.degraded})`,
    "",
    "_No interview answers, Constitution wording, Note contents, or source text appear in this summary — the event schema has no field that can hold them._",
  ];
  return lines.join("\n");
}
