"use client";

/**
 * Planning card (LIFEOS-037, Feature 2). A compact card for one planned record.
 * Draggable, keyboard-movable, and multi-selectable. A move changes ONLY the
 * horizon + order — never the record's status/priority/hierarchy. Orphaned
 * references (missing record) are shown so the user can clean them up.
 */

import Link from "next/link";
import type { PlanningCard as Card } from "@/lib/planning/board";
import type { PlanningHorizon } from "@/types/mvp";
import { HORIZON_LABEL, BOARD_COLUMNS } from "@/lib/planning/horizon";
import { ENTITY_LABEL } from "@/lib/entities/entity";

export default function PlanningCard({ card, selected, active, onToggle, onMove, onRemove, onDragStart }: {
  card: Card;
  selected: boolean;
  active: boolean;
  onToggle: () => void;
  onMove: (h: PlanningHorizon) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const refKey = `${card.assignment.ref.kind}:${card.assignment.ref.id}`;
  return (
    <li
      data-card={refKey}
      data-horizon={card.assignment.horizon}
      draggable
      onDragStart={onDragStart}
      className={`rounded-xl border p-2.5 text-xs ${active ? "border-sky-500/60 bg-sky-500/[.05]" : "border-black/[.07] dark:border-white/[.09]"} ${card.meta.exists ? "" : "opacity-60"}`}
    >
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${card.meta.title}`} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {card.meta.exists && card.meta.href ? (
            <Link href={card.meta.href} className="block truncate font-medium text-zinc-800 hover:underline dark:text-zinc-100">{card.meta.title}</Link>
          ) : (
            <span className="block truncate font-medium text-zinc-500">{card.meta.title}{!card.meta.exists && " (missing)"}</span>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400">
            <span className="rounded-full bg-black/[.06] px-1.5 dark:bg-white/[.08]">{ENTITY_LABEL[card.meta.kind] ?? card.meta.kind}</span>
            {card.meta.context && <span>· {card.meta.context}</span>}
            {(card.meta.tags ?? []).slice(0, 2).map((t) => <span key={t} className="rounded-full bg-black/[.06] px-1.5 dark:bg-white/[.08]">{t}</span>)}
          </div>
        </div>
      </div>
      {/* Move menu — keyboard/mobile friendly; the same effect as drag-drop. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {BOARD_COLUMNS.filter((h) => h !== card.assignment.horizon).map((h) => (
          <button key={h} type="button" onClick={() => onMove(h)} data-move={h} className="rounded-full border border-black/[.10] px-1.5 py-0.5 text-[9px] text-zinc-500 hover:bg-black/[.04] dark:border-white/[.12] dark:hover:bg-white/[.06]">→ {HORIZON_LABEL[h]}</button>
        ))}
        <button type="button" onClick={onRemove} aria-label="Remove from planning" className="ml-auto text-[10px] text-zinc-400 hover:text-rose-500">✕</button>
      </div>
    </li>
  );
}
