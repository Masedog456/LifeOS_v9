"use client";

/**
 * Author page (LIFEOS-028, Feature 10).
 *
 * A derived projection — authors are plain names (no duplicate author entity),
 * so this groups every document by that author and surfaces the knowledge those
 * documents produced (via citations): related captures, beliefs, concepts, and
 * research. Deterministic and read-only.
 */

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/mvpStore";
import { documentsByAuthor } from "@/lib/library/documents";
import { citationsForDocument } from "@/lib/library/citations";
import { resolveRecord } from "@/lib/command/records";

export default function AuthorPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const params = useParams<{ name: string }>();
  const name = params?.name ? decodeURIComponent(params.name) : "";

  const docs = useMemo(() => documentsByAuthor(state, name), [state, name]);
  const related = useMemo(() => {
    const seen = new Set<string>();
    const out: { kind: string; id: string; title: string; href?: string; removed?: boolean }[] = [];
    for (const d of docs) for (const c of citationsForDocument(state, d.id)) {
      const key = `${c.recordKind}:${c.recordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Broken citation targets (a deleted knowledge record) are shown visibly
      // as "removed" rather than silently dropped — the citation never crashes.
      const live = resolveRecord(state, c.recordKind, c.recordId);
      out.push(live ? { kind: c.recordKind, id: c.recordId, title: live.title, href: live.href } : { kind: c.recordKind, id: c.recordId, title: "(removed)", removed: true });
    }
    return out;
  }, [state, docs]);

  if (!mounted) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/reading" className="text-xs text-zinc-500 underline-offset-4 hover:underline">← Reading</Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-1 text-sm text-zinc-500">{docs.length} document{docs.length === 1 ? "" : "s"} in your library.</p>

      {docs.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-400">No documents by this author.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Documents</h2>
            <ul className="flex flex-col gap-1.5">
              {docs.map((d) => (
                <li key={d.id}>
                  <Link href={`/document/${d.id}`} className="flex items-center gap-2 rounded-xl border border-black/[.06] p-2.5 hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]">
                    <span aria-hidden className="h-8 w-6 shrink-0 rounded" style={{ background: d.coverColor ?? "#e5e7eb" }} />
                    <span className="min-w-0 text-sm text-zinc-800 dark:text-zinc-100">{d.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {related.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Knowledge from these documents</h2>
              <ul className="flex flex-wrap gap-1.5">
                {related.map((r) => (
                  <li key={`${r.kind}:${r.id}`}>
                    {r.href ? (
                      <Link href={r.href} className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] text-zinc-600 hover:underline dark:bg-white/[.06] dark:text-zinc-300">{r.kind}: {r.title.slice(0, 40)}</Link>
                    ) : (
                      <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] text-zinc-400 line-through dark:bg-white/[.06]" title="The linked record was deleted">{r.kind}: {r.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
