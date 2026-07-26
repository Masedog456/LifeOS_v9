"use client";

/**
 * BacklinksPanel (LIFEOS-029, Feature 3) — the inspector "Backlinks" tab.
 * Deterministic "who links to me?", grouped by source kind; each backlink opens
 * the originating record in the inspector.
 */

import { useMemo } from "react";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext } from "@/lib/entities/entity";
import { entityBacklinks } from "@/lib/entities/backlinks";
import EntityLink from "@/components/entity/EntityLink";

export default function BacklinksPanel({ kind, id }: { kind: string; id: string }) {
  const state = useStore();
  const groups = useMemo(() => entityBacklinks(makeEntityContext(state), kind, id), [state, kind, id]);

  if (groups.length === 0) return <p className="p-4 text-sm text-zinc-400">Nothing links here yet.</p>;

  return (
    <div className="flex flex-col gap-3 p-4">
      {groups.map((g) => (
        <section key={g.kind}>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{g.label} · {g.items.length}</h3>
          <ul className="flex flex-col gap-1">
            {g.items.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                <EntityLink kind={r.kind} id={r.id} className="block truncate text-left text-[13px] text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200">{r.title}</EntityLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
