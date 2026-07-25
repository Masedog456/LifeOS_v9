"use client";

/**
 * Theme detail (LIFEOS-026, Feature 3).
 *
 * One theme in full: frequency over time, and every connected belief, capture,
 * dialogue, research project, synthesis, and open tension — each a link to the
 * real record, each tagged with HOW it connects (an explicit reference vs. a
 * name/alias mention), so the connection is always inspectable. Read-only.
 */

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/mvpStore";
import { themeById, type ThemeConnection } from "@/lib/memory/themes";
import ExplanationDetail from "@/components/ExplanationDetail";
import { Sparkline } from "../page";

export default function ThemeDetailPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const theme = useMemo(() => (id ? themeById(state, id) : undefined), [state, id]);

  if (!mounted) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading theme…</p></main>;
  }

  if (!theme) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <p className="text-sm text-zinc-500">That theme doesn&apos;t exist (or the concept was archived).</p>
        <Link href="/themes" className="mt-3 inline-block text-sm text-zinc-500 underline underline-offset-4">← All themes</Link>
      </main>
    );
  }

  const span =
    theme.firstAt && theme.lastAt
      ? `${new Date(theme.firstAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })} – ${new Date(theme.lastAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
      : "";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/themes" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← All themes</Link>
      <header className="mb-5 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">{theme.name}</h1>
        {theme.aliases.length > 0 && <p className="mt-0.5 text-[11px] text-zinc-400">also: {theme.aliases.join(", ")}</p>}
        <p className="mt-1 text-sm text-zinc-500">
          {theme.total} connection{theme.total === 1 ? "" : "s"}{span ? ` across ${span}` : ""}. Also in the <Link href={`/world/concept/${theme.id}`} className="underline underline-offset-4">World model</Link>.
        </p>
        <ExplanationDetail explanation={theme.explanation} />
      </header>

      {theme.buckets.length > 0 && (
        <section className="mb-6 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Frequency over time</h2>
          <div className="flex items-end gap-1">
            {theme.buckets.map((b) => (
              <div key={b.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-24 w-full items-end">
                  <div className="w-full rounded-sm bg-zinc-300 dark:bg-zinc-600" style={{ height: `${(b.count / Math.max(...theme.buckets.map((x) => x.count), 1)) * 100}%` }} title={`${b.month}: ${b.count}`} />
                </div>
                <span className="text-[8px] text-zinc-400">{b.month.slice(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 sm:hidden"><Sparkline buckets={theme.buckets} /></div>
        </section>
      )}

      <div className="flex flex-col gap-5">
        <ConnectionGroup title="Beliefs" items={theme.beliefs} />
        <ConnectionGroup title="Open tensions" items={theme.tensions} tone="text-amber-600 dark:text-amber-400" />
        <ConnectionGroup title="Dialogues" items={theme.dialogues} />
        <ConnectionGroup title="Research" items={theme.research} />
        <ConnectionGroup title="Syntheses" items={theme.syntheses} />
        <ConnectionGroup title="Captures" items={theme.captures} />
      </div>
    </main>
  );
}

function ConnectionGroup({ title, items, tone }: { title: string; items: ThemeConnection[]; tone?: string }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone ?? "text-zinc-400"}`}>{title} ({items.length})</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((c) => (
          <li key={`${c.kind}:${c.id}`}>
            <Link href={c.href} className="flex items-start justify-between gap-3 rounded-xl border border-black/[.06] px-3 py-2 transition-colors hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]">
              <span className="min-w-0 text-sm text-zinc-800 dark:text-zinc-100">{c.label.length > 90 ? c.label.slice(0, 89) + "…" : c.label}</span>
              <span className="shrink-0 text-[10px] text-zinc-400" title={c.via === "reference" ? "explicit reference" : "name/alias mention"}>
                {c.via === "reference" ? "linked" : "mentions"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
