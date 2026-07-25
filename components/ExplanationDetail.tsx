"use client";

/**
 * ExplanationDetail (LIFEOS-026, Features 4 & 7).
 *
 * The ONE way LifeOS shows *why* something was surfaced. It renders a shared
 * MemoryExplanation — the triggers that fired, the supporting records (as links
 * back to the real thing, never copies), the qualitative confidence, and when
 * it was generated. Used by Living Memory, the Insight Timeline, Themes,
 * Continue Thinking, Reflection Prompts, and every Recommendation, so no
 * surfaced item is ever unexplained.
 */

import Link from "next/link";
import type { MemoryExplanation } from "@/lib/memory/explanation";

const CONFIDENCE_TONE: Record<string, string> = {
  high: "text-emerald-600 dark:text-emerald-400",
  moderate: "text-sky-600 dark:text-sky-400",
  low: "text-amber-600 dark:text-amber-400",
  unknown: "text-zinc-400",
};

function when(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ExplanationSummary({ explanation }: { explanation: MemoryExplanation }) {
  return <p className="text-xs text-zinc-500 dark:text-zinc-400">{explanation.summary}</p>;
}

export default function ExplanationDetail({ explanation, defaultOpen = false }: { explanation: MemoryExplanation; defaultOpen?: boolean }) {
  return (
    <details className="group mt-2" open={defaultOpen}>
      <summary className="cursor-pointer list-none text-[11px] text-zinc-500 underline-offset-4 hover:underline">
        <span className="group-open:hidden">Why am I seeing this?</span>
        <span className="hidden group-open:inline">Hide explanation</span>
      </summary>
      <div className="mt-2 rounded-lg border border-black/[.06] bg-black/[.02] px-3 py-2.5 dark:border-white/[.08] dark:bg-white/[.03]">
        <p className="text-xs text-zinc-700 dark:text-zinc-200">{explanation.summary}</p>

        {explanation.triggers.length > 0 && (
          <ul className="mt-2 space-y-1">
            {explanation.triggers.map((t) => (
              <li key={t.rule} className="flex items-start gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                <span>
                  {t.label}
                  <span className="ml-1 text-zinc-400" title="deterministic rule that fired">[{t.rule}]</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {explanation.evidence.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Based on</p>
            <p className="mt-1 flex flex-wrap gap-1">
              {explanation.evidence.map((v, i) =>
                v.href ? (
                  <Link key={`${v.id}:${i}`} href={v.href} className="rounded-full bg-black/[.05] px-1.5 py-0.5 text-[10px] text-zinc-600 underline-offset-2 hover:underline dark:bg-white/[.06] dark:text-zinc-300" title={`${v.kind}${v.note ? " · " + v.note : ""}`}>
                    {v.label.length > 42 ? v.label.slice(0, 41) + "…" : v.label}
                  </Link>
                ) : (
                  <span key={`${v.id}:${i}`} className="rounded-full bg-black/[.05] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.06]" title={v.kind}>
                    {v.label.length > 42 ? v.label.slice(0, 41) + "…" : v.label}
                  </span>
                ),
              )}
            </p>
          </div>
        )}

        <p className="mt-2 text-[10px] text-zinc-400">
          confidence <span className={CONFIDENCE_TONE[explanation.confidence] ?? ""}>{explanation.confidence}</span>
          {explanation.generatedAt ? ` · generated ${when(explanation.generatedAt)}` : ""}
          {" · derived from your existing records — nothing stored"}
        </p>
      </div>
    </details>
  );
}
