"use client";

/**
 * The shared "Recorded life" block (LIFEOS-057).
 *
 * Used both inside a Constitution element card and on the reflection view, so
 * the wording contract has exactly one implementation. Every sentence here comes
 * from `lib/constitution/copy.ts` — nothing is composed inline, because a
 * sentence written in JSX is a sentence no test can hold to the contract.
 */

import { useState } from "react";
import type { ConstitutionEvidence } from "@/lib/constitution/evidence";
import {
  evidenceHeadline, evidenceComparison, lastRecordedPhrase, evidenceKindPhrase, evidenceSituation,
} from "@/lib/constitution/copy";

export default function EvidenceBlock({
  evidence,
  onLink,
  onReflect,
  onCreateAction,
}: {
  evidence: ConstitutionEvidence;
  onLink?: () => void;
  onReflect?: () => void;
  onCreateAction?: () => void;
}) {
  const [why, setWhy] = useState(false);
  const situation = evidenceSituation(evidence);
  const comparison = evidenceComparison(evidence);
  const last = lastRecordedPhrase(evidence);

  return (
    <div className="mt-3 rounded-xl border border-black/[.06] p-3 text-xs dark:border-white/[.08]">
      <p className="text-zinc-700 dark:text-zinc-300">{evidenceHeadline(evidence)}</p>
      {comparison && <p className="mt-1 text-zinc-500">{comparison}</p>}
      {last && <p className="mt-1 text-zinc-500">{last}</p>}

      {evidence.evidenceByKind.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-zinc-500">
          {evidence.evidenceByKind.map((row) => (
            <li key={row.kind}>{evidenceKindPhrase(row)}</li>
          ))}
        </ul>
      )}

      {/* Responses. All optional, all explicit — nothing is ever created for
          the user, and "this doesn't need attention" is simply closing the
          panel, which is why no such button exists to be pressed. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {situation === "no_links" && onLink && (
          <button type="button" onClick={onLink} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
            Link something
          </button>
        )}
        {situation !== "no_links" && onLink && (
          <button type="button" onClick={onLink} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
            Link something else
          </button>
        )}
        {onReflect && (
          <button type="button" onClick={onReflect} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
            Write a note about this
          </button>
        )}
        {onCreateAction && (
          <button type="button" onClick={onCreateAction} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
            Create an action
          </button>
        )}
        <button type="button" onClick={() => setWhy((w) => !w)} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          Why am I seeing this?
        </button>
      </div>

      {why && (
        <div className="mt-3 space-y-2 border-t border-black/[.06] pt-2 dark:border-white/[.08]">
          <ul className="space-y-0.5 text-zinc-500">
            {evidence.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <ul className="space-y-0.5 text-zinc-400">
            {evidence.coverage.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
