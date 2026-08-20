/**
 * The silent-adoption canary (LIFEOS-059 §8).
 *
 * ## The one question
 *
 *   Did any Constitution element appear without a recorded user action?
 *
 * This is the most important beta invariant. Everything else LIFEOS-058 built —
 * the single adoption gate, the validator, the four injection defences — exists
 * to make the answer permanently "no". The canary is what would tell us if that
 * were ever false in the field, on a real person's device, rather than only in
 * a test.
 *
 * ## It does not infer intent
 *
 * It compares two sets: elements that exist, and creations that were recorded at
 * the mutation seam. `createConstitutionElement` and `adoptConstitutionElement`
 * are the only functions in the codebase that can produce an element or set
 * `adoptedAt`, and each records a fingerprint when it runs. An element with no
 * matching record was not written by either of them.
 *
 * ## Three honest verdicts, not two
 *
 * A binary pass/fail would produce false alarms, and a false STOP-THE-LINE is
 * expensive — it would train people to ignore the real one. Two situations
 * legitimately produce an element with no local record:
 *
 *   1. **It predates instrumentation.** Elements created before the beta build
 *      have no events and never will. Excluded by `startedAt`.
 *   2. **It arrived by sync.** An element adopted on another device is a real
 *      user action — just not one this browser saw. `state_replaced` with
 *      `reason: "remote_adoption"` marks those windows.
 *
 * So the canary reports `clean`, `inconclusive`, or `violation`, and only the
 * third is STOP-THE-LINE. Anything it cannot explain *and* cannot attribute to
 * sync is a violation.
 *
 * ## It does not self-heal
 *
 * `checkConstitutionIntegrity` is a pure read. It never deletes an element,
 * never backfills a missing event, never rewrites the log. A violation stays
 * visible until a person looks at it — which is the entire value of a canary.
 */

import type { ConstitutionElement, StoreState } from "@/types/mvp";
import type { BetaEvent } from "@/lib/beta/events";
import { fingerprint } from "@/lib/beta/events";

export type CanaryVerdict = "clean" | "inconclusive" | "violation";

/** One element the canary could not account for. Fingerprint only — no wording. */
export interface UnaccountedElement {
  fp: string;
  kind: string;
  status: string;
  createdAt: string;
  /** True when the element is adopted but no adoption was recorded. */
  adoptedWithoutRecord: boolean;
}

export interface CanaryReport {
  verdict: CanaryVerdict;
  /** Elements created at/after instrumentation with no recorded creation. */
  unaccounted: UnaccountedElement[];
  /** How many elements were skipped for predating instrumentation. */
  predatesInstrumentation: number;
  /** True when a remote adoption happened, which legitimately explains gaps. */
  syncOccurred: boolean;
  /** Elements checked against the record. */
  checked: number;
  /** The headline, in plain language. */
  headline: string;
}

/** The exact banner a violation must produce. Asserted by tests. */
export const STOP_THE_LINE = "STOP-THE-LINE: CONSTITUTION MUTATION WITHOUT RECORDED USER ACTION";

/**
 * Check the store against the recorded mutation seam.
 *
 * `startedAt` is when instrumentation began on this device; elements older than
 * that are not evidence of anything and are counted separately rather than
 * silently ignored — a summary that quietly dropped them would overstate how
 * much the canary actually covers.
 */
export function checkConstitutionIntegrity(
  state: StoreState,
  events: readonly BetaEvent[],
  startedAt: string | null,
): CanaryReport {
  const elements: ConstitutionElement[] = state.constitutionElements ?? [];
  const created = new Set(events.filter((e) => e.event === "constitution_created" && e.fp).map((e) => e.fp!));
  const adopted = new Set(events.filter((e) => e.event === "constitution_adopted" && e.fp).map((e) => e.fp!));
  const syncOccurred = events.some((e) => e.event === "state_replaced" && e.reason === "remote_adoption");

  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const unaccounted: UnaccountedElement[] = [];
  let predates = 0;
  let checked = 0;

  for (const el of elements) {
    const madeMs = Date.parse(el.createdAt ?? "");
    // No instrumentation yet, or the element is older than it — not checkable.
    if (!Number.isFinite(startMs) || (Number.isFinite(madeMs) && madeMs < startMs)) {
      predates += 1;
      continue;
    }
    checked += 1;
    const fp = fingerprint(el.id);
    const hasCreate = created.has(fp);
    const needsAdopt = !!el.adoptedAt;
    const hasAdopt = adopted.has(fp);
    if (!hasCreate || (needsAdopt && !hasAdopt)) {
      unaccounted.push({
        fp,
        kind: el.kind,
        status: el.status,
        createdAt: el.createdAt,
        adoptedWithoutRecord: needsAdopt && !hasAdopt,
      });
    }
  }

  if (unaccounted.length === 0) {
    return {
      verdict: "clean",
      unaccounted,
      predatesInstrumentation: predates,
      syncOccurred,
      checked,
      headline: checked === 0
        ? "Nothing to check yet — no Constitution elements have been created since this build started recording."
        : `All ${checked} element${checked === 1 ? "" : "s"} created since recording began have a matching user action.`,
    };
  }

  if (syncOccurred) {
    return {
      verdict: "inconclusive",
      unaccounted,
      predatesInstrumentation: predates,
      syncOccurred,
      checked,
      headline:
        `${unaccounted.length} element${unaccounted.length === 1 ? "" : "s"} have no recorded action on this device, ` +
        "but data was adopted from another device during this period, which explains it. Not treated as a violation — " +
        "check the other device if you want certainty.",
    };
  }

  return {
    verdict: "violation",
    unaccounted,
    predatesInstrumentation: predates,
    syncOccurred,
    checked,
    headline: STOP_THE_LINE,
  };
}
