"use client";

/**
 * Constitution in Practice (LIFEOS-057).
 *
 * Puts what the user has adopted next to what Conqify has recorded about the
 * records they linked. That is the whole claim — it is an observation over two
 * sets, not a judgment of a person.
 *
 * Deliberately absent, and asserted absent by tests: any score, percentage,
 * alignment reading, streak, progress ring, or red/green light. There is no
 * ordering of elements by "how well they are doing", because no such quantity
 * exists here.
 *
 * Performance: the activity index is built ONCE for the whole page and threaded
 * into every element's projection (§17), rather than rebuilt per element.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { activeConstitution, byKind, retiredElements } from "@/lib/constitution/constitution";
import { buildConstitutionEvidenceMap } from "@/lib/constitution/evidence";
import { domainSummaryPhrase } from "@/lib/constitution/copy";
import { CONSTITUTION_KIND_LABEL } from "@/types/mvp";
import { buildActivityIndex } from "@/lib/insights/activity";
import { resolveRange } from "@/lib/insights/range";
import { todayKey, addDays } from "@/lib/reviews/dates";
import EvidenceBlock from "@/components/constitution/ConstitutionEvidence";

/** The three windows the brief asks for, expressed with the existing engine. */
const WINDOWS = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
] as const;

export default function ConstitutionReflection() {
  const state = useStore();
  const [windowId, setWindowId] = useState<(typeof WINDOWS)[number]["id"]>("30");

  const range = useMemo(() => {
    const days = WINDOWS.find((w) => w.id === windowId)!.days;
    const today = todayKey();
    // `custom` over the existing DayKey helpers — no new date engine, and no new
    // preset added to the shared InsightRangeKind enum.
    return resolveRange("custom", { today, customStart: addDays(today, -(days - 1)), customEnd: today });
  }, [windowId]);

  const elements = useMemo(() => activeConstitution(state), [state]);

  // ONE index for the whole page, however many elements are shown.
  const evidence = useMemo(
    () => buildConstitutionEvidenceMap(state, elements, range, { index: buildActivityIndex(state) }),
    [state, elements, range],
  );

  const groups = byKind(elements).filter((g) => g.elements.length > 0);
  const retiredCount = retiredElements(state).length;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Constitution in Practice</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">
          What you have adopted, next to what Conqify has recorded about the records you linked to it.
          This is an observation, not an assessment — Conqify only sees what was entered here.
        </p>
        <p className="mt-2 text-xs">
          <Link href="/constitution" className="text-zinc-500 underline underline-offset-2">← Back to your Constitution</Link>
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWindowId(w.id)}
            className={`rounded-full px-3 py-1 text-xs ${w.id === windowId ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] dark:border-white/[.15]"}`}
          >
            {w.label}
          </button>
        ))}
        <span className="text-xs text-zinc-400">{range.label}</span>
      </div>

      {elements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.12] p-6 text-center text-sm text-zinc-500 dark:border-white/[.15]">
          You have not adopted anything yet. Write one thing on your{" "}
          <Link href="/constitution" className="underline underline-offset-2">Constitution</Link> and add it.
        </p>
      ) : (
        <>
          {/* A plain count per kind. No comparison, no ordering, no verdict. */}
          <section className="mb-8 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
            <ul className="space-y-0.5 text-xs text-zinc-500">
              {groups.map((g) => (
                <li key={g.kind}>{domainSummaryPhrase(CONSTITUTION_KIND_LABEL[g.kind], g.elements.length)}</li>
              ))}
            </ul>
          </section>

          {groups.map((g) => (
            <section key={g.kind} className="mb-8">
              <h2 className="mb-3 text-sm font-medium">{CONSTITUTION_KIND_LABEL[g.kind]}</h2>
              <ul className="space-y-3">
                {g.elements.map((e) => {
                  const ev = evidence.get(e.id);
                  return (
                    <li key={e.id} className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]">
                      <p className="leading-relaxed text-zinc-900 dark:text-zinc-100">{e.statement}</p>
                      {ev && (
                        <EvidenceBlock
                          evidence={ev}
                          onLink={() => { window.location.href = `/constitution?element=${e.id}`; }}
                          onReflect={() => { window.location.href = `/notes?from=constitution&element=${e.id}`; }}
                          onCreateAction={() => { window.location.href = `/actions?fromConstitution=${e.id}`; }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {retiredCount > 0 && (
            <p className="mt-8 border-t border-black/[.06] pt-4 text-xs text-zinc-500 dark:border-white/[.08]">
              {retiredCount} element{retiredCount === 1 ? "" : "s"} you no longer adopt {retiredCount === 1 ? "is" : "are"} not shown here.
              {" "}
              <Link href="/constitution" className="underline underline-offset-2">View them on your Constitution</Link>.
            </p>
          )}
        </>
      )}
    </main>
  );
}
