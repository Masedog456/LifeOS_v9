"use client";

/**
 * Theme Evolution (LIFEOS-026, Feature 3) — the index.
 *
 * Recurring concepts across the user's whole history (attention, identity,
 * freedom, ego, meditation, justice, love, death, …), each with how often it
 * appears and over what span. A theme is an existing world-model concept;
 * connections are drawn deterministically from explicit references and from the
 * concept's name/aliases appearing in a record. Read-only projection.
 */

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildThemes } from "@/lib/memory/themes";

function span(firstAt?: string, lastAt?: string): string {
  const f = firstAt ? new Date(firstAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
  const l = lastAt ? new Date(lastAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
  if (f && l && f !== l) return `${f} – ${l}`;
  return f || l || "";
}

export default function ThemesPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const themes = useMemo(() => buildThemes(state, { min: 2 }), [state]);

  if (!mounted) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Finding your themes…</p></main>;
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Themes</h1>
        <p className="mt-1 text-sm text-zinc-500">
          The ideas you return to. Each theme gathers every belief, capture, dialogue, research project, synthesis, and open tension that touches it — all clickable, all derived from what you already wrote.
        </p>
      </header>

      {themes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
          No recurring themes yet. As concepts appear across more of your records, they surface here. Build your world model in the <Link href="/world" className="underline underline-offset-4">World</Link> view.
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {themes.map((t) => (
            <li key={t.id}>
              <Link href={`/themes/${t.id}`} className="block rounded-2xl border border-black/[.08] p-4 transition-colors hover:bg-black/[.02] dark:border-white/[.10] dark:hover:bg-white/[.03]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{t.name}</p>
                    {t.aliases.length > 0 && <p className="mt-0.5 text-[11px] text-zinc-400">also: {t.aliases.join(", ")}</p>}
                  </div>
                  <span className="shrink-0 text-[11px] text-zinc-400">{t.total} connection{t.total === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Sparkline buckets={t.buckets} />
                  <span className="shrink-0 text-[10px] text-zinc-400">{span(t.firstAt, t.lastAt)}</span>
                </div>
                <p className="mt-2 flex flex-wrap gap-1 text-[10px] text-zinc-400">
                  {t.beliefs.length > 0 && <span>{t.beliefs.length} belief{t.beliefs.length === 1 ? "" : "s"}</span>}
                  {t.captures.length > 0 && <span>· {t.captures.length} capture{t.captures.length === 1 ? "" : "s"}</span>}
                  {t.dialogues.length > 0 && <span>· {t.dialogues.length} dialogue{t.dialogues.length === 1 ? "" : "s"}</span>}
                  {t.research.length > 0 && <span>· {t.research.length} research</span>}
                  {t.syntheses.length > 0 && <span>· {t.syntheses.length} synthesis</span>}
                  {t.tensions.length > 0 && <span className="text-amber-500">· {t.tensions.length} open tension{t.tensions.length === 1 ? "" : "s"}</span>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function Sparkline({ buckets }: { buckets: { month: string; count: number }[] }) {
  if (buckets.length === 0) return <span className="text-[10px] text-zinc-300">—</span>;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <span className="flex h-8 items-end gap-0.5" aria-hidden>
      {buckets.map((b) => (
        <span
          key={b.month}
          className="w-1.5 rounded-sm bg-zinc-300 dark:bg-zinc-600"
          style={{ height: `${Math.max(10, (b.count / max) * 100)}%` }}
          title={`${b.month}: ${b.count}`}
        />
      ))}
    </span>
  );
}
