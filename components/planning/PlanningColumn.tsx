"use client";

/**
 * Planning column (LIFEOS-037, Feature 2). One horizon column with a drop target,
 * a collapse toggle, and its ordered cards. Dropping (or the card move menu)
 * changes only the horizon + order.
 */

import type { BoardColumn } from "@/lib/planning/board";
import type { PlanningHorizon } from "@/types/mvp";
import { HORIZON_LABEL } from "@/lib/planning/horizon";
import PlanningCard from "@/components/planning/PlanningCard";

export default function PlanningColumn({ column, selected, activeKey, collapsed, onToggleCollapse, onToggleSelect, onMove, onRemove, onDrop, onDragStartCard }: {
  column: BoardColumn;
  selected: Set<string>;
  activeKey?: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleSelect: (refKey: string) => void;
  onMove: (refKey: string, h: PlanningHorizon) => void;
  onRemove: (refKey: string) => void;
  onDrop: (h: PlanningHorizon) => void;
  onDragStartCard: (refKey: string) => void;
}) {
  return (
    <section
      data-column={column.horizon}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop(column.horizon); }}
      className="flex min-w-[220px] flex-1 flex-col rounded-2xl border border-black/[.07] bg-black/[.01] p-2 dark:border-white/[.09] dark:bg-white/[.02]"
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <button type="button" onClick={onToggleCollapse} className="flex items-center gap-1 text-xs font-semibold" aria-expanded={!collapsed}>
          <span aria-hidden className="text-[10px] text-zinc-400">{collapsed ? "▸" : "▾"}</span>
          {HORIZON_LABEL[column.horizon]}
        </button>
        <span className="text-[10px] text-zinc-400">{column.cards.length}</span>
      </header>
      {!collapsed && (
        column.cards.length === 0
          ? <p className="px-1 py-4 text-center text-[11px] text-zinc-400">Drop here</p>
          : <ul className="flex flex-col gap-1.5">
              {column.cards.map((card) => {
                const refKey = `${card.assignment.ref.kind}:${card.assignment.ref.id}`;
                return (
                  <PlanningCard
                    key={refKey}
                    card={card}
                    selected={selected.has(refKey)}
                    active={activeKey === refKey}
                    onToggle={() => onToggleSelect(refKey)}
                    onMove={(h) => onMove(refKey, h)}
                    onRemove={() => onRemove(refKey)}
                    onDragStart={() => onDragStartCard(refKey)}
                  />
                );
              })}
            </ul>
      )}
    </section>
  );
}
