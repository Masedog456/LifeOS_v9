"use client";

/**
 * Daily Home (LIFEOS-025) — the daily starting point.
 *
 * A pure PROJECTION over existing state: it composes what needs attention,
 * what changed, what is unresolved, what to review, what to continue, and what
 * was recently completed — from records that already exist. It duplicates
 * nothing, creates nothing, and mutates nothing by being viewed.
 */

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { pendingProposals, useStore } from "@/lib/mvpStore";
import { isActive } from "@/lib/orchestrator";
import { isOnboardingDone } from "@/lib/prefs";
import { buildContinueThinking } from "@/lib/memory/continue";
import { buildReflectionPrompts } from "@/lib/memory/prompts";
import { buildLivingMemory } from "@/lib/memory/living";
import { buildGraph } from "@/lib/graph";
import { ExplanationSummary } from "@/components/ExplanationDetail";
import { getPinned } from "@/lib/command/recent";
import { resolveRecord } from "@/lib/command/records";
import { openQuickCapture } from "@/lib/command/events";
import FirstRun from "@/components/ux/FirstRun";
import TodayInboxCard from "@/components/inbox/TodayInboxCard";
import TodayCommandCenter from "@/components/today/TodayCommandCenter";
import TodayPlanCard from "@/components/planning/TodayPlanCard";
import TodayInsightsCard from "@/components/insights/TodayInsightsCard";

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
}
function ago(iso: string): string {
  const d = daysAgo(iso);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
}
function snip(s: string, n = 64): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}
/** A warm, time-of-day greeting — the small touch that makes Today feel like
 * opening your own notebook rather than a dashboard (LIFEOS-044). */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function TodayPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();

  const view = useMemo(() => {
    const activeRecs = state.recommendations.filter((r) => isActive(r));
    const highRecs = activeRecs.filter((r) => r.priority === "high");
    const proposals = pendingProposals(state);
    const openDialogues = state.dialogueSessions.filter((d) => d.status === "open" || d.status === "active" || d.status === "paused");
    const openTensions = state.tensions.filter((t) => t.status === "open" || t.status === "under_synthesis");
    const activeResearch = state.researchProjects.filter((r) => !r.seededProjectId);
    const staleBeliefs = state.beliefs.filter((b) => b.status === "accepted" && daysAgo(b.updatedAt) >= 90);
    const duePractices = state.practices.filter((p) => p.status === "accepted" && (p.cadence === "daily" || p.cadence === "weekly"));
    const recentCaptures = [...state.captures].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
    const openDecisions = state.decisions.filter((d) => d.status === "exploring" || d.status === "narrowed");
    // Recently completed — the loop closing: last 7 days of concluded/resolved/accepted work.
    const completed: { at: string; label: string; href: string }[] = [
      ...state.dialogueSessions.filter((d) => d.status === "concluded" && daysAgo(d.updatedAt) <= 7).map((d) => ({ at: d.updatedAt, label: `Dialogue concluded: ${snip(d.title, 44)}`, href: `/dialogue/${d.id}` })),
      ...state.tensions.filter((t) => t.status === "resolved" && daysAgo(t.updatedAt) <= 7).map((t) => ({ at: t.updatedAt, label: `Tension resolved: ${snip(t.title, 44)}`, href: `/dialogue/${t.dialogueId}` })),
      ...state.syntheses.filter((s) => s.status === "accepted" && daysAgo(s.updatedAt) <= 7).map((s) => ({ at: s.updatedAt, label: `Synthesis accepted: ${snip(s.statement, 44)}`, href: `/dialogue/${s.dialogueId}` })),
      ...state.decisions.filter((d) => d.status === "decided" && daysAgo(d.updatedAt) <= 7).map((d) => ({ at: d.updatedAt, label: `Decision made: ${snip(d.title, 44)}`, href: `/decisions/${d.id}` })),
      ...state.recommendations.filter((r) => r.completed && daysAgo(r.createdAt) <= 7).map((r) => ({ at: r.createdAt, label: `Recommendation done: ${snip(r.suggestedAction, 44)}`, href: "/orchestrator" })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

    // LIFEOS-026 — Continue Thinking, Reflection Prompts, and Living Memory,
    // all pure projections over the same state.
    //
    // The graph is built ONCE here and threaded into the two engines that read
    // it; each used to build its own identical copy on every render of this
    // page. Same state in, same graph out — this changes cost, not meaning.
    const graph = buildGraph(state);
    const continueThinking = buildContinueThinking(state).slice(0, 5);
    const reflectionPrompts = buildReflectionPrompts(state, { limit: 3, graph });
    const memory = buildLivingMemory(state, { limit: 4, graph });

    return { activeRecs, highRecs, proposals, openDialogues, openTensions, activeResearch, staleBeliefs, duePractices, recentCaptures, openDecisions, completed, continueThinking, reflectionPrompts, memory };
  }, [state]);

  // Pinned records (LIFEOS-027) — read from prefs, reconciled against the store.
  const pinned = mounted ? getPinned(state) : [];

  if (!mounted) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading your day…</p></main>;
  }

  const showOnboardingInvite = !isOnboardingDone();
  // The collapsible "More from your notebook" only appears when it holds
  // something — an empty disclosure would be noise, not calm.
  // LIFEOS-083 §1.10. Pinned, Continue thinking and To review moved INSIDE the
  // disclosure, so the gate has to know about them — otherwise a user whose only
  // secondary content is a pinned record gets a collapsed section that renders
  // nothing, or worse, no section and a silently dropped card.
  const hasSecondary =
    pinned.length > 0 || view.continueThinking.length > 0 || view.proposals.length > 0 ||
    view.openDialogues.length > 0 || view.activeResearch.length > 0 || view.openDecisions.length > 0 ||
    view.staleBeliefs.length > 0 || view.duePractices.length > 0 || view.recentCaptures.length > 0 ||
    view.memory.length > 0 || view.reflectionPrompts.length > 0 || view.completed.length > 0;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
            <h1 className="mt-0.5 text-[1.75rem] font-semibold leading-tight tracking-tight">{greeting()}.</h1>
          </div>
          <button type="button" onClick={openQuickCapture} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">＋ Quick capture</button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          {/* LIFEOS-083 §3. Three lines of instructions, every day, above the
              day itself. The product should orient, not explain itself — the
              ⌘K hint is worth keeping and the rest was chrome. */}
          Press <kbd className="rounded border border-black/[.12] px-1 text-[10px] dark:border-white/[.15]">⌘K</kbd> to search or jump anywhere.
        </p>
      </header>

      {/* LIFEOS-062: the empty state belongs to `TodayCommandCenter`, which is
          the only thing that knows whether the projection actually found
          anything. The page used to keep its own `empty` check and render a
          competing "Nothing here yet" panel — two empty states with different
          copy, and the page-level one won, so the capture-focused prompt §29
          asks for could never appear. */}
      {(
        <div className="flex flex-col gap-4">
          {/* LIFEOS-062. ONE projection over ONE index pass, replacing the
              schedule / due / return / actions cards. Those each derived their
              own slice from the store — and two of them built the activity index
              independently — so the page paid for the same work repeatedly and
              no section could see what another had found. Suggested Next needs
              all of it at once, so all of it is now computed at once. */}
          <TodayCommandCenter />

          {/* LIFEOS-083 §1.10. Everything below this line is an ENTRY POINT or
              scaffolding, and it used to come first.

              The audit measured what that cost: on a phone the only thing above
              the fold was "Getting started 2/8". The advisor meeting at 09:00,
              the overdue application and the follow-up due today were all below
              an eight-item onboarding checklist, a tour invite and a review
              link. Three pieces of scaffolding outranked the day.

              The order is now: the day, then the ways into the rest of it. */}

          {/* LIFEOS-092 §20. The review entry point lives ONCE, on the
              orientation card above — this card was a second "Review today →"
              with an identical label pointing at a different surface. */}

          <FirstRun />

          {showOnboardingInvite && (
            <div className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
              <p className="text-sm text-zinc-700 dark:text-zinc-200">New here? A short tour shows how LifeOS helps you capture, decide, and reflect — you stay in charge of everything.</p>
              <Link href="/welcome" className="mt-2 inline-block rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Start the tour →</Link>
            </div>
          )}

          {/* Capture inbox entry point (LIFEOS-035, Feature 13). */}
          <TodayInboxCard />

          {/* Planning entry point (LIFEOS-037, Feature 16). */}
          <TodayPlanCard />

          {/* Insights snapshot (LIFEOS-039, Feature 18). */}
          <TodayInsightsCard />

          {/* Progressive disclosure (LIFEOS-044): the deeper, more reflective
              parts of the day stay one calm click away, so Today opens quiet. */}
          {hasSecondary && (
          <details className="lo-details flex flex-col gap-4">
            <summary className="flex items-center gap-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              <span aria-hidden className="lo-caret text-[9px]">▸</span> More from your notebook
            </summary>
            <div className="mt-2 flex flex-col gap-4">
          {/* Pinned — fast access to favourite records (LIFEOS-027, Feature 4). */}
          <Card title="Pinned" href="/today" linkLabel="⌘K to manage" show={pinned.length > 0}>
            {pinned.map((p) => {
              const href = resolveRecord(state, p.kind, p.id)?.href ?? "/today";
              return (
                <Link key={`${p.kind}:${p.id}`} href={href} className="block py-0.5 text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">
                  <span aria-hidden className="mr-1 text-amber-500">★</span>{snip(p.title, 56)}
                </Link>
              );
            })}
          </Card>

          {/* LIFEOS-083 §1.3. A SECOND "Needs attention" used to render here,
              built from orchestrator recommendations — same heading as the
              commitment-signal section a few hundred pixels above it, different
              evidence, same page. Two headings that promise the same thing and
              answer differently is worse than either alone.

              The commitment section wins: it is the one the resolution layer,
              Memory and the 082 shortlist all agree with. Orchestrator
              recommendations remain at /orchestrator. */}

          {/* Continue thinking — the primary way back into unfinished threads (LIFEOS-026, Feature 5). */}
          <Card title="Continue thinking" href="/memory" linkLabel="Living Memory →" show={view.continueThinking.length > 0}>
            {view.continueThinking.map((c) => (
              <Link key={c.id} href={c.href} className="block py-0.5 text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">
                {snip(c.title, 54)} <span className="text-xs text-zinc-400">· {c.reason}</span>
              </Link>
            ))}
          </Card>

          <Card title="To review" href="/inbox" linkLabel="Belief Inbox →" show={view.proposals.length > 0}>
            <p className="text-sm text-zinc-700 dark:text-zinc-200">{view.proposals.length} belief proposal{view.proposals.length === 1 ? "" : "s"} waiting for your judgment.</p>
          </Card>

          {/* Continue */}
          <Card title="Continue" href="/dialogue" linkLabel="Explore an idea →" show={view.openDialogues.length > 0}>
            {view.openDialogues.slice(0, 3).map((d) => (
              <Link key={d.id} href={`/dialogue/${d.id}`} className="block py-0.5 text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">
                {snip(d.title, 56)} <span className="text-xs text-zinc-400">· {d.status} · {ago(d.updatedAt)}</span>
              </Link>
            ))}
            {view.openTensions.length > 0 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{view.openTensions.length} unresolved tension{view.openTensions.length === 1 ? "" : "s"} across your explorations.</p>}
          </Card>

          <Card title="Active research" href="/research" linkLabel="Research →" show={view.activeResearch.length > 0}>
            {view.activeResearch.slice(0, 3).map((r) => (
              <Link key={r.id} href={`/research/${r.id}`} className="block py-0.5 text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">
                {snip(r.title, 56)} <span className="text-xs text-zinc-400">· {ago(r.updatedAt)}</span>
              </Link>
            ))}
          </Card>

          <Card title="Open decisions" href="/decisions" linkLabel="Decisions →" show={view.openDecisions.length > 0}>
            {view.openDecisions.slice(0, 3).map((d) => (
              <Link key={d.id} href={`/decisions/${d.id}`} className="block py-0.5 text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">
                {snip(d.title, 56)} <span className="text-xs text-zinc-400">· {d.status}</span>
              </Link>
            ))}
          </Card>

          {/* Review + practice */}
          <Card title="Due for review" href="/review" linkLabel="Reviews →" show={view.staleBeliefs.length > 0}>
            <p className="text-sm text-zinc-700 dark:text-zinc-200">{view.staleBeliefs.length} belief{view.staleBeliefs.length === 1 ? "" : "s"} unexamined for 90+ days.</p>
            {view.staleBeliefs.slice(0, 2).map((b) => <p key={b.id} className="mt-1 text-xs text-zinc-500">• {snip(b.text, 64)}</p>)}
          </Card>

          <Card title="Practice" href="/formation" linkLabel="Reflect →" show={view.duePractices.length > 0}>
            {view.duePractices.slice(0, 3).map((p) => (
              <p key={p.id} className="py-0.5 text-sm text-zinc-700 dark:text-zinc-200">{snip(p.userWording?.trim() || p.title, 56)} <span className="text-xs text-zinc-400">· {p.cadence}</span></p>
            ))}
          </Card>

          {/* What changed */}
          <Card title="Recent captures" href="/" linkLabel="Capture →" show={view.recentCaptures.length > 0}>
            {view.recentCaptures.map((c) => (
              <p key={c.id} className="py-0.5 text-sm text-zinc-700 dark:text-zinc-200">{snip(c.text, 64)} <span className="text-xs text-zinc-400">· {ago(c.createdAt)}</span></p>
            ))}
          </Card>

          {/* From your memory — deterministic resurfacing, each item self-explaining (LIFEOS-026, Feature 1). */}
          <Card title="From your memory" href="/memory" linkLabel="Living Memory →" show={view.memory.length > 0}>
            {view.memory.map((m) => (
              <div key={m.id} className="border-b border-black/[.04] py-1.5 last:border-0 dark:border-white/[.05]">
                <Link href={m.href} className="block text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">{snip(m.title, 60)}</Link>
                <div className="mt-0.5"><ExplanationSummary explanation={m.explanation} /></div>
              </div>
            ))}
          </Card>

          {/* Reflection prompts — evidence-bearing questions, never unexplained (LIFEOS-026, Feature 6). */}
          <Card title="Reflection prompts" href="/memory" linkLabel="Living Memory →" show={view.reflectionPrompts.length > 0}>
            {view.reflectionPrompts.map((p) => (
              <p key={p.id} className="py-0.5 text-sm text-zinc-700 dark:text-zinc-200">{p.text}</p>
            ))}
          </Card>

          <Card title="Recently completed" href="/health" linkLabel="System Health →" show={view.completed.length > 0}>
            {view.completed.map((c, i) => (
              <Link key={i} href={c.href} className="block py-0.5 text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300">
                ✓ {c.label} <span className="text-xs text-zinc-400">· {ago(c.at)}</span>
              </Link>
            ))}
          </Card>
            </div>
          </details>
          )}

          {/* LIFEOS-063 R-1. A second "You're all caught up. Nothing is waiting
              on you right now" panel used to live here, gated ONLY on the
              knowledge-side collections above it — recommendations, proposals,
              dialogues, research, decisions, stale beliefs, practices. It knew
              nothing about `TodayCommandCenter`, so on an ordinary day it fired
              while the page listed three overdue actions, a due follow-up and
              two appointments a few hundred pixels higher.

              This is the same defect LIFEOS-062 removed at the other end of the
              page, and the reason both existed is the same: the empty state
              belongs to the one component that knows whether the projection
              found anything. `TodayCommandCenter` renders a capture-focused
              prompt when there is genuinely nothing, and every card here hides
              itself when it has nothing to say, so an empty day already reads
              correctly without a panel asserting it. */}
        </div>
      )}
    </main>
  );
}

function Card({ title, href, linkLabel, show, children }: { title: string; href: string; linkLabel: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <section data-card className="lo-card rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
        <Link href={href} className="text-[11px] text-zinc-400 underline-offset-4 hover:text-zinc-600 hover:underline dark:hover:text-zinc-300">{linkLabel}</Link>
      </div>
      {children}
    </section>
  );
}
