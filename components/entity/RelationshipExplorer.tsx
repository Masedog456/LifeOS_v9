"use client";

/**
 * RelationshipExplorer (LIFEOS-029, Features 2 & 7) — the inspector
 * "Relationships" tab. Grouped, navigable relationships (References / Referenced
 * by / Supports / Contradicts / Derived from / Related documents / authors /
 * themes / decisions / Citations). Every item opens in the inspector (one click,
 * cross-links). Collapsible sections remember their state (navigation memory).
 */

import { useMemo } from "react";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityKindLabel } from "@/lib/entities/entity";
import { entityRelationships } from "@/lib/entities/relationships";
import { isSectionExpanded, toggleSection } from "@/lib/entities/inspector";
import EntityLink from "@/components/entity/EntityLink";

export default function RelationshipExplorer({ kind, id }: { kind: string; id: string }) {
  const state = useStore();
  const groups = useMemo(() => entityRelationships(makeEntityContext(state), kind, id), [state, kind, id]);

  if (groups.length === 0) return <p className="p-4 text-sm text-zinc-400">No relationships yet. As you connect this to other records, they appear here.</p>;

  return (
    <div className="flex flex-col gap-3 p-4">
      {groups.map((g) => {
        const key = `rel:${g.key}`;
        const open = isSectionExpanded(key);
        return (
          <section key={g.key}>
            <button type="button" onClick={() => toggleSection(key)} aria-expanded={open} className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              <span>{g.label} · {g.items.length}</span>
              <span aria-hidden>{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {g.items.map((it) => (
                  <li key={`${it.ref.kind}:${it.ref.id}`} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] text-zinc-400">{entityKindLabel(it.ref.kind)}</span>
                    <EntityLink kind={it.ref.kind} id={it.ref.id} className="min-w-0 truncate text-left text-[13px] text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200">
                      {it.ref.title}
                    </EntityLink>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
