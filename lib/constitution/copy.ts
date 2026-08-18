/**
 * The wording contract for Constitution in Practice (LIFEOS-057).
 *
 * Every user-facing sentence about recorded evidence is produced here, by a
 * deterministic function of counts and dates, so the product's most important
 * discipline is testable rather than a matter of whoever writes the JSX.
 *
 * ## What this exists to prevent
 *
 * A comparison between "what I said matters" and "what got recorded" is one
 * careless verb away from becoming a verdict on a person. `dormancyPhrase` and
 * `attentionView` already established the register — *what was recorded, over
 * what period* — and this module extends it to the Constitution.
 *
 *   SAY:    "No related activity was recorded in Conqify during this period."
 *   NEVER:  "You neglected this."
 *
 * The three situations below are permanently distinct and must never collapse
 * into one another:
 *
 *   1. no links        → Conqify has nothing it CAN use. A relationship gap.
 *   2. links, silence  → nothing was recorded HERE. Not a statement about life.
 *   3. links, records  → this is what was recorded. Still not a verdict.
 *
 * `FORBIDDEN_EVIDENCE_WORDS` is asserted against every string this module can
 * emit, so the contract cannot rot.
 */

import type { ConstitutionEvidence } from "@/lib/constitution/evidence";

/**
 * Vocabulary this surface may never use.
 *
 * Two groups, both banned for the same reason: each one converts an observation
 * into a judgment. The moral group ("neglected", "failing") judges the person;
 * the metric group ("score", "adherence", "aligned") smuggles the same judgment
 * in behind a number.
 */
export const FORBIDDEN_EVIDENCE_WORDS: readonly string[] = [
  // moral verdicts
  "neglect", "neglected", "failing", "failed", "failure", "hypocri",
  "lazy", "undisciplined", "should have", "you didn't", "you did not",
  "on track", "off track", "behind", "falling short", "slipping",
  // disguised verdicts
  "aligned", "misaligned", "alignment", "adherence", "adhering", "compliance",
  "score", "scored", "rating", "grade", "percent aligned", "percentage aligned",
  "discipline score", "virtue", "life score", "balance score", "progress percentage",
  "streak", "consistency score", "success rate",
];

/** True when a candidate string violates the contract. Case-insensitive. */
export function violatesWordingContract(text: string): string[] {
  const low = (text ?? "").toLowerCase();
  return FORBIDDEN_EVIDENCE_WORDS.filter((w) => low.includes(w));
}

/** Which of the three situations this element is in. Never a fourth. */
export type EvidenceSituation = "no_links" | "links_without_records" | "links_with_records";

export function evidenceSituation(ev: ConstitutionEvidence): EvidenceSituation {
  if (ev.directRelations.length === 0) return "no_links";
  return ev.recordedActivity === 0 ? "links_without_records" : "links_with_records";
}

/**
 * The headline sentence for one element.
 *
 * Note what the `no_links` case says and does not say. It reports a gap in the
 * PRODUCT's knowledge — "not yet connected to records Conqify can use" — because
 * an element with no links is unobservable, not unlived. Saying "no activity"
 * there would be the single most damaging sentence this feature could produce.
 */
export function evidenceHeadline(ev: ConstitutionEvidence): string {
  const situation = evidenceSituation(ev);
  const links = ev.directRelations.length;
  const n = ev.recordedActivity;

  if (situation === "no_links") {
    return "This element is not yet connected to records Conqify can use as evidence.";
  }
  if (situation === "links_without_records") {
    return `${links} linked record${links === 1 ? "" : "s"}. No related activity was recorded in Conqify during this period.`;
  }
  return `${links} linked record${links === 1 ? "" : "s"}. ${ev.activeRelations} recorded ${n} ${n === 1 ? "entry" : "entries"} during this period.`;
}

/**
 * An optional second line comparing this window to the one before it.
 *
 * Returned ONLY when both windows are non-empty and the difference is a literal
 * count difference — the brief's requirement. A period with nothing to compare
 * says nothing at all rather than reaching for a trend.
 */
export function evidenceComparison(ev: ConstitutionEvidence): string | undefined {
  const now = ev.recordedActivity;
  const before = ev.priorRecordedActivity;
  if (now === 0 && before === 0) return undefined;
  if (now === before) return `The same number of entries (${now}) was recorded in the preceding period of equal length.`;
  if (before === 0) return `Nothing was recorded in the preceding period of equal length.`;
  if (now === 0) return `${before} ${before === 1 ? "entry was" : "entries were"} recorded in the preceding period of equal length.`;
  return now > before
    ? `More entries were recorded than in the preceding period of equal length (${now} vs ${before}).`
    : `Fewer entries were recorded than in the preceding period of equal length (${now} vs ${before}).`;
}

/** Last-recorded line, in the neutral register `dormancyPhrase` established. */
export function lastRecordedPhrase(ev: ConstitutionEvidence, now: number = Date.now()): string | undefined {
  if (!ev.lastRecordedAt) return undefined;
  const t = Date.parse(ev.lastRecordedAt);
  if (Number.isNaN(t)) return undefined;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  if (days === 0) return "Most recent entry: today.";
  return `Most recent entry: ${days} day${days === 1 ? "" : "s"} ago.`;
}

/**
 * A per-kind line, e.g. "Practices — 2 linked, 1 entry."
 *
 * For kinds Conqify does not instrument, the line says so instead of implying
 * that a zero means nothing happened.
 */
export function evidenceKindPhrase(row: ConstitutionEvidence["evidenceByKind"][number]): string {
  const base = `${row.label} — ${row.links} linked`;
  if (row.capability === "timestamps_only" && row.observations === 0) {
    return `${base}. Conqify records no ongoing activity for these.`;
  }
  if (row.observations === 0) return `${base}. Nothing recorded in this period.`;
  return `${base}, ${row.observations} ${row.observations === 1 ? "entry" : "entries"}.`;
}

/**
 * The count of adopted elements per kind. Deliberately a plain count with no
 * comparison — the brief is explicit that no kind may be called weak or strong,
 * and there is no meaningful ordering between "3 purposes" and "8 principles".
 */
export function domainSummaryPhrase(label: string, count: number): string {
  return `${label} — ${count} active element${count === 1 ? "" : "s"}`;
}

/**
 * Two DIFFERENT observations that must never be merged (brief §9):
 *   A. the element itself has not been revisited
 *   B. no linked activity was recorded
 * A statement can be true of one and false of the other.
 */
export function untouchedElementPhrase(daysSinceElementTouched: number): string {
  return `You have not edited this element in ${daysSinceElementTouched} day${daysSinceElementTouched === 1 ? "" : "s"}.`;
}

export function untouchedLinksPhrase(daysSinceLinkedActivity: number | undefined): string {
  if (daysSinceLinkedActivity === undefined) return "No linked activity has been recorded in Conqify.";
  return `No linked activity has been recorded in Conqify for ${daysSinceLinkedActivity} day${daysSinceLinkedActivity === 1 ? "" : "s"}.`;
}
