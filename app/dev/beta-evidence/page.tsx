"use client";
/**
 * The founder beta summary (LIFEOS-059 §7). Dev-only surface.
 *
 * Deliberately not a dashboard: counts derived from the local log, the canary
 * verdict, and a copyable Markdown block. No charts, no funnels, no cross-user
 * view, and no score of any kind about a person.
 *
 * It cannot display private prose because the event schema has no field that
 * can hold any — see `lib/beta/events.ts`.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/lib/mvpStore";
import { useBetaEvidence, clearEvidence } from "@/lib/beta/store";
import { useBetaFeedback, FEEDBACK_CATEGORY_LABEL, type FeedbackCategory } from "@/lib/beta/feedback";
import { checkConstitutionIntegrity } from "@/lib/beta/canary";
import { buildBetaSummary, summaryToMarkdown } from "@/lib/beta/summary";
import { BETA_DISCLOSURE } from "@/lib/beta/disclosure";

export default function BetaEvidencePage() {
  const state = useStore();
  // Both logs come through `useSyncExternalStore`, which is what makes this page
  // hydration-safe: `localStorage` does not exist on the server, so the server
  // snapshot is "nothing recorded" and React re-reads the real log after
  // hydrating. Reading storage in a state initializer instead would make the
  // first client render disagree with the server HTML (React error #418).
  // Clearing evidence below emits, so the view updates without a manual refresh.
  const { events, startedAt } = useBetaEvidence();
  const feedback = useBetaFeedback();
  const [showRaw, setShowRaw] = useState(false);

  const { summary, markdown } = useMemo(() => {
    const canary = checkConstitutionIntegrity(state, events, startedAt);
    const s = buildBetaSummary(events, feedback, canary, startedAt);
    return { summary: s, markdown: summaryToMarkdown(s) };
  }, [state, events, feedback, startedAt]);

  const c = summary.trust.canary;
  const canaryTone =
    c.verdict === "violation" ? "border-rose-500 text-rose-700 dark:text-rose-300"
      : c.verdict === "inconclusive" ? "border-amber-500 text-amber-700 dark:text-amber-300"
        : "border-black/[.10] text-zinc-600 dark:border-white/[.12] dark:text-zinc-400";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Closed-beta evidence</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Local to this device. {summary.eventCount} events since {summary.startedAt ?? "—"}.
      </p>

      <section className={`mt-5 rounded-2xl border-2 p-4 ${canaryTone}`}>
        <h2 className="text-sm font-semibold">Silent-adoption canary — {c.verdict.toUpperCase()}</h2>
        <p className="mt-1 text-xs leading-relaxed">{c.headline}</p>
        <p className="mt-1 text-[11px] opacity-70">
          {c.checked} checked · {c.predatesInstrumentation} predate recording · sync in period: {c.syncOccurred ? "yes" : "no"}
        </p>
        {c.unaccounted.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px]">
            {c.unaccounted.map((u) => (
              <li key={u.fp}>{u.fp} · {u.kind} · {u.status}{u.adoptedWithoutRecord ? " · adopted with no recorded adoption" : ""}</li>
            ))}
          </ul>
        )}
      </section>

      <pre className="mt-6 overflow-x-auto whitespace-pre-wrap rounded-2xl border border-black/[.06] p-4 text-xs leading-relaxed dark:border-white/[.08]">
{markdown}
      </pre>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Feedback written on this device</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Counts only. Reading what a tester wrote is a separate, deliberate act — open it below.
        </p>
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
          {(Object.entries(summary.trust.feedbackByCategory) as [FeedbackCategory, number][]).map(([k, n]) => (
            <li key={k}>{FEEDBACK_CATEGORY_LABEL[k]} — {n}</li>
          ))}
        </ul>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-black/[.06] pt-4 text-xs dark:border-white/[.08]">
        <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          {showRaw ? "Hide" : "Show"} raw events ({events.length})
        </button>
        <button type="button" onClick={() => clearEvidence()} className="text-zinc-500 underline underline-offset-2">
          Clear evidence on this device
        </button>
      </div>

      {showRaw && (
        <pre className="mt-3 max-h-96 overflow-auto rounded-xl border border-black/[.06] p-3 text-[11px] dark:border-white/[.08]">
{JSON.stringify(events, null, 2)}
        </pre>
      )}

      <ul className="mt-6 space-y-1 border-t border-black/[.06] pt-4 text-[11px] text-zinc-400 dark:border-white/[.08]">
        {BETA_DISCLOSURE.map((l) => <li key={l}>· {l}</li>)}
      </ul>
    </main>
  );
}
