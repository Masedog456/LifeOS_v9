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
import { ExplanationSummary } from "@/components/ExplanationDetail";

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
    const continueThinking = buildContinueThinking(state).slice(0, 5);
    const reflectionPrompts = buildReflectionPrompts(state, { limit: 3 });
    const memory = buildLivingMemory(state, { limit: 4 });

    return { activeRecs, highRecs, proposals, openDialogues, openTensions, activeResearch, staleBeliefs, duePractices, recentCaptures, openDecisions, completed, continueThinking, reflectionPrompts, memory };
  }, [state]);

  if (!mounted) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading your day…</p></main>;
  }

  const empty =
    state.captures.length === 0 && state.beliefs.length === 0 && state.sources.length === 0 &&
    state.dialogueSessions.length === 0 && state.researchProjects.length === 0;
  const showOnboardingInvite = !isOnboardingDone();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} — a projection of what deserves attention. Nothing here is a copy; every card links to the record itself.
        </p>
      </header>

      {showOnboardingInvite && (
        <div className="mb-5 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
          <p className="text-sm text-zinc-700 dark:text-zinc-200">New here? A two-minute tour explains the cognitive loop and gets your first thought captured.</p>
          <Link href="/welcome" className="mt-2 inline-block rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Start the tour →</Link>
        </div>
      )}

      {empty && !showOnboardingInvite ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
          <p>Nothing here yet — LifeOS starts with a captured thought.</p>
          <Link href="/" className="mt-2 inline-block rounded-full border border-black/[.12] px-4 py-2 text-sm text-zinc-700 hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-200 dark:hover:bg-white/[.06]">Capture your first thought →</Link>
        </div>
      ) : !empty && (
        <div className="flex flex-col gap-4">
          {/* Needs attention */}
          <Card title="Needs attention" href="/orchestrator" linkLabel="LifeOS Inbox →" show={view.activeRecs.length > 0}>
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              {view.activeRecs.length} active recommendation{view.activeRecs.length === 1 ? "" : "s"}{view.highRecs.length > 0 ? ` — ${view.highRecs.length} high priority` : ""}.
            </p>
            {view.highRecs.slice(0, 2).map((r) => <p key={r.id} className="mt-1 text-xs text-zinc-500">• {r.suggestedAction}</p>)}
          </Card>

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
          <Card title="Continue" href="/dialogue" linkLabel="Dialogues →" show={view.openDialogues.length > 0}>
            {view.openDialogues.slice(0, 3).map((d) => (
              <Link key={d.id} href={`/dialogue/${d.id}`} className="block py-0.5 text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">
                {snip(d.title, 56)} <span className="text-xs text-zinc-400">· {d.status} · {ago(d.updatedAt)}</span>
              </Link>
            ))}
            {view.openTensions.length > 0 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{view.openTensions.length} unresolved tension{view.openTensions.length === 1 ? "" : "s"} across your dialogues.</p>}
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

          {view.activeRecs.length === 0 && view.proposals.length === 0 && view.openDialogues.length === 0 && view.activeResearch.length === 0 && view.openDecisions.length === 0 && view.staleBeliefs.length === 0 && view.duePractices.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/[.10] p-5 text-sm text-zinc-500 dark:border-white/[.12]">
              All clear — nothing is waiting on you. Capture a thought, open a dialogue, or run a scan in the <Link href="/orchestrator" className="underline underline-offset-4">LifeOS Inbox</Link>.
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function Card({ title, href, linkLabel, show, children }: { title: string; href: string; linkLabel: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
        <Link href={href} className="text-[11px] text-zinc-400 underline-offset-4 hover:underline">{linkLabel}</Link>
      </div>
      {children}
    </section>
  );
}
